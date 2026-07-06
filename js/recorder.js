/* ============================================================
   recorder.js — RecorderClient
   Captures the room microphone in short self-contained segments and
   POSTs each to the local diarisation backend, which returns the full
   speaker-labelled (Clinician / Patient) transcript so far.

   It records in ~intervalMs segments by stopping/restarting MediaRecorder,
   so each blob is independently decodable by the server.
   ============================================================ */

class RecorderClient {
  constructor({ backendUrl, onTranscript, onError, onState, intervalMs = 10000 } = {}) {
    this.backendUrl = (backendUrl || 'http://localhost:8000').replace(/\/$/, '');
    this.onTranscript = onTranscript || (() => {});
    this.onError = onError || (() => {});
    this.onState = onState || (() => {});
    this.intervalMs = intervalMs;
    this.recording = false;
    this._stream = null;
    this._mr = null;
    this._sid = null;
    this._segTimer = null;
  }

  async start() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this.onError('Microphone permission denied or unavailable.');
      return false;
    }
    // open a session on the backend
    try {
      const res = await fetch(this.backendUrl + '/session/start', { method: 'POST' });
      if (!res.ok) throw new Error('status ' + res.status);
      this._sid = (await res.json()).session_id;
    } catch (e) {
      this.onError('Cannot reach diarisation backend at ' + this.backendUrl + '. Is it running?');
      this._cleanupStream();
      return false;
    }
    this.recording = true;
    this.onState('recording');
    this._recordSegment();
    return true;
  }

  /* Record one self-contained segment, then send it and loop. */
  _recordSegment() {
    if (!this.recording) return;
    const chunks = [];
    const mr = new MediaRecorder(this._stream);
    this._mr = mr;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      if (chunks.length) {
        const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' });
        await this._send(blob);                      // send this segment first
      }
      if (this.recording) this._recordSegment();     // keep going, or…
      else if (this._pendingStop) await this._finalizeStop();   // …close the session AFTER the final chunk
    };
    mr.start();
    this._segTimer = setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, this.intervalMs);
  }

  async _send(blob) {
    if (!this._sid) return;
    const fd = new FormData();
    fd.append('audio', blob, 'chunk.webm');
    try {
      const res = await fetch(`${this.backendUrl}/session/${this._sid}/chunk`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('status ' + res.status);
      const data = await res.json();
      this.onTranscript(data.segments || [], !!data.mock);
    } catch (e) {
      this.onError('Backend error while transcribing a chunk.');
    }
  }

  async stop() {
    if (!this.recording && !this._pendingStop) { await this._finalizeStop(); return; }
    this.recording = false;
    this.onState('idle');
    this._pendingStop = true;
    clearTimeout(this._segTimer);
    // if a segment is recording, stopping it flushes the final chunk, then onstop
    // calls _finalizeStop AFTER the chunk is sent; otherwise finalize now.
    if (this._mr && this._mr.state !== 'inactive') {
      try { this._mr.stop(); } catch (e) { await this._finalizeStop(); }
    } else {
      await this._finalizeStop();
    }
  }

  async _finalizeStop() {
    if (!this._pendingStop && !this._sid) return;
    this._pendingStop = false;
    if (this._sid) {
      try { await fetch(`${this.backendUrl}/session/${this._sid}/stop`, { method: 'POST' }); } catch (e) { /* ignore */ }
      this._sid = null;
    }
    this._cleanupStream();
  }

  _cleanupStream() {
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
  }
}
