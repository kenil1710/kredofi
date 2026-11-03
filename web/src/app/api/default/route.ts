// POST /api/default {borrower}: for demo accounts (no wallet), the relayer does the permissionless
// default steps (SPEC 4): mark_default once the contract's own date check allows it, then
// request_identity_release, then the dev scorer re-seals the name to the partner key.
import { NextResponse } from 'next/server';
import { IN_ENCLAVE, KREDOFI_CONTRACT } from '@/lib/config';
import { call, clientIp, isTestnetAccount, overQuota, rateLimited, relayerAccount, scorerAccount, viewPool } from '@/server/near';
import { pastDue, publicError } from '@/server/guards';
import { checkPinned, loadSubmitted, runScorer } from '@/server/scorer';
import { recordSoon } from '@/server/ledger';

export const runtime = 'nodejs';
export const maxDuration = 60;

type B = { has_active_loan: boolean; pending_request: boolean; released_identity: string | null; loan: { due_at: string } | null } | null;

export async function POST(req: Request) {
  const { borrower } = (await req.json().catch(() => ({}))) as { borrower?: unknown };
  if (!isTestnetAccount(borrower)) return NextResponse.json({ error: 'Use a NEAR testnet account.' }, { status: 400 });
  if (rateLimited(`default:${borrower}`, 15_000)) return NextResponse.json({ error: 'Already working on it.' }, { status: 429 });
  if (overQuota(`default:${clientIp(req)}`, 30, 3_600_000)) return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 });
  const txs: string[] = [];
  try {
    let b = await viewPool<B>('get_borrower', { account_id: borrower });
    if (b?.has_active_loan) {
      // Check the contract's own date rule first, so the relayer never pays for a refused mark_default (audit M3).
      const { grace_ns } = await viewPool<{ grace_ns: string }>('get_config');
      if (!pastDue(b.loan?.due_at, grace_ns)) return NextResponse.json({ error: 'This loan is not past its due date plus grace yet.' }, { status: 409 });
      const r = await call(relayerAccount(), KREDOFI_CONTRACT, 'mark_default', { borrower });
      if (r.hash) txs.push(r.hash);
      if (!r.ok) return NextResponse.json({ error: r.error, txs }, { status: 409 });
    }
    if (!(await viewPool<boolean>('is_release_allowed', { account_id: borrower }))) return NextResponse.json({ txs });
    b = await viewPool<B>('get_borrower', { account_id: borrower });
    if (IN_ENCLAVE) {
      // OutLayer mode: the relayer pays the 0.01 NEAR fee (OutLayer refunds the unused part to it) and
      // the enclave re-seals the name to the partner key; on_release stores it in the same transaction.
      if (!b?.pending_request && !b?.released_identity) {
        const r = await call(relayerAccount(), KREDOFI_CONTRACT, 'request_identity_release', { borrower }, 150n, 10n ** 22n);
        if (r.hash) txs.push(r.hash);
        if (!r.ok) return NextResponse.json({ error: r.error, txs }, { status: 409 });
      }
      txs.forEach((h) => recordSoon(h, relayerAccount().accountId));
      const after = await viewPool<B>('get_borrower', { account_id: borrower });
      if (!after?.released_identity) return NextResponse.json({ error: 'The enclave did not release the name this time. Try again.', txs }, { status: 409 });
      return NextResponse.json({ txs });
    }
    if (!b?.pending_request) {
      const r = await call(relayerAccount(), KREDOFI_CONTRACT, 'request_identity_release', { borrower });
      if (r.hash) txs.push(r.hash);
      if (!r.ok) return NextResponse.json({ error: r.error, txs }, { status: 409 });
    }
    await checkPinned();
    const sub = await loadSubmitted(borrower);
    if (!sub) return NextResponse.json({ error: 'This server did not score this borrower, so it cannot release the identity.', txs }, { status: 409 });
    const { partner_pubkey } = await viewPool<{ partner_pubkey: string }>('get_config');
    const output = await runScorer({ op: 'release', sealed: sub.sealed_identity, partner_pubkey });
    const r = await call(scorerAccount(), KREDOFI_CONTRACT, 'dev_submit_release', { borrower, output });
    if (r.hash) txs.push(r.hash);
    if (!r.ok) return NextResponse.json({ error: r.error, txs }, { status: 409 });
    txs.forEach((h, i) => recordSoon(h, i === txs.length - 1 ? scorerAccount().accountId : relayerAccount().accountId));
    return NextResponse.json({ txs });
  } catch (e) {
    console.error('default failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: publicError(e, 'Default failed. Try again.'), txs }, { status: 502 });
  }
}
