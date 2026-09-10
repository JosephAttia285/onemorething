/* ============================================================
   ui.js — UIRenderer
   Pure presentation: turns model state into HTML. Holds references
   to DOM nodes but contains no clinical logic.
   ============================================================ */

const STATUS_WORD = { red: 'Ask', orange: 'Check', green: 'Done', grey: 'N/A' };

/* Guarantee a displayed string reads as a sentence: capital first letter and
   a closing full stop (unless it already ends in . ! ? or a bracket). */
function _sentence(s) {
  let x = String(s == null ? '' : s).trim();
  if (!x) return '';
  x = x.charAt(0).toUpperCase() + x.slice(1);
  if (!/[.!?)\]]$/.test(x)) x += '.';
  return x;
}

class UIRenderer {
  constructor(refs) { this.refs = refs; }

  static badge(s) { return `<span class="badge ${s}">${s}</span>`; }

  /* Fixed-position tiles grouped by section/priority — they only recolour, never move.
     Groups render in first-seen order, so asthma keeps its template order. */
  renderTiles(engine) {
    const groups = [];
    for (const it of engine.items) { const g = it.group || it.prio; if (!groups.includes(g)) groups.push(g); }
    let html = '';
    for (const g of groups) {
      const items = engine.items.filter(it => (it.group || it.prio) === g);
      if (!items.length) continue;
      html += `<div class="tile-group-label">${g}</div>`;
      for (const it of items) {
        const r = engine.results[it.id] || { status: 'red' };
        let sum, sumClass;
        if (r.status === 'green') { sum = _sentence(r.extracted || 'Documented'); sumClass = 'tile-sum'; }
        else if (r.status === 'orange') { sum = _sentence(r.extracted || 'Mentioned, but not specific enough'); sumClass = 'tile-sum'; }
        else if (r.status === 'grey') { sum = _sentence(r.extracted || 'Not applicable'); sumClass = 'tile-sum'; }
        else { sum = _sentence(r.prompt || it.defaultPrompt); sumClass = 'tile-ask'; }
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
    // grey = "not applicable" — excluded from the completion denominator
    const applicable = total - (c.grey || 0);
    const pct = applicable > 0 ? Math.round(((c.green || 0) / applicable) * 100) : 100;
    const criticals = engine.items.filter(it => it.prio === 'Critical' && engine.status(it.id) !== 'grey');
    const critDone = criticals.filter(it => engine.status(it.id) === 'green').length;
    const critMissing = criticals.length - critDone;
    this.refs.ring.style.background = `conic-gradient(var(--green) ${pct}%, #dbe3e6 0)`;
    this.refs.ringPct.textContent = pct + '%';
    const na = c.grey ? ` &nbsp;·&nbsp; <span style="color:var(--faint)">${c.grey} n/a</span>` : '';
    this.refs.statusText.innerHTML =
      `<b>${c.green || 0}</b>/${applicable} captured &nbsp;·&nbsp; <span style="color:var(--amber-txt)">${c.orange || 0} to check</span> &nbsp;·&nbsp; <span style="color:var(--red)">${c.red || 0} to ask</span>${na}`;
    this.refs.critText.textContent = `Critical: ${critDone}/${criticals.length}` + (critMissing ? ' — action needed' : ' ✓');
    this.refs.critText.className = 'crit ' + (critMissing ? 'crit-bad' : 'crit-ok');
  }

  /* Copy-pasteable draft summary for the clinical notes.
     `side` selects which extra sections to include (nodule adds radiology). */
  buildSummary(engine, ehr, radiology, sessionName, side = 'nodule') {
    const now = new Date().toLocaleString('en-GB');
    const lines = [];
    lines.push('OneMoreThing — consultation completeness summary (DRAFT — verify before use).');
    if (sessionName) lines.push(`Consultation: ${sessionName}`);
    lines.push(`Date: ${now}.`);
    lines.push(`Patient context: age ${ehr.age || 'not recorded'}, sex ${ehr.sex || 'not recorded'}.`);
    lines.push('');
    lines.push('Patient-answerable items:');
    for (const it of engine.items) {
      const r = engine.results[it.id] || { status: 'red' };
      let ans;
      if (r.status === 'green') ans = _sentence(r.extracted || 'Documented');
      else if (r.status === 'orange') ans = _sentence(r.extracted || 'Mentioned') + ' [Ambiguous — please clarify.]';
      else if (r.status === 'grey') ans = _sentence(r.extracted || 'Not applicable') + ' [N/A]';
      else ans = 'Not discussed.';
      lines.push(`- ${it.label}: ${ans}`);
    }
    lines.push('');
    if (side === 'nodule') {
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
    } else {
      lines.push('This tool checks whether the key asthma review questions were covered. It does not grade control or recommend treatment. Measurements (FeNO, spirometry, peak flow, skin-prick) are clinician-entered and not inferred from the conversation.');
    }
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
  appendLine(speaker, text, time) {
    this._ensureClean();
    if (this._interimEl) { this._interimEl.remove(); this._interimEl = null; }
    const div = document.createElement('div');
    div.className = 'line';
    const ts = time ? `<span class="ts">${time}</span>` : '';
    div.innerHTML = `<span class="who ${speaker === 'Patient' || speaker === 'Speaker' ? 'pt' : ''}">${speaker}${ts}</span>${text}`;
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

  /* Saved-consultations list. */
  renderSessions(store) {
    const list = store.list();
    if (!list.length) {
      this.refs.sessionsList.innerHTML = '<div class="empty">No saved consultations yet. They are stored on this computer once you press Stop.</div>';
      return;
    }
    this.refs.sessionsList.innerHTML = list.map(s => {
      const c = s.counts || {};
      const esc = t => String(t || '').replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
      return `<div class="sess-row">
        <div class="sess-main">
          <div class="sess-name-t">${esc(s.name)}</div>
          <div class="sess-meta">${esc(s.dateLabel || '')} &nbsp;·&nbsp; ${c.green || 0} captured, ${c.orange || 0} to check, ${c.red || 0} to ask</div>
        </div>
        <button class="btn-mini" data-open="${s.id}">Open</button>
        <button class="btn-mini danger" data-del="${s.id}">Delete</button>
      </div>`;
    }).join('');
  }

  /* Saved-consultations list for the left slide-out history drawer.
     Grouped by day (newest first), each row tagged by condition. */
  renderHistory(store, activeBoard) {
    const list = store.list();
    if (!list.length) {
      this.refs.historyList.innerHTML = '<div class="empty">No saved consultations yet. Press Stop at the end of a consultation and it is stored here (with identifiers redacted).</div>';
      return;
    }
    const esc = t => String(t || '').replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
    const TPL = { nodule: 'Nodule', asthma: 'Asthma' };
    let html = '';
    let lastDay = null;
    for (const s of list) {
      const d = new Date(s.endedAt || s.startedAt || Date.now());
      const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
      if (day !== lastDay) { html += `<div class="hist-day">${day}</div>`; lastDay = day; }
      const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const c = s.counts || {};
      const tpl = TPL[s.template] || 'Nodule';
      const tplCls = s.template === 'asthma' ? 'asthma' : 'nodule';
      html += `<div class="sess-row${s.template && activeBoard && s.template !== activeBoard ? ' other' : ''}">
        <div class="sess-main">
          <div class="sess-name-t">${esc(s.name)}</div>
          <div class="sess-meta"><span class="tpl-badge ${tplCls}">${tpl}</span> ${time} &nbsp;·&nbsp; ${c.green || 0} captured, ${c.orange || 0} to check, ${c.red || 0} to ask</div>
        </div>
        <button class="btn-mini" data-open="${s.id}">Open</button>
        <button class="btn-mini danger" data-del="${s.id}">Delete</button>
      </div>`;
    }
    this.refs.historyList.innerHTML = html;
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
