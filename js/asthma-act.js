/* ============================================================
   asthma-act.js — Asthma Control Test (ACT / c-ACT) logic + config
   Pure logic and configuration, no DOM. Loadable in the browser
   (global) and in Node (module.exports) so the unit tests can run
   the same code the UI uses.

   Design constraints (from the clinical spec):
   - Tool is chosen by patient AGE, never by the user.
   - `tool` and `band` are ALWAYS derived, never stored as source of truth.
   - The score is CLINICIAN-ENTERED ONLY: the sole writers require an
     explicit source token of 'clinician'. No speech/AI code path can
     write responses or the total. (Asserted by asthma-act.test.js.)
   ============================================================ */

/* Short domain PLACEHOLDER labels, keyed by item id. The official
   questionnaire wording is copyright-licensed and will replace these
   later — NO logic anywhere may depend on the label text. */
const ACT_ITEM_LABELS = {
  'cact.child1': 'Asthma today',
  'cact.child2': 'Running / exercise / play',
  'cact.child3': 'Cough',
  'cact.child4': 'Night waking',
  'cact.carer1': 'Daytime symptoms (days)',
  'cact.carer2': 'Wheeze (days)',
  'cact.carer3': 'Night waking (days)',
  'act.q1': 'Activity limitation',
  'act.q2': 'Shortness of breath',
  'act.q3': 'Night waking',
  'act.q4': 'Reliever use',
  'act.q5': 'Self-rated control',
};

const ACT_TOOLS = {
  cact: {
    id: 'cact', name: 'c-ACT', ageMin: 4, ageMax: 11,
    items: [
      { id: 'cact.child1', min: 0, max: 3 }, { id: 'cact.child2', min: 0, max: 3 },
      { id: 'cact.child3', min: 0, max: 3 }, { id: 'cact.child4', min: 0, max: 3 },
      { id: 'cact.carer1', min: 0, max: 5 }, { id: 'cact.carer2', min: 0, max: 5 },
      { id: 'cact.carer3', min: 0, max: 5 },
    ],
    totalMin: 0, totalMax: 27,
    bands: [
      { min: 20, max: 27, band: 'green', label: 'Well controlled' },
      { min: 13, max: 19, band: 'amber', label: 'Not well controlled' },
      { min: 0, max: 12, band: 'red', label: 'Very poorly controlled' },
    ],
  },
  act: {
    id: 'act', name: 'ACT', ageMin: 12, ageMax: Infinity,
    items: [
      { id: 'act.q1', min: 1, max: 5 }, { id: 'act.q2', min: 1, max: 5 },
      { id: 'act.q3', min: 1, max: 5 }, { id: 'act.q4', min: 1, max: 5 },
      { id: 'act.q5', min: 1, max: 5 },
    ],
    totalMin: 5, totalMax: 25,
    bands: [
      { min: 20, max: 25, band: 'green', label: 'Well controlled' },
      { min: 16, max: 19, band: 'amber', label: 'Not well controlled' },
      { min: 5, max: 15, band: 'red', label: 'Very poorly controlled' },
    ],
  },
};

/* Age → tool. Never user-selectable. */
function actToolForAge(age) {
  const a = (age === '' || age == null) ? null : Number(age);
  if (a == null || isNaN(a)) return { tool: null, disabled: true, reason: 'Age required to select ACT tool' };
  if (a < 4) return { tool: null, disabled: true, reason: 'Not applicable — under 4 years' };
  if (a <= 11) return { tool: 'cact', disabled: false, reason: null };
  return { tool: 'act', disabled: false, reason: null };
}

/* Total → band (derived; null if no total or no tool). */
function actBand(toolId, total) {
  const t = ACT_TOOLS[toolId];
  if (!t || total == null) return null;
  const b = t.bands.find(x => total >= x.min && total <= x.max);
  return b ? { band: b.band, label: b.label } : null;
}

const ACT_CLINICIAN = 'clinician';

/* Holds one ACT/c-ACT assessment. tool & band are getters (derived).
   Writers require source === 'clinician'. */
class ActReadiness {
  constructor() {
    this.patientAge = null;
    this.entryMode = 'itemised';       // 'itemised' | 'total'
    this.responses = {};               // itemId -> number
    this._total = null;                // used only in 'total' mode
    this.completedAt = null;
  }

  /* ----- derived (never stored as source of truth) ----- */
  get tool() { return actToolForAge(this.patientAge).tool; }
  get disabled() { return actToolForAge(this.patientAge).disabled; }
  get reason() { return actToolForAge(this.patientAge).reason; }

