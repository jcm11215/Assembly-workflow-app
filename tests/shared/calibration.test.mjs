// Scoring a scan against a checked list, and what it learns from one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareParts, lessonsFrom } from '../../shared/calibration.js';

const p = (drawn, item, location, quantity = 1, balloon = null) => ({ item_as_drawn: drawn, item, installation_location: location, quantity, balloon });
const key = [
  p('GEARMOTOR 5HP', 'Motor', 'drive_end', 1, 3),
  p('FLG BRG 2-7/16', 'Bearing', 'drive_end', 1, 5), p('FLG BRG 2-7/16', 'Bearing', 'tail_end', 1, 5),
  p('HNGR BRG', 'Hanger Bearing', 'hanger', 2, 7)
];

test('a scan that matches the checked list scores 100', () => {
  const r = compareParts(key, key);
  assert.equal(r.score, 100);
  assert.equal(r.right, 3);
  assert.equal(r.expected, 3, 'a part at both ends is one part');
});

test('missed, extra, wrong type, end and count are each named', () => {
  const r = compareParts(key, [
    p('GEARMOTOR 5HP', 'Drive Shaft', 'drive_end', 1),
    p('FLG BRG 2-7/16', 'Bearing', 'drive_end', 2),
    p('FOOT W/ END SHAFT', 'Drive Shaft', 'drive_end')
  ]);
  assert.deepEqual(r.missed, ['HNGR BRG']);
  assert.deepEqual(r.extra, ['FOOT W/ END SHAFT']);
  assert.deepEqual(r.wrongType, [{ name: 'GEARMOTOR 5HP', got: 'Drive Shaft', want: 'Motor' }]);
  assert.deepEqual(r.wrongEnd, [{ name: 'FLG BRG 2-7/16', got: 'drive_end', want: 'drive_end,tail_end' }]);
  assert.equal(r.wrongQty.length, 0, 'two bearings either way');
  assert.equal(r.score, 25, 'two half-right out of three wanted plus one extra');
});

test('a part read with different wording still matches by its item number', () => {
  const r = compareParts(key, [p('GEAR MOTOR, 5 HP', 'Motor', 'drive_end', 1, 3)]);
  assert.equal(r.right, 1);
  assert.equal(r.missed.length, 2);
});

test('lessons: what it got wrong or missed, and what isn\'t a part', () => {
  const lessons = lessonsFrom(key, [p('GEARMOTOR 5HP', 'Motor', 'drive_end'), p('FOOT', 'Drive Shaft', 'drive_end')]);
  assert.deepEqual(lessons.map(l => [l.drawn, l.item, l.location]), [
    ['FLG BRG 2-7/16', 'Bearing', null],
    ['HNGR BRG', 'Hanger Bearing', 'hanger'],
    ['FOOT', 'Not a part', null]
  ]);
});
