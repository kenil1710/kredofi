import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A link styled as a button must keep its own text colour. `.g-paper a{color}` once beat
// `.btn-violet{color}` on specificity, which hid the label of /integrate's "Check my limit".
test('section link colours do not override .btn text colours', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.g-paper a:where\(:not\(\.btn\)\)\{color:/);
  assert.doesNotMatch(css, /\.g-paper a\{color:/);
});
