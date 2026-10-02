/**
 * Headless smoke test.
 *
 * Runs the real dashboard against the running API (demo device by default) inside
 * jsdom, visits every route, and fails if the console reports an error or a page
 * renders the error boundary / blank tree.
 *
 * Usage:  npm run dev:api   (in another terminal)
 *         npx tsx scripts/smoke.tsx
 */
import { JSDOM } from 'jsdom';
import { createServer, type ViteDevServer } from 'vite';
import React from 'react';

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8787';

const ROUTES: [string, string][] = [
  ['/', 'CPU'],
  ['/explorer', 'API explorer'],
  ['/connections', 'Demo lab'],
  ['/console', 'Console'],
  ['/settings', 'Appearance'],
  ['/m/interface', 'ether1'],
  ['/m/ip/firewall/filter', 'input'],
  ['/m/ip/firewall/connection', '192.168.'],
  ['/m/ip/dhcp-server/lease', '192.168.'],
  ['/m/ip/dns', '1.1.1.1'],
  ['/m/queue/simple', 'guest-wifi'],
  ['/m/interface/wifi/registration-table', 'Accra-Office'],
  ['/m/ppp/active', 'sam15'],
  ['/m/ip/hotspot/active', 'reception-desk'],
  ['/m/interface/wireguard/peers', 'Endpoint Address'],
  ['/m/system/user', 'admin'],
  ['/m/system/backup', 'Create backup'],
  ['/m/log', 'log'],
  ['/m/tool/ping', 'Run'],
  ['/m/tool/torch', 'Run'],
  ['/m/container', 'pihole-dns'],
  ['/m/iot/leds', 'user-led'],
  ['/m/ipv6/address', '2a02:1348'],
  ['/m/routing/bgp/session', 'to-upstream-1'],
  ['/m/system/resource', 'uptime'],
  ['/m/this/does/not/exist', 'not'],
];

async function main() {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ---- jsdom environment -------------------------------------------------
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:5173/',
    pretendToBeVisual: true,
  });
  dom.window.scrollTo = () => {};
  const g = globalThis as any;
  const define = (key: string, value: unknown) => {
    Object.defineProperty(g, key, { value, writable: true, configurable: true });
  };
  define('window', dom.window);
  define('document', dom.window.document);
  define('navigator', dom.window.navigator);
  define('location', dom.window.location);
  define('history', dom.window.history);
  define('localStorage', dom.window.localStorage);
  define('sessionStorage', dom.window.sessionStorage);
  g.HTMLElement = dom.window.HTMLElement;
  g.Element = dom.window.Element;
  g.Node = dom.window.Node;
  g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.CustomEvent = dom.window.CustomEvent;
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
  g.cancelAnimationFrame = (id: any) => clearTimeout(id);
  g.EventSource = class { close() {} addEventListener() {} };
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.scrollTo = () => {};

  const nativeFetch = globalThis.fetch;
  g.fetch = (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    return nativeFetch(url.startsWith('http') ? url : `${API}${url}`, init);
  };

  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args: any[]) => { errors.push(args.map(String).join(' ')); };
  console.warn = (...args: any[]) => { warnings.push(args.map(String).join(' ')); };

  // ---- vite (transforms TSX + aliases for node) --------------------------
  const vite: ViteDevServer = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    logLevel: 'error',
  });

  const mods = await vite.ssrLoadModule('/scripts/smoke-entry.tsx');
  const { mount } = mods as { mount: (container: Element, route: string) => Promise<() => void> };

  let failed = 0;
  for (const [route, expect] of ROUTES) {
    errors.length = 0;
    g.history.pushState({}, '', route);
    const container = dom.window.document.createElement('div');
    dom.window.document.body.innerHTML = '';
    dom.window.document.body.appendChild(container);
    try {
      const unmount = await mount(container, route);
      await new Promise((r) => setTimeout(r, 1400));
      const html = container.innerHTML;
      const main = container.querySelector('main') ?? container;
      const visible = main.textContent ?? '';
      const bad = /Maximum update depth|Objects are not valid|Cannot read|undefined is not a function|is not defined/i.test(html);
      const has = visible.includes(expect);
      const status = errors.length || bad || !has || visible.length < 40 ? 'FAIL' : 'ok  ';
      if (status === 'FAIL') failed++;
      origError(`[${status}] ${route.padEnd(40)} ${has ? `shows "${expect}"` : `MISSING "${expect}"`} · ${visible.length} chars${errors.length ? ` · ${errors.length} console errors` : ''}`);
      for (const e of errors.slice(0, 2)) origError(`        ↳ ${e.split('\n')[0].slice(0, 220)}`);
      if (status === 'FAIL') origError(`        text: ${visible.replace(/\s+/g, ' ').slice(0, 300)}`);
      unmount();
    } catch (err) {
      failed++;
      origError(`[FAIL] ${route.padEnd(40)} threw: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  console.error = origError;
  console.warn = origWarn;
  await vite.close();
  origError(`\n${ROUTES.length - failed}/${ROUTES.length} routes rendered cleanly.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
