/**
 * Small, read-only MCP-compatible gateway for network operations agents.
 *
 * This intentionally exposes normalized, bounded tools instead of a raw
 * RouterOS script executor. Mutating tools should be added only after policy,
 * approval, rollback, and audit services exist.
 */
import type { Request, Response } from 'express';
import { getActiveConnection } from './store';
import { getCapabilities } from './probe';
import { getDeviceInfo, getMetrics } from './demo/engine';
import { INSIGHT_PATHS, fetchPaths } from './analytics/collect';
import { buildInsights } from './analytics/insights';
import { createInvestigation, createPlan } from './ai/store';

const SERVER = { name: 'routeros-control-plane', version: '1.0.0' };
const MAX_TEXT = 100_000;

const tools = [
  {
    name: 'get_fleet_summary',
    description: 'Return the configured RouterOS device summary. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_device_health',
    description: 'Return current health metrics for the active RouterOS device. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_device_capabilities',
    description: 'Return RouterOS menu capability results and device metadata. Read-only.',
    inputSchema: { type: 'object', properties: { refresh: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'get_active_findings',
    description: 'Return bounded security, reliability, capacity, and observability findings with evidence. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'identify_device',
    description: 'Build a detailed, evidence-backed identity record for an observed IP address. Read-only.',
    inputSchema: { type: 'object', required: ['ip'], properties: { ip: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'create_hotspot_bypass_plan',
    description: 'Create an approval-required captive portal bypass plan for a verified device. Does not change RouterOS.',
    inputSchema: { type: 'object', required: ['deviceId', 'server', 'reason'], properties: { deviceId: { type: 'string' }, address: { type: 'string' }, macAddress: { type: 'string' }, server: { type: 'string' }, reason: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'create_investigation',
    description: 'Create a durable read-only investigation task. Does not change the device.',
    inputSchema: { type: 'object', required: ['title', 'goal', 'deviceIds'], properties: { title: { type: 'string' }, goal: { type: 'string' }, deviceIds: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  },
  {
    name: 'create_change_plan',
    description: 'Create a draft change plan for human review. Does not execute RouterOS changes.',
    inputSchema: { type: 'object', required: ['intent', 'deviceIds', 'risk'], properties: { intent: { type: 'string' }, deviceIds: { type: 'array', items: { type: 'string' } }, risk: { enum: ['low', 'medium', 'high', 'critical'] }, preconditions: { type: 'array', items: { type: 'string' } }, verification: { type: 'array', items: { type: 'string' } }, rollback: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  },
];

const text = (value: unknown) => JSON.stringify(value, null, 2).slice(0, MAX_TEXT);
const result = (value: unknown) => ({ content: [{ type: 'text', text: text(value) }], isError: false });
const error = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });

async function callTool(name: string, args: Record<string, unknown>) {
  const connection = getActiveConnection();
  if (!connection) return error('No active RouterOS connection.');
  switch (name) {
    case 'get_fleet_summary':
      return result({
        devices: [{
          id: connection.id,
          name: connection.name,
          host: connection.host,
          mode: connection.demo ? 'demo' : 'live',
          active: true,
          device: connection.demo ? getDeviceInfo() : null,
        }],
        count: 1,
      });
    case 'get_device_health':
      if (!connection.demo) return result({ mode: 'live', note: 'Use the dashboard health API for live metric collection.' });
      return result({ mode: 'demo', observedAt: new Date().toISOString(), metrics: getMetrics() });
    case 'get_device_capabilities':
      return result(await getCapabilities(args.refresh === true));
    case 'identify_device': {
      const ip = String(args.ip ?? '').trim();
      if (!/^[0-9a-fA-F:.]+$/.test(ip)) return error('A valid IPv4 or IPv6 address is required.');
      const paths = ['ip/arp', 'ip/dhcp-server/lease', 'ip/neighbor', 'ipv6/neighbor', 'ip/hotspot/active', 'ip/hotspot/ip-binding', 'interface/wifi/registration-table'];
      const fetched = await fetchPaths(paths);
      const rows = (path: string) => fetched.get(path)?.rows ?? [];
      const match = (path: string) => rows(path).filter((r) => String(r.address ?? r['last-ip'] ?? '') === ip);
      const arp = match('ip/arp');
      const lease = match('ip/dhcp-server/lease');
      const neighbor = match('ip/neighbor');
      const ipv6 = match('ipv6/neighbor');
      const hotspot = match('ip/hotspot/active');
      const binding = [...rows('ip/hotspot/ip-binding')].filter((r) => String(r.address ?? '') === ip);
      const known = [...arp, ...lease, ...neighbor, ...hotspot];
      const mac = known.map((r) => String(r['mac-address'] ?? '')).find(Boolean);
      return result({
        ip, mac, vendor: mac ? (await import('../shared/oui')).vendorForMac(mac) : undefined,
        randomizedMac: mac ? (await import('../shared/oui')).isRandomisedMac(mac) : false,
        names: [...new Set(known.map((r) => String(r['host-name'] ?? r.identity ?? r.user ?? '')).filter(Boolean))],
        interfaces: [...new Set(known.map((r) => String(r.interface ?? '')).filter(Boolean))],
        platform: neighbor[0]?.platform, board: neighbor[0]?.board, version: neighbor[0]?.version,
        dhcp: lease[0] ? { state: lease[0].status, server: lease[0].server, expires: lease[0]['expires-after'] } : null,
        hotspot: { active: hotspot.length > 0, sessions: hotspot, bindings: binding },
        ipv6: ipv6.map((r) => r.address),
        evidence: paths.map((path) => ({ path, rows: rows(path).length, matched: match(path).length, ok: fetched.get(path)?.ok ?? false, error: fetched.get(path)?.error })),
        observedAt: new Date().toISOString(),
      });
    }
    case 'create_hotspot_bypass_plan': {
      const address = args.address ? String(args.address) : '';
      const macAddress = args.macAddress ? String(args.macAddress).toUpperCase() : '';
      if (!String(args.deviceId ?? '') || !String(args.server ?? '') || String(args.reason ?? '').trim().length < 5) return error('deviceId, server, and a reason of at least five characters are required.');
      if (address && !/^[0-9a-fA-F:.]+$/.test(address)) return error('Invalid device IP address.');
      if (macAddress && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(macAddress)) return error('Invalid device MAC address.');
      return result(createPlan({ intent: `Bypass captive portal for ${macAddress || address} on ${String(args.server)}`, deviceIds: [String(args.deviceId)], risk: 'medium', createdBy: 'mcp-agent', actions: [{ id: `action-${Date.now()}`, deviceId: String(args.deviceId), operation: 'create', resource: 'ip/hotspot/ip-binding', description: 'Create an approved hotspot bypass binding', parameters: { ...(address ? { address } : {}), ...(macAddress ? { 'mac-address': macAddress } : {}), server: String(args.server), type: 'bypassed', comment: String(args.reason).trim() }, reversible: true }], preconditions: ['Verify device identity and current MAC/IP association', 'Check for conflicting bindings'], expectedEffects: ['The selected device bypasses captive portal authentication on the selected server'], verification: ['Binding exists with type bypassed and expected target'], rollback: ['Remove the created hotspot IP binding'] }));
    }
    case 'create_investigation':
      if (typeof args.title !== 'string' || typeof args.goal !== 'string' || !Array.isArray(args.deviceIds)) return error('title, goal, and deviceIds are required.');
      return result(createInvestigation({ title: args.title, goal: args.goal, deviceIds: args.deviceIds.map(String), createdBy: 'mcp-agent' }));
    case 'create_change_plan':
      if (typeof args.intent !== 'string' || !Array.isArray(args.deviceIds) || !['low', 'medium', 'high', 'critical'].includes(String(args.risk))) return error('intent, deviceIds, and a valid risk are required.');
      return result(createPlan({ intent: args.intent, deviceIds: args.deviceIds.map(String), risk: String(args.risk) as 'low' | 'medium' | 'high' | 'critical', preconditions: Array.isArray(args.preconditions) ? args.preconditions.map(String) : [], verification: Array.isArray(args.verification) ? args.verification.map(String) : [], rollback: Array.isArray(args.rollback) ? args.rollback.map(String) : [], createdBy: 'mcp-agent' }));
    case 'get_active_findings': {
      const fetched = await fetchPaths([...INSIGHT_PATHS]);
      const bundle = buildInsights(fetched, connection.demo ? 'demo' : 'live');
      return result({
        score: bundle.score,
        findings: bundle.findings.slice(0, 100),
        observedAt: new Date().toISOString(),
        caveat: 'Findings are evidence-backed observations, not autonomous change instructions.',
      });
    }
    default:
      return error(`Unknown tool: ${name}`);
  }
}

/** JSON-RPC HTTP handler. It is mounted beneath the existing authenticated API. */
export async function handleMcp(req: Request, res: Response): Promise<unknown> {
  const message = req.body ?? {};
  const id = message.id ?? null;
  const reply = (resultValue: unknown) => res.json({ jsonrpc: '2.0', id, result: resultValue });
  const fail = (code: number, messageText: string) => res.json({ jsonrpc: '2.0', id, error: { code, message: messageText } });

  if (message.jsonrpc !== '2.0') return fail(-32600, 'Invalid JSON-RPC request.');
  try {
    switch (message.method) {
      case 'initialize':
        return reply({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false }, resources: {} }, serverInfo: SERVER });
      case 'notifications/initialized':
        return res.status(204).end();
      case 'tools/list':
        return reply({ tools });
      case 'tools/call': {
        const params = message.params ?? {};
        if (typeof params.name !== 'string') return fail(-32602, 'tools/call requires params.name.');
        return reply(await callTool(params.name, (params.arguments ?? {}) as Record<string, unknown>));
      }
      case 'resources/list':
        return reply({ resources: [] });
      case 'ping':
        return reply({});
      default:
        return fail(-32601, `Method not found: ${String(message.method)}`);
    }
  } catch (err) {
    return fail(-32000, err instanceof Error ? err.message : 'MCP tool failed.');
  }
}
