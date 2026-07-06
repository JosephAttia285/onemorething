/* ============================================================
   app.js — DemoPlayer + App (composition root)
   Wires the model classes, UI and input sources together.
   Loaded last; boots on DOMContentLoaded.
   ============================================================ */

/* Plays a scripted consultation line-by-line on a timer, with pause/resume. */
class DemoPlayer {
  constructor(script, onLine, onDone) {
    this.script = script;
    this.onLine = onLine;
    this.onDone = onDone || (() => {});
    this.running = false;
    this.paused = false;
    this.i = 0;
    this._timer = null;
  }
  play() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.i = 0;
    this._next();
  }
  _next() {
    if (this.paused) return;
    if (this.i >= this.script.length) { this.running = false; this.onDone(); return; }
    const [who, text] = this.script[this.i];
    this.onLine(who, text);
    const gap = (this.i === 6) ? 2600 : 1500;   // pause before the "missed questions" turn
    this.i++;
    this._timer = setTimeout(() => this._next(), gap);
  }
  pause() { if (this.running && !this.paused) { this.paused = true; clearTimeout(this._timer); } }
  resume() { if (this.running && this.paused) { this.paused = false; this._next(); } }
  stop() { this.running = false; this.paused = false; this.i = 0; clearTimeout(this._timer); }
}

class App {
  constructor() {
    // ----- DOM references -----
    this.refs = {};
    [
      'micBtn', 'pauseBtn', 'demoBtn', 'ctBtn', 'ctBtn2', 'settingsBtn', 'pipBtn', 'resetBtn',
      'tiles', 'ring', 'ringPct', 'statusText', 'critText', 'liveDot',
      'post', 'summary', 'copyBtn', 'transcript', 'transcriptNote', 'relabelBtn',
      'readiness', 'radiology', 'audit', 'ehrAge', 'ehrSex', 'ehrNote', 'enginePill',
      'modal', 'llmEnabled', 'llmBase', 'llmModel', 'llmKey', 'llmStatus', 'llmTest', 'modalClose',
      'ctModal', 'ctText', 'ctFile', 'ctSample', 'ctExtractNote', 'ctClose', 'ctApply',
    ].forEach(id => { this.refs[id] = document.getElementById(id); });

    // ----- model -----
    this.items = CHECKLIST_CONFIG.map(cfg => new ChecklistItem(cfg));
    this.audit = new AuditLog();
    this.transcript = new TranscriptStore();
    this.radiology = new RadiologyReport(RAD_FIELDS);
    this.ehr = { ...EHR_DEFAULTS };
    this.ehrAgeEdited = false;   // becomes true once the clinician edits the field by hand
    this.ehrSexEdited = false;
    this._micPaused = false;     // mic was paused via the Pause button (transcript kept)
    this._pip = null;            // floating mini-window handle
    this._miniRoot = null;
    this._autoMini = true;       // attempt to auto-open the floating window when hidden
    this.finished = false;       // consultation stopped → post-consult view shown
    this.engine = new RuleEngine(this.items, this.audit);
    this.readiness = new RiskReadiness(this.engine, this.ehr, this.radiology);

    // ----- services -----
    this.ui = new UIRenderer(this.refs);
    this.llm = new LlmRefiner({ onStatus: (m, c) => this._setLlmStatus(m, c) });
    this.speech = new SpeechController({
      onFinal: (text) => { this.transcript.addRaw(text); this.ui.appendLine('Speaker', text); this.refresh(); },
      onInterim: (text) => this.ui.showInterim(text),
      onError: (err) => { if (err === 'unsupported') alert('Live speech recognition is not supported here. Please use Chrome, or run the demo.'); if (err === 'not-allowed') { alert('Microphone permission denied.'); this.ui.setMicState(false); } },
    });
    this.demo = new DemoPlayer(DEMO_SCRIPT,
      (who, text) => { this.transcript.addLine(who, text); this.ui.appendLine(who, text); this.refresh(); },
      () => { this.refs.demoBtn.disabled = false; this._updatePauseBtn(); this._consultEnd(); });
  }

