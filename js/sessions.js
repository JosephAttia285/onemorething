/* ============================================================
   sessions.js — SessionStore
   Saves each consultation locally (in the browser) so the clinician
   can reopen earlier ones at the end of the day. Nothing is uploaded.
   ============================================================ */

class SessionStore {
  constructor(key = 'omt_sessions') { this.key = key; }

  _all() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch (e) { return []; }
  }
  _write(arr) {
    try { localStorage.setItem(this.key, JSON.stringify(arr)); } catch (e) { /* quota/private mode */ }
  }

  /* Most recent first. */
  list() { return this._all().sort((a, b) => (b.endedAt || b.startedAt || 0) - (a.endedAt || a.startedAt || 0)); }
  get(id) { return this._all().find(s => s.id === id) || null; }
  save(session) {
    const arr = this._all();
    const i = arr.findIndex(s => s.id === session.id);
    if (i >= 0) arr[i] = session; else arr.push(session);
    this._write(arr);
  }
  remove(id) { this._write(this._all().filter(s => s.id !== id)); }
  clear() { this._write([]); }

  /* "Consultation — 13 Jul 2026, 14:32" */
  static defaultName(d = new Date()) {
    return 'Consultation — ' + d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }
}
