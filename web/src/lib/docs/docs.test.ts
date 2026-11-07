import { TRUST_ROWS } from '../trustModel.ts';
import { readFileSync } from 'node:fs';
// Every internal link in the docs must work: /docs/<slug> pages exist, #anchors exist on their page,
// and other app paths exist as routes (src/app/**/page.tsx).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_PAGES, anchorOf, docBySlug } from './pages.ts';

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
  for (const s of ['overview', 'how-it-works', 'borrowers', 'lenders', 'scoring-model', 'privacy', 'verify', 'fees-treasury', 'contracts-api', 'integrate', 'security', 'testnet-vs-mainnet', 'faq', 'roadmap']) {
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
  for (const s of ['$100, $250, $500 and $1,000', 'A 100%, B 75%, C 50%', 'A 4%, B 6%, C 8%', '$104.00', '10% of the pool', '800 to 1,000', '650 to 799', '500 to 649', '250 minus 60', '15 days (half the term)', 'Hold your next loan at least 1 minute to level up.', 'Limits can rise at most once per term (30 days).']) {
    assert.ok(all.includes(s), s);
  }
});

test('the trust table in the README matches /trust and /docs/security', () => {
  const readme = readFileSync(new URL('../../../../README.md', import.meta.url), 'utf8');
  for (const r of TRUST_ROWS) assert.ok(readme.includes(`| ${r.what} | ${r.holder} | ${r.misuse} | ${r.pilot} |`), r.what);
  assert.ok(docBySlug('security')!.body.includes(TRUST_ROWS[2].misuse));
});

test('verify page: testnet wasm URL is the pinned build and the saved bundle is the Nov 7 run (audit Nov 7)', () => {
  const v = docBySlug('verify')!.body;
  const src = readFileSync(join(import.meta.dirname, 'pages.ts'), 'utf8'); // the URL shows only in OutLayer mode
  assert.ok(src.includes('9fdaaea69a4cc017048496a0c5e2b05903c6b02d') && !src.includes('fa82707f'));
  assert.ok(v.includes('mainnet-score-2026-11-07.attestation.json') && !v.includes('bundle docs/proofs/mainnet-score-2026-11-03'));
});
