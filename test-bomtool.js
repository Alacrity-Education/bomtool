// Test harness for bomtool.html: extracts the <script> block and runs the pure
// merge logic against the real example CSVs plus synthetic edge cases.
// Run with: node test-bomtool.js
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const html = fs.readFileSync(path.join(DIR, 'bomtool.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const modPath = path.join(DIR, '.bomtool-core.test.cjs');
fs.writeFileSync(modPath, script);
const B = require(modPath);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); }
}
function load(file, multiplier = 1) {
  const bom = B.parseBOM(file, fs.readFileSync(path.join(DIR, 'example', file), 'utf8'));
  bom.multiplier = multiplier;
  return bom;
}
const findRows = (res, footprint) => res.rows.filter(r => r.footprint === footprint);
const byValue = (res, v) => res.rows.filter(r => r.values.includes(v));

// ---------- footprint shortening ----------
check('R0603', B.shortenFootprint('Resistor_SMD:R_0603_1608Metric') === 'R0603');
check('R0805 with suffixes', B.shortenFootprint('Resistor_SMD:R_0805_2012Metric_Pad1.20x1.40mm_HandSolder') === 'R0805');
check('C1812', B.shortenFootprint('Capacitor_SMD:C_1812_4532Metric') === 'C1812');
check('LED -> D0603', B.shortenFootprint('LED_SMD:LED_0603_1608Metric') === 'D0603');
check('Diode -> D0805', B.shortenFootprint('Diode_SMD:D_0805_2012Metric') === 'D0805');
check('5-digit imperial 01005', B.shortenFootprint('Resistor_SMD:R_01005_0402Metric') === 'R01005');
check('THT radial cap untouched', B.shortenFootprint('Capacitor_THT:CP_Radial_D10.0mm_P5.00mm') === 'Capacitor_THT:CP_Radial_D10.0mm_P5.00mm');
check('choke without size untouched', B.shortenFootprint('Inductor_SMD:L_CommonModeChoke_Coilank_ACM4532') === 'Inductor_SMD:L_CommonModeChoke_Coilank_ACM4532');
check('non-RCLD untouched', B.shortenFootprint('Package_TO_SOT_SMD:SOT-23') === 'Package_TO_SOT_SMD:SOT-23');
check('empty untouched', B.shortenFootprint('') === '');

// ---------- parsing of the 5 real files ----------
const badge = load('alacrity badge.csv');
const candu = load('CANDU.csv');
const indx = load('indxworks.csv');
const midea = load('Midea WiFi Dongle.csv');
const pipsu = load('PIPSU.csv');

check('badge rows', badge.entries.length === 5, badge.entries.length);
check('candu rows', candu.entries.length === 12, candu.entries.length);
check('indx rows', indx.entries.length === 24, indx.entries.length);
check('midea rows', midea.entries.length === 8, midea.entries.length);
check('pipsu rows', pipsu.entries.length === 9, pipsu.entries.length);
check('indx SPEC columns = Type,Inductance', JSON.stringify(indx.specColumns) === '["Type","Inductance"]', indx.specColumns);
check('classifyColumn: blacklist ignored', ['Datasheet', 'sim.pins', 'Description'].every(c => B.classifyColumn(c).type === 'ignore'));
check('classifyColumn: other columns kept as SPEC', B.classifyColumn('Tolerance').type === 'spec' && B.classifyColumn('Tolerance').name === 'Tolerance');
check('indx mouser code trimmed', indx.entries.find(e => e.refsRaw === 'U3').mfr.Mouser === '511-STR485ELVQT');
check('indx TME column detected', indx.mfrColumns.includes('TME'), indx.mfrColumns);
check('entry id format', candu.entries[0].id === 'CANDU:C1,C2,C3,C4', candu.entries[0].id);
check('badge footprints shortened at parse', badge.entries.find(e => e.refsRaw.startsWith('C1')).footprint === 'C0603');

// ---------- merge of all 5, multiplier 1 ----------
const res1 = B.mergeBOMs([badge, candu, indx, midea, pipsu]);

