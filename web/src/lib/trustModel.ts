// Who holds what today: one table for /trust and /docs/security (README.md carries the same rows; a test
// keeps them together). Plain and unsoftened. The Pilot column is a plan, not something built, except
// where it says so. Facts: docs/SECURITY_AUDIT.md, THREAT_MODEL.md, contracts/kredofi/src/params.rs.
export type TrustRow = { what: string; holder: string; misuse: string; pilot: string };

export const TRUST_ROWS: TrustRow[] = [
  {
    what: 'Sealing key (`SEAL_KEY`)',
    holder: 'The developer, who created it on a laptop. A copy is an OutLayer secret.',
    misuse: 'Open any sealed bank token from the chain and, if it is still unused, exchange it first and read that bank data (the real score then fails). Open any sealed name. Compute fingerprints offline.',
    pilot: 'Generated inside the enclave, never held outside it.',
  },
  {
    what: 'Plaid keys',
    holder: 'The developer. A copy is an OutLayer secret. Sandbox keys today.',
    misuse: 'With an opened token, read that bank data outside the enclave. Alone they read no bank data, because each read needs a token.',
    pilot: 'Production keys kept inside the enclave, under a licensed lending partner’s Plaid account.',
  },
  {
    what: '`kredofi.near` full-access key',
    holder: 'The developer. It is the only key on the account.',
    misuse: 'Deploy any code. New code could move every token the contract holds and bypass every rule here, including the scorer time lock. No delay and no warning. The mainnet pool holds $0 today.',
    pilot: 'Final reviewed build, then the key is deleted (lock), so the code can never change again.',
  },
  {
    what: 'Owner role on `kredofi.near`',
    holder: 'The developer, one account.',
    misuse: 'Withdraw the treasury. Change loan settings within fixed bounds. Pin another scorer after a 24 h public wait (built). Switch `production_data` on at once, which unlocks lender deposits, with no wait. It cannot move lender cash, loans or the reserve.',
    pilot: 'Multisig, so several keys must sign. Time lock extended to the other owner settings.',
  },
  {
    what: 'Recovery partner key',
    holder: 'The developer. The partner is simulated: no real partner exists.',
    misuse: 'Read the name of any borrower whose identity was released after a default.',
    pilot: 'Held only by a real, licensed recovery partner. We keep only its public key.',
  },
  {
    what: 'OutLayer secrets owner',
    holder: 'The developer’s account, which also owns the scorer project.',
    misuse: 'Replace the secrets, or change which build and caller may read them, so another build could read the sealing and Plaid keys. Publish new scorer versions (the contract runs only the pinned one).',
    pilot: 'Same multisig as the owner. No secret left that a person ever knew.',
  },
  {
    what: 'OutLayer and Intel (not us)',
    holder: 'OutLayer controls the approved enclave builds on `worker.outlayer.near`. Intel signs the hardware proof.',
    misuse: 'A build OutLayer approves could leak what it runs, and a TDX flaw could too. Attestation proves which approved build ran, not that the build behaves well. OutLayer can also refuse to run.',
    pilot: 'Not removed. We would review its governance and rely on more than one operator if available.',
  },
];

/** Markdown table for /docs/security. */
export const trustTableMarkdown = () => [
  '| What | Who holds it today | What they could do if misused | How the Pilot removes it |',
  '|---|---|---|---|',
  ...TRUST_ROWS.map((r) => `| ${r.what} | ${r.holder} | ${r.misuse} | ${r.pilot} |`),
].join('\n');

/** Each `word` as code, for /trust, which renders JSX rather than markdown. */
export const splitCode = (s: string) => s.split('`').map((text, i) => ({ text, code: i % 2 === 1 }));
