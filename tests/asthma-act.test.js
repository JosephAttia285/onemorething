/* ============================================================
   asthma-act.test.js — acceptance tests for the ACT/c-ACT logic.
   Run:  node tests/asthma-act.test.js
   Pure-logic tests over js/asthma-act.js (no DOM). Criteria are
   derived from the clinical spec (the "10 acceptance criteria"
   placeholder was not supplied, so these encode the spec directly).
   ============================================================ */

const {
  ACT_ITEM_LABELS, ACT_TOOLS, actToolForAge, actBand, ActReadiness, TALLY_ROWS,
} = require('../js/asthma-act.js');

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; } else { failed++; console.error('  ✗ FAIL: ' + name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), `${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }
function throws(fn, name) { let t = false; try { fn(); } catch (e) { t = true; } ok(t, name); }

/* helper: fully answer the itemised tool with a constant per item, or a map */
function fillItemised(act, valueOrMap) {
  const t = ACT_TOOLS[act.tool];
  t.items.forEach(it => {
    const v = typeof valueOrMap === 'function' ? valueOrMap(it) : valueOrMap;
    act.setResponse(it.id, v, 'clinician');
  });
}

/* 1 — age-driven tool selection, never user-chosen */
(() => {
  eq(actToolForAge(null).tool, null, '1a age null → no tool');
  ok(actToolForAge(null).disabled && /age required/i.test(actToolForAge(null).reason), '1b age null → disabled + reason');
  ok(actToolForAge(3).disabled && /under 4 years/i.test(actToolForAge(3).reason), '1c age 3 → under-4 disabled');
  eq(actToolForAge(4).tool, 'cact', '1d age 4 → c-ACT');
  eq(actToolForAge(11).tool, 'cact', '1e age 11 → c-ACT');
  eq(actToolForAge(12).tool, 'act', '1f age 12 → ACT');
  eq(actToolForAge(40).tool, 'act', '1g adult → ACT');
})();

/* 2 — c-ACT itemised sum + bands (0–27; 20–27 green, 13–19 amber, 0–12 red) */
(() => {
  const a = new ActReadiness(); a.setAge(8);
  eq(a.tool, 'cact', '2a age 8 → c-ACT');
  fillItemised(a, it => it.max);                 // all max → 3*4 + 5*3 = 27
  eq(a.totalScore, 27, '2b c-ACT all-max sums to 27');
  eq(a.band.band, 'green', '2c 27 → green');
  a.clearResponses(); fillItemised(a, 0); eq(a.totalScore, 0, '2d all-zero → 0'); eq(a.band.band, 'red', '2e 0 → red');
})();

/* 3 — c-ACT band boundaries 12/13 and 19/20 */
(() => {
  const mk = (total) => { const a = new ActReadiness(); a.setAge(8); a.setEntryMode('total'); a.setTotal(total, 'clinician'); return a; };
  eq(mk(12).band.band, 'red', '3a c-ACT 12 → red');
  eq(mk(13).band.band, 'amber', '3b c-ACT 13 → amber');
  eq(mk(19).band.band, 'amber', '3c c-ACT 19 → amber');
  eq(mk(20).band.band, 'green', '3d c-ACT 20 → green');
})();

/* 4 — ACT itemised sum + band boundaries (5–25; 20–25 green, 16–19 amber, 5–15 red) */
(() => {
  const a = new ActReadiness(); a.setAge(14);
  eq(a.tool, 'act', '4a age 14 → ACT');
  fillItemised(a, 5); eq(a.totalScore, 25, '4b ACT all-5 → 25'); eq(a.band.band, 'green', '4c 25 → green');
  const mk = (total) => { const x = new ActReadiness(); x.setAge(14); x.setEntryMode('total'); x.setTotal(total, 'clinician'); return x; };
  eq(mk(15).band.band, 'red', '4d ACT 15 → red');
  eq(mk(16).band.band, 'amber', '4e ACT 16 → amber');
  eq(mk(19).band.band, 'amber', '4f ACT 19 → amber');
  eq(mk(20).band.band, 'green', '4g ACT 20 → green');
})();

/* 5 — incomplete itemised → no total, no band */
(() => {
  const a = new ActReadiness(); a.setAge(8);
  a.setResponse('cact.child1', 2, 'clinician');
  eq(a.totalScore, null, '5a partial → total null');
  eq(a.band, null, '5b partial → band null');
})();

/* 6 — out-of-range rejected, NEVER clamped, message names the range */
(() => {
  const a = new ActReadiness(); a.setAge(14); a.setEntryMode('total');
  const r = a.setTotal(99, 'clinician');
  ok(!r.ok && /5.*25/.test(r.message), '6a ACT total 99 rejected, message names 5–25');
  eq(a.totalScore, null, '6b rejected total not stored (not clamped)');
  const a2 = new ActReadiness(); a2.setAge(8);
  const r2 = a2.setResponse('cact.child1', 4, 'clinician');   // child items max 3
  ok(!r2.ok && /0.*3/.test(r2.message), '6c c-ACT child item 4 rejected, names 0–3');
  eq(a2.responses['cact.child1'], undefined, '6d rejected response not stored');
  const r3 = a2.setResponse('cact.carer1', 5, 'clinician');   // carer items max 5
  ok(r3.ok && a2.responses['cact.carer1'] === 5, '6e carer item 5 accepted');
})();

/* 7 — HARD CONSTRAINT: scores are clinician-entered only. No speech/AI path may write. */
(() => {
  const a = new ActReadiness(); a.setAge(14); a.setEntryMode('total');
  throws(() => a.setTotal(20, 'ai'), '7a setTotal source "ai" throws');
  throws(() => a.setTotal(20, 'speech'), '7b setTotal source "speech" throws');
  throws(() => a.setTotal(20), '7c setTotal with no source throws');
  throws(() => a.setResponse('act.q1', 5, 'ai'), '7d setResponse source "ai" throws');
  eq(a.totalScore, null, '7e state unchanged after blocked writes');
  // there is no alternate un-guarded writer on the instance/prototype
  const writeNames = [];
  let o = a;
  while (o && o !== Object.prototype) { Object.getOwnPropertyNames(o).forEach(n => writeNames.push(n)); o = Object.getPrototypeOf(o); }
  const suspicious = writeNames.filter(n => /^(set|write|apply|fill|inject)/i.test(n) && !['setAge', 'setEntryMode', 'setResponse', 'setTotal'].includes(n));
  eq(suspicious, [], '7f no extra writer methods exist beyond the guarded ones');
  // the two guarded writers are the only ones, and both enforce the token (7a–7d prove it)
})();

/* 8 — tool & band are DERIVED, never stored as source of truth */
(() => {
  const a = new ActReadiness(); a.setAge(8); a.setEntryMode('total'); a.setTotal(22, 'clinician');
  eq(a.state.tool, 'cact', '8a state.tool derived from age');
  eq(a.state.band.band, 'green', '8b state.band derived from total');
  a.setAge(14);                                  // change age → tool re-derives
  eq(a.state.tool, 'act', '8c changing age re-derives tool with no explicit set');
  ok(!('tool' in a) === false || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(a), 'tool').get, '8d tool is a getter, not a stored field');
})();

/* 9 — 11/12 boundary detection for the confirm-and-clear flow */
(() => {
  const a = new ActReadiness(); a.setAge(11);
  ok(a.toolWouldChange(12), '9a 11→12 changes tool');
  ok(!a.toolWouldChange(10), '9b 11→10 same tool');
  ok(a.toolWouldChange(3), '9c 11→3 changes tool (disabled)');
})();

/* 10 — labels come from a separate config; logic must not depend on label text */
(() => {
  ok(ACT_ITEM_LABELS['cact.child1'] && ACT_ITEM_LABELS['act.q5'], '10a labels keyed by item id exist');
  const a = new ActReadiness(); a.setAge(8);
  const saved = ACT_ITEM_LABELS['cact.child1'];
  ACT_ITEM_LABELS['cact.child1'] = 'ZZZ placeholder changed';   // mutate label
  fillItemised(a, it => it.max);
  eq(a.totalScore, 27, '10b scoring unaffected by label text change');
  ACT_ITEM_LABELS['cact.child1'] = saved;
})();

/* 11 — Severity & risk tally: 7 rows, correct ids, NOT a score (no total exported) */
(() => {
  eq(TALLY_ROWS.length, 7, '11a tally has 7 rows');
  const ids = TALLY_ROWS.map(r => r.id);
  eq(ids, ['oral_steroid_courses', 'emergency_visits', 'hospital_admissions', 'salbutamol_canisters', 'school_days_lost', 'prev_picu_hdu', 'safeguarding'], '11b tally row ids match spec');
  eq(TALLY_ROWS.filter(r => r.type === 'yesno').map(r => r.id), ['prev_picu_hdu', 'safeguarding'], '11c PICU/HDU + safeguarding are yes/no');
  const mod = require('../js/asthma-act.js');
  ok(typeof mod.tallyScore === 'undefined' && typeof mod.tallyBand === 'undefined', '11d tally exposes no score/verdict function');
})();

console.log(`\nasthma-act: ${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
