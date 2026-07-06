# OneMoreThing — Pulmonary Nodule Clinic Assistant

A working prototype of a real-time consultation **completeness** assistant. It listens to a clinician–patient conversation and keeps a live checklist of the key patient-answerable questions needed for pulmonary nodule risk assessment, flagging anything that hasn't been asked before the patient leaves the room.

It does **not** diagnose, calculate malignancy risk, or recommend management. It checks whether the right questions were asked — nothing more.

---

## 1. The 30-second version

Open `index.html` in a browser, hit **Start**, and run the consultation as normal.

- A **grid of 16 fixed tiles** (the patient-answerable questions) fills most of the screen. Tiles never move — they just **recolour** as topics are covered: **red** (Ask — not discussed), **amber** (Check — mentioned but vague), **green** (Done — clearly answered), with a one-line summary of what was said. They're grouped by priority (Critical / Important / Supportive) so the eye knows where to look.
- A **progress wheel** at the top shows overall % captured, plus a **Critical: X/7** indicator that turns red if any red-flag question is still outstanding (a raw percentage alone could hide a missed critical).
- A slim **sidebar** holds patient context (age/sex) and the Brock/Herder readiness.
- The **transcript stays hidden during the consultation** (less distracting than a scribe). When you press **Stop**, it writes out below, alongside a **copy-pasteable draft summary** for the notes and the detailed readiness. You then paste the CT/PET report to complete the picture.

As the conversation grows, an engine re-reads the whole transcript and updates the tiles. There are two engines: a fast offline **rules** engine (always on) and an optional **AI** engine (an external language model) that can refine the results.

That's the entire idea: **transcript in → completeness at a glance → summary out.**

---

## 2. How it works, a bit deeper

### The core loop

Every time a new line of speech arrives, the app does this:

1. Append the text to a running transcript.
2. Run all 16 checklist questions over the **entire** transcript (not just the new line).
3. Each question returns a status (`red`/`amber`/`green`), a short extracted answer, the transcript sentence used as evidence, and — if incomplete — what's missing and a suggested follow-up prompt.
4. Repaint the three panels and log any status change to the audit trail.
5. If the AI engine is enabled, send the transcript to the language model a moment later and merge its (possibly better) classifications back in.

The engine is **stateless**: it always recomputes from the full transcript rather than trying to track incremental changes. This makes its behaviour predictable and easy to reason about.

### The three statuses (strict rules)

- **Red** — the topic has not been addressed at all.
- **Amber** — mentioned but not clinically useful yet. e.g. *"I smoked years ago"* gives no pack-years or quit date.
- **Green** — clearly answered, with a short extracted summary shown beside the item.

Items are deliberately hard to turn green. Smoking only goes green when current/former/never is clear (and, for ever-smokers, amount/duration/quit date are captured). Previous cancer needs type, year, treatment and current status.

### Patient-answerable vs radiology-only

A hard boundary runs through the product. The patient can answer smoking history, previous cancer, family history, symptoms. The patient **cannot** reliably answer nodule size, spiculation, PET uptake, etc. Those radiology fields are shown separately as locked grey "requires CT/PET/clinician input" cards and are **never** inferred from the conversation. They are populated by **pasting the CT/PET report text** into the CT/PET report box — the six fields (size, type, spiculation, location, count, PET uptake) are then **extracted automatically** from the free text (e.g. "12 mm spiculated solid nodule in the right upper lobe … SUVmax 5.1" → size 12 mm, spiculation Present, type Solid, location Right upper lobe, PET Moderate). Every extracted field is shown as an **editable box in the radiology panel** so the clinician can correct anything. Each field unlocks its matching readiness row only once it has a value. This is clinician/radiology-sourced text — never inferred from the patient conversation.

### Risk-score readiness (not a calculator)

Rather than computing a malignancy percentage, the right-hand panel reports *input completeness* for the Brock and Herder models — e.g. "Brock patient inputs 4/5". This is safer and matches the product positioning: the tool tells the clinician what's still missing, it does not produce a risk score.

Age and sex sit at the top of this panel, pre-loaded from the EHR (mock defaults in the prototype). They are **editable** at any time, and they also **auto-fill from the conversation**: if the patient states their age or sex ("I'm 67", "I'm a woman"), the fields update automatically. Attribution is guarded so a relative's age — "my father had lung cancer at 68" — is never mistaken for the patient's, and a manual edit locks the field so it won't be overwritten.

### Rules vs AI

