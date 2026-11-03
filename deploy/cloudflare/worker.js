// kredofi.xyz -> the Hugging Face Space, as a reverse proxy: the address bar stays kredofi.xyz.
// www.kredofi.xyz and plain HTTP redirect to https://kredofi.xyz. Bodies stream both ways (no buffering).
// Client IP: Cloudflare's CF-Connecting-IP (set by Cloudflare's edge, a visitor can't forge it) goes to
// the app as x-kredofi-client-ip, with x-kredofi-proxy = PROXY_SECRET (a Worker secret) so the app
// trusts that IP only from this Worker (web/src/server/clientIp.ts). Visitor-sent x-kredofi-* headers
// are dropped. Deployed by scripts/cf_worker.py.
export const ORIGIN = 'https://kenil1710-kredofi.hf.space';
export const SITE = 'kredofi.xyz';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.protocol === 'http:' || url.hostname === `www.${SITE}`) {
      url.protocol = 'https:';
      url.hostname = SITE;
      url.port = '';
      return Response.redirect(url.toString(), 301);
    }
    if (url.hostname !== SITE) return new Response('Not found', { status: 404 });
    if (!env.PROXY_SECRET) return new Response('Proxy not configured', { status: 503 });

    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) {
      if (k.startsWith('x-kredofi-') || k.startsWith('cf-') || k === 'x-forwarded-for' || k === 'x-real-ip' || k === 'host') headers.delete(k);
    }
    headers.set('x-kredofi-client-ip', req.headers.get('cf-connecting-ip') ?? '');
    headers.set('x-kredofi-proxy', env.PROXY_SECRET);
    headers.set('x-forwarded-host', SITE);
    headers.set('x-forwarded-proto', 'https');

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const res = await fetch(ORIGIN + url.pathname + url.search, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual',
    });
    const out = new Response(res.body, res); // streams; keeps status, headers and every Set-Cookie
    const loc = out.headers.get('location');
    if (loc && loc.startsWith(ORIGIN)) out.headers.set('location', `https://${SITE}` + loc.slice(ORIGIN.length));
    return out;
  },
};
