// Every internal link in the docs must work: /docs/<slug> pages exist, #anchors exist on their page,
// and other app paths exist as routes (src/app/**/page.tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_PAGES, anchorOf } from './pages.ts';

const APP = join(import.meta.dirname, '..', '..', 'app');
const anchors = (body: string) => new Set([...body.matchAll(/^#{2,3} (.+)$/gm)].map((m) => anchorOf(m[1])));
const links = (body: string) => [...body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);

test('every internal docs link resolves', () => {
  const bad: string[] = [];
  for (const p of DOC_PAGES) {
    for (const href of links(p.body)) {
      if (/^https?:\/\//.test(href)) continue;
      const [path, hash] = href.split('#');
      if (path === '' && hash) { if (!anchors(p.body).has(hash)) bad.push(`${p.slug}: ${href}`); continue; }
      if (path.startsWith('/docs/')) {
        const target = DOC_PAGES.find((d) => d.slug === path.slice(6));
        if (!target) bad.push(`${p.slug}: ${href}`);
        else if (hash && !anchors(target.body).has(hash)) bad.push(`${p.slug}: ${href} (no #${hash})`);
        continue;
      }
      if (!existsSync(join(APP, path, 'page.tsx'))) bad.push(`${p.slug}: ${href} (no route)`);
    }
  }
  assert.deepEqual(bad, []);
});

test('every page is reachable and has a unique slug', () => {
  const slugs = DOC_PAGES.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of ['overview', 'how-it-works', 'borrowers', 'lenders', 'scoring-model', 'privacy', 'verify', 'fees-treasury', 'contracts-api', 'security', 'testnet-vs-mainnet', 'faq', 'roadmap']) {
    assert.ok(slugs.includes(s), s);
  }
});

test('the docs never contain developer account details or secret-looking values', () => {
  const all = DOC_PAGES.map((p) => p.body).join('\n');
  assert.doesNotMatch(all, /715363554c6216e50dbbffd81750f2c6b3b8551c4f3466fdf02eee85cc7543b0/); // owner/dev account
  assert.doesNotMatch(all, /ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/);
  assert.doesNotMatch(all, /hf_[A-Za-z0-9]{20,}/);
});

test('key numbers match the contract and scorer', () => {
  const all = DOC_PAGES.map((p) => p.body).join('\n');
  for (const s of ['$100, $250, $500 and $1,000', 'A 100%, B 75%, C 50%', 'A 4%, B 6%, C 8%', '$104.00', '10% of the pool', '800 to 1,000', '650 to 799', '500 to 649', '250 minus 60']) {
    assert.ok(all.includes(s), s);
  }
});
