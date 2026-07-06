/* ============================================================
   speech.js — SpeechController
   Thin wrapper around the browser Web Speech API. Emits callbacks
   for interim/final results; knows nothing about the checklist.
   ============================================================ */

class SpeechController {
  constructor({ onFinal, onInterim, onError } = {}) {
    this.onFinal = onFinal || (() => {});
    this.onInterim = onInterim || (() => {});
    this.onError = onError || (() => {});
    this.listening = false;
    this._recog = null;
  }

  static get supported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  _build() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-GB';
    r.onresult = (e) => {
      let interim = '', finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += tr; else interim += tr;
      }
      if (finalText.trim()) this.onFinal(finalText.trim());
      if (interim) this.onInterim(interim);
    };
    r.onend = () => { if (this.listening) r.start(); };   // auto-restart while active
    r.onerror = (e) => {
      if (e.error === 'not-allowed') { this.stop(); }
      this.onError(e.error);
    };
    return r;
  }

  start() {
    if (!SpeechController.supported) { this.onError('unsupported'); return false; }
    if (!this._recog) this._recog = this._build();
    this.listening = true;
    this._recog.start();
    return true;
  }

  stop() {
    this.listening = false;
    if (this._recog) { try { this._recog.stop(); } catch (e) { /* ignore */ } }
  }
}
