# RouterOS Control Plane

A modern, dark, NOC-style dashboard for **MikroTik RouterOS 7** — every REST menu in the catalog, one UI.

It talks to your router through the RouterOS **REST API** (`/rest/...`) via a small Node proxy, so credentials never
reach the browser, and it ships with a **full simulated device** so the whole interface is usable (and demoable)
without any hardware.

<p align="center">
  <em>Overview · command palette (⌘K) · live metrics · 278 REST menus · generic CRUD · script console</em>
</p>

---

## Highlights

- **Every REST menu, catalogued** — 278 endpoints across 18 navigation categories (interfaces, IPv4/IPv6, firewall,
  routing, queues, wireless, PPP, VPN, hotspot, RADIUS, User Manager, system, containers, IoT, MPLS, tools…), each with
  typed fields, commands and availability metadata. 204 list menus, 56 singletons, 18 command menus, 2 228 typed
  property fields.
- **Generic CRUD that actually works** — list pages get sorting, filtering, paging, selection, bulk enable/disable/delete,
  CSV export, schema-driven create/edit forms (only changed properties are PATCHed) and raw JSON.
- **Command runner** — `ping`, `traceroute`, `torch`, `sniffer`, `backup/save/load`, `export`, `reboot`, `reset-configuration`,
  `wireless scan`, `speed-test`, `check-for-updates`, `execute`… with forms for parameters and structured output.
- **Live monitoring** — CPU/memory/disk gauges, RX/TX throughput chart, per-interface counters, DHCP/PPP/Wi-Fi/hotspot
  client counts, alerts, top talkers, log tail, all streamed over SSE in demo mode.
- **Auto-discovering coverage** — the backend probes ~41 core menu paths on the connected device and caches the results,
  so the UI marks menus as **supported / unsupported / unreachable** and hides what your firmware and licence lack.
- **Strategic analytics** — an insights engine scores the device (0–100, graded) across security, reliability,
  capacity, performance, wireless, routing and observability, then explains every deduction with a finding: severity,
  remediation steps, raw evidence and a deep link to the menu that fixes it. Plus capacity/oversubscription maths,
  IPAM & DHCP-pool exhaustion, wireless airtime and weak-client analysis, route-source/BGP/OSPF health and queue
  shaping. Includes a snapshot differ that reports exactly which firewall, NAT, route, DHCP, user or interface
  sections drifted since the baseline. Every read also feeds a **persisted score history** (`data/analytics-history.json`),
  so the page shows whether the network is trending up or down — overall and per component — instead of a single number.
- **Shareable audit report** — one click renders the whole analysis as Markdown (`/api/insights/report`): executive
  summary, score breakdown with trends, findings with remediation and evidence, capacity/IPAM/wireless/routing detail,
  configuration drift since the baseline, the DPI caveat and a coverage/caveat section listing menus that could not be
  read. `?format=json` returns the same thing for automation; `?download=true` saves it as a file.
- **Detailed network map** — the device inventory is merged from DHCP leases → ARP → IPv6 neighbours → bridge hosts →
  wireless registrations → PPP/queue/conntrack evidence and grouped by MAC, resolved to vendor via a built-in OUI
  table. The topology page lays that out as a layered map (internet → uplink → router → bridges/VLANs/tunnels →
  segments) with live link state, per-segment device stacks and utilisation, subnet/source tables and search
  highlighting.
- **Device probing** — select any host and probe it on demand: ICMP, DNS/PTR, DHCP lease detail, DHCPv6, vendor and
  platform identification, plus the evidence trail (which of the eleven discovery sources produced the record).
- **Traffic & flow analytics** — application classes, protocol mix, top ports, top talkers and every tracked
  conversation with byte counts, rates and duration, driven by `/ip/firewall/connection` and the mangle/queue
  counters your router already keeps.
- **Terminal + API explorer** — run RouterOS console scripts and browse/search the whole catalog with live status.
- **NOC ergonomics** — ⌘K (or `/`) command palette, pinned favourites, density switch, light/dark, keyboard shortcuts,
  toasts, empty/loading/error states everywhere.

