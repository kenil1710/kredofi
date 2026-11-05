import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickFacts } from './mainnetPick.ts';

const record = { v: 'record', readAt: 1 };
const last = { v: 'last', readAt: 2 };

test('a complete live read wins and is dated now', () => assert.deepEqual(pickFacts({ v: 'live' }, 3, last, record), { v: 'live', readAt: 3, source: 'live' }));
test('no answer: the last read keeps its own time', () => assert.deepEqual(pickFacts(null, 3, last, record), { v: 'last', readAt: 2, source: 'last-read' }));
test('no answer and no earlier read: the dated record', () => assert.deepEqual(pickFacts(null, 3, null, record), { v: 'record', readAt: 1, source: 'record' }));
