// Salvaging a nearly-valid JSON reply. Every case here is something a
// model actually did to a real drawing -- a shop drawing is wall-to-wall
// inch and foot marks, and one bad backslash used to discard the whole
// reply, dimensions and title block together.
import './stub.mjs';
const { parseJsonLenient } = await import('../src/blueprints/jsonRepair.js');

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); pass++; console.log('  PASS ' + n); }
  catch (e) { fail++; console.log('  FAIL ' + n + ' -> ' + e.constructor.name + ': ' + e.message); }
};
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

console.log('=== valid JSON is left completely alone ===');
t('parses and reports no repairs', () => {
  const r = parseJsonLenient('{"a":1,"b":"12\\" DIA"}');
  eq(r.parsed.a, 1, 'a');
  eq(r.parsed.b, '12" DIA', 'a properly escaped inch mark');
  eq(r.repairs.length, 0, 'repairs');
});
t('fences the model was told not to add are stripped', () => {
  eq(parseJsonLenient('```json\n{"a":1}\n```').parsed.a, 1, 'a');
  eq(parseJsonLenient('```\n{"a":2}\n```').parsed.a, 2, 'a');
});
t('a foot mark needs no escaping and keeps its apostrophe', () => {
  eq(parseJsonLenient(`{"d":"20' LG"}`).parsed.d, "20' LG", 'value');
});

console.log('\n=== the failure that lost a whole drawing ===');
t("an escaped foot mark (\\') is repaired, not discarded", () => {
  // The real one: 'Bad escaped character in JSON at position 2849'.
  const r = parseJsonLenient(`{"description":"12\\" DIA X 20\\' LG SCREW CONVEYOR"}`);
  eq(r.parsed.description, `12" DIA X 20' LG SCREW CONVEYOR`, 'value');
  if (!r.repairs.some(x => /invalid escape/.test(x))) throw new Error('repair not reported: ' + r.repairs);
});
t('the rest of a long reply survives one bad escape', () => {
  const r = parseJsonLenient(`{"jobNumber":"2024-170","customer":"EARTH CARE","notes":"3\\ SCH 40 pipe","conveyorType":"screw"}`);
  eq(r.parsed.jobNumber, '2024-170', 'the title block still arrives');
  eq(r.parsed.conveyorType, 'screw', 'and so does everything after the bad character');
});
t('an invalid escape before a digit is dropped', () => {
  eq(parseJsonLenient('{"s":"2-7/16\\ bore"}').parsed.s, '2-7/16 bore', 'value');
});
t('a malformed unicode escape is dropped rather than killing the parse', () => {
  const r = parseJsonLenient('{"s":"20\\u00 deg"}');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
  if (!r.repairs.some(x => /\\u/.test(x))) throw new Error('repair not reported');
});
t('a real unicode escape is preserved', () => {
  eq(parseJsonLenient('{"s":"20\\u00b0 incline"}').parsed.s, '20° incline', 'degrees sign');
});

console.log('\n=== replies that ran out of room ===');
t('a truncated components array keeps the entries that made it', () => {
  // The output limit cuts mid-entry; everything before it is still good.
  const r = parseJsonLenient('{"parts":[{"item":"Motor"},{"item":"Reducer"},{"item":"Bea');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
  eq(r.parsed.parts.length, 2, 'complete entries kept');
  eq(r.parsed.parts[1].item, 'Reducer', 'the last complete one');
});
t('an unterminated string is closed', () => {
  const r = parseJsonLenient('{"notes":"the drive is at the left end');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
  eq(r.parsed.notes, 'the drive is at the left end', 'value');
});
t('a lone trailing backslash does not break the close', () => {
  const r = parseJsonLenient('{"notes":"2-7/16\\');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
});
t('nested structures are closed innermost first', () => {
  const r = parseJsonLenient('{"a":{"b":[1,2');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
  eq(JSON.stringify(r.parsed), '{"a":{"b":[1,2]}}', 'shape');
});

