#!/usr/bin/env python3
"""Screenshot the running dashboard with a real Chromium engine (QtWebEngine).

Why this exists
---------------
The CI/sandbox image has no browser and cannot install distro packages, but it can
reach PyPI. `PySide6` ships QtWebEngine — a full Chromium — together with the Qt
runtime. Once the handful of X11/audio/dbus/GPU libraries it links against are
stubbed out (see `headless-stub-libs.py`) and the offscreen platform plugin is used,
that Chromium renders the app exactly as a desktop browser would, on the CPU.

Output: one tall PNG per view, written to SHOT_OUT (default `../ui-preview`).
Captures go through `printToPdf` because it is the reliable headless path, then
PyMuPDF rasterizes and trims the blank remainder of the page.

Usage (API must be running on :8787 and `dist/` built):
    python3 scripts/headless-stub-libs.py            # writes stubs to /tmp/stub
    LD_LIBRARY_PATH=/tmp/stub python3 scripts/shoot-ui.py
"""
from __future__ import annotations

import os
import sys

sys.setdlopenflags(os.RTLD_LAZY | os.RTLD_GLOBAL)

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
os.environ.setdefault('QT_QUICK_BACKEND', 'software')          # no GL: render on the CPU
os.environ.setdefault('QTWEBENGINE_CHROMIUM_FLAGS',
                      '--no-sandbox --disable-gpu --disable-gpu-compositing --disable-dev-shm-usage')

import pymupdf  # noqa: E402  (import after env is prepared)
from PySide6.QtCore import QEventLoop, QMarginsF, QSizeF, QTimer, QUrl  # noqa: E402
from PySide6.QtGui import QPageLayout, QPageSize  # noqa: E402
from PySide6.QtWebEngineWidgets import QWebEngineView  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

BASE = os.environ.get('SHOT_BASE', 'http://127.0.0.1:8787')
# Absolute, normalised: Chromium's PDF writer mishandles paths containing '..'.
OUT = os.path.abspath(os.environ.get('SHOT_OUT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'ui-preview')))
CSS_WIDTH, CSS_HEIGHT = 1600, 2000        # CSS px per printed page
PT = 72.0 / 96.0                          # CSS px -> points
ZOOM = 1.25                               # PDF -> PNG scale

# route, file, seconds to wait for data, optional JS run before capture
SHOTS: list[tuple[str, str, int, str | None]] = [
    ('/', '01-dashboard.png', 7, None),
    ('/topology', '02-topology.png', 8, None),
    ('/devices', '03-devices.png', 7, None),
    ('/insights', '04-insights.png', 9, "clickByText('Alerts')"),
    ('/traffic', '05-traffic.png', 8, "clickByText('Deep inspection'); setTimeout(() => clickByText('New matcher'), 900)"),
    ('/explorer', '06-explorer.png', 7, None),
    ('/m/ip/firewall/filter', '07-menu-firewall.png', 7, None),
]

CLICK_JS = """
window.clickByText = (label) => {
  const wanted = String(label).toLowerCase();
  const all = [...document.querySelectorAll('button, a, [role="tab"]')];
  const el = all.find((e) => (e.textContent || '').trim().toLowerCase() === wanted)
          || all.find((e) => (e.textContent || '').trim().toLowerCase().includes(wanted));
  if (!el) return 'not-found: ' + label;
  el.click();
  return 'clicked: ' + label;
};
"""


def content_rows(pix) -> int:
    """Last row differing from the page's dominant (background) colour."""
    background = pix.pixel(2, 2)
    last = 0
    for y in range(0, pix.height, 2):
        for x in range(0, pix.width, 8):
            if pix.pixel(x, y) != background:
                last = y
                break
    return min(pix.height, last + 12)


def crop_rows(pix, rows: int):
    """Return a pixmap with only the first `rows` pixel rows (PyMuPDF has no clip ctor)."""
    if rows >= pix.height:
        return pix
    data = pix.samples[: pix.width * rows * pix.n]
    return pymupdf.Pixmap(pix.colorspace, pix.width, rows, data, pix.alpha)


def stack_pdf(path: str, out_png: str, max_height: int = 7000) -> tuple[int, int]:
    """Stack printed pages into one tall image, dropping blank trailing pages — the
    app is a fixed-height layout, so anything past page 1 is empty background."""
    doc = pymupdf.open(path)
    parts = []
    used = 0
    for page in doc:
        pix = page.get_pixmap(matrix=pymupdf.Matrix(ZOOM, ZOOM), alpha=False)
        rows = content_rows(pix)
        if rows <= 20 and parts:
            continue
        height = min(rows, max_height - used)
        if height <= 0:
            break
        parts.append(crop_rows(pix, height))
        used += height
    if not parts:
        raise RuntimeError(f'{path}: no content found')
    sheet = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, parts[0].width, used))
    sheet.clear_with(255)
    y = 0
    for part in parts:
        sheet.copy(part, pymupdf.IRect(0, y, part.width, y + part.height))
        y += part.height
    sheet.save(out_png)
    doc.close()
    return sheet.width, sheet.height


def main() -> None:
    app = QApplication(sys.argv)
    view = QWebEngineView()
    view.resize(CSS_WIDTH, CSS_HEIGHT)
    view.show()
    os.makedirs(OUT, exist_ok=True)

    results: list[str] = []
    for route, filename, wait_s, js in SHOTS:
        loop = QEventLoop()
        loaded = {'ok': False}

        def on_load(ok: bool) -> None:
            loaded['ok'] = ok
            QTimer.singleShot(int(wait_s * 1000), loop.quit)

        view.loadFinished.connect(on_load)
        view.load(QUrl(BASE + route))
        QTimer.singleShot(int((wait_s + 25) * 1000), loop.quit)      # hard ceiling
        loop.exec()
        view.loadFinished.disconnect(on_load)

        clicked = None
        if js:
            result: dict[str, object] = {}
            inner = QEventLoop()
            view.page().runJavaScript(CLICK_JS + js, lambda value: (result.update(value=value), inner.quit()))
            QTimer.singleShot(6000, inner.quit)
            inner.exec()
            clicked = result.get('value')
            settle = QEventLoop()
            QTimer.singleShot(2500, settle.quit)                      # let the UI react
            settle.exec()

        pdf_path = os.path.join(OUT, 'ui-shot.tmp.pdf')
        layout = QPageLayout(
            QPageSize(QSizeF(CSS_WIDTH * PT, CSS_HEIGHT * PT), QPageSize.Unit.Point),
            QPageLayout.Orientation.Portrait,
            QMarginsF(0, 0, 0, 0),
        )
        printing = QEventLoop()
        view.page().pdfPrintingFinished.connect(lambda *_: printing.quit())
        view.page().printToPdf(pdf_path, layout)
        QTimer.singleShot(30000, printing.quit)
        printing.exec()

        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 1000:
            width, height = stack_pdf(pdf_path, os.path.join(OUT, filename))
            flag = '' if loaded['ok'] else '  LOAD-FAILED'
            results.append(f'[ ok ] {filename:26s} {width}x{height}{flag}{f"  ({clicked})" if clicked else ""}')
        else:
            results.append(f'[FAIL] {filename:26s} no PDF produced')
        if os.path.exists(pdf_path):
            os.remove(pdf_path)

    print('\n'.join(results))
    print(f'\n{sum(1 for r in results if r.startswith("[ ok ]"))}/{len(SHOTS)} screenshots written to {OUT}')


if __name__ == '__main__':
    main()
