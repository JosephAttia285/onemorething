/* ============================================================
   config.js — clinical data & detection rules (no UI, no DOM)
   Loaded first. Exposes plain data + per-item detector functions.
   These are intentionally separated from the engine classes so
   the rule set can be edited without touching application logic.
   ============================================================ */

/* Default patient context. Blank by default so nothing is shown until it is
   actually stated in the consultation, typed in, or supplied by an EHR. */
const EHR_DEFAULTS = { age: '', sex: '' };

/* AI connection defaults (from secrets.js).
   - If AI_PROXY_URL is set, AI works automatically via your proxy with NO key
     in this file (the key lives in the Cloudflare Worker).
   - Otherwise, if OPENAI_API_KEY is set, calls go direct to OpenAI. */
const AI_DEFAULTS = (() => {
  const proxy = (typeof AI_PROXY_URL !== 'undefined' && AI_PROXY_URL.trim()) ? AI_PROXY_URL.trim() : '';
  const key = (typeof OPENAI_API_KEY !== 'undefined' && OPENAI_API_KEY.trim()) ? OPENAI_API_KEY.trim() : '';
  if (proxy) return { enabled: true, base: proxy, model: 'gpt-4o-mini', key: 'proxy' };
  return { enabled: key.length > 0, base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', key };
})();

/* Radiology / clinician-only fields — never inferred from patient speech. */
const RAD_FIELDS = [
  { id: 'RAD1', label: 'Nodule size / diameter', src: 'CT report' },
  { id: 'RAD2', label: 'Nodule type (solid / part-solid / ground-glass)', src: 'CT report' },
  { id: 'RAD3', label: 'Spiculation', src: 'CT report' },
  { id: 'RAD4', label: 'Upper-lobe location', src: 'CT report' },
  { id: 'RAD5', label: 'Nodule count', src: 'CT report' },
  { id: 'RAD6', label: 'PET FDG uptake (absent/faint/moderate/intense)', src: 'PET report' },
];

/* Example CT + PET report text (for the "Paste example" button). */
const SAMPLE_REPORT_TEXT = `Technique
Contrast-enhanced CT thorax performed from lung apices to adrenal glands.
Findings
There is a 12 mm solid pulmonary nodule within the posterior segment of the right upper lobe.
The nodule demonstrates spiculated margins with mild pleural retraction.
No internal fat or benign central calcification identified.
No satellite nodules. No cavitation. Mild centrilobular emphysema. No enlarged mediastinal or hilar lymph nodes. No pleural effusion. No suspicious adrenal lesion.
Impression
12 mm spiculated solid pulmonary nodule in the right upper lobe. Morphology is suspicious for primary lung malignancy. Recommend PET-CT for further characterisation.

Technique
Whole-body FDG PET-CT performed 60 minutes following FDG administration.
Findings
12 mm right upper lobe pulmonary nodule demonstrates moderately increased FDG uptake (SUVmax 5.1). No FDG-avid hilar or mediastinal lymphadenopathy. No evidence of distant metastatic disease.
Impression
Moderately FDG-avid right upper lobe pulmonary nodule. Appearance remains suspicious for primary lung malignancy. Recommend discussion at Lung MDT.`;

/* Infer the six radiology fields from free-text CT/PET report(s).
   Returns an object with any of RAD1..RAD6 that could be extracted. */
function extractRadiology(text) {
  const t = (text || '').toLowerCase();
  const out = {};
  if (!t.trim()) return out;

  // RAD1 — nodule size / diameter (first "N mm" / "N cm")
  const sz = t.match(/(\d+(?:\.\d+)?)\s*(mm|cm)\b/);
  if (sz) out.RAD1 = `${sz[1]} ${sz[2]}`;

  // RAD2 — nodule type (check part-solid / ground-glass before plain solid)
  if (/part[- ]?solid/.test(t)) out.RAD2 = 'Part-solid';
  else if (/sub[- ]?solid/.test(t)) out.RAD2 = 'Sub-solid';
  else if (/ground[- ]?glass|\bggo\b|ground glass opacity/.test(t)) out.RAD2 = 'Ground-glass';
  else if (/\bsolid\b/.test(t)) out.RAD2 = 'Solid';

  // RAD3 — spiculation
  if (/spiculat/.test(t)) out.RAD3 = 'Present';
  else if (/no spiculation|non-?spiculated|smooth margin|well[- ]?defined|well[- ]?circumscribed/.test(t)) out.RAD3 = 'Absent';

  // RAD4 — lobe / location
  const loc = t.match(/(right|left)\s+(upper|middle|lower)\s+lobe/);
  if (loc) out.RAD4 = `${loc[1][0].toUpperCase() + loc[1].slice(1)} ${loc[2]} lobe`;
  else if (/lingula/.test(t)) out.RAD4 = 'Lingula';

  // RAD5 — nodule count
  const cnt = t.match(/\b(two|three|four|five|six|\d+)\s+(?:pulmonary |lung )?nodules\b/);
  const cntN = cnt ? ({ two: 2, three: 3, four: 4, five: 5, six: 6 }[cnt[1]] || parseInt(cnt[1], 10)) : 0;
  if (/multiple nodules|numerous nodules|several nodules|multifocal|innumerable/.test(t) || cntN > 1) out.RAD5 = cntN > 1 ? `Multiple (${cntN})` : 'Multiple';
  else if (/no (?:satellite|additional|other) nodules?|solitary|single (?:pulmonary )?nodule/.test(t)) out.RAD5 = 'Single (1)';
  else if (/nodule/.test(t)) out.RAD5 = 'Single (1)';

  // RAD6 — PET FDG uptake (only if the report mentions PET/FDG/SUV)
  if (/pet|fdg|suv/.test(t)) {
    const suv = t.match(/suv\s*max\s*[:=]?\s*(\d+(?:\.\d+)?)/) || t.match(/suvmax\s*[:=]?\s*(\d+(?:\.\d+)?)/);
    let cat = '';
    if (/no (?:significant )?(?:fdg )?uptake|not fdg[- ]?avid|non[- ]?avid|photopenic/.test(t)) cat = 'Absent';
    else if (/intense|markedly|marked uptake|highly avid|high[- ]grade/.test(t)) cat = 'Intense';
    else if (/moderate/.test(t)) cat = 'Moderate';
    else if (/mild|faint|low[- ]grade|minimal|slightly/.test(t)) cat = 'Faint';
    else if (/fdg[- ]?avid|increased uptake|\bavid\b|uptake/.test(t)) cat = 'Moderate';
    if (cat && suv) out.RAD6 = `${cat} (SUVmax ${suv[1]})`;
    else if (cat) out.RAD6 = cat;
    else if (suv) out.RAD6 = `SUVmax ${suv[1]}`;
  }
  return out;
}

/* Scripted sample consultation (the section-9 demo scenario). */
const DEMO_SCRIPT = [
  ['Clinician', "Thanks for coming in today. We're here to talk about the small spot we saw on your CT scan."],
  ['Patient',   "Yes, I've had this cough for about six weeks now."],
  ['Clinician', "Have you ever smoked?"],
  ['Patient',   "I used to smoke. I'm a former smoker, I gave it up a while back."],
  ['Clinician', "And apart from the cough, any breathlessness or chest pain?"],
  ['Patient',   "Just the cough really, no chest pain."],
  ['Clinician', "We discussed your CT scan and what the next steps might be."],
  ['Clinician', "Before you go — have you ever had cancer before, and has anyone in your close family had lung cancer?"],
  ['Patient',   "Yes, I had breast cancer back in 2016, treated with surgery and radiotherapy, no recurrence since. And my father had lung cancer at 68."],
];

/* ---------- shared detector helpers ---------- */
function _sentences(t) {
  return t.replace(/\n+/g, '. ').split(/(?<=[.?!])\s+/).map(s => s.trim()).filter(Boolean);
}
function _evidence(t, regexes) {
  for (const s of _sentences(t)) {
    for (const r of regexes) { if (r.test(s)) return s; }
  }
  return null;
}

/* Recency resolver: given [label, regex] pairs, return the label whose
   match appears LAST in the text. Lets a later statement override an
   earlier one when the patient changes their mind / corrects themselves. */
function _latestMatch(t, pairs) {
  let bestLabel = null, bestIdx = -1;
  for (const [label, re] of pairs) {
    const g = new RegExp(re.source, 'g');
    let m, last = -1;
    while ((m = g.exec(t))) last = m.index;
    if (last > bestIdx) { bestIdx = last; bestLabel = label; }
  }
  return bestLabel;
}

/* Single source of truth for smoking status, used by PN1/PN2/PN3/PN16.
   Returns { value: 'current'|'former'|'never'|'mentioned'|null, corrected }.
   `corrected` is true when more than one status was stated (a change of mind). */
const SMOKING = {
  // any reference to smoking, so colloquial quit phrases ("off the fags") are still in scope
  mention: /smok|cigarett|\bcigs?\b|\bciggies?\b|\bfags?\b|roll[- ]?ups?|tobacco|nicotine|vap(?:e|ing|ed)|the odd one|packed (?:it|them) in/,
  never:   /never smok|never touched (?:a )?(?:cigarett|fag|ciggie|one)|non-?smoker|not a smoker|never been a smoker|never have(?: smoked)?|don'?t smoke and never/,
  current: /current smoker|currently smoking|i still smoke|still smoking|still kind of smok|still smoke|i'?m a smoker|smoke a bit (?:right )?now|i smoke a bit|i smoke about|i smoke around|i smoke \d|smoke every day|i do smoke|i still have|had a few cigarettes|the odd (?:one|cigarette|fag|ciggie)|social smoker|have a few|a few a day|couple a day|couple of a day|still light up|still partial|haven'?t quit|haven'?t stopped|i vape|i'?m vaping/,
  former:  /former smoker|ex-?smoker|used to smoke|i smoked (?:\d|about|around|roughly|like|a|when|for|years|back)|back in the day|i quit|quit smoking|quit when|quit at|quit years|quit a while|quit \d|stopped smoking|stopped in (?:19|20)\d{2}|gave up smoking|gave it up|gave up|given (?:up|them up)|i used to smoke|i stopped|i did stop|i have stopped|i don'?t smoke (?:now|any ?more)|packed (?:it|them|the fags|the cigarettes) in|jacked (?:it|them) in|knocked it on the head|kicked the habit|off the (?:fags|cigs|ciggies)|binned (?:it|them|the fags)|chucked (?:it|them) in|came off (?:them|the fags)|haven'?t (?:touched|had|smoked) (?:one|a cigarette|a fag|since|in years|for years)|not (?:smoked|touched one) (?:since|for years|in years)|don'?t touch them now/,
};
function _smokingStatus(t) {
  if (!SMOKING.mention.test(t)) return { value: null, corrected: false };
  const present = [['never', SMOKING.never], ['current', SMOKING.current], ['former', SMOKING.former]]
    .filter(([, re]) => re.test(t));
  const latest = _latestMatch(t, present);
  return { value: latest || 'mentioned', corrected: present.length > 1 };
}

/* Extract patient AGE and SEX from the transcript, if the patient states them.
   Returns { age?, sex? }. Careful about attribution: a relative's age
   ("my father, 68") must NOT become the patient's age. Uses recency so a
   later self-correction ("actually I'm 72") overrides an earlier value. */
function extractPatientContext(t) {
  const out = {};
  // self-statements ("I'm 67", "I am 67 years old") and generic forms ("aged 67", "67 years old")
  const ageRe = /\bi'?m\s+(\d{1,3})(?:\s*years?\s*old)?\b(?!\s*(?:a day|per day|\/day|cig|fags|pack))|\bi am\s+(\d{1,3})(?:\s*years?\s*old)?\b(?!\s*(?:a day|per day|\/day|cig|fags|pack))|\baged\s+(\d{1,3})\b|\b(\d{1,3})\s*years?\s*old\b/g;
  let m, lastIdx = -1;
  while ((m = ageRe.exec(t))) {
    const num = m[1] || m[2] || m[3] || m[4];
    const generic = m[3] || m[4];   // "aged X" / "X years old" — could refer to someone else
    const pre = t.slice(Math.max(0, m.index - 28), m.index);
    if (generic && /father|mother|brother|sister|\bdad\b|\bmum\b|\bmom\b|gran|nan|son|daughter|husband|wife|uncle|aunt|\bhe\b|\bshe\b|\bthey\b/.test(pre)) continue;
    const age = +num;
    if (age >= 18 && age <= 110 && m.index > lastIdx) { out.age = String(age); lastIdx = m.index; }
  }
  // sex, self-reported; recency decides if both stated
  const male = /\bi'?m (?:a )?(?:male|man|gentleman)\b|\bi am (?:a )?(?:male|man)\b|as a man\b/;
  const female = /\bi'?m (?:a )?(?:female|woman|lady)\b|\bi am (?:a )?(?:female|woman)\b|as a woman\b/;
  const sx = _latestMatch(t, [['Male', male], ['Female', female]]);
  if (sx) out.sex = sx;
  return out;
}

/* Convert spelled-out numbers to digits so the rules can read natural speech
   ("fifteen a day", "seven years ago", "fifty-eight" → 15, 7, 58). */
const _NUMWORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9,
  ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17,
  eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
function _normalizeNumbers(t) {
  // compounds first: "fifty-eight" / "fifty eight" → 58
  t = t.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](one|two|three|four|five|six|seven|eight|nine)\b/g,
    (m, a, b) => String(_NUMWORDS[a] + _NUMWORDS[b]));
  // single words (keep "no one"/"any one"/"some one"/"every one" as words)
  t = t.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (m, w, off, s) => {
      if (w === 'one' && /\b(no|any|some|every)\s$/.test(s.slice(Math.max(0, off - 6), off))) return m;
      return String(_NUMWORDS[w]);
    });
  return t;
}

