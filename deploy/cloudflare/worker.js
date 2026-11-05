// kredofi.xyz -> the Hugging Face Space, as a reverse proxy: the address bar stays kredofi.xyz.
// www.kredofi.xyz and plain HTTP redirect to https://kredofi.xyz. Bodies stream both ways (no buffering).
// Client IP: Cloudflare's CF-Connecting-IP (set by Cloudflare's edge, a visitor can't forge it) goes to
// the app as x-kredofi-client-ip, with x-kredofi-proxy = PROXY_SECRET (a Worker secret) so the app
// trusts that IP only from this Worker (web/src/server/clientIp.ts). Visitor-sent x-kredofi-* headers
// are dropped. Deployed by scripts/cf_worker.py.
// GET and HEAD: a stuck upstream gets a timeout and one retry, then a short 504, so a visitor never waits
// minutes. The timeout covers only the wait for response headers: a body already streaming is left alone.
// POST is never retried (a score or relay must not run twice).
export const ORIGIN = 'https://kenil1710-kredofi.hf.space';
export const SITE = 'kredofi.xyz';
export const PAGE_TIMEOUT_MS = 12_000;
export const API_TIMEOUT_MS = 30_000; // ledger and passbook read the chain, so they can be slow on a cold cache

async function attempt(target, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(target, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer); // headers are in: from here the abort must never cut the body
  }
}

function gaveUp(isApi) {
  const headers = { 'cache-control': 'no-store', 'retry-after': '15' };
  if (isApi) return Response.json({ error: 'The server took too long. Try again in a few seconds.' }, { status: 504, headers });
  const page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KredoFi</title><body style="font:16px/1.5 system-ui,sans-serif;background:#E6EAE1;color:#10302A;padding:48px 16px;max-width:520px;margin:auto"><h1 style="font-size:24px">The server took too long</h1><p>Nothing was lost. Reload this page in a few seconds.</p>';
  return new Response(page, { status: 504, headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

async function getWithRetry(target, init, path, ms) {
  const started = Date.now();
  for (const n of [1, 2]) {
    try {
      const res = await attempt(target, init, ms);
      if (n > 1 || Date.now() - started > 5000) console.log(JSON.stringify({ upstream: 'slow', path, attempts: n, ms: Date.now() - started, status: res.status }));
      return { res, attempts: n, ms: Date.now() - started };
    } catch (e) {
      console.log(JSON.stringify({ upstream: 'failed', path, attempt: n, ms: Date.now() - started, error: e?.name ?? 'error' }));
    }
  }
  return { res: null, attempts: 2, ms: Date.now() - started };
}

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
    const target = ORIGIN + url.pathname + url.search;
    const init = { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual' };
    let res = null;
    let timing = null;
    if (hasBody) {
      res = await fetch(target, init);
    } else {
      const isApi = url.pathname.startsWith('/api/');
      timing = await getWithRetry(target, init, url.pathname, isApi ? API_TIMEOUT_MS : PAGE_TIMEOUT_MS);
      if (!timing.res) return gaveUp(isApi);
      res = timing.res;
    }
    const out = new Response(res.body, res); // streams; keeps status, headers and every Set-Cookie
    if (timing) {
      out.headers.set('x-kredofi-attempts', String(timing.attempts));
      out.headers.append('server-timing', `upstream;dur=${timing.ms}`);
    }
    const loc = out.headers.get('location');
    if (loc && loc.startsWith(ORIGIN)) out.headers.set('location', `https://${SITE}` + loc.slice(ORIGIN.length));
    return out;
  },
};