## Quick start (demo device, no hardware)

```bash
npm install
npm run dev          # API on :8787 + Vite on :5173
```

Open <http://localhost:5173> — a simulated CCR2004 with live counters, DHCP leases, Wi-Fi clients, logs and 278 menus is
already connected. `npm run build && npm start` serves the same UI from the API port at <http://localhost:8787>.

> Demo mode is read/write too: create firewall rules, add queues, run ping — the state machine reacts. `POST /api/demo/reset`
> (or the button in **Settings**) restores the initial state.

## Connecting a real router

RouterOS exposes the REST API from **v7.1beta4**; plain HTTP (`www`) works from **v7.9**, HTTPS (`www-ssl`) is recommended.

1. On the router, enable a web service and create a user with the REST policy:

   ```rsc
   /ip service set www-ssl disabled=no
   /ip service set www disabled=no
   /ip service set www-ssl certificate=rest-cert

   /user group add name=rest-api policy=read,write,api,rest-api,test
   /user add name=dashboard group=rest-api password=CHANGE-ME

   /ip firewall filter add chain=input action=accept protocol=tcp dst-port=443 \
       src-address=10.0.0.0/8 comment="dashboard"
   ```

2. In the dashboard open **Connections → Add connection**, fill in host/port/scheme/user/password (leave *Verify TLS
   certificate* off for self-signed certs) and press **Test connection**. Profiles are stored server-side in
   `data/connections.json` (mode `0600`); the password never leaves the backend.

3. Select the profile — the UI re-probes capabilities and starts talking to the real device.

You can also bootstrap the first profile from the environment (see below); the built-in demo stays available and can be
switched back to at any time.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `API_PORT` | `8787` | API + production UI port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Where connection profiles are persisted |
| `ROUTEROS_HOST` | – | Adds + activates a real connection profile on boot |
| `ROUTEROS_PORT` | `443` | REST port |
| `ROUTEROS_SCHEME` | `https` | `https` (www-ssl) or `http` (www, v7.9+) |
| `ROUTEROS_USER` / `ROUTEROS_PASSWORD` | `admin` / – | REST credentials |
| `ROUTEROS_TLS_VERIFY` | `false` | Verify the router certificate |
| `ROUTEROS_NAME` | host | Display name for the bootstrapped profile |
| `ROS_TIMEOUT_MS` | `15000` | Per-request timeout |
| `PROBE_TTL_MS` | `300000` | Capability probe cache TTL |

Copy `.env.example` to `.env` (loaded by `tsx`/Vite where applicable) or export the variables in your shell.

## Project layout

```
shared/           types.ts + catalog/ — the single source of truth the server AND UI render from
server/           Express API: routeros.ts (REST client), store.ts (profiles), probe.ts, demo/ (simulated device)
server/analytics/ Insights, topology, device inventory, traffic collectors, score history and report rendering
src/              React UI: components/ (table, forms, charts, shell), pages/, lib/ (api client, store, formatting)
scripts/smoke.tsx Headless jsdom smoke test: renders every page against the running API and asserts real data
scripts/gen-icons.mjs Regenerates the tree-shakeable lucide icon registry after adding new icon names
```

