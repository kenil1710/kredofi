// kredofi-cron: GitHub skips scheduled workflow runs (Nov 4: nothing from 10:49 for 8+ hours), so Cloudflare's
// cron dispatches them. Its own Worker with no routes, so a bug here can't touch the kredofi.xyz proxy.
// GH_DISPATCH_TOKEN (fine-grained, this repo, Actions read/write) is a secret binding, never logged.
// CRON_MAP (plain JSON binding): cron string -> workflow file. Deployed by scripts/cf_worker.py cron.
// A failed dispatch throws, which shows only in Cloudflare's logs: nobody is emailed from here. The health
// workflow is the alarm: it goes red when no seed tick has run for 3 hours (.github/workflows/health-watch.yml).
// If GitHub and Cloudflare both stop, successful runs stop pinging HC_PING_URL and healthchecks.io emails the owner.
export const REPO = 'kenil1710/kredofi';
// Both run through Nov 26. After the Nov 13 freeze a seed tick seeds nothing, but its ping keeps healthchecks.io green.
export const UNTIL = { 'seed-tick.yml': '2026-11-27T00:00:00Z', 'health-watch.yml': '2026-11-27T00:00:00Z' };

export async function dispatch(workflow, token, fetchFn = fetch) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`;
  const send = () => fetchFn(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'kredofi-cron', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  let res = await send();
  if (res.status >= 500) res = await send(); // one retry on GitHub's side errors only
  if (res.status !== 204) throw new Error(`dispatch ${workflow}: GitHub answered ${res.status}`);
}

export default {
  async scheduled(event, env) {
    const workflow = JSON.parse(env.CRON_MAP)[event.cron];
    if (!workflow) throw new Error(`no workflow for cron ${event.cron}`);
    if (event.scheduledTime >= Date.parse(UNTIL[workflow])) return;
    await dispatch(workflow, env.GH_DISPATCH_TOKEN);
  },
  fetch() { return new Response('Not found', { status: 404 }); },
};
