// Reading a parts table from a page's own text, without the AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTable, readTable, tableIsClean, phrases } from '../../web/scan/tableText.js';
import { categorize } from '../../web/scan/categories.js';
import { partsFromTable, applyLearned } from '../../web/scan/pipeline.js';
import { learnKey } from '../../shared/partNames.js';

const run = (str, x, y, w = Math.max(0.006, str.length * 0.006), h = 0.008) => ({ str, x, y: y - h / 2, w, h });

// ITEM | QTY | PART NO. | DESCRIPTION, header on top, a description that
// starts left of its (centred) header and one that wraps onto two lines.
function table(headY, step){
  const row = (i, qty, pn, desc, extra) => {
    const y = headY + step * (i + 1);
    const out = [run(String(i + 1), 0.608, y), run(String(qty), 0.648, y), run(pn, 0.68, y)];
    desc.split(' ').reduce((x, word) => { out.push(run(word, x, y)); return x + word.length * 0.006 + 0.002; }, 0.745);
    if(extra) out.push(run(extra, 0.745, y + 0.009));
    return out;
  };
  return [
    run('ITEM', 0.60, headY, 0.03), run('QTY', 0.64, headY, 0.025), run('PART', 0.68, headY, 0.028), run('NO.', 0.7095, headY, 0.016),
    run('DESCRIPTION', 0.79, headY, 0.07),
    ...row(0, 1, 'GM-5', 'GEARMOTOR, 5HP 39RPM'),
    ...row(1, 2, 'HB-247', 'HNGR BRG ASSY', 'UHMW, 2-7/16 BORE'),
    ...row(2, 3, '', '12" SECTIONAL FLIGHT'),
    ...row(3, 4, 'P-9', 'END PLATE'),
    run('12', 0.30, 0.40)               // a dimension elsewhere on the sheet
  ];
}

test('words next to each other become one phrase', () => {
  const p = phrases([run('ITEM', 0.1, 0.5, 0.03), run('NO.', 0.131, 0.5, 0.015), run('QTY', 0.2, 0.5, 0.025)]);
  assert.deepEqual(p.map(x => x.str), ['ITEM NO.', 'QTY']);
});

test('a table under its header is read row by row, columns and all', () => {
  const t = findTable(table(0.60, 0.022));
  assert.ok(t, 'found the table');
  const rows = readTable(t);
  assert.deepEqual(rows.map(r => [r.balloon, r.quantity, r.part_number, r.description]), [
    [1, 1, 'GM-5', 'GEARMOTOR, 5HP 39RPM'],
    [2, 2, 'HB-247', 'HNGR BRG ASSY UHMW, 2-7/16 BORE'],
    [3, 3, '', '12" SECTIONAL FLIGHT'],
    [4, 4, 'P-9', 'END PLATE']
  ]);
  assert.ok(tableIsClean(rows));
  const [x, y, w, h] = t.bomBox;
  assert.ok(x < 0.60 && y < 0.60 && x + w > 0.85 && y + h > 0.69, 'the box holds the whole table');
  assert.ok(!(0.30 > x && 0.30 < x + w), 'the stray dimension is outside it');
});

test('a table that grows upward from its header reads the same', () => {
  const rows = readTable(findTable(table(0.90, -0.022)));
  assert.deepEqual(rows.map(r => r.balloon), [1, 2, 3, 4]);
  assert.equal(rows[0].description, 'GEARMOTOR, 5HP 39RPM');
});

test('no header, no table', () => {
  assert.equal(findTable([run('NOTES', 0.1, 0.1), run('1', 0.1, 0.12), run('2', 0.1, 0.14)]), null);
  assert.equal(tableIsClean([{ balloon: 1, description: 'X' }]), false);
});

test('descriptions sort into the shop\'s part types', () => {
  assert.equal(categorize('GEARMOTOR, 5HP'), 'Motor');
  assert.equal(categorize('HNGR BRG ASSY'), 'Hanger Bearing');
  assert.equal(categorize('FLG BRG 2-7/16'), 'Bearing');
  assert.equal(categorize('DRIVE SHAFT 2-7/16'), 'Drive Shaft');
  assert.equal(categorize('SHAFT MOUNT DRIVE'), 'Drive');
  assert.equal(categorize('12" SECTIONAL FLIGHT'), 'Auger');
  assert.equal(categorize('CPLG BOLT'), null, 'coupling bolts are not tracked');
  assert.equal(categorize('GASKET'), null);
  assert.equal(categorize('SHAFT, 2-7/16 C1045'), 'Shaft');
  assert.equal(categorize('WASTE PACK SEAL'), 'Seal');
  assert.equal(categorize('DRIVE END PLATE'), null);
  assert.equal(categorize('CAP SCREW 1/2-13'), null);
});

test('table rows become parts; corrections people made are applied', () => {
  const parts = partsFromTable([{ balloon: 5, description: 'FLG BRG 2-7/16', quantity: 2, part_number: '', specification: '' }], 2);
  assert.equal(parts[0].item, 'Bearing');
  assert.equal(parts[0].source_page, 2);
  const learned = new Map([[learnKey('Flg. Brg 2-7/16'), { item: 'Bearing', location: 'tail_end' }]]);
  const { parts: fixed, used } = applyLearned(parts, learned);
  assert.equal(used, 1);
  assert.equal(fixed[0].installation_location, 'tail_end');
});