  get totalScore() {
    const t = ACT_TOOLS[this.tool];
    if (!t) return null;
    if (this.entryMode === 'itemised') {
      const vals = t.items.map(it => this.responses[it.id]);
      if (vals.some(v => v == null)) return null;   // incomplete → no total
      return vals.reduce((a, b) => a + b, 0);
    }
    return this._total;
  }

  get band() { return actBand(this.tool, this.totalScore); }

  /* Serialisable snapshot in the spec's shape (tool & band derived). */
  get state() {
    return {
      tool: this.tool,
      patientAge: this.patientAge,
      responses: { ...this.responses },
      totalScore: this.totalScore,
      entryMode: this.entryMode,
      band: this.band,
      completedAt: this.completedAt,
    };
  }

  /* ----- guard: the only writers, clinician-only ----- */
  _assertClinician(source) {
    if (source !== ACT_CLINICIAN) {
      throw new Error('ACT/c-ACT scores are clinician-entered only — no speech/AI writes permitted.');
    }
  }

  /* Would moving to `newAge` change which tool applies? (For the
     11/12 boundary confirm dialog.) */
  toolWouldChange(newAge) {
    return actToolForAge(newAge).tool !== this.tool;
  }
  hasData() {
    return this._total != null || Object.keys(this.responses).length > 0;
  }

  /* Age is patient context, not a score, so it needs no source token.
     Crossing the tool boundary is handled by the caller (confirm +
     clearResponses) BEFORE calling this. */
  setAge(newAge) {
    this.patientAge = (newAge === '' || newAge == null) ? null : Number(newAge);
  }

  setEntryMode(mode) {
    if (mode !== 'itemised' && mode !== 'total') return;
    this.entryMode = mode;
  }

  /* Set one itemised response. Rejects out-of-range (never clamps). */
  setResponse(itemId, value, source) {
    this._assertClinician(source);
    const t = ACT_TOOLS[this.tool];
    const item = t && t.items.find(i => i.id === itemId);
    if (!item) return { ok: false, message: `Item ${itemId} is not part of the ${t ? t.name : 'current'} tool.` };
    if (value === null || value === '') { delete this.responses[itemId]; this._stamp(); return { ok: true }; }
    const n = Number(value);
    if (isNaN(n) || !Number.isInteger(n) || n < item.min || n > item.max) {
      return { ok: false, message: `Value must be a whole number between ${item.min} and ${item.max}.` };
    }
    this.responses[itemId] = n;
    this._stamp();
    return { ok: true };
  }

  /* Set the total directly (total-only mode). Rejects out-of-range. */
  setTotal(value, source) {
    this._assertClinician(source);
    const t = ACT_TOOLS[this.tool];
    if (!t) return { ok: false, message: 'No ACT tool active for this age.' };
    if (value === null || value === '') { this._total = null; this._stamp(); return { ok: true }; }
    const n = Number(value);
    if (isNaN(n) || !Number.isInteger(n) || n < t.totalMin || n > t.totalMax) {
      return { ok: false, message: `${t.name} total must be a whole number between ${t.totalMin} and ${t.totalMax}.` };
    }
    this._total = n;
    this._stamp();
    return { ok: true };
  }

  clearResponses() { this.responses = {}; this._total = null; this.completedAt = null; }

  _stamp() { this.completedAt = this.totalScore != null ? new Date().toISOString() : null; }
}

/* ----- Severity & risk tally (NOT a validated score) ----- */
const TALLY_ROWS = [
  { id: 'oral_steroid_courses', label: 'Oral steroid courses (12 mo)', type: 'number' },
  { id: 'emergency_visits', label: 'Emergency ED/UCC/GP visits (12 mo)', type: 'number' },
  { id: 'hospital_admissions', label: 'Hospital admissions (12 mo)', type: 'number' },
  { id: 'salbutamol_canisters', label: 'Salbutamol canisters used (12 mo)', type: 'number' },
  { id: 'school_days_lost', label: 'School days lost (12 mo)', type: 'number' },
  { id: 'prev_picu_hdu', label: 'Previous PICU/HDU admission', type: 'yesno' },
  { id: 'safeguarding', label: 'Safeguarding concern', type: 'yesno' },
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ACT_ITEM_LABELS, ACT_TOOLS, actToolForAge, actBand, ActReadiness, ACT_CLINICIAN, TALLY_ROWS };
}
