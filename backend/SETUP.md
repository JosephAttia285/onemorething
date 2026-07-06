# Diarisation backend — setup

This local server adds **2-speaker separation** (clinician vs patient) from a
single microphone, so the app can label who said what. It runs entirely on
your machine — patient audio never leaves the device.

It pairs **faster-whisper** (speech-to-text) with **pyannote.audio**
(diarisation — "who spoke when"), wrapped in a tiny HTTP API the browser app
calls. The browser records ~10-second audio segments; the server keeps a
running buffer per session and re-transcribes + re-diarises it, returning the
full Clinician/Patient transcript.

---

## 0. Test the plumbing first (no models, 2 minutes)

You can confirm the app ↔ backend connection before installing any ML models.

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install fastapi "uvicorn[standard]" python-multipart numpy
MOCK=1 uvicorn server:app --port 8000
```

Then in the app: **⚙ AI settings → Backend URL** = `http://localhost:8000` →
close → click **⦿ Record (2-speaker)** and allow the mic. You'll see mock lines
appear alternating Clinician/Patient. That proves the wiring works. Stop the
server (Ctrl+C) and continue below to enable real transcription.

---

## 1. Prerequisites

- **Python 3.10+**
- **ffmpeg** (decodes the browser audio):
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
- A **Hugging Face account + access token** (free) for the pyannote model.

## 2. Install

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

(`torch`/`pyannote` are large — first install takes a few minutes.)

## 3. Hugging Face token + model access (one-time)

pyannote's diarisation model is gated, so you must accept its terms:

1. Create a token at <https://huggingface.co/settings/tokens> (read access).
2. Visit and click **"Agree and access"** on both:
   - <https://huggingface.co/pyannote/speaker-diarization-3.1>
   - <https://huggingface.co/pyannote/segmentation-3.0>
3. Export the token in your shell:

```bash
export HF_TOKEN=hf_xxxxxxxxxxxxxxxxx
```

## 4. Run (real mode)

```bash
source venv/bin/activate
export HF_TOKEN=hf_xxxxxxxxxxxxxxxxx
uvicorn server:app --port 8000
```

The **first** request downloads the Whisper + pyannote weights (a few hundred
MB) — give it a minute. Subsequent runs are instant to start.

In the app: **⚙ AI settings → Backend URL** = `http://localhost:8000`, then
click **⦿ Record (2-speaker)**.

---

## 5. Tuning (env vars)

| Variable        | Default | Notes |
|-----------------|---------|-------|
| `WHISPER_MODEL` | `base`  | `tiny` / `base` / `small` / `medium`. Bigger = more accurate, slower. On a laptop CPU start with `base`. |
| `DEVICE`        | `cpu`   | Set `cuda` on an NVIDIA GPU for a big speed-up. |
| `NUM_SPEAKERS`  | `2`     | Clinician + patient. |
| `MOCK`          | unset   | `MOCK=1` runs without models (plumbing test). |

Example, more accurate on a capable machine:

```bash
WHISPER_MODEL=small DEVICE=cpu uvicorn server:app --port 8000
```

---

## 6. How it performs, honestly

- **CPU (laptop / Apple Silicon):** fine for short consults and demos. Because
  the server re-processes the whole buffer each segment, latency grows as the
  consultation gets longer — good for the first several minutes, then it lags.
- **GPU (NVIDIA):** much faster and the recommended setup for a real pilot or
  multiple rooms — set `DEVICE=cuda`.
- **Accuracy:** strong for a calm two-person consult; overlapping speech or
  very similar voices reduce diarisation accuracy. Speaker mapping assumes the
  **first person to speak is the clinician** — start recording as the clinician
  opens the consultation, or adjust the mapping in `server.py`.

## 7. Privacy / governance

All audio and transcription stay on the machine running this server — nothing
is sent to any cloud service. For a real NHS pilot, run it on an approved/
on-premise device and complete the usual information-governance (DPIA) steps.
This prototype is for informal testing, not clinical use.

---

## 8. Architecture (for the technical reviewer)

```
mic ──(browser MediaRecorder, ~10s segments)──▶ POST /session/{id}/chunk
                                                      │
                                       faster-whisper (ASR) + pyannote (diarise)
                                                      │
                              full Clinician/Patient transcript (JSON)
                                                      │
   browser rebuilds transcript ──▶ existing OneMoreThing checklist engine (unchanged)
```

The checklist / rules / AI engine is untouched — this only replaces the input
layer (browser Web Speech, which can't diarise) with a diarising backend.
Swapping to a hosted ASR (AssemblyAI, Deepgram, Azure, etc.) means
reimplementing only the `/chunk` handler.
