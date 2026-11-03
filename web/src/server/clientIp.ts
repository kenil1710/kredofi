// Which IP a request comes from, for per-visitor rate limits.
// - Through our Cloudflare Worker (kredofi.xyz): the Worker sends Cloudflare's CF-Connecting-IP as
//   x-kredofi-client-ip together with x-kredofi-proxy = PROXY_SECRET. Trusted only when the secret matches.
// - Without the Worker's secret, whenever PROXY_SECRET is set (the Space, any host name): one shared
//   bucket, 'direct'. (Audit Nov 3: matching only *.hf.space hosts depended on Hugging Face rejecting
//   other Host headers, e.g. a trailing dot.)
//   The Space's proxy passes X-Forwarded-For through in a way a visitor can forge (Nov 3: 62 spoofed
//   requests got past a 60/hour limit with the first hop, 22 past 20/min with the rightmost hop), so
//   it is never trusted there. Page loads on the Space address redirect to kredofi.xyz (src/proxy.ts).
// - Without PROXY_SECRET (local runs): the rightmost public X-Forwarded-For hop, else 'local'.
// IPv6 addresses are keyed on their /64 (one home or VPS usually holds a whole /64; audit L2).
import { timingSafeEqual } from 'node:crypto';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]{2,39}$/i;

export function isIp(s: string): boolean {
  const m = IPV4.exec(s);
  if (m) return m.slice(1).every((x) => Number(x) <= 255);
  return IPV6.test(s) && s.includes(':');
}

export function isPrivateIp(s: string): boolean {
  const m = IPV4.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = s.toLowerCase();
  return v === '::1' || v === '::' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** True when the request came through our Worker (the shared secret matches). */
export function viaWorker(headers: Headers, proxySecret: string | undefined = process.env.PROXY_SECRET): boolean {
  const given = headers.get('x-kredofi-proxy');
  return !!(proxySecret && proxySecret.length >= 32 && given && same(given, proxySecret));
}

export const isSpaceHost = (headers: Headers) => /\.hf\.space$/i.test((headers.get('host') ?? '').split(':')[0]);

/** Rate-limit key for an address: IPv4 as is, IPv6 as its /64 prefix ("2001:db8:0:1::/64"). */
export function ipKey(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.toLowerCase().split('::');
  const a = head ? head.split(':') : [], b = tail !== undefined && tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function clientIpFrom(headers: Headers, proxySecret: string | undefined = process.env.PROXY_SECRET): string {
  if (viaWorker(headers, proxySecret)) {
    const ip = headers.get('x-kredofi-client-ip')?.trim() ?? '';
    if (isIp(ip)) return ipKey(ip);
  }
  if (proxySecret) return 'direct';
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (isIp(hops[i]) && !isPrivateIp(hops[i])) return ipKey(hops[i]);
  const real = headers.get('x-real-ip')?.trim();
  return real && isIp(real) ? ipKey(real) : 'local';
}