  init() {
    this._wire();
    // auto-connect AI if a key is present in secrets.js
    this.llm.configure(AI_DEFAULTS);
    this.refs.llmEnabled.checked = AI_DEFAULTS.enabled;
    this.refs.llmBase.value = AI_DEFAULTS.base;
    this.refs.llmModel.value = AI_DEFAULTS.model;
    this.refs.llmKey.value = AI_DEFAULTS.key;
    this.refs.settingsBtn.textContent = this.llm.enabled ? '⚙ AI: on' : '⚙ AI settings';
    this.refs.relabelBtn.classList.toggle('hidden', !this.llm.ready);
    this._updateEnginePill();
    this.ui.renderRadiology(this.radiology);
    this.refresh();
    // best-effort: pop the floating window out when the page is hidden/minimised.
    // Browsers require a recent user gesture to open it, so this only succeeds
    // sometimes (e.g. shortly after a click) — the Minimise button is the reliable way.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !this._pip && this._autoMini && !this.transcript.isEmpty) {
        this._toggleMiniWindow().catch(() => {});
      }
    });
  }

  /* Re-run the engine and repaint everything that depends on the transcript. */
  refresh() {
    this.engine.run(this.transcript);
    this._applyContext();
    this.ui.renderTiles(this.engine);
    this.ui.renderProgress(this.engine);
    this.ui.renderReadiness(this.readiness);
    this.ui.renderAudit(this.audit);
    if (this._miniRoot) this._renderMini();
    if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology);
    if (this.llm.enabled && !this.transcript.isEmpty) {
      this.ui.setEnginePill('busy', '● AI refining…');
      this.llm.schedule(() => this.llm.refine(this.transcript, this.engine, this.audit).then(() => {
        this.ui.renderTiles(this.engine);
        this.ui.renderProgress(this.engine);
        this.ui.renderReadiness(this.readiness);
        this.ui.renderAudit(this.audit);
        if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology);
        this._updateEnginePill();
      }));
    }
  }

  /* Consultation start/finish drives the live-vs-post view. */
  _consultStart() { this.finished = false; this.refs.post.classList.add('hidden'); this.refs.liveDot.classList.add('on'); }
  _consultEnd() {
    this.refs.liveDot.classList.remove('on');
    if (!this.transcript.isEmpty) {
      this.finished = true;
      this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology);
      this.refs.post.classList.remove('hidden');
      this.refs.post.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this._finalizeTranscript();   // AI speaker labelling if connected
    }
  }

  _wire() {
    this.refs.micBtn.onclick = () => {
      if (this.speech.listening) { this.speech.stop(); this.ui.setMicState(false); this._micPaused = false; this._consultEnd(); }
      else if (this.speech.start()) { this.ui.setMicState(true); this._micPaused = false; this._consultStart(); }
      this._updatePauseBtn();
    };
    this.refs.relabelBtn.onclick = () => this._finalizeTranscript(true);
    this.refs.copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.refs.summary.textContent).then(() => {
        this.refs.copyBtn.textContent = '✓ Copied';
        setTimeout(() => { this.refs.copyBtn.textContent = '⧉ Copy'; }, 1500);
      }).catch(() => {});
    };
    this.refs.pauseBtn.onclick = () => this._togglePause();
    this.refs.demoBtn.onclick = () => { this.refs.demoBtn.disabled = true; this._consultStart(); this.demo.play(); this._updatePauseBtn(); };
    this.refs.pipBtn.onclick = () => this._toggleMiniWindow();
    // CT / PET report modal (two openers: toolbar + panel link)
    this.refs.ctBtn.onclick = () => this._openCt();
    this.refs.ctBtn2.onclick = () => this._openCt();
    this.refs.ctClose.onclick = () => this.refs.ctModal.classList.remove('open');
    this.refs.ctModal.onclick = (e) => { if (e.target.id === 'ctModal') this.refs.ctModal.classList.remove('open'); };
    this.refs.ctSample.onclick = () => { this.refs.ctText.value = SAMPLE_REPORT_TEXT; this.refs.ctExtractNote.textContent = ''; };
    this.refs.ctFile.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { this.refs.ctText.value = reader.result; };
      reader.readAsText(f);
    };
    this.refs.ctApply.onclick = () => this._applyReport();

    // inline editing of the radiology fields in the panel
    this.refs.radiology.addEventListener('input', (e) => {
      const el = e.target;
      if (el.classList && el.classList.contains('rad-input')) {
        this.radiology.set(el.dataset.id, el.value);
        this.ui.renderReadiness(this.readiness);
      }
    });
    this.refs.resetBtn.onclick = () => this._reset();

    // editable EHR patient context — a manual edit locks the field against auto-fill
    this.refs.ehrAge.oninput = (e) => { this.ehr.age = e.target.value.trim(); this.ehrAgeEdited = true; this.refs.ehrNote.textContent = 'Age/sex set manually · editable any time'; this.ui.renderReadiness(this.readiness); };
    this.refs.ehrSex.onchange = (e) => { this.ehr.sex = e.target.value; this.ehrSexEdited = true; this.refs.ehrNote.textContent = 'Age/sex set manually · editable any time'; this.ui.renderReadiness(this.readiness); };

    // settings modal / LLM
    this.refs.settingsBtn.onclick = () => this.refs.modal.classList.add('open');
    this.refs.modalClose.onclick = () => {
      this.llm.configure({
        enabled: this.refs.llmEnabled.checked,
        base: this.refs.llmBase.value.trim(),
        model: this.refs.llmModel.value.trim(),
        key: this.refs.llmKey.value.trim(),
      });
      this.refs.modal.classList.remove('open');
      this.refs.settingsBtn.textContent = this.llm.enabled ? '⚙ AI: on' : '⚙ AI settings';
      this._updateEnginePill();
      this.refs.relabelBtn.classList.toggle('hidden', !this.llm.ready);
      if (this.llm.enabled && !this.transcript.isEmpty) this.refresh();
    };
    this.refs.llmTest.onclick = async () => {
      this.llm.configure({
        enabled: true,
        base: this.refs.llmBase.value.trim(),
        model: this.refs.llmModel.value.trim(),
        key: this.refs.llmKey.value.trim(),
      });
      if (!this.llm.key) { this._setLlmStatus('Enter an API key first.', 'var(--orange)'); return; }
      if (this.transcript.isEmpty) this.transcript.addRaw('Patient: I used to smoke a bit when I was younger.');
      this.ui.setEnginePill('busy', '● AI refining…');
      await this.llm.refine(this.transcript, this.engine, this.audit);
      this.ui.renderTiles(this.engine);
      this.ui.renderProgress(this.engine);
      this._updateEnginePill();
    };
    this.refs.modal.onclick = (e) => { if (e.target.id === 'modal') this.refs.modal.classList.remove('open'); };
  }

  /* Pause/resume whatever is currently active — the demo or live mic —
     keeping the transcript and checklist intact (unlike Reset). */
  _togglePause() {
    if (this.demo.running) {
      this.demo.paused ? this.demo.resume() : this.demo.pause();
    } else if (this.speech.listening) {
      this.speech.stop(); this.ui.setMicState(false); this._micPaused = true;
    } else if (this._micPaused) {
      if (this.speech.start()) { this.ui.setMicState(true); this._micPaused = false; }
    }
    this._updatePauseBtn();
    if (this._miniRoot) this._renderMini();
  }

  _updatePauseBtn() {
    const b = this.refs.pauseBtn;
    if (this.demo.running) { b.disabled = false; b.textContent = this.demo.paused ? '▶ Resume' : '⏸ Pause'; }
    else if (this.speech.listening) { b.disabled = false; b.textContent = '⏸ Pause'; }
    else if (this._micPaused) { b.disabled = false; b.textContent = '▶ Resume'; }
    else { b.disabled = true; b.textContent = '⏸ Pause'; }
  }

  /* At the end, optionally use the AI to split the raw single-stream
     transcript into Clinician/Patient turns. `force` re-runs on demand. */
  async _finalizeTranscript(force = false) {
    this.refs.relabelBtn.classList.toggle('hidden', !this.llm.ready);
    if (!this.llm.ready) { this.refs.transcriptNote.textContent = 'raw (AI off)'; return; }
    if (!force && this.transcript.isEmpty) return;
    this.refs.transcriptNote.textContent = 'labelling speakers…';
    const turns = await this.llm.labelTranscript(this.transcript);
    if (turns && turns.length) {
      this.ui.clearTranscript('');
      for (const t of turns) this.ui.appendLine(t.speaker === 'Patient' ? 'Patient' : 'Clinician', t.text);
      this.refs.transcriptNote.textContent = 'speakers inferred by AI';
    } else {
      this.refs.transcriptNote.textContent = 'AI labelling unavailable — showing raw';
    }
  }

  /* Open the CT/PET report modal. */
  _openCt() {
    this.refs.ctExtractNote.textContent = '';
    this.refs.ctModal.classList.add('open');
  }

  /* Extract radiology fields from the pasted report and apply them. */
  _applyReport() {
    const found = extractRadiology(this.refs.ctText.value);
    const labels = { RAD1: 'size', RAD2: 'type', RAD3: 'spiculation', RAD4: 'location', RAD5: 'count', RAD6: 'PET uptake' };
    const applied = [];
    for (const id of Object.keys(found)) { this.radiology.set(id, found[id]); applied.push(labels[id]); }
    this.ui.renderRadiology(this.radiology);
    this.ui.renderReadiness(this.readiness);
    if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology);
    if (applied.length) {
      this.refs.ctExtractNote.textContent = '✓ Extracted: ' + applied.join(', ') + '. Review/edit in the radiology panel.';
      this.refs.ctExtractNote.style.color = 'var(--green)';
      setTimeout(() => this.refs.ctModal.classList.remove('open'), 900);
    } else {
      this.refs.ctExtractNote.textContent = 'No radiology fields recognised — check the text, or enter values directly in the panel.';
      this.refs.ctExtractNote.style.color = 'var(--orange)';
    }
  }

  /* Zoom-style floating window: a compact, always-on-top view of the
     outstanding questions, via the Document Picture-in-Picture API. */
  async _toggleMiniWindow() {
    if (this._pip) { this._pip.close(); return; }
    if (!('documentPictureInPicture' in window)) {
      alert('The floating mini-window needs Chrome (or Edge) version 116 or newer.');
      return;
    }
    const pip = await window.documentPictureInPicture.requestWindow({ width: 340, height: 480 });
    this._pip = pip;
    // copy our stylesheet(s) into the floating window
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(node => pip.document.head.appendChild(node.cloneNode(true)));
    pip.document.body.style.margin = '0';
    const root = pip.document.createElement('div');
    root.className = 'mini-root';
    pip.document.body.appendChild(root);
    this._miniRoot = root;
    this._renderMini();
    pip.addEventListener('pagehide', () => { this._pip = null; this._miniRoot = null; this.refs.pipBtn.textContent = '⤢ Minimise'; });
    this.refs.pipBtn.textContent = '⤡ Restore';
  }

  _pauseLabel() {
    if (this.demo.running) return this.demo.paused ? '▶ Resume' : '⏸ Pause';
    if (this.speech.listening) return '⏸ Pause';
    if (this._micPaused) return '▶ Resume';
    return '⏸ Pause';
  }

  _renderMini() {
    if (!this._miniRoot || !this._pip) return;
    const doc = this._pip.document;
    const c = this.engine.counts();
    const outstanding = this.engine.ordered().filter(it => this.engine.status(it.id) !== 'green');
    const pauseActive = this.demo.running || this.speech.listening || this._micPaused;
    let html = `<div class="mini-h">OneMoreThing — outstanding questions</div>`;
    html += `<div class="mini-counts">${c.green || 0} captured · ${c.orange || 0} to clarify · ${c.red || 0} not asked</div>`;
    html += `<div class="mini-controls">
      <button id="miniPause" class="mini-btn"${pauseActive ? '' : ' disabled'}>${this._pauseLabel()}</button>
      <button id="miniReset" class="mini-btn danger">↺ Reset</button>
    </div>`;
    if (!outstanding.length) {
      html += `<div class="mini-done">✓ All key patient questions covered.</div>`;
    } else {
      for (const it of outstanding) {
        const r = this.engine.results[it.id] || {};
        html += `<div class="mini-item ${r.status}"><b>${it.label}</b>${r.missing ? `<br><span>${r.missing}</span>` : ''}</div>`;
      }
    }
    this._miniRoot.innerHTML = html;
    const p = doc.getElementById('miniPause');
    if (p) p.onclick = () => { this._togglePause(); };
    const r = doc.getElementById('miniReset');
    if (r) r.onclick = () => { this._reset(); };
  }

  /* Fill age/sex from the conversation when the patient states them,
     unless the clinician has manually edited the field. */
  _applyContext() {
    const ctx = extractPatientContext(this.transcript.lowercased);
    const applied = [];
    if (ctx.age && !this.ehrAgeEdited && ctx.age !== this.ehr.age) {
      this.ehr.age = ctx.age; this.refs.ehrAge.value = ctx.age; applied.push('age');
    }
    if (ctx.sex && !this.ehrSexEdited && ctx.sex !== this.ehr.sex) {
      this.ehr.sex = ctx.sex; this.refs.ehrSex.value = ctx.sex; applied.push('sex');
    }
    if (applied.length) this.refs.ehrNote.textContent = '✓ ' + applied.join(' & ') + ' picked up from the conversation · edit any time';
  }

  _reset() {
    this.speech.stop();
    this.ui.setMicState(false);
    this._micPaused = false;
    this.transcript.clear();
    this.engine.reset();
    this.audit.clear();
    this.demo.stop();
    this.refs.demoBtn.disabled = false;
    this._updatePauseBtn();
    this.finished = false;
    this.refs.post.classList.add('hidden');
    this.refs.liveDot.classList.remove('on');
    this.refs.summary.textContent = '';
    // restore EHR defaults and unlock auto-fill
    this.ehr.age = EHR_DEFAULTS.age; this.ehr.sex = EHR_DEFAULTS.sex;
    this.ehrAgeEdited = false; this.ehrSexEdited = false;
    this.refs.ehrAge.value = EHR_DEFAULTS.age; this.refs.ehrSex.value = EHR_DEFAULTS.sex;
    this.refs.ehrNote.textContent = 'Preloaded from EHR · auto-fills if the patient states their age/sex · editable any time';
    this.ui.clearTranscript('Transcript will appear here. Press “Start listening” to use your microphone, or “Play demo” to run the sample consultation.');
    this.refresh();
  }

  _setLlmStatus(msg, col) {
    this.refs.llmStatus.textContent = msg;
    this.refs.llmStatus.style.color = col;
    if (/error|unavailable/i.test(msg)) this.ui.setEnginePill('err', '● AI error — using rules');
  }

  _updateEnginePill() {
    if (!this.llm.enabled) { this.ui.setEnginePill('rules', '● Rules engine'); return; }
    if (this.llm.lastRefinedAt) this.ui.setEnginePill('ai', '● AI engine · refined ' + this.llm.lastRefinedAt);
    else this.ui.setEnginePill('ai', '● AI engine ready');
  }
}

window.addEventListener('DOMContentLoaded', () => new App().init());
