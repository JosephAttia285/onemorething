/* ============================================================
   asthma-form.js — AsthmaForm
   Renders the full paediatric asthma clinic template
   (ASTHMA_TEMPLATE_SPEC) as an interactive structured form:
   dropdowns, Yes/No toggles, numbers, free text, medication
   dose-builders, conditional reveals, ACT age-driven
   interpretation, FeNO auto-banding, and a live clinic note.
   Pure UI over the spec data — no clinical logic beyond the
   template's own rules.
   ============================================================ */

class AsthmaForm {
  constructor(root, spec, opts = {}) {
    this.root = root;
    this.spec = spec;
    this.onChange = opts.onChange || (() => {});
    this.getAge = opts.getAge || (() => '');
    this._lastDep = {};
  }

  static esc(t) { return String(t == null ? '' : t).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }

  render() {
    const E = AsthmaForm.esc;
    let html = `<div class="form-intro">Structured clinic template — every field from the confirmed spec (NICE NG245 2024 · BNFc). Fill what applies; a copy-pasteable note builds below. Confidence tags: <span class="conf confirmed">Confirmed</span> <span class="conf high">High</span> <span class="conf med">Med</span>.</div>`;

    for (const sec of this.spec.sections) {
      html += `<section class="form-sec"><h3>${E(sec.title)}${sec.subtitle ? `<span class="sec-sub">${E(sec.subtitle)}</span>` : ''}</h3>`;
      if (sec.medications) {
        html += `<div class="med-list">${sec.medications.map(m => this._medHtml(m)).join('')}</div>`;
      }
      if (sec.fields) {
        html += `<div class="ff-grid">${sec.fields.map(f => this._fieldHtml(f)).join('')}</div>`;
      }
      if (sec.skin_prick) {
        html += `<div class="sp-block"><div class="ff-l">${E(sec.skin_prick.label)}</div><div class="sp-grid">${
          sec.skin_prick.allergens.map(a => `<label class="sp-item"><span>${E(a)}</span><input type="number" class="ff-ctl sp-in" data-spk="${E(a)}" min="0"><span class="ff-unit">mm</span></label>`).join('')
        }</div></div>`;
      }
      if (sec.education_readonly) {
        html += `<div class="ff-ro">${E(sec.education_readonly)}</div>`;
      }
      html += `</section>`;
    }

    html += `<section class="form-sec note-sec">
      <h3>Clinic note <span class="sec-sub">draft — copy into the record</span>
        <button class="btn-mini" data-copy style="margin-left:auto">⧉ Copy note</button></h3>
      <pre class="form-note" data-note></pre></section>`;

    this.root.innerHTML = html;
    this.root.addEventListener('input', () => this.sync());
    this.root.addEventListener('change', () => this.sync());
    const copy = this.root.querySelector('[data-copy]');
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(this.root.querySelector('[data-note]').textContent).then(() => {
        copy.textContent = '✓ Copied'; setTimeout(() => { copy.textContent = '⧉ Copy note'; }, 1500);
      }).catch(() => {});
    });
    this.sync();
  }

  /* ---------- control builders ---------- */
  _conf(f) { return f.confidence ? `<span class="conf ${f.confidence.toLowerCase()}">${f.confidence}</span>` : ''; }

  _fieldHtml(f) {
    const E = AsthmaForm.esc;
    let ctl = '';
    if (f.type === 'select') {
      ctl = `<select class="ff-ctl" data-fid="${f.id}"><option value="">— select —</option>${f.options.map(o => `<option>${E(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'boolean') {
      ctl = `<select class="ff-ctl" data-fid="${f.id}"><option value="">—</option><option>Yes</option><option>No</option></select>`;
    } else if (f.type === 'number' || f.type === 'feno') {
      const at = ['type="number"', 'class="ff-ctl"', `data-fid="${f.id}"`];
      if (f.min != null) at.push(`min="${f.min}"`);
      if (f.max != null) at.push(`max="${f.max}"`);
      if (f.step != null) at.push(`step="${f.step}"`);
      ctl = `<input ${at.join(' ')}>${f.unit ? `<span class="ff-unit">${E(f.unit)}</span>` : ''}`;
    } else if (f.type === 'text') {
      ctl = f.long ? `<textarea class="ff-ctl" data-fid="${f.id}" rows="2"></textarea>`
                   : `<input type="text" class="ff-ctl" data-fid="${f.id}">`;
    } else if (f.type === 'multiselect') {
      ctl = `<div class="ff-multi">${f.options.map(o => `<label class="ff-chk"><input type="checkbox" data-multi="${f.id}" value="${E(o)}"> ${E(o)}</label>`).join('')}</div>`;
    } else if (f.type === 'act') {
      ctl = `<input type="number" class="ff-ctl" data-fid="${f.id}"><span class="ff-unit">score</span><div class="ff-out" data-act-out></div>`;
    }
    const months = f.reveals_months_on
      ? `<span class="ff-months" data-months-wrap hidden> — <input type="number" min="0" class="ff-ctl ff-months-in" data-months="${f.id}"> months</span>` : '';
    const free = (f.reveals_free_text_on || f.allow_free_text)
      ? `<input type="text" class="ff-free" data-free="${f.id}" placeholder="${E(f.free_text_label || 'Please specify')}" hidden>` : '';
    const hint = f.hint ? `<div class="ff-hint">${E(f.hint)}</div>` : '';
    return `<div class="ff" data-fwrap="${f.id}">
      <div class="ff-l">${E(f.label)} ${this._conf(f)}</div>
      <div class="ff-c">${ctl}${months}</div>${free}${hint}</div>`;
  }

  _medHtml(m) {
    const E = AsthmaForm.esc;
    if (m.type === 'readonly') {
      return `<div class="med"><div class="med-name">${E(m.name)}</div><div class="med-ro">${E(m.sentence)}</div></div>`;
    }
    const ctrls = m.dropdowns.map(d => {
      let c;
      if (d.type === 'boolean') {
        c = `<select class="med-ctl" data-mid="${m.id}" data-mfield="${d.field}"><option value="">—</option><option>Yes</option><option>No</option></select>`;
      } else {
        c = `<select class="med-ctl" data-mid="${m.id}" data-mfield="${d.field}"${d.dependsOn ? ` data-depends="${d.dependsOn}"` : ''}><option value="">—</option>${d.options.map(o => `<option>${E(o)}</option>`).join('')}</select>`;
      }
      return `<label class="med-field"><span>${E(d.label)}</span>${c}${d.hint ? `<span class="med-hint">${E(d.hint)}</span>` : ''}</label>`;
    }).join('');
    return `<div class="med"><div class="med-name">${E(m.name)}</div><div class="med-sentence">${E(m.sentence)}</div><div class="med-ctrls">${ctrls}</div></div>`;
  }

  /* ---------- dynamic behaviour + serialize ---------- */
  sync() {
    this._applyDynamic();
    const v = this.serialize();
    this.root.querySelector('[data-note]').textContent = this.buildNote(v);
    this.onChange(v);
  }

  _applyDynamic() {
    for (const sec of this.spec.sections) {
      for (const f of sec.fields || []) {
        // free-text reveal
        const free = this.root.querySelector(`[data-free="${f.id}"]`);
        if (free) {
          const el = this.root.querySelector(`[data-fid="${f.id}"]`);
          const val = el ? el.value : '';
          let show = false;
          if (f.reveals_free_text_on && f.reveals_free_text_on.includes(val)) show = true;
          if (f.allow_free_text) {
            if (f.type === 'select' && val === 'Other') show = true;
            if (f.type === 'multiselect' && this.root.querySelector(`[data-multi="${f.id}"][value="Others"]:checked, [data-multi="${f.id}"][value="Other"]:checked`)) show = true;
          }
          free.hidden = !show;
        }
        // months reveal
        if (f.reveals_months_on) {
          const el = this.root.querySelector(`[data-fid="${f.id}"]`);
          const wrap = this.root.querySelector(`[data-fwrap="${f.id}"] [data-months-wrap]`);
          if (wrap) wrap.hidden = !(el && f.reveals_months_on.includes(el.value));
        }
        if (f.type === 'act') this._updateAct(f);
        if (f.type === 'feno') this._updateFeno();
      }
      // medication max-depends-on-strength
      for (const m of sec.medications || []) {
        for (const d of m.dropdowns || []) {
          if (d.dependsOn && d.optionMap) {
            const dep = this.root.querySelector(`.med-ctl[data-mid="${m.id}"][data-mfield="${d.dependsOn}"]`);
            const tgt = this.root.querySelector(`.med-ctl[data-mid="${m.id}"][data-mfield="${d.field}"]`);
            const key = m.id + ':' + d.field;
            if (dep && tgt && this._lastDep[key] !== dep.value) {
              this._lastDep[key] = dep.value;
              const opts = d.optionMap[dep.value] || d.options;
              const cur = tgt.value;
              tgt.innerHTML = `<option value="">—</option>${opts.map(o => `<option>${o}</option>`).join('')}`;
              if (opts.includes(cur)) tgt.value = cur;
            }
          }
        }
      }
    }
  }

  _updateAct(field) {
    const el = this.root.querySelector('[data-fid="act_score"]');
    const out = this.root.querySelector('[data-act-out]');
    if (!el || !out) return;
    if (el.value === '') { out.textContent = ''; out.className = 'ff-out'; return; }
    const score = +el.value;
    const age = parseInt(this.getAge(), 10);
    let tool = null;
    if (!isNaN(age)) tool = field.tools.find(t => age >= t.ageMin && age <= t.ageMax);
    if (!tool) { out.textContent = 'Enter the child’s age (side panel) to auto-select c-ACT vs ACT and interpret.'; out.className = 'ff-out warn'; return; }
    if (score < tool.min || score > tool.max) { out.textContent = `${tool.tool}: ${score} is outside the valid range (${tool.min}–${tool.max}).`; out.className = 'ff-out bad'; return; }
    let label, cls;
    if (score >= tool.wellControlled) { label = 'well controlled'; cls = 'good'; }
    else if (tool.notWellMin != null) {
      if (score >= tool.notWellMin) { label = 'not well controlled'; cls = 'warn'; }
      else { label = 'poorly controlled'; cls = 'bad'; }
    } else { label = 'not well controlled'; cls = 'warn'; }
    out.textContent = `${tool.tool} (age ${age}): ${score} → ${label}.`;
    out.className = 'ff-out ' + cls;
  }

  _updateFeno() {
    const el = this.root.querySelector('[data-fid="feno_value"]');
    const sel = this.root.querySelector('[data-fid="feno_interpretation"]');
    if (!el || !sel || el.value === '') return;
    if (sel.value === 'Unable to perform / Not done') return;   // respect a manual override
    const v = +el.value;
    sel.value = v < 20 ? '< 20 ppb — Normal' : v < 35 ? '20–34 ppb — Intermediate' : '≥ 35 ppb — Positive (eosinophilic)';
  }

  serialize() {
    const v = { fields: {}, meds: {}, skin: {} };
    this.root.querySelectorAll('[data-fid]').forEach(el => { if (el.value !== '') v.fields[el.dataset.fid] = el.value; });
    const multi = {};
    this.root.querySelectorAll('[data-multi]:checked').forEach(el => { (multi[el.dataset.multi] = multi[el.dataset.multi] || []).push(el.value); });
    for (const k in multi) v.fields[k] = multi[k];
    this.root.querySelectorAll('[data-free]').forEach(el => { if (!el.hidden && el.value.trim()) v.fields[el.dataset.free + '__free'] = el.value.trim(); });
    this.root.querySelectorAll('[data-months]').forEach(el => { if (el.value !== '') v.fields[el.dataset.months + '__months'] = el.value; });
    this.root.querySelectorAll('.med-ctl').forEach(el => { if (el.value !== '') (v.meds[el.dataset.mid] = v.meds[el.dataset.mid] || {})[el.dataset.mfield] = el.value; });
    this.root.querySelectorAll('[data-spk]').forEach(el => { if (el.value !== '') v.skin[el.dataset.spk] = el.value; });
    return v;
  }

  /* Restore a previously-saved set of values into the form. */
  setValues(v) {
    if (!v) return;
    const F = v.fields || {}, M = v.meds || {}, S = v.skin || {};
    for (const [id, val] of Object.entries(F)) {
      if (id.endsWith('__free')) { const el = this.root.querySelector(`[data-free="${id.slice(0, -6)}"]`); if (el) el.value = val; continue; }
      if (id.endsWith('__months')) { const el = this.root.querySelector(`[data-months="${id.slice(0, -9)}"]`); if (el) el.value = val; continue; }
      if (Array.isArray(val)) { val.forEach(o => { const c = this.root.querySelector(`[data-multi="${id}"][value="${AsthmaForm.esc(o)}"]`); if (c) c.checked = true; }); continue; }
      const el = this.root.querySelector(`[data-fid="${id}"]`); if (el) el.value = val;
    }
    for (const [mid, obj] of Object.entries(M)) for (const [field, val] of Object.entries(obj)) {
      const el = this.root.querySelector(`.med-ctl[data-mid="${mid}"][data-mfield="${field}"]`); if (el) el.value = val;
    }
    for (const [a, val] of Object.entries(S)) { const el = this.root.querySelector(`[data-spk="${AsthmaForm.esc(a)}"]`); if (el) el.value = val; }
    this.sync();
  }

  clear() {
    this.root.querySelectorAll('.ff-ctl, .ff-free, .ff-months-in, .sp-in, .med-ctl').forEach(el => { el.value = ''; });
    this.root.querySelectorAll('[data-multi]').forEach(el => { el.checked = false; });
    this._lastDep = {};
    this.sync();
  }

  /* ---------- note builder ---------- */
  buildNote(v) {
    const F = v.fields, M = v.meds, S = v.skin;
    const val = id => F[id];
    const withFree = id => { const b = val(id); const f = F[id + '__free']; return b == null ? null : (f ? `${b} (${f})` : b); };
    const has = x => x != null && x !== '' && !(Array.isArray(x) && !x.length);

    const secs = [];
    // add a section only if it has at least one non-empty row.
    // rows are { label, v } (printed "- label: v") or { text } (printed "- text").
    const section = (title, rows) => {
      const clean = rows.filter(r => r.text != null || has(r.v));
      if (clean.length) secs.push({ title, rows: clean });
    };
    const R = (label, x) => ({ label, v: x });

    section('Attendance & presenting complaint', [
      R('Attended with', withFree('attended_with')),
      R('Symptom duration (years)', val('symptom_duration_years')),
    ]);
    {
      const t = (F.triggers || []).concat(F.triggers__free ? [`other: ${F.triggers__free}`] : []);
      section('Triggers', [R('Triggers', t.length ? t : null)]);
    }
    section('Symptom pattern', [
      R('Cough at night', val('cough_at_night')),
      R('Episodic & diurnal (worse night/early am)', val('episodic_diurnal')),
      R('Symptom-free intervals', val('symptom_free_intervals')),
    ]);
    section('Current medications', this._noteMeds(M).map(m => ({ text: m })));
    section('Response, adherence & atopy', [
      R('Reported adherence', F.adherence_doses != null ? `${F.adherence_doses}/14 doses` : null),
      R('Response to treatment', val('response_to_treatment')),
      R('Eczema', this._pair('eczema_present', 'eczema_status', F)),
      R('Hay fever / rhinitis', this._pair('rhinitis_present', 'rhinitis_status', F)),
      R('Food allergy', withFree('food_allergy')),
      R('Drug allergies', withFree('drug_allergy')),
      R('Other allergies', withFree('other_allergy')),
    ]);
    section('High-risk factors', [
      R('Previous PICU admission', val('prev_picu')),
      R('Previous HDU admission', val('prev_hdu')),
      R('Severe asthma attacks', val('severe_attacks')),
      R('Safeguarding / psychosocial', withFree('safeguarding')),
    ]);
    section('Severity — last 12 months', [
      R('Oral steroid courses', val('oral_steroid_courses')),
      R('Emergency visits (ED/UCC/GP)', val('emergency_visits')),
      R('Hospital admissions', val('hospital_admissions')),
      R('Salbutamol canisters used', val('salbutamol_canisters')),
      R('Days off school', val('days_off_school')),
    ]);
    if (val('act_score') != null) {
      const out = this.root.querySelector('[data-act-out]');
      section('Asthma control', [R('ACT', out && out.textContent ? out.textContent.replace(/\.$/, '') : val('act_score'))]);
    }
    section('Background history', [
      R('Other significant conditions', val('other_conditions')),
      R('Past history', withFree('past_history')),
      R('Gestation', val('birth_gestation')),
      R('Place of birth', val('birth_hospital')),
      R('Mode of delivery', val('delivery_mode')),
      R('Immediate postnatal period', F.postnatal_period ? F.postnatal_period.concat(F.postnatal_period__free ? [`other: ${F.postnatal_period__free}`] : []) : null),
    ]);
    section('Family & social history', [
      R('Family history of atopy', withFree('fh_atopy')),
      R('Family history of other problems', withFree('fh_other')),
      R('Pets / animal exposure', F.pets || null),
      R('Smoker exposure', F.smoker_presence ? (F.smoker_who ? `${F.smoker_presence} (${F.smoker_who})` : F.smoker_presence) : null),
      R('Immunisation', val('immunisation')),
      R('Developmental history', val('developmental_history')),
      R('School', val('school')),
      R('Social history', val('social_history')),
    ]);
    const spk = Object.entries(S);
    section('Examination', [
      R('Resp/CVS/Abdo', withFree('exam_normal')),
      R('Peak flow', F.peak_flow_value != null ? `${F.peak_flow_value} L/min${F.peak_flow_pct_predicted != null ? ` (${F.peak_flow_pct_predicted}% predicted)` : ''}` : null),
      R('FeNO', F.feno_value != null ? `${F.feno_value} ppb${F.feno_interpretation ? ` — ${F.feno_interpretation}` : ''}` : null),
      R('Spirometry', val('spirometry')),
      R('Skin prick (mm)', spk.length ? spk.map(([a, mm]) => `${a} ${mm}`).join('; ') : null),
    ]);
    let fu = val('follow_up');
    if (fu && F.follow_up__months) fu = fu.replace('___', F.follow_up__months);
    section('Impression & plan', [
      R('Impression', val('impression')),
      R('Step-up plan', val('step_up_plan')),
      R('Step-down plan', val('step_down_plan')),
      R('Follow-up', fu),
    ]);

    const L = ['PAEDIATRIC ASTHMA REVIEW — structured note (DRAFT, verify before use).', `Date: ${new Date().toLocaleString('en-GB')}.`];
    for (const s of secs) {
      L.push('', s.title);
      for (const r of s.rows) L.push(r.text != null ? `- ${r.text}` : `- ${r.label}: ${Array.isArray(r.v) ? r.v.join(', ') : r.v}`);
    }
    L.push('', 'This structured note is a documentation aid only; all clinical decisions remain the responsibility of the treating clinician.');
    return L.join('\n');
  }

  _pair(presentId, statusId, F) {
    const p = F[presentId], s = F[statusId];
    if (p == null && s == null) return null;
    if (p === 'No') return 'No';
    return [p, s].filter(Boolean).join(' — ');
  }

  _noteMeds(M) {
    const out = [];
    for (const sec of this.spec.sections) {
      for (const m of sec.medications || []) {
        if (m.type === 'readonly') continue;
        const vals = M[m.id];
        if (!vals) continue;
        const hasDose = Object.keys(vals).some(k => k !== 'prescribed');
        if (vals.prescribed === 'No') continue;
        if (vals.prescribed !== 'Yes' && !hasDose) continue;
        let s = m.sentence.replace(/\{(\w+)\}/g, (_, k) => vals[k] || '__');
        const flag = vals.prescribed ? ` [${vals.prescribed === 'Yes' ? 'continued' : vals.prescribed}]` : '';
        out.push(`${m.name} — ${s}${flag}`);
      }
    }
    return out;
  }
}