check('42 merged rows', res1.rows.length === 42, res1.rows.length);

// value stays in the grouping key: unrelated resistors do NOT merge
const r0603 = findRows(res1, 'R0603');
check('three plain R0603 rows (120, 10K, 10k)', r0603.length === 3 &&
  JSON.stringify(r0603.map(r => [r.values.join(), r.qty, r.mfr.LCSC]).sort()) ===
  JSON.stringify([['10K', 1, 'C2906982'], ['10k', 8, 'C25744'], ['120', 4, 'C2907096']].sort()),
  r0603.map(r => [r.values, r.qty, r.mfr.LCSC]));

// R0805: 0-ohm merges across CANDU+PIPSU (same value+fp); 1k stays separate with its own code
const r0805 = findRows(res1, 'R0805');
check('two R0805 rows', r0805.length === 2, r0805.map(r => [r.values, r.qty]));
const r0805zero = r0805.find(r => r.values.includes('0'));
const r0805oneK = r0805.find(r => r.values.includes('1k'));
check('0-ohm row: CANDU+PIPSU, qty 4, C2907215', r0805zero && r0805zero.qty === 4 && r0805zero.mfr.LCSC === 'C2907215' &&
  r0805zero.ids.includes('CANDU:R1,R2') && r0805zero.ids.includes('PIPSU:R5,R6'), r0805zero);
check('1k row separate with C2907232', r0805oneK && r0805oneK.qty === 2 && r0805oneK.mfr.LCSC === 'C2907232', r0805oneK);

// identical code + same footprint/SPEC, different value -> silent merge
const c100n = byValue(res1, '100n')[0];
check('100n and 100nF merged via C1591, qty 6', c100n && c100n.qty === 6 && c100n.mfr.LCSC === 'C1591' &&
  JSON.stringify(c100n.values) === '["100n","100nF"]', c100n);
check('no warning for the 100n/100nF merge', !res1.warnings.some(w => w.message.includes('C1591')));
const led = findRows(res1, 'D0603').filter(r => r.values.includes('LED-BLUE'));
check('badge LEDs + indx D5 silently merged (same fp, code C965807), qty 9', led.length === 1 && led[0].qty === 9 &&
  JSON.stringify(led[0].values) === '["LED-BLUE","PWR-BLUE"]' && !res1.warnings.some(w => w.message.includes('C965807')),
  [led.map(r => [r.values, r.qty]), res1.warnings.filter(w => w.message.includes('C965807')).map(w => w.message)]);
const jst = findRows(res1, 'Connector_JST:JST_XH_B2B-XH-A_1x02_P2.50mm_Vertical');
check('JST_XH CAN1..CAN_HOST silently unified via C158012, qty 6', jst.length === 1 && jst[0].qty === 6 &&
  jst[0].mfr.LCSC === 'C158012' && jst[0].orderFrom === 'LCSC' &&
  JSON.stringify(jst[0].values) === '["CAN1","CAN2","CAN3","CAN4","CAN_HOST"]' &&
  !res1.warnings.some(w => w.message.includes('C158012')), jst.map(r => [r.values, r.qty]));
const altech = findRows(res1, 'TerminalBlock_Altech:Altech_AK300_1x02_P5.00mm_45-Degree');
check('Altech PWR1/PWR2/PWR silently unified, qty 6', altech.length === 1 && altech[0].qty === 6 &&
  JSON.stringify(altech[0].values) === '["PWR1","PWR2","PWR"]', altech.map(r => [r.values, r.qty]));
const wifi = byValue(res1, 'WIFISOCKET_P1');
check('WIFISOCKET_P1/P2 silently unified, qty 2', wifi.length === 1 && wifi[0].qty === 2 && wifi[0].values.includes('WIFISOCKET_P2'), wifi);

