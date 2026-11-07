// "Verify my score": what the server may say about one borrower's own score. Pure, unit-tested.
// `proven` needs ALL of: verifier exit 0, all five layers "pass", measurements approved, and the signed run being
// this account's current on-chain score from the pinned scorer. A failed check is `failed`; anything we could not
// complete is `unavailable`. Nothing else can produce `proven`, on the server or in the browser (resultFromResponse).

export type OnchainScore = { band: string; score: number | string; income_cap: string; fingerprint: string; scorer_version: string };
export type VerifyRun = { exitCode: number | null; timedOut?: boolean; busy?: boolean; bundle?: unknown };
export type VerifyContext = { tx: string; account: string; network: 'testnet' | 'mainnet'; pinned: string; score: OnchainScore };

export type VerifyResult =
  | {
      status: 'proven'; tx: string; network: string; taskId: number; scorer: string; approvedOn: string;
      intel: string; inputHash: string; outputHash: string; command: string;
    }
  | { status: 'failed'; reason: string }
  | { status: 'unavailable'; reason: string };

const LAYERS = ['authenticity', 'identity', 'binding', 'input', 'output'] as const;
const LAYER_WORDS: Record<(typeof LAYERS)[number], string> = {
  authenticity: "Intel's signature on the quote", identity: 'the approved enclave build', binding: 'the quote covering this run',
  input: 'the input bytes in the transaction', output: 'the output bytes in the transaction',
};
const TEMP = 'The attestation check could not be completed. This says nothing about your score either way. Try again in a minute.';

export const verifyCommand = (tx: string, network: string) => network === 'mainnet'
  ? `outlayer-verify tx ${tx} --api https://api.outlayer.ai`
  : `outlayer-verify tx ${tx} --network testnet --api https://testnet-api.outlayer.ai`;

type Layer = { verdict?: unknown; detail?: unknown };
type Bundle = {
  network?: unknown; measurements_approved?: unknown; register_contract?: unknown; output_raw?: unknown;
  attestation?: { task_id?: unknown; transaction_hash?: unknown; caller_account_id?: unknown; wasm_hash?: unknown; input_hash?: unknown; output_hash?: unknown };
  verification?: Partial<Record<(typeof LAYERS)[number], Layer>>;
};

const firstFailed = (b: Bundle | null) => {
  const bad = b?.verification ? LAYERS.find((l) => b.verification![l]?.verdict !== 'pass') : undefined;
  return bad ? LAYER_WORDS[bad] : null;
};

export function interpretRun(run: VerifyRun, ctx: VerifyContext): VerifyResult {
  if (run.busy) return { status: 'unavailable', reason: 'Other checks are running. Try again in a moment.' };
  if (run.timedOut || run.exitCode === null) return { status: 'unavailable', reason: TEMP };
  const b = run.bundle && typeof run.bundle === 'object' ? (run.bundle as Bundle) : null;
  if (run.exitCode === 1) {
    const what = firstFailed(b);
    return { status: 'failed', reason: what ? `OutLayer's verifier failed on ${what}.` : "OutLayer's verifier reported an invalid proof." };
  }
  if (run.exitCode !== 0 || !b) return { status: 'unavailable', reason: TEMP };

  // Exit 0 alone is not enough: re-read each verdict and tie the signed run to this borrower's score.
  const what = firstFailed(b);
  if (!b.verification || what) return { status: 'failed', reason: `OutLayer's verifier did not pass ${what ?? 'every check'}.` };
  if (b.measurements_approved !== true) return { status: 'failed', reason: 'The enclave build is not on the approved list.' };
  const a = b.attestation;
  if (b.network !== ctx.network || a?.transaction_hash !== ctx.tx) return { status: 'failed', reason: 'The proof is for a different transaction.' };
  if (a.caller_account_id !== ctx.account) return { status: 'failed', reason: 'This run was made for a different account.' };
  if (a.wasm_hash !== ctx.pinned || a.wasm_hash !== ctx.score.scorer_version) {
    return { status: 'failed', reason: `This run used scorer ${String(a.wasm_hash).slice(0, 8)}…, not the pinned ${ctx.pinned.slice(0, 8)}…. Check your limit again for a score from the current build.` };
  }
  let out: Record<string, unknown>;
  try { out = JSON.parse(String(b.output_raw)) as Record<string, unknown>; } catch { return { status: 'unavailable', reason: TEMP }; }
  if (out.caller !== ctx.account || out.band !== ctx.score.band || String(out.score) !== String(ctx.score.score)
    || String(out.income_cap) !== String(ctx.score.income_cap) || out.fingerprint !== ctx.score.fingerprint) {
    return { status: 'failed', reason: 'This transaction is not your current score. Reload the page, or check your limit again.' };
  }
  return {
    status: 'proven', tx: ctx.tx, network: ctx.network, taskId: Number(a.task_id), scorer: String(a.wasm_hash),
    approvedOn: String(b.register_contract), intel: String(b.verification.authenticity?.detail),
    inputHash: String(a.input_hash), outputHash: String(a.output_hash), command: verifyCommand(ctx.tx, ctx.network),
  };
}

/** The browser's reading of the route's answer: anything it doesn't fully recognise is "can't verify", never success. */
export function resultFromResponse(ok: boolean, body: unknown): VerifyResult {
  const r = (body ?? {}) as Record<string, unknown>;
  const strs = ['tx', 'network', 'scorer', 'approvedOn', 'intel', 'inputHash', 'outputHash', 'command'];
  if (ok && r.status === 'proven' && typeof r.taskId === 'number' && strs.every((k) => typeof r[k] === 'string' && r[k])) return r as unknown as VerifyResult;
  if (ok && r.status === 'failed' && typeof r.reason === 'string') return { status: 'failed', reason: r.reason };
  const reason = typeof r.reason === 'string' ? r.reason : typeof r.error === 'string' ? r.error : TEMP;
  return { status: 'unavailable', reason };
}
