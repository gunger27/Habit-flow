'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeCompletions, mergeHabit, mergeHabitLists, isDone, measurementStats, normalizeCompletion } = require('../sync-core.js');

test('merges habits from separate devices without dropping unique records', () => {
  const merged = mergeHabitLists([{ id: 'local', updatedAt: '2026-01-01T00:00:00Z' }], [{ id: 'cloud', updatedAt: '2026-01-02T00:00:00Z' }]);
  assert.deepEqual(merged.map(h => h.id).sort(), ['cloud', 'local']);
});

test('uses the newest habit revision for scalar fields and preserves completion events', () => {
  const merged = mergeHabit(
    { id: 'one', name: 'Local name', updatedAt: '2026-01-02T00:00:00Z', completions: { '2026-01-01': { done: true, updatedAt: '2026-01-01T00:00:00Z' } } },
    { id: 'one', name: 'Cloud name', updatedAt: '2026-01-03T00:00:00Z', completions: { '2026-01-01': { done: false, updatedAt: '2026-01-04T00:00:00Z' }, '2026-01-02': true } }
  );
  assert.equal(merged.name, 'Cloud name');
  assert.equal(isDone(merged.completions['2026-01-01']), false);
  assert.equal(isDone(merged.completions['2026-01-02']), true);
});

test('tombstones win by revision time and allow a later edit to restore a habit', () => {
  const deleted = mergeHabit(
    { id: 'one', updatedAt: '2026-01-03T00:00:00Z', deletedAt: '2026-01-03T00:00:00Z' },
    { id: 'one', updatedAt: '2026-01-02T00:00:00Z' }
  );
  assert.ok(deleted.deletedAt);
  const restored = mergeHabit(deleted, { id: 'one', updatedAt: '2026-01-04T00:00:00Z', name: 'Restored' });
  assert.equal(restored.deletedAt, undefined);
  assert.equal(restored.name, 'Restored');
});

test('resolves equal timestamp conflicts deterministically across devices', () => {
  const time = '2026-02-01T12:00:00.000Z';
  const a = { id: 'same', name: 'A', updatedAt: time, completions: { '2026-02-01': { done: true, updatedAt: time } } };
  const b = { id: 'same', name: 'B', updatedAt: time, completions: { '2026-02-01': { done: false, updatedAt: time } } };
  assert.deepEqual(mergeHabit(a, b), mergeHabit(b, a));
  assert.equal(isDone(mergeHabit(a, b).completions['2026-02-01']), false);
});

test('preserves checkbox history and applies optional targets to quantity habits', () => {
  assert.equal(isDone({ done: true }), true);
  assert.equal(isDone({ value: 8 }, { trackingType: 'quantity', dailyTarget: 10 }), false);
  assert.equal(isDone({ value: 10 }, { trackingType: 'quantity', dailyTarget: 10 }), true);
  assert.equal(isDone({ value: 1 }, { trackingType: 'quantity' }), true);
  assert.equal(isDone({ value: 0 }, { trackingType: 'quantity' }), false);
});

test('merges quantity notes and keeps newer per-day measurement edits', () => {
  const merged = mergeCompletions(
    { '2026-01-01': { value: 10, note: 'morning', updatedAt: '2026-01-01T08:00:00Z' } },
    { '2026-01-01': { value: 12, note: 'evening', updatedAt: '2026-01-01T20:00:00Z' } }
  );
  assert.deepEqual(merged['2026-01-01'], { value: 12, note: 'evening', updatedAt: '2026-01-01T20:00:00Z' });
});

test('measurement tombstones beat stale values and stats ignore missing entries', () => {
  const merged = mergeCompletions(
    { '2026-01-01': { value: 10, note: '', updatedAt: '2026-01-01T08:00:00Z' } },
    { '2026-01-01': { deleted: true, updatedAt: '2026-01-01T20:00:00Z' } }
  );
  assert.equal(isDone(merged['2026-01-01'], { trackingType: 'quantity' }), false);
  assert.deepEqual(measurementStats([{ value: 10 }, { value: 0 }, { value: null, note: 'only note' }, { deleted: true, value: 22 }]), { count: 2, sum: 10, average: 5, best: 10 });
});

test('normalizes legacy checkbox records and new quantity records without changing their meaning', () => {
  assert.deepEqual(normalizeCompletion(true, '2026-01-01T00:00:00Z'), { done: true, updatedAt: '2026-01-01T00:00:00Z' });
  assert.deepEqual(normalizeCompletion({ value: 12, note: 'extra set', updatedAt: '2026-01-02T00:00:00Z' }, ''), { value: 12, note: 'extra set', updatedAt: '2026-01-02T00:00:00Z' });
});