- The **rules engine** matches keywords and phrases (regular expressions). It's instant, free, fully offline, and explainable — but brittle: it only catches phrasings it was written to expect.
- The optional **AI engine** sends the transcript to an OpenAI-compatible language model with a strict "completeness only" prompt. It handles paraphrase and context far better, but costs money, needs a network, and depends on prompt quality.

Both can set an item's status. The little **rules** / **AI** chip on each card tells you which one did, and a pill in the toolbar shows the overall engine state.

### Handling self-correction (when the patient changes their mind)

Patients often revise an answer mid-sentence — *"I stopped in 2014… actually, no, I still smoke a bit now."* Because the engine reads the **whole** transcript, both the "stopped" and the "still smoke" statements are present, so a naive matcher would be confused.

The rule applied is **recency wins**: the patient's *most recent* statement overrides earlier, contradicted ones.

- In the **rules engine**, smoking status is resolved by a helper (`_latestMatch`) that finds which of current/former/never appears **last** in the transcript and uses that. When more than one status was stated, the extracted summary is annotated *"(most recent statement used)"* so the change of mind is visible. All four smoking-related items (status, pack-years, quit date, cessation) share this single resolver, so they stay consistent — e.g. once the latest position is "current smoker", the quit-date item automatically reads "not applicable".
- In the **AI engine**, the prompt carries an explicit self-correction rule: if the patient corrects themselves (cues like "actually", "no", "sorry", "I mean"), use their latest statement; if their final position is genuinely unresolved, mark it amber.

Worked examples (verified): *"former… actually still smoke"* → current; *"current… sorry, I quit in 2018"* → former, quit 2018; *"never… well, I used to"* → former.

---

## 3. File-by-file breakdown

```
onemorething/
├── index.html        Page structure; loads the stylesheet and scripts
├── styles.css        All styling (neutral clinical theme)
├── README.md         This document
└── js/
    ├── secrets.js    Private: your OpenAI key for auto-connect (keep out of git)
    ├── config.js     Clinical data + the 16 detection rules + AI defaults
    ├── engine.js     Domain model classes (no UI)
    ├── speech.js     Microphone / speech-to-text wrapper (browser, single-stream)
    ├── llm.js        Optional AI refinement + transcript speaker-labelling
    ├── ui.js         All on-screen rendering (tiles, wheel, summary)
    └── app.js        Wires everything together; starts the app
```

(A parked `backend/` folder with an experimental local 2-speaker diarisation
server also exists but is no longer wired into the UI.)

The code is organised by **separation of concerns**: data is separate from logic, logic is separate from presentation, and input sources (mic, AI) are isolated behind small classes. To change the question set you touch only `config.js`; to restyle, only `styles.css`; to change behaviour, only the relevant class.

The scripts are loaded as plain `<script>` tags (not ES modules) so the page opens by double-clicking a local file. They share one global scope and load in order: `config → engine → speech → llm → ui → app`.

### index.html

Pure structure. It defines the header, the toolbar buttons (listen / demo / load report / AI settings / reset) and the engine pill, the safety disclaimer, three empty panels with IDs (`transcript`, `checklist`, `readiness`, `radiology`, `audit`), the editable age/sex EHR box, and the hidden AI-settings modal. It contains almost no data — JavaScript fills the panels in by their IDs. At the bottom it loads the six scripts.

### styles.css

The whole visual theme. The `:root` block defines colour variables (`--red`, `--amber-txt`, `--green`, `--brand`, etc.) and everything else references them, so the palette is controlled from one place. Status colours map directly to clinical meaning: an item's class (`item green`, `item red`…) drives its border and background. Also styles the toolbar engine pill and the per-item `rules`/`AI` chips.

### js/config.js — *data and detection rules*

The clinical content, deliberately kept separate from application logic. Exposes:

- `EHR_DEFAULTS` — default patient age/sex (would come from an EHR integration).
- `RAD_FIELDS` + `MOCK_REPORT` — the radiology-only fields and their mock CT/PET values.
- `DEMO_SCRIPT` — the scripted sample consultation (the demo scenario).
- `CHECKLIST_CONFIG` — an array of 16 question definitions. **This is the heart of the clinical logic.**

Each question is an object: `{ id, label, prio, src, defaultPrompt, detect(text) }`. The `detect` function is where the red/amber/green decision lives. It receives the full lowercased transcript and returns `{ status, extracted, evidence, missing }`.

**Example — smoking status (PN1):** it defines three regular-expression patterns (`never`, `current`, `former`), tests them against the transcript, and returns green with the matching status; if smoking is mentioned but unclassifiable it returns amber; if smoking never comes up, red. That three-way fall-through is the strict status rule in code.

