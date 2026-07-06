"""
OneMoreThing — local diarisation backend
=========================================
Near-real-time speech-to-text WITH speaker separation (diarisation) for a
single microphone in a GP room. Pairs faster-whisper (transcription) with
pyannote.audio (who-spoke-when), runs fully on your own machine, and exposes
a tiny HTTP API the browser app calls.

Design (chunked, accumulate-and-reprocess):
  - The browser records the consultation in ~10s self-contained audio blobs.
  - Each blob is appended to a per-session audio buffer on the server.
  - The WHOLE buffer is re-transcribed + re-diarised each time, so speaker
    labels stay consistent across the consultation (Speaker 0/1 don't swap).
  - The full labelled transcript is returned; the browser replaces its view.

This is the simplest design that keeps speaker labels stable. The cost is
that reprocessing grows with consultation length — fine on a GPU, and fine
on a laptop CPU for short consults / demos. See SETUP.md for the GPU path.

Run:
  uvicorn server:app --port 8000            # real models (needs HF token)
  MOCK=1 uvicorn server:app --port 8000     # mock mode, no models, tests wiring

Env vars:
  MOCK=1              run without any ML models (plumbing test)
  HF_TOKEN=...        Hugging Face token (required for pyannote, real mode)
  WHISPER_MODEL=base  faster-whisper size: tiny|base|small|medium (default base)
  DEVICE=cpu          cpu|cuda  (default cpu)
  NUM_SPEAKERS=2      expected speakers (clinician + patient)
"""

import os
import io
import uuid
import subprocess
import tempfile

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

MOCK = os.environ.get("MOCK", "") == "1"
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
DEVICE = os.environ.get("DEVICE", "cpu")
NUM_SPEAKERS = int(os.environ.get("NUM_SPEAKERS", "2"))
SAMPLE_RATE = 16000

app = FastAPI(title="OneMoreThing diarisation backend")

# allow the browser app to call us from file:// or http://localhost
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# in-memory sessions: session_id -> accumulated mono 16k float32 audio
SESSIONS: dict[str, np.ndarray] = {}

# lazily-loaded models (real mode only)
_whisper = None
_diarizer = None


def _load_models():
    """Load faster-whisper + pyannote once, on first real request."""
    global _whisper, _diarizer
    if _whisper is not None:
        return
    from faster_whisper import WhisperModel
    from pyannote.audio import Pipeline
    import torch

    compute_type = "int8" if DEVICE == "cpu" else "float16"
    _whisper = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=compute_type)

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise RuntimeError("HF_TOKEN not set — required to download the pyannote diarisation model.")
    _diarizer = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=hf_token)
    if DEVICE == "cuda":
        _diarizer.to(torch.device("cuda"))


def _decode_to_pcm(raw: bytes) -> np.ndarray:
    """Decode an arbitrary audio blob (webm/opus/wav/...) to mono 16k float32 via ffmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        f.write(raw)
        src = f.name
    try:
        # ffmpeg -> raw float32 little-endian, mono, 16 kHz
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-i", src, "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-"],
            capture_output=True,
        )
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg failed: " + proc.stderr.decode("utf-8", "ignore")[-400:])
        return np.frombuffer(proc.stdout, dtype=np.float32).copy()
    finally:
        try:
            os.unlink(src)
        except OSError:
            pass


def _transcribe_and_diarise(audio: np.ndarray) -> list[dict]:
    """Run ASR + diarisation on the whole buffer; return labelled segments."""
    import torch

    # 1) transcription
    segments, _info = _whisper.transcribe(audio, language="en", vad_filter=True)
    asr = [{"start": float(s.start), "end": float(s.end), "text": s.text.strip()} for s in segments if s.text.strip()]
    if not asr:
        return []

    # 2) diarisation over the same audio
    wav = torch.from_numpy(audio).unsqueeze(0)  # (1, samples)
    diarization = _diarizer({"waveform": wav, "sample_rate": SAMPLE_RATE}, num_speakers=NUM_SPEAKERS)
    turns = [(t.start, t.end, label) for t, _, label in diarization.itertracks(yield_label=True)]

    # 3) assign each ASR segment to the speaker it overlaps most
    def speaker_for(seg):
        best, best_ov = None, 0.0
        for (ts, te, label) in turns:
            ov = max(0.0, min(seg["end"], te) - max(seg["start"], ts))
            if ov > best_ov:
                best_ov, best = ov, label
        return best

    for seg in asr:
        seg["spk"] = speaker_for(seg)

    # 4) map raw labels -> Clinician / Patient by order of first appearance
    order = []
    for seg in asr:
        if seg["spk"] is not None and seg["spk"] not in order:
            order.append(seg["spk"])
    role = {}
    names = ["Clinician", "Patient", "Speaker 3", "Speaker 4"]
    for i, lbl in enumerate(order):
        role[lbl] = names[i] if i < len(names) else f"Speaker {i + 1}"

    return [{"speaker": role.get(seg["spk"], "Speaker"), "text": seg["text"],
             "start": seg["start"], "end": seg["end"]} for seg in asr]


# ----------------------------- API -----------------------------

@app.get("/health")
def health():
    return {"ok": True, "mock": MOCK, "model": WHISPER_MODEL, "device": DEVICE}


@app.post("/session/start")
def session_start():
    sid = uuid.uuid4().hex[:12]
    SESSIONS[sid] = np.zeros(0, dtype=np.float32)
    return {"session_id": sid}


@app.post("/session/{sid}/chunk")
async def session_chunk(sid: str, audio: UploadFile = File(...)):
    if sid not in SESSIONS:
        raise HTTPException(404, "unknown session")
    raw = await audio.read()

    if MOCK:
        # plumbing test only — no real transcription
        n = int(SESSIONS[sid][0]) if SESSIONS[sid].size else 0
        SESSIONS[sid] = np.array([n + 1], dtype=np.float32)
        who = "Clinician" if (n % 2 == 0) else "Patient"
        return {"segments": [{"speaker": who, "text": f"(mock) audio chunk {n + 1} received — install models to transcribe", "start": 0, "end": 0}], "mock": True}

    _load_models()
    pcm = _decode_to_pcm(raw)
    SESSIONS[sid] = np.concatenate([SESSIONS[sid], pcm])
    segments = _transcribe_and_diarise(SESSIONS[sid])
    return {"segments": segments}


@app.post("/session/{sid}/stop")
def session_stop(sid: str):
    SESSIONS.pop(sid, None)
    return {"ok": True}