/* ---------- checklist configuration ----------
   Each entry: { id, label, prio, src, defaultPrompt, detect(lcText) }
   detect() returns { status, extracted?, evidence?, missing? }.        */
const CHECKLIST_CONFIG = [
  { id: 'PN1', label: 'Smoking status', prio: 'Critical', src: ['BTS', 'Herder/Mayo'],
    defaultPrompt: 'Have you ever smoked — currently, in the past, or never?',
    detect(t) {
      const s = _smokingStatus(t);
      const ev = _evidence(t, [/smok/, /cigarett/]);
      const tail = s.corrected ? ' (most recent statement used)' : '';
      // Contradiction: describes present/occasional smoking (medically = current
      // smoker) yet also says they quit / are former / never / "no".
      const presentSmoking = /when i smoke\b|when i have a cigarette|have a cigarette\b|having a cigarette|having cigarettes|have cigarettes|if i smoke\b|the odd (?:one|cigarette|fag)|a few cigarettes|few cigarettes|couple of cigarettes|social(?:ly)? smok|smoke social|smoke socially|on nights out|when i (?:drink|go out)|nice having (?:a )?cigarette/;
      const priorQuitClaim = s.value === 'former' || s.value === 'never'
        || /in the past|used to|quit|gave up|gave it up|stopped smok|don'?t smoke/.test(t);
      if (presentSmoking.test(t) && priorQuitClaim) {
        return { status: 'orange', contradiction: true,
          extracted: 'Describes current/occasional smoking but also says quit/never — clarify (occasional smoking still counts as current).',
          evidence: _evidence(t, [presentSmoking]) || ev,
          missing: 'Confirm current smoking status; occasional/social smoking = current smoker.' };
      }
      if (s.value === 'current') return { status: 'green', extracted: 'Current smoker.' + tail, evidence: ev };
      if (s.value === 'former')  return { status: 'green', extracted: 'Former smoker.' + tail, evidence: ev };
      if (s.value === 'never')   return { status: 'green', extracted: 'Never smoker.' + tail, evidence: ev };
      if (s.value === 'mentioned') return { status: 'orange', extracted: 'Smoking mentioned but current/former/never status not explicit.', evidence: ev, missing: 'Is the patient a current, former or never smoker?' };
      return { status: 'red' };
    } },

  { id: 'PN2', label: 'Smoking burden (pack-years)', prio: 'Critical', src: ['BTS', 'Herder/Mayo'],
    defaultPrompt: 'Roughly how many cigarettes a day did you smoke, and for how many years?',
    detect(t) {
      if (!SMOKING.mention.test(t)) return { status: 'red' };
      if (_smokingStatus(t).value === 'never') return { status: 'grey', extracted: 'Never smoker — pack-years not applicable.' };
      const py = t.match(/(\d+)\s*pack[- ]?years?/);
      const perDayM = t.match(/(\d+)\s*(?:a day|per day|cigarettes? a day|\/day|cigs? a day|fags? a day|roll[- ]?ups? a day|ciggies? a day|daily)/);
      let perDay = perDayM ? +perDayM[1] : null;
      // colloquial quantities → cigarettes/day
      if (perDay == null && /(?:a|one) pack a day|a packet a day|pack a day|20 a day/.test(t)) perDay = 20;
      if (perDay == null && /half a pack a day|ten a day|10 a day/.test(t)) perDay = 10;
      if (perDay == null && /two packs a day|40 a day|2 packs/.test(t)) perDay = 40;
      // Smoking DURATION in years. Priority: explicit range → start/stop ages →
      // "for N years" (never "N years ago", which is time SINCE quitting).
      const range = t.match(/(?:between (?:the )?ages? of (?:the )?|from (?:the )?(?:age )?)(\d{1,2})\s*(?:and|to|until|till|-)\s*(?:the )?(\d{1,2})/);
      const startAge = t.match(/start(?:ed)?[^.]{0,18}?(?:when i was|at the age of|at age|aged)\s*(?:about |around )?(\d{1,2})\b/);
      const stopAge = t.match(/(?:stopped|quit|gave up|gave it up|packed it in)[^.]{0,25}?(?:when i was|at the age of|at age|aged)\s*(?:about |around )?(\d{1,2})\b/);
      const forYears = t.match(/(?:for|over)\s*(?:about |around )?(\d+)\s*years?/) || t.match(/(\d+)\s*years?(?!\s*(?:ago|old))/);
      const sinceAgeM = t.match(/since i was (\d+)/);
      let yrs = null;
      if (range) yrs = Math.abs(+range[2] - +range[1]);
      else if (startAge && stopAge) yrs = Math.abs(+stopAge[1] - +startAge[1]);
      else if (forYears) yrs = +forYears[1];
      const ev = _evidence(t, [/pack[- ]?year/, /\d+\s*(?:a day|per day|\/day|fags|roll|ciggies)/, /\d+\s*years/, /pack a day/, /when i was/]);
      if (py) return { status: 'green', extracted: `Approx ${py[1]} pack-years.`, evidence: ev };
      if (perDay && yrs) {
        const pk = Math.round((perDay / 20) * yrs);
        return { status: 'green', extracted: `${perDay}/day for ${yrs} years ≈ ${pk} pack-years.`, evidence: ev };
      }
      if (perDay && sinceAgeM) return { status: 'green', extracted: `${perDay}/day since age ${sinceAgeM[1]}.`, evidence: ev };
      return { status: 'orange', extracted: 'Smoking acknowledged but amount/duration not quantified.', evidence: _evidence(t, [SMOKING.mention]), missing: 'Cigarettes per day and number of years (pack-years) not captured.' };
    } },

  { id: 'PN3', label: 'Quit date (if former smoker)', prio: 'Critical', src: ['BTS'],
    defaultPrompt: 'When did you stop smoking?',
    detect(t) {
      const s = _smokingStatus(t);
      if (s.value === 'current') return { status: 'grey', extracted: 'Current smoker — quit date not applicable.' };
      if (s.value === 'never') return { status: 'grey', extracted: 'Never smoker — not applicable.' };
      if (s.value !== 'former') return { status: 'red' };   // only relevant once they're a (settled) former smoker
      const yr = t.match(/(?:stopped|quit|gave up|given up|packed (?:it|them) in|jacked (?:it|them) in|kicked the habit|binned them|came off them|since)\D{0,14}(19|20)\d{2}/);
      const ago = t.match(/(\d+)\s*years? ago/) || t.match(/(?:stopped|quit|packed it in|gave up|kicked)\D{0,14}(\d+)\s*years? ago/);
      const ev = _evidence(t, [/stopped|quit|gave up|given up|packed (?:it|them) in|kicked the habit|years ago/]);
      if (yr) return { status: 'green', extracted: `Stopped ~${yr[0].match(/(19|20)\d{2}/)[0]}.`, evidence: ev };
      if (ago) return { status: 'green', extracted: `Stopped ~${ago[1]} years ago.`, evidence: ev };
      return { status: 'orange', extracted: 'Former smoker but quit date vague.', evidence: ev, missing: 'Approximate year/date of quitting not captured.' };
    } },

  { id: 'PN4', label: 'Previous cancer history', prio: 'Critical', src: ['BTS', 'Herder/Mayo'],
    defaultPrompt: 'Have you ever had any cancer before? If so, what type, when, and how was it treated?',
    detect(t) {
      const asked = /had cancer|previous cancer|any cancer|cancer before|history of cancer|tumour|tumor|malignan|growth (?:removed|taken)|a growth|lump (?:removed|taken)|mass removed|cancer scare|the all[- ]clear|in remission|carcinoma/;
      if (!asked.test(t)) return { status: 'red' };
      const noCa = /no (?:previous )?cancer|never had cancer|no history of cancer|no malignan|nothing like that|never had (?:a )?tumour|clear of cancer/;
      const ev = _evidence(t, [/cancer|tumour|tumor|malignan|growth|lump|carcinoma/]);
      if (noCa.test(t)) return { status: 'green', extracted: 'No previous cancer reported.', evidence: ev };
      // pick the patient's own cancer type, skipping family-attributed mentions (e.g. "father had lung cancer")
      const typeRe = /(breast|bowel|colorectal|colon|prostate|skin|melanoma|bladder|kidney|renal|lymphoma|leukaemia|leukemia|myeloma|ovarian|cervical|womb|uterine|stomach|gastric|liver|pancrea\w*|testicular|oesophag\w*|esophag\w*|head and neck|throat|larynx|lung)\s*cancer/g;
      let m, picked = null;
      while ((m = typeRe.exec(t))) {
        const pre = t.slice(Math.max(0, m.index - 32), m.index);
        if (/father|mother|brother|sister|\bdad\b|\bmum\b|\bmom\b|family|relative|grandfather|grandmother|parent|gran|nan|old man/.test(pre)) continue;
        picked = m[1]; break;
      }
      const type = picked ? [null, picked] : null;
      const year = t.match(/(19|20)\d{2}/);
      const tx = /surgery|radiotherapy|chemo|treated|operation|\bop\b|removed|taken out|mastectomy|resection|tablets for it|all[- ]clear/.test(t);
      if (type && (year || tx)) {
        let e = `${type[1][0].toUpperCase() + type[1].slice(1)} cancer`;
        if (year) e += ` (${year[0]})`;
        if (tx) e += ', treated';
        if (/no recurrence|in remission|clear|cured/.test(t)) e += ', no recurrence';
        return { status: 'green', extracted: e + '.', evidence: ev };
      }
      return { status: 'orange', extracted: 'Prior cancer mentioned but type/date/treatment/current status incomplete.', evidence: ev, missing: 'Cancer type, approximate year, treatment and current status.' };
    } },

  { id: 'PN5', label: 'Previous lung cancer specifically', prio: 'Critical', src: ['BTS'],
    defaultPrompt: 'Have you ever had lung cancer specifically?',
    detect(t) {
      if (/no (?:previous )?lung cancer|never had lung cancer|no lung cancer/.test(t))
        return { status: 'green', extracted: 'No previous lung cancer.', evidence: _evidence(t, [/lung cancer/]) };
      if (/lung cancer/.test(t)) {
        if (/(father|mother|brother|sister|dad|mum|parent|family|relative).{0,30}lung cancer/.test(t) && !/i had lung cancer|my lung cancer/.test(t))
          return { status: 'red' };
        return { status: 'orange', extracted: 'Lung involvement mentioned — confirm whether patient personally had lung cancer.', evidence: _evidence(t, [/lung/]), missing: 'Personal history of lung cancer not explicitly confirmed.' };
      }
      if (/something on (?:my|the) lung|spot on (?:my|the) lung|shadow on (?:my|the) lung|growth on (?:my|the) lung|mass on (?:my|the) lung|spot on my chest/.test(t))
        return { status: 'orange', extracted: 'Vague lung history mentioned.', evidence: _evidence(t, [/lung|chest/]), missing: 'Was this previously diagnosed lung cancer?' };
      return { status: 'red' };
    } },

  { id: 'PN6', label: 'Family history of lung cancer', prio: 'Critical', src: ['BTS', 'Brock'],
    defaultPrompt: 'Has anyone in your close family had lung cancer?',
    detect(t) {
      const fam = /family|father|mother|brother|sister|\bdad\b|\bmum\b|\bmom\b|parent|relative|grandfather|grandmother|\bgran\b|grandad|grandma|\bnan\b|old man|sibling|aunt|uncle|cousin/;
      if (!fam.test(t) && !/family history/.test(t)) return { status: 'red' };
      const ev = _evidence(t, [/(father|mother|brother|sister|dad|mum|mom|parent|grandfather|grandmother|gran|nan|old man|sibling|aunt|uncle|family).{0,40}(lung cancer|cancer)/, /family history/]);
      if (/no family history|no one in (?:my|the) family|nobody in (?:my|the) family|no family.{0,20}lung cancer|none of (?:my|the) family/.test(t))
        return { status: 'green', extracted: 'No family history of lung cancer.', evidence: ev };
      const relWord = '(father|mother|brother|sister|dad|mum|mom|parent|grandfather|grandmother|gran|grandad|grandma|nan|old man|sibling|aunt|uncle|cousin)';
      // relative → "lung cancer" stated close together, both directions
      const rel = t.match(new RegExp(relWord + '[^.]{0,40}lung cancer'))
        || (new RegExp('lung cancer[^.]{0,25}' + relWord).test(t) ? [null, t.match(new RegExp('lung cancer[^.]{0,25}' + relWord))[1]] : null);
      if (rel) return { status: 'green', extracted: `Relative (${rel[1]}) had lung cancer.`, evidence: ev };
      // relative had *some* cancer, or a lung tumour that may not be a primary — needs clarifying
      if (new RegExp(relWord + '[^.]{0,50}(cancer|tumour|tumor|growth)').test(t) || /cancer.{0,15}(?:in (?:my|the) )?family|family.{0,15}cancer|runs in (?:my|the) family|in the family/.test(t))
        return { status: 'orange', extracted: 'Family cancer mentioned, but lung-primary / relationship not confirmed.', evidence: ev, missing: 'Was it primary lung cancer, and which relative?' };
      return { status: 'red' };
    } },

  { id: 'PN7', label: 'Emphysema / COPD history', prio: 'Important', src: ['BTS', 'Brock'],
    defaultPrompt: 'Have you ever been told you have emphysema or COPD?',
    detect(t) {
      if (/no copd|no emphysema|no (?:lung|chest) disease|never had copd|nothing wrong with (?:my )?lungs/.test(t))
        return { status: 'green', extracted: 'No COPD/emphysema reported.', evidence: _evidence(t, [/copd|emphysema|lung/]) };
      const dx = t.match(/(copd|emphysema|chronic obstructive|chronic bronchitis|smoker'?s lung)/);
      const ev = _evidence(t, [/copd|emphysema|chronic obstructive|chronic bronchitis|smoker'?s lung|inhaler|puffer|nebuliser/]);
      if (dx) {
        if (/diagnos|inhaler|puffer|nebuliser|since|year/.test(t)) return { status: 'green', extracted: 'COPD/emphysema diagnosis stated.', evidence: ev };
        return { status: 'orange', extracted: 'COPD/emphysema mentioned — confirm diagnosis/details.', evidence: ev, missing: 'Confirmed diagnosis and treatment.' };
      }
      if (/weak lungs|lung problem|chest problem|bad lungs|bad chest|dodgy lungs|scarred lungs|breathing problem|on (?:a puffer|inhalers|a nebuliser)/.test(t))
        return { status: 'orange', extracted: 'Vague lung problem described.', evidence: _evidence(t, [/lung|chest|breath|puffer|inhaler/]), missing: 'Is there a formal COPD/emphysema diagnosis?' };
      return { status: 'red' };
    } },

  { id: 'PN8', label: 'Haemoptysis (coughing blood)', prio: 'Critical', src: ['BTS', 'Herder/Mayo'],
    defaultPrompt: 'Have you coughed up any blood?',
    detect(t) {
      if (/no h?aemoptysis|no blood|not coughed up.{0,10}blood|denies h?aemoptysis|haven'?t coughed up.{0,10}blood|never coughed up blood|no red|no spots of red|(?:blood|red|streak|pink).{0,20}\bno\b|red or anything.{0,4}no|spots of red or anything no/.test(t))
        return { status: 'green', extracted: 'No haemoptysis (blood/red denied).', evidence: _evidence(t, [/blood|h?aemoptysis|red|phlegm|sputum/]) };
      if (/coughed up blood|cough up blood|coughing (?:up )?blood|blood.streaked|spitting blood|spit blood|blood when i cough|blood in (?:my )?(?:phlegm|sputum|spit)|pink phlegm|rusty phlegm|red in (?:my )?phlegm|h?aemoptysis/.test(t))
        return { status: 'green', extracted: 'Haemoptysis reported.', evidence: _evidence(t, [/blood|h?aemoptysis|phlegm|sputum|spit/]) };
      if (/phlegm|sputum|spit/.test(t) && /dark|colour|color|funny|odd|brown/.test(t))
        return { status: 'orange', extracted: 'Sputum described vaguely — unclear if blood present.', evidence: _evidence(t, [/phlegm|sputum/]), missing: 'Explicit yes/no on coughing up blood.' };
      return { status: 'red' };
    } },

  { id: 'PN9', label: 'Current respiratory symptoms', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'Any new cough, breathlessness, chest pain, recurrent infections or wheeze?',
    detect(t) {
      const sym = /cough|breathless|short of breath|out of breath|chest pain|tight chest|wheez|puffed|winded|infection/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/(no cough|no breathless|no chest pain|no wheez).{0,40}(no|just|only)/.test(t) || /(cough|breathless).{0,20}(\d+\s*(?:weeks|months|days))/.test(t))
        return { status: 'green', extracted: 'Respiratory symptoms characterised.', evidence: ev };
      if (/breathing is bad|breathing'?s bad|chesty|bit wheezy|bit breathless|bit short of breath/.test(t))
        return { status: 'orange', extracted: 'Vague respiratory complaint.', evidence: ev, missing: 'Specific symptom, onset and duration.' };
      return { status: 'green', extracted: 'Respiratory symptoms discussed.', evidence: ev };
    } },

  { id: 'PN10', label: 'Systemic symptoms', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'Any unexplained weight loss, night sweats, fevers, reduced appetite or fatigue?',
    detect(t) {
      const sym = /weight loss|lost.{0,6}(kg|stone|pounds|weight)|losing weight|put on weight|gained weight|gaining weight|weigh(?:ed|s)?\s*\d+|\d+\s*(?:kg|kilo|kilos|kilograms|stone|pounds)|clothes.{0,12}loose|night sweat|sweat\w* at night|drenching sweat|fever|temperature|appetite|off my food|fatigue|tired all|knackered|no energy|worn out|wiped out/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      const weightGain = /put on weight|gained weight|gaining weight|weigh.{0,6}(?:more|\d)|\d+\s*kilograms?/.test(t) && !/weight loss|lost.{0,6}weight/.test(t);
      if (weightGain) return { status: 'green', extracted: 'Weight discussed — gain/stable, no unexplained loss.', evidence: ev };
      if (/lost \d|lost (?:a lot of |some )?weight|clothes.{0,12}loose|night sweat|drenching|fever|high temperature|no weight loss|no night sweat|no appetite/.test(t))
        return { status: 'green', extracted: 'Systemic symptoms characterised.', evidence: ev };
      if (/felt off|not myself|run down|bit tired|a bit off/.test(t))
        return { status: 'orange', extracted: 'Vague systemic complaint.', evidence: ev, missing: 'Specific weight loss / sweats / fevers.' };
      return { status: 'green', extracted: 'Systemic symptoms discussed.', evidence: ev };
    } },

  { id: 'PN11', label: 'Recent infection / inflammatory context', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'Have you had a recent chest infection, pneumonia, COVID, TB exposure or antibiotics?',
    detect(t) {
      const sym = /pneumonia|chest infection|covid|coronavirus|tuberculosis|\btb\b|antibiotic|amoxicillin|the flu|influenza|infection on (?:my|the) chest/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/pneumonia|antibiotic|amoxicillin|covid|chest infection|the flu/.test(t))
        return { status: 'green', extracted: 'Recent infection / treatment noted.', evidence: ev };
      if (/cold recently|bit of a cold|sniffles/.test(t))
        return { status: 'orange', extracted: 'Minor illness mentioned.', evidence: ev, missing: 'Any chest infection / pneumonia / antibiotics?' };
      return { status: 'green', extracted: 'Infection history discussed.', evidence: ev };
    } },

  { id: 'PN12', label: 'Immunosuppression', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'Are you on steroids, chemotherapy, biologics, transplant medication or anything that lowers immunity?',
    detect(t) {
      const sym = /steroid|prednisolone|chemo|biologic|transplant|immunosupp|methotrexate|azathioprine|ciclosporin|rituximab|adalimumab|humira|immune/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/prednisolone|steroid|chemo|methotrexate|azathioprine|ciclosporin|rituximab|adalimumab|humira|transplant|biologic/.test(t))
        return { status: 'green', extracted: 'Immunosuppressive therapy noted.', evidence: ev };
      if (/immune tablets|something for (?:my )?immune|tablets that lower|water down my immune/.test(t))
        return { status: 'orange', extracted: 'Vague immune medication mentioned.', evidence: ev, missing: 'Specific drug / dose.' };
      return { status: 'green', extracted: 'Immunosuppression discussed.', evidence: ev };
    } },

  { id: 'PN13', label: 'Functional fitness', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'How far can you walk, and can you climb stairs?',
    detect(t) {
      const sym = /walk|stairs|flight|exercise|active|housebound|get about|on my feet|do my (?:own )?shopping|use a (?:stick|frame|walker)/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/\d+\s*(?:minutes|metres|meters|miles|flight)|climb.{0,10}stairs|manage.{0,10}stairs|can'?t manage (?:the )?stairs|walk.{0,10}\d|walk to the shops|do my (?:own )?shopping|housebound|get about (?:fine|ok|alright)/.test(t))
        return { status: 'green', extracted: 'Functional capacity quantified.', evidence: ev };
      if (/breathless sometimes|get tired|bit slow|slow down|take my time/.test(t))
        return { status: 'orange', extracted: 'Fitness described vaguely.', evidence: ev, missing: 'Walking distance / stairs capacity.' };
      return { status: 'green', extracted: 'Functional fitness discussed.', evidence: ev };
    } },

  { id: 'PN14', label: 'Major comorbidities', prio: 'Important', src: ['BTS'],
    defaultPrompt: 'Any major heart, lung, kidney problems, or blood thinners?',
    detect(t) {
      const sym = /heart|cardiac|ticker|pacemaker|\baf\b|atrial|kidney|renal|apixaban|warfarin|rivaroxaban|edoxaban|blood thinner|blood-thinning|diabet|sugar(?: diabetes)?|\bmi\b|heart attack|stroke|comorbid/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/apixaban|warfarin|rivaroxaban|edoxaban|blood thinner|\baf\b|atrial|pacemaker|previous mi|heart attack|dodgy heart|heart problem|kidney|diabet|sugar diabetes|had a stroke/.test(t))
        return { status: 'green', extracted: 'Comorbidities / anticoagulation noted.', evidence: ev };
      if (/lots of tablets|few conditions|bits and bobs|this and that|few bits wrong/.test(t))
        return { status: 'orange', extracted: 'Comorbidities alluded to but unspecified.', evidence: ev, missing: 'Specific conditions and blood thinners.' };
      return { status: 'green', extracted: 'Comorbidities discussed.', evidence: ev };
    } },

  { id: 'PN15', label: 'Anxiety & understanding', prio: 'Supportive', src: ['BTS'],
    defaultPrompt: 'How worried are you about this nodule, and has the plan been explained clearly?',
    detect(t) {
      const sym = /worried|worried sick|anxious|anxiety|scared|frightened|terrified|petrified|panicking|nervous|understand|explained|what does (?:it|this) mean|nurse/;
      if (!sym.test(t)) return { status: 'red' };
      const ev = _evidence(t, [sym]);
      if (/very worried|worried sick|very anxious|frightened|terrified|petrified|not worried|reassured|happy with the plan|i understand|makes sense|nurse/.test(t))
        return { status: 'green', extracted: 'Patient concern / understanding explored.', evidence: ev };
      if (/bit worried|bit anxious|confused|not sure|bit lost|don'?t (?:really )?understand|what does (?:it|this) mean/.test(t))
        return { status: 'orange', extracted: 'Some concern expressed — explore further.', evidence: ev, missing: 'Level of concern and whether plan understood.' };
      return { status: 'green', extracted: 'Concerns discussed.', evidence: ev };
    } },

  { id: 'PN16', label: 'Smoking cessation opportunity', prio: 'Supportive', src: ['BTS'],
    defaultPrompt: 'Would you like support to stop smoking?',
    detect(t) {
      const sv = _smokingStatus(t).value;
      if (sv === 'never') return { status: 'grey', extracted: 'Never smoker — cessation not applicable.' };
      if (!SMOKING.mention.test(t)) return { status: 'red' };
      const ev = _evidence(t, [/cessation|stop smoking|quit|give up|patches|referral|nicotine/]);
      if (/accepts? referral|wants? to (?:stop|quit|give up)|like (?:help )?to (?:stop|quit|give up)|help (?:me )?(?:stop|quit|give up)|cessation|quit support|referral to stop|patches|nicotine replacement|stop[- ]smoking service/.test(t))
        return { status: 'green', extracted: 'Cessation support offered/accepted.', evidence: ev };
      if (/maybe later|perhaps later|not now|think about it|not ready|not interested/.test(t))
        return { status: 'orange', extracted: 'Cessation raised but patient undecided.', evidence: ev, missing: 'Offer referral to stop-smoking service.' };
      if (sv === 'former') return { status: 'grey', extracted: 'Former smoker — cessation not currently applicable.' };
      return { status: 'red' };   // current/unclear smoker, cessation not yet offered
    } },
];
