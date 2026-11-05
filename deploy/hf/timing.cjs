// Preloaded before the Next.js server (node -r ./timing.cjs server.js): response times in the Space logs.
// Logs method, path without query, status and milliseconds; never queries, IPs, headers or bodies.
//   [timing] slow GET /trust 200 ttfb=2100 total=2140     finished after SLOW_MS
//   [timing] open GET /trust 10000                        still unanswered at OPEN_MS, the line a real hang leaves
//   [timing] gone GET /trust ttfb=- total=59700           client left before the answer finished
//   [timing] min n=12 p50=8 p95=40 max=120 open=0 lag=14  one line a minute, only when there was traffic or lag
const http = require('node:http');
const { monitorEventLoopDelay } = require('node:perf_hooks');

const SLOW_MS = Number(process.env.TIMING_SLOW_MS) || 2000;
const OPEN_MS = Number(process.env.TIMING_OPEN_MS) || 10000;
const MINUTE_MS = Number(process.env.TIMING_MINUTE_MS) || 60000;
const LAG_REPORT_MS = 200;

const log = (s) => console.log('[timing] ' + s);
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
let open = 0;
let done = [];

const pathOf = (url) => String(url ?? '').split('?')[0].slice(0, 120);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (name, req, res) {
  if (name === 'request') track(req, res);
  return emit.apply(this, arguments);
};

function track(req, res) {
  const t0 = Date.now();
  const label = `${req.method} ${pathOf(req.url)}`;
  let ttfb = null;
  let ended = false;
  open++;
  const writeHead = res.writeHead;
  res.writeHead = function () {
    if (ttfb === null) ttfb = Date.now() - t0;
    return writeHead.apply(this, arguments);
  };
  const stuck = setTimeout(() => log(`open ${label} ${OPEN_MS}`), OPEN_MS);
  stuck.unref();
  const end = (finished) => {
    if (ended) return;
    ended = true;
    clearTimeout(stuck);
    open--;
    const total = Date.now() - t0;
    done.push(total);
    if (!finished) log(`gone ${label} ttfb=${ttfb ?? '-'} total=${total}`);
    else if (total >= SLOW_MS) log(`slow ${label} ${res.statusCode} ttfb=${ttfb ?? '-'} total=${total}`);
  };
  res.once('finish', () => end(true));
  res.once('close', () => end(res.writableFinished));
}

setInterval(() => {
  const maxLag = Math.round(lag.max / 1e6);
  lag.reset();
  if (!done.length && !open && maxLag < LAG_REPORT_MS) return;
  const a = done.sort((x, y) => x - y);
  done = [];
  log(`min n=${a.length} p50=${a.length ? pct(a, 0.5) : '-'} p95=${a.length ? pct(a, 0.95) : '-'} max=${a.length ? a[a.length - 1] : '-'} open=${open} lag=${maxLag}`);
}, MINUTE_MS).unref();
