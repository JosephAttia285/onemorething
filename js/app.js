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

/* Each tab is a "template": a self-contained live-listening checklist.
   They share the toolbar, mic, AI and saved-consultations plumbing, but
   each keeps its own transcript/engine/audit so the two consultations
   stay independent. `side` selects which side-panel to show. */
const TEMPLATES = {
  nodule: {
    id: 'nodule',
    label: 'Pulmonary Nodule',
    tag: 'Pulmonary Nodule Clinic — consultation completeness assistant',
    checklist: CHECKLIST_CONFIG,
    demo: DEMO_SCRIPT,
    side: 'nodule',
    ehrDefaults: EHR_DEFAULTS,
  },
  asthma: {
    id: 'asthma',
    label: 'Paediatric Asthma',
    tag: 'Paediatric Asthma Clinic — consultation completeness assistant',
    checklist: ASTHMA_CHECKLIST,
    demo: ASTHMA_DEMO_SCRIPT,
    side: 'asthma',
    ehrDefaults: { age: '', sex: '' },
  },
};

/* Build the per-consultation model for one template. */
function makeBoard(template) {
  const items = template.checklist.map(cfg => new ChecklistItem(cfg));
  const audit = new AuditLog();
  const transcript = new TranscriptStore();
  const radiology = new RadiologyReport(RAD_FIELDS);
  const ehr = { ...template.ehrDefaults };
  const engine = new RuleEngine(items, audit);
  const readiness = new RiskReadiness(engine, ehr, radiology);
  return {
    template, items, audit, transcript, radiology, ehr, engine, readiness,
    ehrAgeEdited: false, ehrSexEdited: false, finished: false,
    sessionId: null, sessionStartedAt: null, sessionName: SessionStore.defaultName(),
    _aiLastLen: 0,
  };
}

class App {
  static AI_PAUSE_MS = 1400;    // fire ~1.4s after the speaker pauses (event-driven, per exchange)
  static AI_MAX_MS = 40000;     // rare safety net only for very long uninterrupted speech
  static AI_MIN_DELTA = 25;     // require ~25 new transcript chars before re-checking

  constructor() {
    // ----- DOM references -----
    this.refs = {};
    [
      'micBtn', 'pauseBtn', 'demoBtn', 'ctBtn', 'ctBtn2', 'settingsBtn', 'pipBtn', 'resetBtn',
      'sessionName', 'sessionsBtn', 'sessionsModal', 'sessionsList', 'sessionsClose',
      'helpBtn', 'welcomeModal', 'welcomeDemo', 'welcomeClose',
      'tiles', 'ring', 'ringPct', 'statusText', 'critText', 'liveDot',
      'post', 'summary', 'copyBtn', 'transcript', 'transcriptNote', 'relabelBtn',
      'readiness', 'radiology', 'audit', 'ehrAge', 'ehrSex', 'ehrNote', 'enginePill',
      'modal', 'llmEnabled', 'llmBase', 'llmModel', 'llmKey', 'llmStatus', 'llmTest', 'modalClose',
      'ctModal', 'ctText', 'ctFile', 'ctSample', 'ctExtractNote', 'ctClose', 'ctApply',
      'brandTag', 'tabs', 'readinessPanel', 'asthmaPanel',
    ].forEach(id => { this.refs[id] = document.getElementById(id); });

    // ----- boards (one live consultation per tab) -----
    this.boards = { nodule: makeBoard(TEMPLATES.nodule), asthma: makeBoard(TEMPLATES.asthma) };
    this.active = 'nodule';
    this.board = this.boards[this.active];

    // ----- app-level state (shared across tabs) -----
    this._micPaused = false;     // mic was paused via the Pause button (transcript kept)
    this._pip = null;            // floating mini-window handle
    this._miniRoot = null;
    this._autoMini = true;       // attempt to auto-open the floating window when hidden
    this.sessions = new SessionStore();
    this._aiInFlight = false;    // an AI check is currently running
    this._aiPending = false;     // new speech arrived while a check was running
    this._aiPauseTimer = null;
    this._aiMaxTimer = null;

    // ----- services -----
    this.ui = new UIRenderer(this.refs);
    this.llm = new LlmRefiner({ onStatus: (m, c) => this._setLlmStatus(m, c) });
    this.speech = new SpeechController({
      onFinal: (text) => { const t = this.transcript.addRaw(text); this.ui.appendLine('Speaker', text, t); this.refresh(); },
      onInterim: (text) => this.ui.showInterim(text),
      onError: (err) => { if (err === 'unsupported') alert('Live speech recognition is not supported here. Please use Chrome, or run the demo.'); if (err === 'not-allowed') { alert('Microphone permission denied.'); this.ui.setMicState(false); } },
    });
    this.demo = this._makeDemo();
  }

