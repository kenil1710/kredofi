// The AI summary is asked for "no numbers other than the band letter" (scorer/src/lib.rs, demo).
// Models sometimes break that and get numbers wrong (live, Nov 2: "income in one of the last six
// months" for a borrower paid in 4 of 6). The score never depends on it, but a wrong number on the
// page misleads, so a summary with any digit or number word is not shown. Pure, unit-tested.
const NUMBERS = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|once|twice|half|dozen|hundred|thousand)\b/i;

export function usableSummary(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t || t.length > 400 || NUMBERS.test(t)) return null;
  return t;
}

// The summary request (testnet): sent by the browser after the score shows, from the band and the
// five rule results it decrypted. No bank data, and no numbers in the prompt (each rule is described
// in words), so the model has none to get wrong. Models: Qwen/Qwen3.8-27B on NEAR AI Cloud first; if it
// hasn't answered in 8 s, Qwen/Qwen3.6-35B-A3B-FP8, also hosted by NEAR AI Cloud (tested Nov 2: ~1 s).
export const SUMMARY_MODEL = 'Qwen/Qwen3.8-27B';
export const SUMMARY_FALLBACK = 'Qwen/Qwen3.6-35B-A3B-FP8';
/** [model, timeout ms] in the order tried. */
export const SUMMARY_PLAN: [string, number][] = [[SUMMARY_MODEL, 8_000], [SUMMARY_FALLBACK, 15_000]];
export type RuleParts = { income: number; stability: number; payment: number; cash_flow: number; buffer: number };
const RULES: [keyof RuleParts, string, number][] = [
  ['income', 'income level', 250], ['stability', 'steady income', 250], ['payment', 'on-time payments', 250],
  ['cash_flow', 'money left over after spending', 150], ['buffer', 'savings buffer', 100],
];
const level = (v: number, max: number) => (v >= max ? 'full marks' : v >= max * 0.6 ? 'most points' : v > 0 ? 'some points' : 'no points');

/** Valid band and rule results (as the scorer produces them), else null. */
export function checkParts(band: unknown, parts: unknown): { band: 'A' | 'B' | 'C' | 'D'; parts: RuleParts } | null {
  if (typeof band !== 'string' || !/^[ABCD]$/.test(band) || !parts || typeof parts !== 'object') return null;
  const out = {} as RuleParts;
  for (const [k, , max] of RULES) {
    const v = (parts as Record<string, unknown>)[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return null;
    out[k] = v;
  }
  return { band: band as 'A' | 'B' | 'C' | 'D', parts: out };
}

export function summaryRequest(band: string, parts: RuleParts, model = SUMMARY_MODEL) {
  const facts = `Band ${band}. ` + RULES.map(([k, name, max]) => `${name}: ${level(parts[k], max)}`).join('; ') + '.';
  return {
    model,
    messages: [
      { role: 'system', content: '/no_think You explain a credit result to the borrower in exactly two short, plain, kind sentences: why this band, and the one change that would help most. Do not write any numbers or number words; only the band letter. No advice beyond the rules given.' },
      { role: 'user', content: facts },
    ],
    max_tokens: 120,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
  };
}

/** The model's text, cleaned (no reasoning tags, one line), then the same filter as the page. */
export function parseSummary(v: unknown): string | null {
  const raw = (v as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') return null;
  const i = raw.lastIndexOf('</think>');
  const text = (i >= 0 ? raw.slice(i + 8) : raw).split(/\s+/).filter(Boolean).join(' ');
  if (text.includes('<think>')) return null;
  return usableSummary(text);
}
