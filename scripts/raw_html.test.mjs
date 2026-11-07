// What a reader without JavaScript gets: fetch each page's raw HTML, drop scripts and styles, and check the key
// text is there. AI screening (HACKATHON.md Q-017) often fetches pages this way.
//   node --test scripts/raw_html.test.mjs                        # kredofi.xyz
//   BASE=http://localhost:3000 node --test scripts/raw_html.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'https://kredofi.xyz';
const decode = (s) => s.replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const body = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, '');
async function page(path) {
  const r = await fetch(BASE + path, { headers: { 'user-agent': 'kredofi-raw-html-test' }, redirect: 'follow' });
  assert.equal(r.status, 200, path);
  const html = body(await r.text());
  return { html, literal: decode(html), text: decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ') };
}
const PLACEHOLDER = />\s*…\s*</;

const PAGES = {
  '/': {
    literal: ['Every transaction in. One line out.', 'Public on-chain: your band, score, income bucket, bank fingerprint, loans and default status.', 'repay before the grace period ends', "Riya gets $100. Sam doesn't, and he's told why.", 'Lending is the boring part, on purpose.', 'How to check a KredoFi note', 'Numbers from a real mainnet enclave run on 7 November, not from a pitch deck.', 'No-collateral USDC loans on NEAR', 'Testnet demo · no wallet needed · ', 'TDX attestation PROVEN on mainnet →', 'attestation/1301269', '9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm', 'Borrow against your payslip.'],
    text: ['Prove your income on NEAR without showing your bank statements.', 'A sealed enclave scores your bank history. Only your band, your score and a few sealed fields reach NEAR.'],
    absent: ['mainnet run · sandbox data · 7.7 s · Verify', 'we pay the network fees.', 'puts eight fields on NEAR: v, caller', 'Lenders see a band', 'the only score that goes on-chain', 'on time and your next note'],
    patterns: [/Income level 250/, /Money left over 150/, /Score 1000/, /Riya 1000/, /Sam 270/],
    // The full field list is linked from "How to check a note" (the "How the privacy works" target), not from the hero.
    check: ({ html }) => {
      const check = html.slice(html.indexOf('id="check"'), html.indexOf('id="two"'));
      assert.ok(check.includes('href="/docs/privacy#what-leaves-the-scorer"'), '#check links the field list');
      const hero = html.slice(html.indexOf('class="hero-inner"'), html.indexOf('class="enclave"'));
      assert.ok(hero.length > 100 && !hero.includes('what-leaves-the-scorer'), 'no field-list link in the hero');
    },
  },
  '/trust': { literal: ['href="/docs/privacy#what-leaves-the-scorer"', 'Why is this safe?', 'The 7 November mainnet run', 'Everything that went on-chain for one real testnet enclave score', 'HoLog3yaJvbEKfXyqHDP4cRAmcqpxTApkBNbEMdapwjC', 'attestation/1301269', '9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm'] },
  '/mainnet': {
    literal: ['What kredofi.near runs, right now.', 'Contract version', 'Pinned scorer', 'Pending scorer change', 'Deposits locked', 'Locked until real bank data', 'TDX attestation of the newest score', 'outlayer-verify tx 9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm', 'Check it yourself'],
    patterns: [/Contract version v\d+ .*?\b[0-9a-f]{64}\b/, /Pinned scorer [0-9a-f]{64}\b/, /Pending scorer change ([0-9a-f]{64} (applies at|can be applied now)|none \(time lock)/, /Read at \d+ \w+ \d{4}, \d\d:\d\d UTC|last read at|recorded on/],
    noPlaceholder: true,
  },
  '/integrate': { literal: ["Your band, another contract's terms.", 'partner-vault.kency.testnet', 'What this demo leaves out', 'so any app can read it without asking you'], absent: ['gave no permission'], patterns: [/Band A 110% \$100\.00/, /Band D, no score, expired or defaulted 150% \$73\.33/] },
  '/lend': {
    literal: ['Lend test USDC to the pool.', 'Lost by lenders so far', 'nothing here is a forecast'],
    patterns: [/In the pool \$[\d,]+\.\d\d/, /Lent out right now \$[\d,]+\.\d\d/, /Reserve, pays losses first \$[\d,]+\.\d\d/, /Share price \d\.\d{4} USDC/, /read from the chain at \d+ \w+ \d{4}, \d\d:\d\d UTC/],
    noPlaceholder: true,
  },
  '/ledger': {
    literal: ['Public ledger', 'Bands and amounts only: no names, no bank data.', 'By band', 'Pinned scorer', 'Pending scorer change'],
    patterns: [/as of \d+ \w+ \d{4}, \d\d:\d\d UTC/, /Pool \$[\d,]+\.\d\d, lent out \$[\d,]+\.\d\d, reserve \$[\d,]+\.\d\d/, /OutLayer: inside Intel TDX/, /Pinned scorer [0-9a-f]{64}\b/],
    noPlaceholder: true,
    check: ({ html }) => assert.ok((html.match(/<li\b[^>]*>\s*<span>/g) ?? []).length >= 10, 'ledger rows in the raw HTML'),
  },
  '/borrow': { literal: ['Connect your bank (sandbox)', 'Log in with user_good / pass_good.', 'Test bank in 3 steps: 1. Type Platypus. 2. Pick First Platypus Bank (not OAuth). 3. Log in with user_good / pass_good.', 'keeps none of it.', 'No wallet needed'] },
};

for (const [path, want] of Object.entries(PAGES)) {
  test(`raw HTML of ${path}`, async () => {
    const p = await page(path);
    for (const s of want.literal ?? []) assert.ok(p.literal.includes(s), `${path}: not literal: ${s}`);
    for (const s of want.absent ?? []) assert.ok(!p.literal.includes(s), `${path}: must be gone: ${s}`);
    for (const s of want.text ?? []) assert.ok(p.text.includes(s), `${path}: not in text: ${s}`);
    for (const r of want.patterns ?? []) assert.match(p.text, r, path);
    if (want.noPlaceholder) assert.doesNotMatch(p.html, PLACEHOLDER, `${path}: empty placeholder`);
    want.check?.(p);
  });
}

test('every docs page has its heading and real text in the raw HTML', async () => {
  const { html } = await page('/docs/overview');
  const slugs = [...new Set([...html.matchAll(/href="\/docs\/([a-z-]+)"/g)].map((m) => m[1]))];
  assert.ok(slugs.length >= 14, `docs pages in the nav: ${slugs.length}`);
  for (const s of slugs) {
    const d = await page(`/docs/${s}`);
    assert.match(d.html, /<h1[^>]*>[^<]+/, s);
    assert.ok(d.text.split(' ').length > 150, `/docs/${s}: only ${d.text.split(' ').length} words`);
  }
});
