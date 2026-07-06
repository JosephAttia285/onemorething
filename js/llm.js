/* ============================================================
   llm.js — LlmRefiner (optional)
   Sends the transcript + checklist schema to an OpenAI-compatible
   endpoint and merges any refined statuses back into the engine.
   Strictly a completeness classifier — never diagnoses or scores.
   ============================================================ */

class LlmRefiner {
  constructor({ onStatus } = {}) {
    this.enabled = false;
    this.base = '';
    this.model = '';
    this.key = '';
    this.onStatus = onStatus || (() => {});
    this._timer = null;
  }

  configure({ enabled, base, model, key }) {
    this.enabled = !!enabled;
    this.base = base || '';
    this.model = model || '';
    this.key = key || '';
  }

  get ready() { return this.enabled && !!this.key; }

  /* Debounced trigger — avoids firing on every recognised word. */
  schedule(fn, ms = 900) {
    clearTimeout(this._timer);
    this._timer = setTimeout(fn, ms);
  }

  _systemPrompt() {
    return [
      'You are a clinical consultation COMPLETENESS checker for a pulmonary nodule clinic.',
      'You ONLY judge whether each checklist item has been adequately discussed. You must NOT diagnose, score malignancy risk, or recommend management.',
      "For each item return status: 'red' (not discussed at all), 'orange' (mentioned but a needed detail is missing), or 'green' (clearly answered).",
      '',
      'CRITICAL INTERPRETATION RULES:',
      '1. A plainly stated FACT counts as answered — do NOT require the literal words "yes" or "no". "My father had lung cancer" is a clear YES with a relationship, so it is GREEN, not orange.',
      '2. A combined clinician question (e.g. "any cancer, and any family lung cancer?") that the patient answers in one sentence still counts as answered for each part.',
      '3. Attribute facts to the right person. A relative\'s cancer answers FAMILY history (PN6), not the patient\'s own cancer (PN4/PN5), and vice versa.',
      '4. SELF-CORRECTION — recency wins. If the patient changes their mind or corrects themselves, the MOST RECENT statement is the truth; earlier contradicted statements are superseded. Watch for cues like "actually", "no", "sorry", "wait", "I mean". Example: "I stopped in 2014... actually no, I still smoke a bit now" => smoking status = current (green), and quit date = not applicable. If their final position is genuinely unresolved ("maybe I do, maybe I don\'t"), use orange.',
      '',
      'PER-ITEM RUBRIC (key items):',
      'PN1 Smoking status: GREEN if current / former / never is clear.',
      'PN2 Pack-years: GREEN only if amount/duration or pack-years given; otherwise ORANGE if ever-smoker.',
      'PN3 Quit date: GREEN if approximate year or years-ago given; ORANGE if former but no date.',
      'PN4 Previous cancer: GREEN if the patient states their own cancer type + approx year + treatment/status, OR clearly states none. A relative\'s cancer does NOT make PN4 green.',
      'PN5 Previous LUNG cancer (patient\'s own): GREEN only if patient confirms or denies personal lung cancer. A father/relative with lung cancer does NOT make PN5 green.',
      'PN6 Family history of lung cancer: GREEN if the patient says a specific relative did, or did not, have lung cancer. Example GREEN: "my father had lung cancer at 68" (relative=father, lung cancer=yes). ORANGE only if family cancer is mentioned without specifying lung cancer or the relative (e.g. "cancer runs in the family").',
      'PN8 Haemoptysis: GREEN if explicitly present or absent.',
      '',
      'EXAMPLES:',
      'Transcript: "My father had lung cancer at 68." => PN6 = green, extracted "Father had lung cancer (age 68)."',
      'Transcript: "I had breast cancer in 2016, treated, no recurrence." => PN4 = green; PN5 = red (no personal lung cancer discussed); PN6 unaffected.',
      'Transcript: "Cancer runs in my family." => PN6 = orange (lung cancer / relative not specified).',
      '',
      'Return ONLY JSON: {"items":[{"id":"PN1","status":"green","extracted":"...","evidence":"...","missing":"..."}]}',
    ].join('\n');
  }

  /* Re-segment a raw single-stream transcript into Clinician/Patient turns. */
  async labelTranscript(transcriptStore) {
    if (!this.ready) return null;
    const sys = 'You are given a raw consultation transcript captured from a single microphone with NO speaker labels. ' +
      'Split it into turns and label each turn as "Clinician" or "Patient". ' +
      'Heuristics: questions, clinical explanations, and instructions are usually the Clinician; personal history, symptoms and answers are usually the Patient. ' +
      'Do NOT invent, add, or remove content — only re-segment the existing words and assign speakers. ' +
      'Return ONLY JSON: {"turns":[{"speaker":"Clinician","text":"..."},{"speaker":"Patient","text":"..."}]}';
    try {
      const res = await fetch(this.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.key },
        body: JSON.stringify({
          model: this.model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: transcriptStore.text }],
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      return Array.isArray(parsed.turns) ? parsed.turns : null;
    } catch (e) { return null; }
  }

  /* Calls the model and merges results into engine.results (+ audit). */
  async refine(transcriptStore, engine, audit) {
    if (!this.ready) return false;
    const schema = engine.items.map(it => ({ id: it.id, label: it.label }));
    const user = 'Checklist items: ' + JSON.stringify(schema) +
      '\n\nTranscript so far:\n' + transcriptStore.text;
    try {
      this.onStatus('refining…', 'var(--muted)');
      const res = await fetch(this.base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.key },
        body: JSON.stringify({
          model: this.model, temperature: 0, response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: this._systemPrompt() },
            { role: 'user', content: user },
          ],
        }),
      });
      if (!res.ok) { this.onStatus('LLM error ' + res.status + ' — using rule-based', 'var(--orange)'); return false; }
      const data = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      let changed = false;
      for (const it of (parsed.items || [])) {
        const r = engine.results[it.id];
        if (!r || !['red', 'orange', 'green'].includes(it.status)) continue;
        if (it.status !== r.status) {
          const meta = engine.items.find(x => x.id === it.id);
          audit.record({ id: it.id, label: (meta ? meta.label : it.id), status: it.status + ' (AI)', evidence: it.evidence });
          engine.prevStatus[it.id] = it.status;
          changed = true;
        }
        r.status = it.status;
        if (it.extracted) r.extracted = it.extracted;
        if (it.evidence) r.evidence = it.evidence;
        // accept a "missing detail" only when meaningful and the item isn't complete
        const junk = /^(n\/?a|none|nil|not applicable|-|—)\.?$/i;
        r.missing = (it.status !== 'green' && it.missing && !junk.test(it.missing.trim())) ? it.missing : null;
        r.engine = 'ai';                 // mark provenance for the UI
      }
      this.lastRefinedAt = AuditLog.now();
      this.onStatus('refined ✓', 'var(--green)');
      return changed;
    } catch (e) {
      this.onStatus('LLM unavailable — using rule-based', 'var(--orange)');
      return false;
    }
  }
}
