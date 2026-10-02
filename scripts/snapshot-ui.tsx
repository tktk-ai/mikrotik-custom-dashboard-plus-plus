/**
 * Renders the real dashboard in jsdom and saves each page as a standalone HTML file
 * (real DOM + the built stylesheet inlined) that any browser can open with no server.
 *
 *   npx tsx scripts/snapshot-ui.tsx            # needs the API on :8787 and dist/ built
 *
 * Layout fidelity is exact once a real browser lays the file out — jsdom only has to
 * produce the same tree. Interactive behaviour (clicks, live SSE) is not included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React from 'react';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8787';
const OUT = process.env.SNAPSHOT_OUT ?? path.resolve(process.cwd(), '../ui-preview');
const CSS = fs.readdirSync(path.resolve(process.cwd(), 'dist/assets')).find((f) => f.endsWith('.css'));

/** Pages worth showing, in the order a reviewer should look at them. */
const PAGES: Array<{ file: string; route: string; title: string; note: string; wait?: number }> = [
  { file: '01-dashboard.html', route: '/', title: 'Overview', note: 'Live device metrics, interfaces, top talkers, alerts' },
  { file: '02-topology.html', route: '/topology', title: 'Network map', note: 'Layered map — export SVG/PNG, drag to pin, click a link for utilisation' },
  { file: '03-devices.html', route: '/devices', title: 'Device inventory', note: 'Merged from 11 discovery sources · the Sweep button opens bulk probing' },
  { file: '04-insights.html', route: '/insights', title: 'Insights', note: 'Health score, findings, capacity, IPAM, wireless, routing, drift' },
  { file: '05-traffic.html', route: '/traffic', title: 'Traffic & flows', note: 'Application classes, talkers, conversations, DPI tooling' },
  { file: '06-console.html', route: '/console', title: 'Console', note: 'Run RouterOS scripts through /rest/execute' },
  { file: '07-explorer.html', route: '/explorer', title: 'API explorer', note: 'All 278 catalogued REST endpoints with typed fields' },
  { file: '08-menu-firewall.html', route: '/m/ip/firewall/filter', title: 'Generated menu page', note: 'Typed table for /ip/firewall/filter — 278 of these exist' },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const cssFile = CSS ? path.resolve(process.cwd(), 'dist/assets', CSS) : null;
  const css = cssFile ? fs.readFileSync(cssFile, 'utf8') : '';
  fs.mkdirSync(OUT, { recursive: true });

  const dom = new JSDOM('<!doctype html><html class="dark"><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  const w = dom.window as any;
  const g = globalThis as any;
  const define = (key: string, value: unknown) => Object.defineProperty(g, key, { value, writable: true, configurable: true });

  define('window', w);
  define('document', w.document);
  define('navigator', w.navigator);
  define('location', w.location);
  define('history', w.history);
  define('localStorage', w.localStorage);
  g.HTMLElement = w.HTMLElement;
  g.Element = w.Element;
  g.Node = w.Node;
  g.Event = w.Event;
  g.CustomEvent = w.CustomEvent;
  g.MouseEvent = w.MouseEvent;
  g.KeyboardEvent = w.KeyboardEvent;
  g.getComputedStyle = w.getComputedStyle.bind(w);
  g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  g.cancelAnimationFrame = (id: number) => clearTimeout(id);
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  g.EventSource = class { close() {} addEventListener() {} removeEventListener() {} };
  g.scrollTo = () => {};

  const nativeFetch = globalThis.fetch;
  g.fetch = (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    return nativeFetch(url.startsWith('http') ? url : `${API}${url}`, init);
  };

  const problems: string[] = [];
  console.error = (...args: any[]) => problems.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));

  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const { createRoot } = await import('react-dom/client');
  const { AppProvider } = await import('../src/lib/store');
  const App = (await import('../src/App')).default;

  const banner = (title: string, route: string, note: string) => `
  <div style="position:sticky;top:0;z-index:60;display:flex;gap:10px;align-items:center;padding:10px 16px;background:#101a2e;border-bottom:1px solid #24314d;font:500 12.5px/1.4 system-ui,sans-serif;color:#c7d2e4">
    <span style="background:#1d4ed8;color:#fff;border-radius:999px;padding:2px 9px;font-weight:600">static snapshot</span>
    <strong style="color:#e8eefc">${title}</strong>
    <code style="color:#8fa3c4">${route}</code>
    <span style="color:#7d8fb0">${note}</span>
    <span style="margin-left:auto;color:#7d8fb0">rendered from the running app · real DOM + real CSS · no JavaScript</span>
  </div>`;

  for (const page of PAGES) {
    problems.length = 0;
    const host = w.document.createElement('div');
    w.document.body.innerHTML = '';
    w.document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 } } });
    const root = createRoot(host);
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(AppProvider, null, React.createElement(MemoryRouter, { initialEntries: [page.route] }, React.createElement(App))),
      ),
    );
    await sleep(page.wait ?? 1800);

    const text = (host.textContent ?? '').replace(/\s+/g, ' ').trim();
    const html = `<!doctype html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${page.title} — RouterOS Control Plane (static snapshot)</title>
<style>${css}</style>
</head>
<body class="bg-bg text-ink">
${banner(page.title, page.route, page.note)}
${host.outerHTML}
</body>
</html>`;
    fs.writeFileSync(path.join(OUT, page.file), html);
    const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
    console.log(`[ ok ] ${page.file.padEnd(22)} ${kb.padStart(4)} kB  ${text.length} chars of text${problems.length ? `  ⚠ ${problems.length} console errors` : ''}`);
  }

  // A plain-text transcript of every page, for grep-able review.
  const index = [
    '# Static UI snapshots — RouterOS Control Plane',
    '',
    'Generated from the running app (real DOM + the built stylesheet inlined). Open any file',
    'in a browser: layout and styling are computed normally, JavaScript is absent, so clicks',
    'and live streams are not available. Regenerate with `npx tsx scripts/snapshot-ui.tsx`.',
    '',
    ...PAGES.map((page) => `- **${page.title}** — \`${page.file}\` · route \`${page.route}\` — ${page.note}`),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'README.md'), index);
  console.log(`\nwrote ${PAGES.length} snapshots to ${OUT}`);
}

await main();