// identical code + DIFFERENT footprint -> merge WITH warning:
// badge 470 on C0603 vs indxworks 470 on R0603, both LCSC C2907172
const r470 = findRows(res1, 'C0603; R0603');
check('470 cluster C0603;R0603 qty 10 via C2907172', r470.length === 1 && r470[0].qty === 10 &&
  r470[0].mfr.LCSC === 'C2907172' && JSON.stringify(r470[0].values) === '["470"]',
  r470.map(r => [r.values, r.qty, r.mfr]));
check('470 specmerge warning', res1.warnings.some(w => w.type === 'specmerge' && w.message.includes('C2907172') &&
  w.ids.includes('indxworks:R9,R10')), res1.warnings.filter(w => w.type === 'specmerge').map(w => w.message));

// with Datasheet dropped, indx U4 and Midea U3 have identical footprint+SPECs and
// the same TME code -> silent merge (only their values differ)
const sot223 = res1.rows.filter(r => r.ids.includes('indxworks:U4'));
check('U4+U3 silently merged via TME code', sot223.length === 1 && sot223[0].qty === 2 &&
  sot223[0].mfr.TME === 'MCP1825S-3302E/DB' && sot223[0].orderFrom === 'TME' &&
  sot223[0].ids.includes('Midea WiFi Dongle:U3') &&
  !res1.warnings.some(w => w.message.includes('MCP1825S-3302E/DB')), sot223);

// value-matched merges across boards
const c10u = findRows(res1, 'C0603').filter(r => r.values.includes('10u'));
check('10u C0603 merged qty 7', c10u.length === 1 && c10u[0].qty === 7 && c10u[0].mfr.LCSC === 'C1691', c10u);
const c1u = byValue(res1, '1u').filter(r => r.footprint === 'C0603');
check('1u C0603 merged qty 3', c1u.length === 1 && c1u[0].qty === 3 && c1u[0].mfr.LCSC === 'C29936', c1u);

// warning census on real data
check('0 code-conflict warnings', res1.warnings.filter(w => w.type === 'codes').length === 0,
  res1.warnings.filter(w => w.type === 'codes').map(w => w.message));
check('1 specmerge warning (470 cluster only)', res1.warnings.filter(w => w.type === 'specmerge').length === 1,
  res1.warnings.filter(w => w.type === 'specmerge').map(w => w.message));
check('1 no-code warning (badge AE1)', res1.warnings.filter(w => w.type === 'nocode').length === 1 &&
  res1.warnings.some(w => w.type === 'nocode' && w.ids.includes('alacrity badge:AE1')),
  res1.warnings.filter(w => w.type === 'nocode').map(w => w.message));
check('no designator warnings on real files', res1.warnings.filter(w => w.type === 'designators').length === 0);
check('all non-parse warnings carry ids', res1.warnings.filter(w => w.type !== 'parse').every(w => Array.isArray(w.ids) && w.ids.length > 0));
check('1 red row (no ordering code)', res1.rows.filter(r => r.orderFrom === '').length === 1,
  res1.rows.filter(r => r.orderFrom === '').map(r => r.ids));

// per-supplier summary block
check('summary buckets', JSON.stringify(res1.summary) === JSON.stringify([
  { mfr: 'TME', qty: 14, lines: 5 },
  { mfr: 'Mouser', qty: 1, lines: 1 },
  { mfr: 'LCSC', qty: 97, lines: 35 },
  { mfr: '', qty: 1, lines: 1 },
]), res1.summary);
check('summary qty equals total (113)', res1.summary.reduce((s, b) => s + b.qty, 0) === 113 &&
  res1.rows.reduce((s, r) => s + r.qty, 0) === 113);
check('summary lines equal row count', res1.summary.reduce((s, b) => s + b.lines, 0) === res1.rows.length);

// ---------- output column layout ----------
const csv = B.parseCSV(B.resultToCSV(res1));
check('header order: refs,qty,value,fp,mfr...,spec...', csv[0].join('|') === 'References|Qty|Value|Footprint|TME|Mouser|Digikey|LCSC|Type|Inductance', csv[0]);
check('no Order From column', !csv[0].includes('Order From'));
check('exported CSV row count', csv.length === res1.rows.length + 1, csv.length);
check('CSV value cell joined with ;', csv.some(r => r[2] === '100n; 100nF'), csv.map(r => r[2]).slice(0, 8));
check('CSV Type/Inductance specs in last columns', csv.some(r => r[8] === 'C0G <1%') && csv.some(r => r[9] === '60uH'));

