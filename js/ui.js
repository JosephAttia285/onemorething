/* ============================================================
   ui.js — UIRenderer
   Pure presentation: turns model state into HTML. Holds references
   to DOM nodes but contains no clinical logic.
   ============================================================ */

const STATUS_WORD = { red: 'Ask', orange: 'Check', green: 'Done' };

class UIRenderer {
  constructor(refs) { this.refs = refs; }

  static badge(s) { return `<span class="badge ${s}">${s}</span>`; }

  /* Fixed-position tiles grouped by priority — they only recolour, never move. */
  renderTiles(engine) {
    const groups = ['Critical', 'Important', 'Supportive'];
    let html = '';
    for (const g of groups) {
      const items = engine.items.filter(it => it.prio === g);
      if (!items.length) continue;
      html += `<div class="tile-group-label">${g}</div>`;
      for (const it of items) {
        const r = engine.results[it.id] || { status: 'red' };
        let sum, sumClass;
        if (r.status === 'green') { sum = r.extracted || 'Documented.'; sumClass = 'tile-sum'; }
        else if (r.status === 'orange') { sum = (r.extracted || 'Mentioned') + ' (ambiguous)'; sumClass = 'tile-sum'; }
        else { sum = r.prompt || it.defaultPrompt; sumClass = 'tile-ask'; }
        html += `<div class="tile ${r.status}" title="${(r.prompt || it.defaultPrompt).replace(/"/g, '&quot;')}">
          <div class="tile-top"><span class="tile-badge ${r.status}">${STATUS_WORD[r.status]}</span><span class="tile-id">${it.id}</span></div>
          <div class="tile-label">${it.label}</div>
          <div class="${sumClass}">${sum}</div>
        </div>`;
      }
    }
    this.refs.tiles.innerHTML = html;
  }

  /* Progress wheel + counts + critical-items indicator. */
  renderProgress(engine) {
    const c = engine.counts();
    const total = engine.items.length;
    const pct = Math.round(((c.green || 0) / total) * 100);
    const criticals = engine.items.filter(it => it.prio === 'Critical');
    const critDone = criticals.filter(it => engine.status(it.id) === 'green').length;
    const critMissing = criticals.length - critDone;
    this.refs.ring.style.background = `conic-gradient(var(--green) ${pct}%, #dbe3e6 0)`;
    this.refs.ringPct.textContent = pct + '%';
    this.refs.statusText.innerHTML =
      `<b>${c.green || 0}</b>/${total} captured &nbsp;·&nbsp; <span style="color:var(--amber-txt)">${c.orange || 0} to check</span> &nbsp;·&nbsp; <span style="color:var(--red)">${c.red || 0} to ask</span>`;
    this.refs.critText.textContent = `Critical: ${critDone}/${criticals.length}` + (critMissing ? ' — action needed' : ' ✓');
    this.refs.critText.className = 'crit ' + (critMissing ? 'crit-bad' : 'crit-ok');
  }

  /* Copy-pasteable draft summary for the clinical notes. */
  buildSummary(engine, ehr, radiology) {
    const now = new Date().toLocaleString('en-GB');
    const lines = [];
    lines.push('OneMoreThing — consultation completeness summary (DRAFT — verify before use)');
    lines.push(now);
    lines.push(`Patient context: age ${ehr.age || 'not recorded'}, sex ${ehr.sex || 'not recorded'}.`);
    lines.push('');
    lines.push('Patient-answerable items:');
    for (const it of engine.items) {
      const r = engine.results[it.id] || { status: 'red' };
      let ans;
      if (r.status === 'green') ans = (r.extracted || 'Documented.');
      else if (r.status === 'orange') ans = (r.extracted || 'Mentioned') + ' [ambiguous]';
      else ans = 'N/A (not discussed)';
      lines.push(`- ${it.label}: ${ans}`);
    }
    lines.push('');
    if (radiology.loaded) {
      lines.push('Radiology (clinician-entered):');
      for (const f of radiology.fields) {
        const v = radiology.value(f.id);
        if (v) lines.push(`- ${f.label}: ${v}`);
      }
    } else {
      lines.push('Radiology: N/A (CT/PET not entered).');
    }
    lines.push('');
    lines.push('Risk score: not calculated — this tool checks information completeness only.');
    lines.push('All clinical decisions remain the responsibility of the treating clinician.');
    return lines.join('\n');
  }