console.log('\n=== other things models do ===');
t('a trailing comma is removed', () => {
  const r = parseJsonLenient('{"a":1,"b":2,}');
  eq(r.parsed.b, 2, 'b');
});
t('a raw newline inside a string is escaped', () => {
  const r = parseJsonLenient('{"notes":"line one\nline two"}');
  if (!r.parsed) throw new Error('should have been salvaged: ' + r.reason);
  eq(r.parsed.notes, 'line one\nline two', 'value');
});
t('a brace inside a string is not mistaken for structure', () => {
  // The scan has to know it is inside a string, or it would count this.
  const r = parseJsonLenient('{"notes":"see detail {A} on sheet 2"}');
  eq(r.parsed.notes, 'see detail {A} on sheet 2', 'value');
  eq(r.repairs.length, 0, 'nothing needed fixing');
});
t('a quote inside a string, properly escaped, does not end it early', () => {
  const r = parseJsonLenient('{"a":"he said \\"go\\"","b":2}');
  eq(r.parsed.b, 2, 'parsing continued past the escaped quotes');
});

console.log('\n=== when it genuinely cannot be salvaged ===');
t('an empty reply says so rather than returning an empty object', () => {
  const r = parseJsonLenient('');
  eq(r.parsed, null, 'parsed');
  if (!/empty/.test(r.reason)) throw new Error('reason: ' + r.reason);
});
t('prose instead of JSON fails, and does not become a guess', () => {
  const r = parseJsonLenient('I was unable to read this drawing.');
  eq(r.parsed, null, 'parsed');
  if (!r.reason) throw new Error('no reason given');
});
t('null and undefined are handled', () => {
  eq(parseJsonLenient(null).parsed, null, 'null');
  eq(parseJsonLenient(undefined).parsed, null, 'undefined');
});

console.log('\n=== the title block survives a lost pass ===');
const { mergeTitleBlock } = await import('../src/blueprints/extract.js');

t('dimensions wins when it read the title block', () => {
  const r = mergeTitleBlock({ jobNumber: '2024-170', customer: 'EARTH CARE' }, { jobNumber: '2024-17O', customer: 'Earth Care Inc' });
  eq(r.jobNumber, '2024-170', 'job number');
  eq(r.customer, 'EARTH CARE', 'customer');
});
t('the parts pass fills in what a failed dimensions pass lost', () => {
  // The real failure: one bad escape sank the dimensions reply, and with
  // it the job number, customer and description off a drawing that had
  // actually been read fine.
  const r = mergeTitleBlock({}, { jobNumber: '2024-170', customer: 'EARTH CARE', description: '12" DIA X 20\' LG' });
  eq(r.jobNumber, '2024-170', 'job number');
  eq(r.description, '12" DIA X 20\' LG', 'description');
});
t('an empty string is not a value and falls through', () => {
  eq(mergeTitleBlock({ customer: '   ' }, { customer: 'EARTH CARE' }).customer, 'EARTH CARE', 'customer');
  eq(mergeTitleBlock({ customer: '' }, { customer: 'EARTH CARE' }).customer, 'EARTH CARE', 'customer');
});
t('both passes failing gives empty strings, never undefined', () => {
  const r = mergeTitleBlock({}, {});
  eq(r.jobNumber, '', 'job number');
  eq(r.customer, '', 'customer');
  eq(r.description, '', 'description');
  eq(r.drawing_number, '', 'drawing number');
});
t('a missing pass object does not throw', () => {
  eq(mergeTitleBlock(null, null).jobNumber, '', 'job number');
  eq(mergeTitleBlock(null, { customer: 'Acme' }).customer, 'Acme', 'customer');
});
t('a non-string value is coerced and trimmed', () => {
  eq(mergeTitleBlock({ jobNumber: 2024170 }, {}).jobNumber, '2024170', 'numeric job number');
  eq(mergeTitleBlock({ customer: '  Acme  ' }, {}).customer, 'Acme', 'trimmed');
});

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