// ---------- multipliers ----------
const indx5 = load('indxworks.csv', 5);
const res2 = B.mergeBOMs([indx5]);
const r120 = byValue(res2, '120');
check('multiplier scales qty (120 x4 x5 = 20)', r120.length === 1 && r120[0].qty === 20, r120.map(r => r.qty));

// conflict resolution: same value+footprint, different codes -> largest effective qty wins
const a = B.parseBOM('AAA.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R1,R2","2","1k","R_0603","C111"\n');
const b = B.parseBOM('BBB.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R5,R6,R7,R8,R9","5","1k","R_0603","C222"\n');
a.multiplier = 1; b.multiplier = 1;
const res4 = B.mergeBOMs([a, b]);
check('identical spec different codes combined', res4.rows.length === 1 && res4.rows[0].qty === 7, res4.rows);
check('largest qty code wins with warning', res4.rows[0].mfr.LCSC === 'C222' &&
  res4.warnings.some(w => w.type === 'codes' && w.message.includes('AAA:R1,R2') && w.message.includes('BBB:R5,R6,R7,R8,R9')),
  res4.warnings.map(w => w.message));
const a10 = B.parseBOM('AAA.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R1,R2","2","1k","R_0603","C111"\n');
a10.multiplier = 10;
check('multiplier changes winner', B.mergeBOMs([a10, b]).rows[0].mfr.LCSC === 'C111');

// ---------- synthetic: value ignored only when code AND footprint match ----------
const v1 = B.parseBOM('V1.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D1","1","PWR-RED","LED_SMD:LED_0603_1608Metric","C9"\n');
const v2 = B.parseBOM('V2.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D2","1","STATUS-RED","LED_SMD:LED_0603_1608Metric","C9"\n');
v1.multiplier = 1; v2.multiplier = 1;
const res3 = B.mergeBOMs([v1, v2]);
check('same code+footprint, different values: silent merge', res3.rows.length === 1 && res3.rows[0].qty === 2 &&
  JSON.stringify(res3.rows[0].values) === '["PWR-RED","STATUS-RED"]' && res3.warnings.length === 0,
  [res3.rows.map(r => r.values), res3.warnings.map(w => w.message)]);

// different values, different codes, same footprint -> stay separate
const u1 = B.parseBOM('U1.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R1","1","0","R_0805","C1"\n"R2","1","1k","R_0805","C2"\n');
u1.multiplier = 1;
check('different values+codes same footprint stay separate', B.mergeBOMs([u1]).rows.length === 2);

// different values, no codes, same footprint -> stay separate
const u2 = B.parseBOM('U2.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R1","1","0","R_0805",""\n"R2","1","1k","R_0805",""\n');
u2.multiplier = 1;
check('codeless different values stay separate', B.mergeBOMs([u2]).rows.length === 2);

// ---------- synthetic: identical code across DIFFERENT specifications -> merge + warning ----------
const m1 = B.parseBOM('M1.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D1","1","LED","LED_SMD:LED_0603_1608Metric","C42"\n');
const m2 = B.parseBOM('M2.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D9","2","LED","Capacitor_SMD:C_0805_2012Metric","C42"\n');
m1.multiplier = 1; m2.multiplier = 1;
const res9 = B.mergeBOMs([m1, m2]);
check('same code different footprint merged with warning', res9.rows.length === 1 && res9.rows[0].qty === 3 &&
  res9.rows[0].footprint === 'D0603; C0805' &&
  res9.warnings.some(w => w.type === 'specmerge' && w.message.includes('M1:D1') && w.message.includes('M2:D9') && w.message.includes('C42')),
  [res9.rows.map(r => r.footprint), res9.warnings.map(w => w.message)]);