| Path | API |
| --- | --- |
| `GET /api/health` | mode, active connection, endpoint count, uptime |
| `GET/POST/PATCH/DELETE /api/connections` | profile CRUD, `:id/activate`, `:id/test` |
| `GET /api/capabilities` · `POST …/refresh` | probe results per menu path |
| `GET /api/dashboard` | metrics bundle for the overview page |
| `GET /api/insights` | score, findings, capacity, IPAM, wireless, routing, queues (`?traffic=true` adds flows) |
| `POST /api/insights/snapshot` | record a baseline; later reads return a section-by-section config diff |
| `GET /api/insights/history` | persisted score series with per-component deltas (device is not touched) |
| `GET /api/insights/report` | Markdown/JSON audit report of the current analysis (`?traffic=true`, `?download=true`) |
| `GET /api/topology` | layered node/link map, segment stats, discovery sources |
| `GET /api/traffic` | application classes, protocol mix, talkers, conversations, DPI capability report |
| `GET /api/device/:ip` | single-host probe: ping, PTR, lease, vendor, platform and evidence |
| `GET /api/stream` | SSE metrics feed |
| `ALL /api/ros/*` | transparent proxy to `/rest/*` (query filters forwarded) |
| `POST /api/console` | run a RouterOS script (`/rest/execute`) |
| `POST /api/demo/reset` · `GET /api/menus` | demo helpers |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API (watch) + Vite dev server |
| `npm run build` | Production bundle into `dist/` |
| `npm start` / `npm run serve` | Serve API + built UI (serve = build then start) |
| `npm run typecheck` | `tsc --noEmit` over server, shared, scripts and UI |
| `npm run smoke` | Renders the real app inside jsdom across 31 routes, 5 click-through interactions and 5 API checks against the running API, asserting live data and zero console errors (needs `npm run dev:api`) |
| `node scripts/gen-icons.mjs` | Rebuild `src/components/iconRegistry.tsx` (explicit icon imports — keeps the main bundle ~124 kB gzipped instead of ~250 kB) |

## Verification

```bash
npm run typecheck   # tsc --noEmit, strict
npm run build       # production bundle
npm run smoke       # needs the API running: npm run dev:api (demo device is fine)
```

The smoke test boots the actual `App` (shell, router, lazy pages, react-query) in jsdom, visits 31 routes — every
page type, the analytics pages, plus list, singleton, command and unknown-menu endpoints — then clicks through five
real interactions (DPI tab, IPAM tab, change tracking, subnet table, device link filter). It fails if a route paints
no data, hits an error state, or logs a console error/warning:

```
[ ok ] /                           6762 chars
[ ok ] /m/ip/firewall/filter       5301 chars
[ ok ] /topology                    6697 chars
[ ok ] /insights                    6587 chars
[ ok ] /traffic                     4977 chars
...
[ ok ] api report (markdown)        7.4 kB
41/41 checks passed (31 routes, 5 interactions, 5 API).
```

## Security notes

- Router credentials live **server-side only**; the browser talks to `/api/*` and can never read a password.
- The proxy refuses paths outside the catalog and forwards filters as-is; all responses are `Cache-Control: no-store`.
- Profiles are written with `0600` permissions and `data/` is git-ignored.
- TLS verification is **on** by default; disable it per profile only for self-signed router certificates.
- The dashboard is not an authenticator: put it behind your own VPN/reverse proxy and use a dedicated
  least-privilege RouterOS user (a read-only group if you only need monitoring).

## Scope & limitations

- REST only — the native binary API (`8728`/`8729`) is intentionally not implemented; REST mirrors the same menus.
- Menus that exist only on certain firmware, boards or licences (e.g. cellular, containers, IoT, MPLS) are detected by
  the capability probe and shown as unsupported rather than failing at click time.
- Some RouterOS operations are inherently long-running (`torch`, `sniffer`, `ping`) — the UI runs them once
  (`once=` style) and shows structured results instead of streaming forever.
- **Deep packet inspection is metadata-only, and the UI says so.** The REST API never exposes packet payloads, so the
  traffic pages classify flows the way the router can: 5-tuple/connection tracking, port and protocol heuristics,
  mangle `layer7-protocol` matchers (with byte/packet counters), and whatever the DHCP/DNS/queue tables reveal. The
  DPI tab therefore reports `payloadInspection: false`, lists the L7 matchers that *are* configured, and shows the
  real paths to payload visibility — port mirroring or `tool/sniffer` streaming into an external sensor (the demo
  models an `ntopng` container on a mirror port), `/tool/torch` for interactivity, and Traffic Flow/IPFIX export.
  Nothing in this dashboard claims to decode application payloads by itself.
