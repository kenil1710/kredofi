// Every number on the landing proof strip and receipt section, in one place, each checked against its
// source by proofFacts.test.ts (the attestation bundle, the docs) and on-chain by the release check.

/** Nov 3 mainnet score, Plaid sandbox data, our test account. docs/proofs/ holds its attestation. */
export const MAINNET_RUN = {
  tx: '3nbdkFd3uNeeoYhqmE2AQHuRMXLZYbDhEZAUzsVDFGzo',
  seconds: '8.5', // OutLayer's log: time_ms 8496
  outputBytes: 472,
};
export const MAINNET_TX_URL = `https://nearblocks.io/txns/${MAINNET_RUN.tx}`;

/** The hero's one proof line, linking to /mainnet. */
export const HERO_PROOF = `TDX attestation: PROVEN · ${MAINNET_RUN.seconds} s mainnet score · Verify →`;

/** kredofi.near scorer_delay_ns = 86400000000000. The testnet demo uses 60 s on purpose. */
export const MAINNET_SCORER_DELAY_HOURS = 24;

/** The landing section's heading. It names no number: Plaid's rolling 730-day window moves the count daily. */
export const ONE_LINE_HEADING = 'Every transaction in. One line out.';

export const RECEIPT_NOTE = 'Inside the enclave the scorer reads your test bank. Only this line is written to NEAR.';

/** A real enclave score of Plaid's public sandbox login (user_good): the exact output in the transaction, byte for byte. */
export const RECEIPT_TX = '7bHhkR47ikb1vispGHgntnKNDa9RmTRZkNB1CRjLX1fk';
export const RECEIPT_TX_URL = `https://testnet.nearblocks.io/txns/${RECEIPT_TX}`;
export const RECEIPT_RAW = '{"band":"B","caller":"devcheck-plaid.relayer.kency.testnet","fingerprint":"7293d33dd77a795854a7270ffba17be53c73d55871efb31ba9f74153ce11d7fa","income_cap":250000000,"reply":"ADYaJK2ish19nhSbRjYmyDMVXTI3lM1lrIblmwpCyAz/oRjHTsSZorl93cnJVeS7S5gIkarGnQPrngQVYVG8FqIBTBr3+8MfTZZXsx4+SF3p3TTes0b+RT1vw+xbqUdFt/42kETdiZykzTyB0IKw5SYCNy6u8DCqXKd7I2R+4buS","score":720,"sealed_identity":"qB760Mz7HLe7o/nTWRT722mavkW0DslvIwrkckY5dX2lIVZQotru2ChnpcZ4guEwJ42ctnc=","v":1}';

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