check('no code-conflict warning (codes identical)', !res9.warnings.some(w => w.type === 'codes'));

// same code AND same spec AND same value -> plain merge, zero warnings
const m3 = B.parseBOM('M3.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D1","1","LED","LED_SMD:LED_0603_1608Metric","C42"\n');
const m4 = B.parseBOM('M4.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"D2","1","LED","LED_SMD:LED_0603_1608Metric","C42"\n');
m3.multiplier = 1; m4.multiplier = 1;
const res10 = B.mergeBOMs([m3, m4]);
check('same code same spec: no warnings', res10.rows.length === 1 && res10.warnings.length === 0);

// identical code bridges a SPEC-field difference, with warning
const m5 = B.parseBOM('M5.csv', '"Reference","Qty","Value","Footprint","LCSC","Type"\n"C1","1","100p","C_0603","C7","C0G"\n');
const m6 = B.parseBOM('M6.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"C2","1","100p","C_0603","C7"\n');
m5.multiplier = 1; m6.multiplier = 1;
const res11 = B.mergeBOMs([m5, m6]);
check('identical code bridges SPEC difference with warning', res11.rows.length === 1 && res11.rows[0].qty === 2 &&
  res11.rows[0].specs.Type === 'C0G' && res11.warnings.filter(w => w.type === 'specmerge').length === 1,
  [res11.rows.map(r => [r.qty, r.specs]), res11.warnings.map(w => w.message)]);

// ---------- synthetic: SPEC separation without a code bridge ----------
const s1 = B.parseBOM('S1.csv', '"Reference","Qty","Value","Footprint","LCSC","Type"\n"C1","1","100p","C_0603","C9","C0G"\n"C2","1","100p","C_0603","C8",""\n');
s1.multiplier = 1;
check('SPEC vs no-SPEC not grouped', B.mergeBOMs([s1]).rows.length === 2);
const s3 = B.parseBOM('S3.csv', '"Reference","Qty","Value","Footprint","LCSC","Type"\n"C1","1","100p","C_0603","C9","C0G"\n"C2","1","100p","C_0603","C10","X7R"\n');
s3.multiplier = 1;
check('different SPEC values (and codes) not grouped', B.mergeBOMs([s3]).rows.length === 2);

// ---------- synthetic: designator mismatch ----------
const bad = B.parseBOM('BAD.csv', '"Reference","Qty","Value","Footprint","LCSC"\n"R1,R2,R3","2","1k","R_0603","C1"\n');
bad.multiplier = 1;
const resBad = B.mergeBOMs([bad]);
check('designator mismatch warning with ids', resBad.warnings.some(w => w.type === 'designators' &&
  w.message.includes('BAD:R1,R2,R3') && w.message.includes('Qty is 2') && w.ids.includes('BAD:R1,R2,R3')));

// ---------- TME vs "TME ID" columns unify; orderFrom prefers configured order ----------
const t1 = B.parseBOM('T1.csv', '"Reference","Qty","Value","Footprint","TME"\n"U1","1","MCP","SOT223","ABC"\n');
const t2 = B.parseBOM('T2.csv', '"Reference","Qty","Value","Footprint","TME ID"\n"U2","1","MCP","SOT223","ABC"\n');
t1.multiplier = 1; t2.multiplier = 1;
const res8 = B.mergeBOMs([t1, t2]);
check('TME and TME ID unify', res8.rows.length === 1 && res8.rows[0].mfr.TME === 'ABC' && res8.rows[0].qty === 2);
const p1 = B.parseBOM('P1.csv', '"Reference","Qty","Value","Footprint","LCSC","TME"\n"U1","1","X","F","CL1","TM1"\n');
p1.multiplier = 1;
check('orderFrom prefers TME (configured order)', B.mergeBOMs([p1]).rows[0].orderFrom === 'TME');

// ---------- csv escaping ----------
check('csv escaping', B.csvEscape('a"b,c') === '"a""b,c"');

fs.unlinkSync(modPath);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
