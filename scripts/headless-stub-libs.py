#!/usr/bin/env python3
"""Build stub shared libraries so QtWebEngine can load in a bare container.

The `PySide6` wheels (manylinux) link their Qt libraries against X11, audio, DBus,
GPU, NSS and xkbcommon — none of which exist in a minimal sandbox, and none of which
are used by offscreen, CPU-only rendering. This script harvests every symbol those
libraries reference from the Qt build itself (including the symbol *versions*, which
the linker matches exactly), then generates a stub .so providing exactly those
symbols. Point `LD_LIBRARY_PATH` at the output directory and Qt loads.

    python3 scripts/headless-stub-libs.py [output_dir]      # default /tmp/stub

This is a sandbox convenience for `scripts/shoot-ui.py`; it never touches the app.
"""
from __future__ import annotations

import collections
import os
import re
import subprocess
import sys

import PySide6

QT_LIB = os.path.join(os.path.dirname(PySide6.__file__), 'Qt', 'lib')
QT_PLUGINS = os.path.join(os.path.dirname(PySide6.__file__), 'Qt', 'plugins')

# library -> symbol-name patterns it owns
PROVIDERS: dict[str, list[str]] = {
    'libdbus-1.so.3':     [r'^dbus_', r'^DBus'],
    'libnspr4.so':        [r'^PR_', r'^PL_', r'^_PR_'],
    'libnss3.so':         [r'^NSS_', r'^SEC', r'^PK11_', r'^CERT_', r'^SSL_', r'^DTLS_',
                           r'^HASH_', r'^SGN_', r'^VFY_', r'^PORT_', r'^NSS'],
    'libnssutil3.so':     [r'^NSSUTIL_', r'^SECU_', r'^NSS_'],
    'libsmime3.so':       [r'^NSS_CMSSigner', r'^NSS_CMS', r'^SMIME_', r'^NSSSMIME'],
    'libxkbcommon.so.0':  [r'^xkb_', r'^xkbcommon_'],
    'libxkbfile.so.1':    [r'^Xkb'],
    'libgbm.so.1':        [r'^gbm_'],
    'libasound.so.2':     [r'^snd_', r'^_snd_'],
    'libEGL.so.1':        [r'^egl[A-Z]', r'^EGL', r'^eglGetProcAddress'],
    'libGL.so.1':         [r'^gl[A-Z]', r'^glX', r'^GLX'],
    'libXcomposite.so.1': [r'^XComposite'],
    'libXdamage.so.1':    [r'^XDamage'],
    'libXfixes.so.3':     [r'^XFixes'],
    'libXrandr.so.2':     [r'^XRR', r'^XRender'],
    'libXtst.so.6':       [r'^XTest', r'^XRecord'],
    'libxcb-dri3.so.0':   [r'^xcb_dri3'],
}

SKIP_SYMBOLS = {'', '_ITM_deregisterTMCloneTable', '_ITM_registerTMCloneTable', '__gmon_start__'}


def elf_objects() -> list[str]:
    out: list[str] = []
    for root in (QT_LIB, QT_PLUGINS):
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if '.so' in name and os.path.exists(os.path.join(dirpath, name)):
                    out.append(os.path.join(dirpath, name))
    return out


def needed(path: str) -> set[str]:
    text = subprocess.run(['readelf', '-dW', path], capture_output=True, text=True).stdout
    return set(re.findall(r'\(NEEDED\)\s+Shared library: \[([^\]]+)\]', text))


def undefined_symbols(path: str) -> list[tuple[str, str | None]]:
    text = subprocess.run(['readelf', '--dyn-syms', '-W', path], capture_output=True, text=True).stdout
    found: list[tuple[str, str | None]] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 8 or parts[6] != 'UND':
            continue
        name, version = parts[7], None
        if '@' in name:
            name, version = name.split('@', 1)
            version = version.lstrip('@')
        if name and name not in SKIP_SYMBOLS:
            found.append((name, version))
    return found


def main() -> None:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '/tmp/stub'
    os.makedirs(out_dir, exist_ok=True)
    symbols: dict[str, dict[str, str | None]] = collections.defaultdict(dict)

    for obj in elf_objects():
        targets = needed(obj) & set(PROVIDERS)
        if not targets:
            continue
        for name, version in undefined_symbols(obj):
            for lib in targets:
                if any(re.match(pattern, name) for pattern in PROVIDERS[lib]):
                    symbols[lib].setdefault(name, version)
                    break

    written = 0
    for lib, table in sorted(symbols.items()):
        base = lib.split('.so')[0].replace('-', '_').replace('.', '_')
        c_path, map_path = f'{out_dir}/{base}.c', f'{out_dir}/{base}.map'
        with open(c_path, 'w') as fh:
            fh.write('/* Generated stubs — never called on the offscreen rendering path. */\n')
            for sym in table:
                fh.write(f'void {sym}(void) {{}}\n')
        by_version: dict[str, list[str]] = collections.defaultdict(list)
        for sym, version in table.items():
            by_version[version or 'STUB_BASE'].append(sym)
        with open(map_path, 'w') as fh:
            for version, names in by_version.items():
                fh.write(f'{version} {{\n  global:\n')
                for name in sorted(names):
                    fh.write(f'    {name};\n')
                fh.write('  local: *;\n};\n')
        result = subprocess.run(
            ['gcc', '-shared', '-fPIC', f'-Wl,-soname,{lib}', f'-Wl,--version-script={map_path}',
             '-o', f'{out_dir}/{lib}', c_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f'  FAILED {lib}: {result.stderr.splitlines()[:2]}')
        else:
            written += 1
            versions = ', '.join(sorted(v or 'none' for v in by_version))
            print(f'  {lib:22s} {len(table):4d} symbols  [{versions}]')

    print(f'\ngenerated {written} stub libraries in {out_dir}')
    print(f'use them with: LD_LIBRARY_PATH={out_dir} python3 scripts/shoot-ui.py')


if __name__ == '__main__':
    main()
