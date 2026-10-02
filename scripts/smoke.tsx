/**
 * Headless smoke test.
 *
 * Renders the real dashboard (shell, routes, react-query data fetching) inside
 * jsdom against a running API — by default the built-in demo device — and
 * checks that each page paints real data with no console errors.
 *
 *   npm run dev:api          # or npm run dev
 *   npm run smoke
 */
import { JSDOM } from 'jsdom';
import React from 'react';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8787';

type Expectation = { route: string; expect: string[] };

const ROUTES: Expectation[] = [
  { route: '/', expect: ['CPU', 'Interfaces'] },
  { route: '/explorer', expect: ['Catalogued menus', '277'] },
  { route: '/connections', expect: ['Demo lab'] },
  { route: '/console', expect: ['Console', 'Example commands'] },
  { route: '/settings', expect: ['Appearance', 'Keyboard shortcuts'] },
  { route: '/m/interface', expect: ['ether1', 'bridge1'] },
  { route: '/m/ip/firewall/filter', expect: ['input', 'accept'] },
  { route: '/m/ip/firewall/connection', expect: ['192.168'] },
  { route: '/m/ip/dhcp-server/lease', expect: ['192.168'] },
  { route: '/m/ip/dns', expect: ['1.1.1.1'] },
  { route: '/m/ipv6/address', expect: ['2a02'] },
  { route: '/m/queue/simple', expect: ['guest-wifi'] },
  { route: '/m/interface/wifi/registration-table', expect: ['Accra-Office'] },
  { route: '/m/ppp/active', expect: ['sam15'] },
  { route: '/m/ip/hotspot/active', expect: ['reception-desk'] },
  { route: '/m/interface/wireguard/peers', expect: ['wireguard'] },
  { route: '/m/system/user', expect: ['admin'] },
  { route: '/m/system/resource', expect: ['uptime'] },
  { route: '/m/system/backup', expect: ['backup'] },
  { route: '/m/log', expect: ['log'] },
  { route: '/m/tool/ping', expect: ['Ping'] },
  { route: '/m/tool/torch', expect: ['Run'] },
  { route: '/m/container', expect: ['pihole-dns'] },
  { route: '/m/iot/leds', expect: ['user-led'] },
  { route: '/m/routing/bgp/session', expect: ['to-upstream-1'] },
  { route: '/m/mpls/ldp', expect: [] },
  { route: '/m/this/does/not/exist', expect: ['No menu named'] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const errors: string[] = [];
  const failures: string[] = [];

  /* ----------------------------- jsdom ------------------------------ */
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  const w = dom.window as unknown as Window & typeof globalThis;
  const g = globalThis as any;

  w.addEventListener('error', (e: any) => errors.push(`window.onerror: ${e.message ?? e}`));
  w.scrollTo = () => {};

  const define = (key: string, value: unknown) =>
    Object.defineProperty(g, key, { value, writable: true, configurable: true });

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

  // Surface anything React or the app logs while rendering.
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...args: any[]) => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  console.warn = (...args: any[]) => {
    const text = args.map(String).join(' ');
    if (/Warning: (An update to|Cannot update|Each child|validateDOMNesting)/.test(text)) errors.push(text);
  };
  process.on('unhandledRejection', (reason: any) => errors.push(`unhandledRejection: ${reason?.message ?? reason}`));

  /* --------------------------- the app ------------------------------ */
  const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
  const { MemoryRouter } = await import('react-router-dom');
  const { createRoot } = await import('react-dom/client');
  const { AppProvider } = await import('../src/lib/store');
  const App = (await import('../src/App')).default;

  for (const { route, expect } of ROUTES) {
    errors.length = 0;
    const host = w.document.createElement('div');
    w.document.body.appendChild(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 } } });
    const root = createRoot(host);
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          AppProvider,
          null,
          React.createElement(MemoryRouter, { initialEntries: [route] }, React.createElement(App)),
        ),
      ),
    );

    await sleep(1400);
    const text = (host.textContent ?? '').replace(/\s+/g, ' ');
    const missing = expect.filter((needle) => !text.includes(needle));
    const blank = text.length < 60;
    const crashed = /Something went wrong|Cannot read|is not a function|undefined is not/i.test(text);
    const ok = !missing.length && !blank && !crashed && !errors.length;

    if (!ok) {
      failures.push(route);
      realError(`[FAIL] ${route.padEnd(34)} missing=${JSON.stringify(missing)} blank=${blank} crashed=${crashed} chars=${text.length}`);
      realError(`       text: ${text.slice(0, 220)}`);
      for (const e of errors.slice(0, 3)) realError(`       console: ${e.split('\n')[0].slice(0, 200)}`);
    } else {
      realError(`[ ok ] ${route.padEnd(34)} ${text.length} chars`);
    }

    if (process.env.SMOKE_VERBOSE) realError(`       full: ${text.slice(0, 1400)}\n`);
    root.unmount();
    client.clear();
    host.remove();
    await sleep(50);
  }

  console.error = realError;
  console.warn = realWarn;
  realError(`\n${ROUTES.length - failures.length}/${ROUTES.length} routes rendered cleanly.`);
  if (failures.length) realError(`failed: ${failures.join(', ')}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
