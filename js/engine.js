/* ============================================================
   engine.js — domain model classes (no DOM access)
   ChecklistItem, AuditLog, TranscriptStore, RadiologyReport,
   RuleEngine, RiskReadiness.
   ============================================================ */

const STATUS_ORDER = { red: 0, orange: 1, green: 2, grey: 3 };

/* A single checklist question. Wraps its metadata and detector strategy. */
class ChecklistItem {
  constructor(cfg) {
    this.id = cfg.id;
    this.label = cfg.label;
    this.prio = cfg.prio;
    this.src = cfg.src;
    this.group = cfg.group || cfg.prio;   // display grouping (section for asthma, priority for nodule)
    this.field = cfg.field || null;       // template field this tile maps to (asthma)
    this.clinicianOnly = !!cfg.clinicianOnly;
    this.defaultPrompt = cfg.defaultPrompt;
    this._detect = cfg.detect;
  }
  /* Evaluate this item against the lowercased transcript. */
  evaluate(lcText) {
    let r;
    try { r = this._detect(lcText); } catch (e) { r = { status: 'red' }; }
    if (!r.prompt) r.prompt = this.defaultPrompt;
    return r;
  }
}

/* Append-only log of status changes with timestamps and evidence. */
class AuditLog {
  constructor() { this.entries = []; }
  record({ id, label, status, evidence }) {
    this.entries.push({ time: AuditLog.now(), id, label, status, evidence: evidence || null });
  }
  recent(n = 40) { return [...this.entries].reverse().slice(0, n); }
  clear() { this.entries.length = 0; }
  static now() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}

/* Holds the running consultation transcript (speaker-tagged + raw). */
class TranscriptStore {
  constructor() { this.lines = []; this.text = ''; }
  addLine(speaker, text) {
    const time = AuditLog.now();
    this.lines.push({ speaker, text, time });
    this.text += '\n' + speaker + ': ' + text;
    return time;
  }
  addRaw(text) {
    const time = AuditLog.now();
    this.lines.push({ speaker: 'Speaker', text, time });
    this.text += '\n' + text;
    return time;
  }
  get lowercased() { return this.text.toLowerCase(); }
  get isEmpty() { return this.text.trim().length === 0; }
  clear() { this.lines = []; this.text = ''; }
  /* Rebuild from a saved session. */
  restore(lines) {
    this.lines = (lines || []).slice();
    this.text = this.lines.map(l => (l.speaker ? l.speaker + ': ' : '') + l.text).join('\n');
  }
}

/* Radiology/PET report — per-field values entered by the clinician.
   Each field stays locked until a value is typed in. */
class RadiologyReport {
  constructor(fields) { this.fields = fields; this.values = {}; }
  set(id, val) { const v = (val || '').trim(); if (v) this.values[id] = v; else delete this.values[id]; }
  value(id) { return this.values[id] || null; }
  // a genuine, usable value (excludes "not performed" / "n/a" / "unknown")
  has(id) { const v = this.values[id]; return !!v && !/not performed|n\/?a|none|unknown/i.test(v); }
  get loaded() { return Object.keys(this.values).length > 0; }
  loadExample(mock) { this.fields.forEach(f => { if (mock[f.id]) this.set(f.id, mock[f.id]); }); }
  clear() { this.values = {}; }
}

/* Runs every checklist item over the transcript and tracks changes. */
class RuleEngine {
  constructor(items, audit) {
    this.items = items;
    this.audit = audit;
    this.results = {};
    this.prevStatus = {};
  }
  run(transcriptStore) {
    const t = _normalizeNumbers(transcriptStore.lowercased);
    for (const item of this.items) {
      const r = item.evaluate(t);
      this.results[item.id] = r;
      if (this.prevStatus[item.id] !== r.status) {
        if (this.prevStatus[item.id] !== undefined || r.status !== 'red') {
          this.audit.record({ id: item.id, label: item.label, status: r.status, evidence: r.evidence });
        }
        this.prevStatus[item.id] = r.status;
      }
    }
    return this.results;
  }
  status(id) { return this.results[id]?.status || 'red'; }
  /* Items sorted red → orange → green for display. */
  ordered() {
    return [...this.items].sort((a, b) =>
      STATUS_ORDER[this.status(a.id)] - STATUS_ORDER[this.status(b.id)]);
  }
  counts() {
    const c = { red: 0, orange: 0, green: 0, grey: 0 };
    for (const it of this.items) c[this.status(it.id)] = (c[this.status(it.id)] || 0) + 1;
    return c;
  }
  reset() { this.results = {}; this.prevStatus = {}; }
}

/* Computes Brock/Herder input-readiness (never a risk percentage). */
class RiskReadiness {
  constructor(engine, ehr, radiology) {
    this.engine = engine;
    this.ehr = ehr;
    this.radiology = radiology;
  }
  _patientState(id) {
    const s = this.engine.status(id);
    if (s === 'green') return 'ok';
    if (s === 'orange') return 'partial';
    return 'no';
  }
  _label(id) {
    const s = this.engine.status(id);
    return s === 'green' ? 'complete' : s === 'orange' ? 'unclear' : 'missing';
  }
  _radRow(label, id) {
    const v = this.radiology.value(id);
    // PET only counts as ready if an actual uptake category was recorded
    const present = id === 'RAD6' ? this.radiology.has(id) : v != null;
    return [label, present ? 'ok' : 'lock', v != null ? v : 'not entered'];
  }
  compute() {
    const ehr = this.ehr;
    const brockPatient = [
      ['Age (EHR)', ehr.age ? 'ok' : 'no', ehr.age || 'missing'],
      ['Sex (EHR)', ehr.sex ? 'ok' : 'no', ehr.sex || 'missing'],
      ['Family history lung cancer', this._patientState('PN6'), this._label('PN6')],
      ['Emphysema/COPD', this._patientState('PN7'), this._label('PN7')],
      ['Smoking status', this._patientState('PN1'), this._label('PN1')],
    ];
    const brockCT = [
      this._radRow('Nodule size', 'RAD1'),
      this._radRow('Nodule type', 'RAD2'),
      this._radRow('Upper-lobe location', 'RAD4'),
      this._radRow('Nodule count', 'RAD5'),
      this._radRow('Spiculation', 'RAD3'),
    ];
    const herderPatient = [
      ['Age (EHR)', ehr.age ? 'ok' : 'no', ehr.age || 'missing'],
      ['Smoking status', this._patientState('PN1'), this._label('PN1')],
      ['Previous cancer', this._patientState('PN4'), this._label('PN4')],
    ];
    const herderPET = [
      this._radRow('Nodule diameter', 'RAD1'),
      this._radRow('Upper-lobe location', 'RAD4'),
      this._radRow('Spiculation', 'RAD3'),
      this._radRow('PET FDG uptake', 'RAD6'),
    ];
    return {
      brock: this._card(brockPatient, brockCT),
      herder: this._card(herderPatient, herderPET),
    };
  }
  _card(patient, radiology) {
    const patN = patient.filter(r => r[1] === 'ok').length;
    const radN = radiology.filter(r => r[1] === 'ok').length;
    const patComplete = patN === patient.length;
    const allReady = patComplete && radN === radiology.length;
    return { patient, radiology, patN, patTot: patient.length, patComplete, allReady };
  }
}
