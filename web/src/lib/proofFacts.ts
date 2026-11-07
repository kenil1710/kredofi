// Every number on the landing proof strip and receipt section, in one place, each checked against its
// source by proofFacts.test.ts (the attestation bundle, the docs) and on-chain by the release check.

/** Nov 7 mainnet score, Plaid sandbox data, our test account. docs/proofs/ holds its attestation. */
export const MAINNET_RUN = {
  tx: '9w6qBWdViZrE2Y4KisYxxjdMtbCmAvRyNvAs6WGbymHm',
  scorer: '5175182a',
  seconds: '7.7', // OutLayer's log: time_ms 7665
  outputBytes: 472,
};
export const MAINNET_TX_URL = `https://nearblocks.io/txns/${MAINNET_RUN.tx}`;

/** The hero's one proof line, linking to /mainnet. */
/** The hero's link to /mainnet; the run's details (7.7 s, sandbox data) are in the proof strip right under the hero. */
export const HERO_PROOF = 'TDX attestation PROVEN on mainnet →';

/** kredofi.near scorer_delay_ns = 86400000000000. The testnet demo uses 60 s on purpose. */
export const MAINNET_SCORER_DELAY_HOURS = 24;

/** The landing section's heading. It names no number: Plaid's rolling 730-day window moves the count daily. */
export const ONE_LINE_HEADING = 'Every transaction in. One line out.';

export const RECEIPT_NOTE = 'Inside the enclave the scorer reads your test bank. Only this line is written to NEAR.';

/** A real enclave score of Plaid's public sandbox login (user_good): the exact output in the transaction, byte for byte. */
export const RECEIPT_TX = 'HoLog3yaJvbEKfXyqHDP4cRAmcqpxTApkBNbEMdapwjC';
export const RECEIPT_TX_URL = `https://testnet.nearblocks.io/txns/${RECEIPT_TX}`;
export const RECEIPT_RAW = '{"band":"B","caller":"devcheck-plaid.relayer.kency.testnet","fingerprint":"7293d33dd77a795854a7270ffba17be53c73d55871efb31ba9f74153ce11d7fa","income_cap":250000000,"reply":"rfv/7OUa8gNEs5lv3NagKNPo/LJlBN6Y5fdobYolcC6hyul1qEhR0n7ju3J6a0qN05OJy+JqAZFZ3E7EOjIoTsilIyJzLMG0MLO4SU4LsJjt7Rgp/bR2ihFx7/rIA7Erd0KGqPYR4mVWMRZkhSWLlFV5TcMuB65u8avAE7v3uJrm","score":720,"sealed_identity":"Poom+6zYt886MnDJ9lnYShUfhUhqeci+N4Fjmybe49HRnUupiRm9KzJYILZE0a9gfex5D/E=","v":1}';

/** Sample rows from that login (Plaid's made-up data). Plaid sign flipped: money in is +. */
export const SANDBOX_ROWS: [string, string, string, number?][] = [
  ['Oct 24', 'Uber 072515 SF**POOL**', '−6.33'],
  ['Oct 11', 'Uber 063015 SF**POOL**', '−5.40'],
  ['Oct 09', 'United Airlines', '+500.00', 1],
  ['Oct 08', "McDonald's", '−12.00'],
  ['Oct 08', 'Starbucks', '−4.33'],
  ['Oct 07', 'SparkFun', '−89.40'],
  ['Sep 24', 'Uber 072515 SF**POOL**', '−6.33'],
  ['Sep 11', 'Uber 063015 SF**POOL**', '−5.40'],
  ['Sep 09', 'United Airlines', '+500.00', 1],
  ['Sep 08', "McDonald's", '−12.00'],
  ['Sep 08', 'Starbucks', '−4.33'],
  ['Sep 07', 'SparkFun', '−89.40'],
];
