/* ============================================================
   eval.js — rules-engine scorecard
   Runs each transcript in tests/*.txt through the OFFLINE rules
   engine and compares the resulting status of every checklist item
   against the gold labels in gold.json.

   Rules-only (deterministic, offline) — no AI/network needed, so it
   is fast and safe to run in CI. The AI refinement lifts several of
   the "late reveal" items further; this measures the rules floor.

   Run:  node tests/eval.js
   ============================================================ */

const fs = require('fs');
const path = require('path');

// Load the browser (classic-script) modules and expose their globals.
const JS = path.join(__dirname, '..', 'js');
const src = ['config.js', 'engine.js'].map(f => fs.readFileSync(path.join(JS, f), 'utf8')).join('\n');
const M = new Function(src + '\nreturn { CHECKLIST_CONFIG, ChecklistItem, RuleEngine, AuditLog, TranscriptStore };')();

const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold.json'), 'utf8'));
const PN = Array.from({ length: 16 }, (_, i) => 'PN' + (i + 1));
const c = { green: '\x1b[32m', orange: '\x1b[33m', red: '\x1b[31m', grey: '\x1b[90m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
const col = s => (c[s] || '') + s + c.reset;

function loadTranscript(name) {
  const raw = fs.readFileSync(path.join(__dirname, name + '.txt'), 'utf8');
  const ts = new M.TranscriptStore();
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    const m = s.match(/^(doctor|clinician|patient)\s*:\s*(.*)$/i);
    if (m) ts.addLine(/^p/i.test(m[1]) ? 'Patient' : 'Clinician', m[2]);
    else ts.addRaw(s);
  }
  return ts;
}

let grandPass = 0, grandTotal = 0;
const missed = [];

for (const script of Object.keys(gold)) {
  const ts = loadTranscript(script);
  const items = M.CHECKLIST_CONFIG.map(cfg => new M.ChecklistItem(cfg));
  const eng = new M.RuleEngine(items, new M.AuditLog());
  eng.run(ts);

  let pass = 0, total = 0;
  console.log(`\n${c.bold}=== ${script.toUpperCase()} ===${c.reset}`);
  for (const id of PN) {
    const exp = gold[script][id];
    if (!exp) continue;
    total++;
    const got = eng.status(id);
    const ok = got === exp;
    if (ok) pass++; else missed.push({ script, id, exp, got, extracted: (eng.results[id] || {}).extracted || '' });
    const mark = ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`  ${id.padEnd(5)} exp ${col(exp).padEnd(16)} got ${col(got).padEnd(16)} ${mark}`);
  }
  const pct = Math.round((pass / total) * 100);
  console.log(`  ${c.bold}→ ${pass}/${total} (${pct}%)${c.reset}`);
  grandPass += pass; grandTotal += total;
}

console.log(`\n${c.bold}RULES-ONLY TOTAL: ${grandPass}/${grandTotal} (${Math.round(grandPass / grandTotal * 100)}%)${c.reset}`);

if (missed.length) {
  console.log(`\n${c.dim}Mismatches (candidates for AI refinement or rule tuning):${c.reset}`);
  for (const m of missed) {
    console.log(`  ${m.script.padEnd(8)} ${m.id.padEnd(5)} exp ${col(m.exp)} got ${col(m.got)}  ${c.dim}${m.extracted.slice(0, 60)}${c.reset}`);
  }
}
