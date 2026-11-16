import dns from 'node:dns/promises';
import net from 'node:net';

export interface TargetCheck {
  ok: boolean;
  reason?: string;
  host?: string;
  port?: number;
  addresses?: string[];
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

/** Private, loopback, link-local, CGNAT, multicast, reserved and metadata ranges. */
export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map((n) => Number.parseInt(n, 10));
    if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('ff')) return true; // multicast
    if (lower.startsWith('64:ff9b')) return true; // NAT64
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice(7);
      if (net.isIP(mapped) === 4) return isPrivateAddress(mapped);
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Validate a community server target before it is ever polled (§7, §6.13).
 * Only IP literals or public hostnames are accepted; every resolved address
 * must be public. Anything else is rejected with a neutral message.
 */
export async function checkTarget(hostInput: string, portInput: number | string): Promise<TargetCheck> {
  const host = String(hostInput ?? '').trim().toLowerCase();
  const port = typeof portInput === 'number' ? portInput : Number.parseInt(String(portInput ?? ''), 10);

  if (!host) return { ok: false, reason: 'Adresse manquante.' };
  if (!/^[a-z0-9._:-]+$/.test(host)) return { ok: false, reason: 'Format d’adresse invalide.' };
  if (host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    return { ok: false, reason: 'Format d’adresse invalide.' };
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: 'Adresse interne refusée.' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: 'Port invalide (1–65535).' };
  if (port < 1024) return { ok: false, reason: 'Les ports privilégiés (< 1024) ne sont pas acceptés.' };

  // Bare numbers (e.g. http://2130706433/) are a classic filter bypass.
  if (/^\d+$/.test(host)) return { ok: false, reason: 'Format d’adresse invalide.' };

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) return { ok: false, reason: 'Adresse privée ou réservée refusée.' };
    return { ok: true, host, port, addresses: [host] };
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length) return { ok: false, reason: 'Nom d’hôte introuvable.' };
    for (const record of records) {
      if (isPrivateAddress(record.address)) {
        return { ok: false, reason: 'Le nom d’hôte résout vers une adresse interne.' };
      }
    }
    return { ok: true, host, port, addresses: records.map((r) => r.address) };
  } catch {
    return { ok: false, reason: 'Nom d’hôte introuvable.' };
  }
}

/** Parse and validate the `IP:port` string submitted by a player. */
export function parseHostPort(value: string): { host: string; port: number } | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 253) return null;
  let host = '';
  let portStr = '';
  if (raw.startsWith('[')) {
    const closing = raw.indexOf(']');
    if (closing === -1) return null;
    host = raw.slice(1, closing);
    if (!raw.startsWith(']:', closing)) return null;
    portStr = raw.slice(closing + 2);
  } else {
    const idx = raw.lastIndexOf(':');
    if (idx === -1) return null;
    host = raw.slice(0, idx);
    portStr = raw.slice(idx + 1);
  }
  const port = Number.parseInt(portStr, 10);
  if (!/^\d{1,5}$/.test(portStr)) return null;
  if (!host) return null;
  return { host, port };
}