  /* Per-consultation state lives on the active board; these accessors let the
     rest of App keep saying this.transcript / this.engine / this.finished etc. */
  get items() { return this.board.items; }
  get audit() { return this.board.audit; }
  get transcript() { return this.board.transcript; }
  get radiology() { return this.board.radiology; }
  get ehr() { return this.board.ehr; }
  get engine() { return this.board.engine; }
  get readiness() { return this.board.readiness; }
  get finished() { return this.board.finished; }
  set finished(v) { this.board.finished = v; }
  get sessionId() { return this.board.sessionId; }
  set sessionId(v) { this.board.sessionId = v; }
  get sessionStartedAt() { return this.board.sessionStartedAt; }
  set sessionStartedAt(v) { this.board.sessionStartedAt = v; }
  get ehrAgeEdited() { return this.board.ehrAgeEdited; }
  set ehrAgeEdited(v) { this.board.ehrAgeEdited = v; }
  get ehrSexEdited() { return this.board.ehrSexEdited; }
  set ehrSexEdited(v) { this.board.ehrSexEdited = v; }
  get _aiLastLen() { return this.board._aiLastLen; }
  set _aiLastLen(v) { this.board._aiLastLen = v; }

  /* A demo player bound to the active board's script. */
  _makeDemo() {
    return new DemoPlayer(this.board.template.demo,
      (who, text) => { const t = this.transcript.addLine(who, text); this.ui.appendLine(who, text, t); this.refresh(); },
      () => { this.refs.demoBtn.disabled = false; this._updatePauseBtn(); this._consultEnd(); });
  }