The patterns deliberately include a wide range of **colloquial and idiomatic British phrasings**, not just textbook terms — e.g. quitting is recognised from "packed it in", "off the fags", "kicked the habit", "jacked it in"; quantities from "a pack a day" or "20 fags a day"; family from "my old man"; lung disease from "smoker's lung" / "on a puffer"; haemoptysis from "spitting blood"; and so on across all items. This widens what the offline engine catches before the AI is ever needed. Coverage is still finite, though — the rules can only match phrasings someone thought to add, which is the structural reason the AI engine exists.

Helpers here include `_sentences()` and `_evidence()` (split the transcript and find the evidence quote), `_latestMatch()` (recency resolver — returns whichever pattern matches **last**, powering self-correction), `_smokingStatus()` (the single source of truth for current/former/never, shared by PN1/PN2/PN3/PN16 so they never disagree), and `extractPatientContext()` (pulls patient age/sex from the transcript with relative-attribution guards, used to auto-fill the EHR fields), and `extractRadiology()` (infers the six radiology fields from a pasted CT/PET report).

A notable detail in **previous cancer (PN4)**: when scanning for a cancer type, it skips any match immediately preceded by a family word ("father", "mother"…), so *"my father had lung cancer"* is not misread as the patient's own cancer.

### js/engine.js — *the domain model (no DOM)*

The application's brain, as a set of small classes:

- **`ChecklistItem`** — wraps one question's metadata and its `detect` strategy. `evaluate(text)` runs the detector and guarantees a default prompt.
- **`AuditLog`** — append-only list of status changes with timestamps and evidence. `record()`, `recent(n)`, `clear()`.
- **`TranscriptStore`** — holds the running transcript as both speaker-tagged lines and a single text blob. Exposes `lowercased` and `isEmpty`.
- **`RadiologyReport`** — the CT/PET fields as clinician-entered text values; `set(id, val)` records a value, `value(id)`/`has(id)` read it (`has` excludes "not performed"/"n/a"), `loadExample(mock)` fills demo values. Each field is locked until a value is typed in.
- **`RuleEngine`** — runs every `ChecklistItem` over the transcript, stores results, detects status changes (writing them to the audit log), and offers `ordered()` (red→amber→green sort for display) and `counts()`.
- **`RiskReadiness`** — derives the Brock and Herder readiness cards from the engine results + EHR + radiology. It only reports input completeness; it never produces a risk number.

Nothing here touches the screen — it's all pure logic, which makes it testable in isolation.

### js/speech.js — *microphone input*

A thin wrapper, **`SpeechController`**, around the browser's built-in Web Speech API (`webkitSpeechRecognition`). It exposes `start()`, `stop()`, a static `supported` check, and fires callbacks for interim (in-progress) and final (confirmed) speech. It knows nothing about the checklist — it just turns audio into text and hands it off. (Note: the browser engine doesn't separate speakers, so live mic labels everything "Speaker".)

### js/llm.js — *optional AI refinement*

**`LlmRefiner`** holds the AI configuration and talks to an OpenAI-compatible endpoint. Key parts:

- `configure()` / `ready` — store settings; ready only when enabled and a key is present.
- `schedule()` — debounces calls (waits ~900 ms after the last change) so it doesn't fire on every word.
- `_systemPrompt()` — the instructions sent to the model. It strictly forbids diagnosis/risk-scoring and gives a per-item rubric with worked examples (e.g. *"my father had lung cancer" → family history = green*), plus interpretation rules including **self-correction** (recency wins — the patient's latest statement overrides earlier contradicted ones).
- `refine()` — sends the transcript + checklist, parses the JSON reply, and merges any changed statuses back into the engine results, tagging each as `engine: 'ai'` and logging "(AI)" audit entries. Wrapped in try/catch, so a failed call leaves the rules result untouched.

### js/ui.js — *all rendering*

**`UIRenderer`** turns model state into HTML. It holds references to the DOM nodes but contains no clinical logic. Methods: `renderChecklist()` (sorts, groups, and draws each item card with its evidence, missing detail, suggested prompt, and engine/source chips), `renderRadiology()`, `renderReadiness()`, `renderAudit()`, transcript helpers (`appendLine`, `showInterim`, `clearTranscript`), `setEnginePill()` (the toolbar AI/Rules indicator), and `setMicState()`.

### js/app.js — *composition root*

Where everything is assembled and started.

- **`DemoPlayer`** — plays the scripted `DEMO_SCRIPT` line by line on timers, with `pause()` / `resume()` / `stop()` so playback can be halted and continued, and a deliberate pause before the "catch-up questions" turn so the red→green transitions are visible.
- **`App`** — the controller. Its constructor caches DOM references and instantiates the model (`ChecklistItem`s, `RuleEngine`, `AuditLog`, `TranscriptStore`, `RadiologyReport`, `RiskReadiness`) and the services (`UIRenderer`, `LlmRefiner`, `SpeechController`, `DemoPlayer`). `refresh()` is the core loop — run the engine, auto-fill age/sex, repaint, update the mini-window, optionally schedule AI refinement. `_wire()` connects every button and the editable inputs. Notable methods: `_togglePause()` (pause/continue the demo or mic without losing state), `_openCt()` (the CT/PET/clinician inputs form), and `_toggleMiniWindow()` / `_renderMini()` (the floating outstanding-questions window with Pause/Reset). The app boots on `DOMContentLoaded` with `new App().init()`.

---

## 4. Running and testing it

- **Just open it:** double-click `index.html` (use Chrome/Edge for the microphone, AI and floating window).
- **Play demo:** runs the sample consultation so you can watch statuses change without a mic.
- **Pause / Resume:** pauses whatever is running (demo or live mic) and continues from where it left off, keeping the transcript and checklist — unlike **Reset**, which clears everything.
- **Live mic:** "Start" (Chrome, needs mic permission and a network connection). The browser transcribes as a single stream; if the AI is connected, the speakers are split into Clinician/Patient in the final transcript.
- **AI connection:** paste your OpenAI key into `js/secrets.js` and it connects automatically on every load (no need to open settings). Leave it blank to run purely on the offline rules engine. You can still enter a key ad-hoc via ⚙ AI settings.
- **AI speaker labels:** when connected, the end-of-consult transcript is re-segmented into Clinician / Patient turns by the model; a "↺ AI speaker labels" button re-runs it.
- **CT/PET inputs:** paste (or upload) the CT/PET report text and click "Extract & apply" — the six radiology fields are inferred from the free text and filled in. "Paste example" loads a sample report. Every field is then editable inline in the radiology panel. Openable from the toolbar or the "✎ Enter / edit" link in the radiology section.
- **Minimise:** opens a small, always-on-top floating window (Zoom-style, via the Document Picture-in-Picture API) showing just the outstanding red/amber questions plus Pause/Reset, so the clinician can keep it in view over other apps. Click again to restore.
- **AI engine:** ⚙ AI settings → tick "Use LLM refinement", set Base URL / model / key → Test (looks for "refined ✓") → Done. Works with OpenAI, OpenRouter, Azure, or a local model via Ollama.
- **If the AI Test fails** (CORS, because of `file://`): serve locally with `python3 -m http.server` and open `http://localhost:8000`.

---

## 5. Key design decisions

- **Completeness, not diagnosis.** The whole product is scoped to "were the questions asked?", which keeps it clinically safe and regulatorily lighter than decision-support software.
- **Hybrid engine.** Rules give an instant, explainable, offline baseline; the LLM adds robustness to real speech. Each item shows its provenance.
- **Stateless recomputation.** Predictable and easy to audit.
- **Strict separation of concerns** across files, so the clinical rule set, the styling, and the logic can each evolve independently.
- **Plain scripts, not modules**, so the prototype opens with a double-click and is easy to demo.

---

## 6. Known limitations & next steps

- **Rules cover a broad set of phrasings (including colloquial ones)** but the list is still finite and will miss truly novel wording — the LLM path exists to cover that gap, but its accuracy depends on prompt quality and should be validated against a labelled set of real-world transcripts.
- **Speaker separation** is unavailable in the built-in browser mic (single stream). The optional local diarisation backend (`backend/`, faster-whisper + pyannote) adds clinician/patient labelling from one mic; it runs on-device for privacy, is CPU-capable for short consults, and is best on a GPU for a real pilot.
- **Evidence selection** sometimes quotes the clinician's question rather than the patient's answer; could be refined to prefer the patient turn.
- **AI override policy** is currently bidirectional; a safety-oriented option is to let AI upgrade confidence but be cautious about downgrading a confidently-answered item.
- **Privacy:** for any hosted AI provider, use synthetic transcripts in testing; a real deployment would use a local or governed model so patient data does not leave the environment.

---

*This is an early prototype intended for informal clinician testing, not clinical use. All clinical decisions remain the responsibility of the treating clinician.*
