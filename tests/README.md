# Evaluation harness

A repeatable scorecard that measures how well the engine maps consultation
transcripts to the correct checklist statuses — so we can improve the rules
without silently breaking other cases.

## Run

```bash
node tests/eval.js
```

It prints, per transcript, the expected vs. actual status for all 16 items,
a score, and a list of mismatches to investigate.

## What's here

- `simple.txt`, `mild.txt`, `complex.txt` — three gold consultation scripts of
  increasing difficulty (clean answers → late reveals → deliberate vagueness).
- `gold.json` — the expected status (`red`/`orange`/`green`) for each item in
  each script.
- `eval.js` — loads the offline rules engine (`js/config.js` + `js/engine.js`),
  runs each transcript through it, and compares to gold.

## Important: this measures the RULES only

The harness runs the deterministic, offline rules engine — no AI, no network —
so it's fast and safe to run anywhere. The optional AI layer lifts several of
the harder "late reveal" and "is this answer vague?" items further; this score
is the reliable floor the AI builds on.

## Reading the results

- **Simple** (clean, direct answers) — the rules should score high here.
- **Mild** (patient initially denies, then reveals: smoking, cancer, COPD,
  blood) — some items need whole-transcript reasoning the rules can't do alone.
- **Complex** (studied vagueness — every answer hedged) — largely an AI
  judgement task: the rules see a keyword and mark it captured, whereas the
  gold answer is "mentioned but too vague → orange".

Two systematic patterns the scorecard reveals:
1. **Doctor's questions can trigger false greens** — a keyword in the question
   ("any weight loss, night sweats, fevers?") can match a rule even before the
   patient answers. Speaker-aware weighting (or the AI) addresses this.
2. **The rules can't detect uncertainty** — they classify presence, not
   confidence. Downgrading a hedged answer to "orange" is the AI's job.

Add new transcripts by dropping a `name.txt` in this folder and a matching
`name` block in `gold.json`.