  renderRadiology(report) {
    this.refs.radiology.innerHTML = report.fields.map(f => {
      const val = (report.value(f.id) || '').replace(/"/g, '&quot;');
      return `<div class="item grey">
        <div class="item-top">${UIRenderer.badge('grey')}<span class="item-label">${f.label}</span></div>
        <div class="item-body">
          <input class="rad-input" data-id="${f.id}" value="${val}" placeholder="🔒 ${f.src} / clinician input">
          <div class="src"><span class="chip locked">${f.src}</span><span class="chip locked">not patient-answerable</span></div>
        </div></div>`;
    }).join('');
  }

  _row(k, state, val) {
    const cls = { ok: 'ok', partial: 'partial', no: 'no', lock: 'lock' }[state];
    return `<div class="ready-row"><span class="k">${k}</span><span class="v ${cls}">${val}</span></div>`;
  }

  _card(title, c, radTitle) {
    const pct = Math.round((c.patN / c.patTot) * 100);
    let status, statusCls;
    if (c.allReady) { status = 'Ready for assessment'; statusCls = 'ok'; }
    else if (c.patComplete) { status = 'Patient inputs complete — awaiting radiology'; statusCls = 'partial'; }
    else { status = 'Not ready — patient inputs incomplete'; statusCls = 'no'; }
    return `<div class="ready-card">
      <div class="ready-h">${title}<span class="pct">patient inputs ${c.patN}/${c.patTot}</span></div>
      <div class="ready-b">
        <div class="group-label" style="margin:0 0 4px">Patient / EHR inputs</div>
        ${c.patient.map(r => this._row(r[0], r[1], r[2])).join('')}
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="group-label" style="margin:10px 0 4px">${radTitle} <span style="color:var(--faint)">(locked)</span></div>
        ${c.radiology.map(r => this._row(r[0], r[1], r[2])).join('')}
        <div class="status-line ${statusCls}">${status}</div>
      </div></div>`;
  }

  renderReadiness(readiness) {
    const data = readiness.compute();
    this.refs.readiness.innerHTML =
      this._card('Brock readiness', data.brock, 'CT inputs') +
      this._card('Herder readiness', data.herder, 'PET inputs');
  }

  renderAudit(audit) {
    if (!audit.entries.length) {
      this.refs.audit.innerHTML = '<div class="empty">Status changes and transcript evidence are logged here.</div>';
      return;
    }
    this.refs.audit.innerHTML = audit.recent().map(a =>
      `<div class="ev"><span class="t">${a.time}</span><span><b>${a.id} ${a.label}</b> → ${a.status.toUpperCase()}${a.evidence ? ` · “${a.evidence}”` : ''}</span></div>`
    ).join('');
  }

  /* Transcript panel helpers */
  clearTranscript(msg) {
    this.refs.transcript.innerHTML = `<div class="empty">${msg}</div>`;
    this._interimEl = null;
  }
  _ensureClean() {
    const empty = this.refs.transcript.querySelector('.empty');
    if (empty) this.refs.transcript.innerHTML = '';
  }
  appendLine(speaker, text) {
    this._ensureClean();
    if (this._interimEl) { this._interimEl.remove(); this._interimEl = null; }
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = `<span class="who ${speaker === 'Patient' || speaker === 'Speaker' ? 'pt' : ''}">${speaker}</span>${text}`;
    this.refs.transcript.appendChild(div);
    this.refs.transcript.scrollTop = this.refs.transcript.scrollHeight;
  }
  showInterim(text) {
    this._ensureClean();
    if (!this._interimEl) {
      this._interimEl = document.createElement('div');
      this._interimEl.className = 'line interim';
      this.refs.transcript.appendChild(this._interimEl);
    }
    this._interimEl.innerHTML = `<span class="who pt">Speaker</span>${text}`;
    this.refs.transcript.scrollTop = this.refs.transcript.scrollHeight;
  }

  /* Toolbar engine pill: state ∈ rules|ai|busy|err */
  setEnginePill(state, text) {
    const p = this.refs.enginePill;
    if (!p) return;
    p.className = 'pill ' + state;
    p.textContent = text;
  }

  setMicState(listening) {
    const b = this.refs.micBtn;
    b.textContent = listening ? '■ Stop' : '● Start';
    b.classList.toggle('live', listening);
    b.classList.toggle('primary', !listening);
  }
}