  init() {
    this._wire();
    this._wireTabs();
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
    this.refs.sessionName.value = SessionStore.defaultName();
    this.refresh();
    // show the walkthrough the first time someone uses it
    try {
      if (!localStorage.getItem('omt_seen_intro')) this.refs.welcomeModal.classList.add('open');
    } catch (e) { /* private mode */ }
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
    this._renderSide();
    this.ui.renderAudit(this.audit);
    if (this._miniRoot) this._renderMini();
    if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology, this._sessionLabel(), this.board.template.side);
    this._scheduleAiCheck();
  }

  /* Render the side panel that matches the active board. */
  _renderSide() {
    if (this.board.template.side === 'nodule') this.ui.renderReadiness(this.readiness);
  }

  _emptyTranscriptMsg() {
    return 'Transcript will appear here. Press “Start” to use your microphone, or “Play demo” to run the sample consultation.';
  }

  /* Repaint the transcript panel from the active board's stored lines. */
  _restoreTranscriptDOM() {
    this.ui.clearTranscript(this._emptyTranscriptMsg());
    this.transcript.lines.forEach(l => this.ui.appendLine(l.speaker || 'Speaker', l.text, l.time));
  }

  _wireTabs() {
    this.refs.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b && b.dataset.board) this.switchBoard(b.dataset.board);
    });
  }

  /* Switch to another condition's tab. Each board keeps its own state,
     so switching stops any live input but never loses a transcript. */
  switchBoard(id) {
    if (id === this.active || !this.boards[id]) return;
    // stop live input on the board we're leaving
    this.speech.stop(); this.ui.setMicState(false); this._micPaused = false;
    this.demo.stop(); this.refs.demoBtn.disabled = false;
    clearTimeout(this._aiPauseTimer); this._aiPauseTimer = null;
    if (this._aiMaxTimer) { clearTimeout(this._aiMaxTimer); this._aiMaxTimer = null; }
    this._aiInFlight = false; this._aiPending = false;
    this.board.sessionName = this.refs.sessionName.value;   // stash the name field

    // activate the target board
    this.active = id;
    this.board = this.boards[id];
    this.demo = this._makeDemo();
    const nodule = this.board.template.side === 'nodule';

    // chrome: brand line, tab highlight, side panel, nodule-only toolbar button
    this.refs.brandTag.textContent = this.board.template.tag;
    this.refs.tabs.querySelectorAll('.tab').forEach(btn => {
      const on = btn.dataset.board === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.refs.readinessPanel.classList.toggle('hidden', !nodule);
    this.refs.asthmaPanel.classList.toggle('hidden', nodule);
    this.refs.ctBtn.classList.toggle('hidden', !nodule);

    // repaint from the target board's state
    this.refs.sessionName.value = this.board.sessionName;
    this.refs.ehrAge.value = this.ehr.age;
    this.refs.ehrSex.value = this.ehr.sex;
    if (nodule) this.ui.renderRadiology(this.radiology);
    this._restoreTranscriptDOM();
    this._updatePauseBtn();
    this.refs.liveDot.classList.remove('on');
    this.refs.post.classList.toggle('hidden', !this.finished);
    this.refresh();
    if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology, this._sessionLabel(), this.board.template.side);
  }

  /* ---- efficient AI checking ----
     The whole transcript is re-analysed at natural PAUSES (after ~2.5s of
     silence) and at least every ~20s during continuous speech, but only when
     enough new text has arrived, and never with two calls in flight. */
  _scheduleAiCheck() {
    if (!this.llm.enabled || this.transcript.isEmpty) return;
    clearTimeout(this._aiPauseTimer);
    this._aiPauseTimer = setTimeout(() => this._runAiCheck(), App.AI_PAUSE_MS);        // fire on a pause
    if (!this._aiMaxTimer) this._aiMaxTimer = setTimeout(() => this._runAiCheck(), App.AI_MAX_MS);  // …or periodically
  }

  _runAiCheck(force = false) {
    clearTimeout(this._aiPauseTimer); this._aiPauseTimer = null;
    if (this._aiMaxTimer) { clearTimeout(this._aiMaxTimer); this._aiMaxTimer = null; }
    if (!this.llm.ready) return;
    if (this._aiInFlight) { this._aiPending = true; return; }          // don't overlap calls
    const len = this.transcript.text.length;
    if (!force && len - this._aiLastLen < App.AI_MIN_DELTA) return;    // skip if nothing meaningful is new
    this._aiInFlight = true;
    this._aiLastLen = len;
    const board = this.board;   // remember which board this check belongs to
    this.ui.setEnginePill('busy', '● AI checking…');
    this.llm.refine(board.transcript, board.engine, board.audit).then(() => {
      this._aiInFlight = false;
      if (this.board !== board) return;   // user switched tabs mid-call — don't repaint the wrong board
      this.ui.renderTiles(this.engine);
      this.ui.renderProgress(this.engine);
      this._renderSide();
      this.ui.renderAudit(this.audit);
      if (this.finished) this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology, this._sessionLabel(), this.board.template.side);
      this._updateEnginePill();
      if (this.finished) this._saveSession();   // keep the saved copy in step with the AI's final view
      if (this._aiPending) { this._aiPending = false; this._scheduleAiCheck(); }   // new speech arrived mid-call
    });
  }

  _closeWelcome() {
    this.refs.welcomeModal.classList.remove('open');
    try { localStorage.setItem('omt_seen_intro', '1'); } catch (e) { /* private mode */ }
  }

  _sessionLabel() { return (this.refs.sessionName.value || '').trim() || SessionStore.defaultName(); }

  /* Consultation start/finish drives the live-vs-post view. */
  _consultStart() {
    this.finished = false;
    this.refs.post.classList.add('hidden');
    this.refs.liveDot.classList.add('on');
    if (!this.sessionId) {                               // begin a new saved consultation
      this.sessionId = 's' + Date.now().toString(36);
      this.sessionStartedAt = Date.now();
      if (!this.refs.sessionName.value.trim()) this.refs.sessionName.value = SessionStore.defaultName();
    }
  }

  _consultEnd() {
    this.refs.liveDot.classList.remove('on');
    if (!this.transcript.isEmpty) {
      this.finished = true;
      this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology, this._sessionLabel(), this.board.template.side);
      this.refs.post.classList.remove('hidden');
      this.refs.post.scrollIntoView({ behavior: 'smooth', block: 'start' });
      this._runAiCheck(true);       // one final full AI check so the end state is fresh
      this._finalizeTranscript();   // AI speaker labelling if connected
      this._saveSession();          // store it so it can be reopened later
    }
  }

  /* Save the current consultation to this computer. */
  _saveSession() {
    if (this.transcript.isEmpty) return;
    if (!this.sessionId) { this.sessionId = 's' + Date.now().toString(36); this.sessionStartedAt = Date.now(); }
    const now = new Date();
    this.sessions.save({
      id: this.sessionId,
      template: this.active,
      name: this._sessionLabel(),
      startedAt: this.sessionStartedAt || now.getTime(),
      endedAt: now.getTime(),
      dateLabel: now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      lines: this.transcript.lines,
      results: this.engine.results,
      counts: this.engine.counts(),
      ehr: { ...this.ehr },
      radiology: { ...this.radiology.values },
      summary: this.refs.summary.textContent,
    });
  }

  /* Reopen a previously saved consultation (into its own tab if needed). */
  _loadSession(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    // older sessions predate the tab concept — treat them as nodule
    if (s.template && this.boards[s.template] && s.template !== this.active) this.switchBoard(s.template);
    const nodule = this.board.template.side === 'nodule';
    this.speech.stop(); this.ui.setMicState(false); this.demo.stop();
    this._micPaused = false; this._updatePauseBtn();
    this.sessionId = s.id;
    this.sessionStartedAt = s.startedAt;
    this.refs.sessionName.value = s.name || '';
    this.board.sessionName = s.name || '';
    this.transcript.restore(s.lines || []);
    this.engine.results = s.results || {};
    this.engine.prevStatus = {};
    this.ehr.age = (s.ehr && s.ehr.age) || '';
    this.ehr.sex = (s.ehr && s.ehr.sex) || '';
    this.refs.ehrAge.value = this.ehr.age;
    this.refs.ehrSex.value = this.ehr.sex;
    this.radiology.values = { ...(s.radiology || {}) };
    this.audit.clear();
    this.ui.renderTiles(this.engine);
    this.ui.renderProgress(this.engine);
    if (nodule) this.ui.renderRadiology(this.radiology);
    this._renderSide();
    this.ui.renderAudit(this.audit);
    this.ui.clearTranscript('');
    (s.lines || []).forEach(l => this.ui.appendLine(l.speaker || 'Speaker', l.text, l.time));
    this.refs.summary.textContent = s.summary || this.ui.buildSummary(this.engine, this.ehr, this.radiology, s.name, this.board.template.side);
    this.finished = true;
    this.refs.post.classList.remove('hidden');
    this.refs.sessionsModal.classList.remove('open');
    this.refs.post.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  _wire() {
    this.refs.micBtn.onclick = () => {
      if (this.speech.listening) { this.speech.stop(); this.ui.setMicState(false); this._micPaused = false; this._consultEnd(); }
      else if (this.speech.start()) { this.ui.setMicState(true); this._micPaused = false; this._consultStart(); }
      this._updatePauseBtn();
    };
    this.refs.relabelBtn.onclick = () => this._finalizeTranscript(true);
    // saved consultations
    this.refs.sessionsBtn.onclick = () => { this.ui.renderSessions(this.sessions); this.refs.sessionsModal.classList.add('open'); };
    this.refs.sessionsClose.onclick = () => this.refs.sessionsModal.classList.remove('open');
    this.refs.sessionsModal.onclick = (e) => { if (e.target.id === 'sessionsModal') this.refs.sessionsModal.classList.remove('open'); };
    this.refs.sessionsList.addEventListener('click', (e) => {
      const open = e.target.getAttribute && e.target.getAttribute('data-open');
      const del = e.target.getAttribute && e.target.getAttribute('data-del');
      if (open) this._loadSession(open);
      if (del) { this.sessions.remove(del); this.ui.renderSessions(this.sessions); }
    });
    // welcome / help
    this.refs.helpBtn.onclick = () => this.refs.welcomeModal.classList.add('open');
    this.refs.welcomeClose.onclick = () => this._closeWelcome();
    this.refs.welcomeModal.onclick = (e) => { if (e.target.id === 'welcomeModal') this._closeWelcome(); };
    this.refs.welcomeDemo.onclick = () => {
      this._closeWelcome();
      this.refs.demoBtn.disabled = true; this._consultStart(); this.demo.play(); this._updatePauseBtn();
    };
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
    if (this.finished) {
      this.refs.summary.textContent = this.ui.buildSummary(this.engine, this.ehr, this.radiology, this._sessionLabel(), this.board.template.side);
      this._saveSession();   // scan findings become part of the saved consultation
    }
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
    const ctx = extractPatientContext(_normalizeNumbers(this.transcript.lowercased));
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
    clearTimeout(this._aiPauseTimer); this._aiPauseTimer = null;
    if (this._aiMaxTimer) { clearTimeout(this._aiMaxTimer); this._aiMaxTimer = null; }
    this._aiInFlight = false; this._aiPending = false; this._aiLastLen = 0;
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
    // start a fresh consultation (previously saved ones are kept)
    this.sessionId = null;
    this.sessionStartedAt = null;
    this.board.sessionName = SessionStore.defaultName();
    this.refs.sessionName.value = this.board.sessionName;
    // restore this board's EHR defaults and unlock auto-fill
    const def = this.board.template.ehrDefaults;
    this.ehr.age = def.age; this.ehr.sex = def.sex;
    this.ehrAgeEdited = false; this.ehrSexEdited = false;
    this.refs.ehrAge.value = def.age; this.refs.ehrSex.value = def.sex;
    this.refs.ehrNote.textContent = 'Auto-fills if the patient states their age/sex · editable any time';
    this.ui.clearTranscript(this._emptyTranscriptMsg());
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
