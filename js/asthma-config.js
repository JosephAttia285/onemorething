/* ============================================================
   asthma-config.js — paediatric asthma live checklist
   Loaded AFTER config.js and asthma-template-spec.js.

   The checklist is GENERATED FROM THE CLINIC TEMPLATE so every
   template field also appears as a tile, in template order, grouped
   by section. Conversationally-answerable fields carry a detector
   that returns a value in the field's own domain, so a detected
   answer both recolours the tile AND autofills the clinical report
   (see App._asthmaAutofill). Measurement/clinician fields are shown
   as locked grey "clinician-entered" tiles and are never inferred
   from speech. ACT/c-ACT has its own readiness panel and is not a tile.
   ============================================================ */

/* Scripted sample consultation for the asthma tab's "Play demo". */
const ASTHMA_DEMO_SCRIPT = [
  ['Clinician', "Thanks for bringing Jack in today. How has his chest been since the hospital admission?"],
  ['Parent',    "He's been coughing a lot at night, and he gets really wheezy when he runs around at school."],
  ['Clinician', "Does anything in particular seem to set it off?"],
  ['Parent',    "Cold weather and being around the cat, and colds always make it much worse."],
  ['Clinician', "Is he taking his brown preventer inhaler every day?"],
  ['Parent',    "He has the brown Clenil twice a day with the spacer, but he does miss it some mornings."],
  ['Clinician', "And the blue reliever — how often does he need that?"],
  ['Parent',    "Maybe two or three times a week, more when he's been running about."],
  ['Clinician', "Any steroid courses or A&E visits since we last saw him?"],
  ['Parent',    "He had one course of steroids and one A&E visit in the last year, but no admissions to intensive care."],
  ['Clinician', "Does anyone smoke at home, and has he had eczema or hay fever?"],
  ['Parent',    "No one smokes at home. He's got eczema and a bit of hay fever, and his dad had asthma as a boy."],
  ['Clinician', "Before you go, we'll check his inhaler technique and go through his written asthma action plan."],
];

/* ---------- detector helpers ---------- */
function _firstInt(t, re) { const m = t.match(re); return m ? parseInt(m[1], 10) : null; }
function _yesNo(t, yesRe, noRe) {
  if (noRe && noRe.test(t)) return 'No';
  if (yesRe.test(t)) return 'Yes';
  return null;
}
/* green result carrying a value in the field's own domain (autofills the report) */
function _val(value, extracted, ev) { return { status: 'green', value, extracted: extracted || String(value), evidence: ev || null }; }
function _amber(extracted, missing, ev) { return { status: 'orange', extracted, missing, evidence: ev || null }; }

/* ---------- domain-value detectors, keyed by template field id ----------
   Each returns { status, value?, extracted?, evidence?, missing? }.
   `value` is a string (select/text), a Yes/No, a number, or an array
   (multiselect) using the EXACT option strings from the template spec. */
const ASTHMA_FIELD_DETECTORS = {

  symptom_duration_years(t) {
    const m = t.match(/(?:for|about|around)\s*(\d+)\s*years?/) || t.match(/(\d+)\s*years?\b(?!\s*old)/);
    if (m && /cough|wheez|symptom|asthma|chest/.test(t)) return _val(Number(m[1]), `${m[1]} years`, _evidence(t, [/years?/]));
    return { status: 'red' };
  },

  triggers(t) {
    if (/no (?:known )?triggers|nothing sets? (?:it|him|her) off/.test(t)) return _val(['None known'], 'None known', _evidence(t, [/trigger|sets/]));
    const map = [
      ['Viral colds', /viral|(?:a |the |gets? a |catches? a )cold|colds\b|chest infection/],
      ['Dust (house dust mite)', /dust|house dust mite/],
      ['Foods', /\bfood|peanut|\begg\b|milk allerg/],
      ['Animals / pets', /\bcat\b|\bdog\b|pets?|animals?|rabbit|horse/],
      ['Exercise', /exercise|running|running about|sport|\bpe\b|when (?:he|she|they) runs?/],
      ['Grass / tree pollen', /pollen|grass|tree|hay ?fever season/],
      ['Tobacco smoke', /tobacco|cigarette smoke|smoky/],
      ['Weather change', /cold weather|cold air|weather change/],
      ['Damp and mould', /damp|mould|mold/],
      ['Emotions / laughter', /laughing|laughter|excited|crying|gets upset/],
      ['Air pollution', /pollution|traffic fumes/],
    ];
    const hit = map.filter(([, re]) => re.test(t)).map(([o]) => o);
    if (hit.length) return _val(hit, hit.join(', '), _evidence(t, map.map(m => m[1])));
    if (/sets? (?:it|him|her) off|triggers?\b|brings it on|flares?/.test(t)) return _amber('Triggers alluded to but not specified.', 'Which specific triggers?', _evidence(t, [/trigger|sets|flares/]));
    return { status: 'red' };
  },

  cough_at_night(t) {
    if (!/cough/.test(t)) return { status: 'red' };
    const ev = _evidence(t, [/cough[^.]*night|night[^.]*cough|at night/]);
    if (/every night|coughs? (?:all|every) night|cough(?:ing)? a lot at night/.test(t)) return _val('Every night', 'Every night', ev);
    if (/most nights/.test(t)) return _val('Most nights', 'Most nights', ev);
    if (/occasional|now and then|sometimes at night|the odd night/.test(t) && /night/.test(t)) return _val('Occasionally', 'Occasionally', ev);
    if (/cough[^.]*night|night[^.]*cough|at night/.test(t)) return _val('Most nights', 'Night cough reported', ev);
    if (/no (?:night|nocturnal) cough|not at night/.test(t)) return _val('Never', 'No night cough', ev);
    return { status: 'red' };
  },

  episodic_diurnal(t) {
    const v = _yesNo(t, /worse at night|worse (?:in|of) the (?:early )?morning|early morning|first thing in the morning|at night/, null);
    if (v) return _val('Yes', 'Worse at night / early morning', _evidence(t, [/night|morning/]));
    return { status: 'red' };
  },

  symptom_free_intervals(t) {
    if (/symptom[- ]free|fine in between|well between|no symptoms in between|clear in between/.test(t)) return _val('Yes', 'Has symptom-free intervals');
    if (/never symptom[- ]free|always (?:has |there)|constant|symptoms all the time/.test(t)) return _val('No', 'No symptom-free intervals');
    return { status: 'red' };
  },

  adherence_doses(t) {
    const m = t.match(/(\d+)\s*(?:out of|\/)\s*14/);
    if (m) return _val(Number(m[1]), `${m[1]}/14 doses`);
    return { status: 'red' };
  },

  response_to_treatment(t) {
    if (/better|improved|improving|helped|much better|working well/.test(t)) return _val('Reported improvement with treatment', 'Improved', _evidence(t, [/better|improv|helped/]));
    if (/no better|not helping|no improvement|still bad|worse/.test(t)) return _val('Limited response reported', 'Limited response', _evidence(t, [/no better|not helping|worse/]));
    return { status: 'red' };
  },

  eczema_present(t) { const v = _yesNo(t, /eczema|dermatitis|dry (?:skin|patches)/, /no eczema|denies eczema/); return v ? _val(v, v === 'Yes' ? 'Eczema' : 'No eczema', _evidence(t, [/eczema|dermatitis/])) : { status: 'red' }; },
  rhinitis_present(t) { const v = _yesNo(t, /hay ?fever|allergic rhinitis|itchy (?:eyes|nose)/, /no hay ?fever|no rhinitis/); return v ? _val(v, v === 'Yes' ? 'Hay fever / rhinitis' : 'No hay fever', _evidence(t, [/hay ?fever|rhinitis/])) : { status: 'red' }; },

  food_allergy(t) {
    if (/no (?:known )?food allerg|not allergic to any food|no food allerg/.test(t)) return _val('None known', 'No food allergy');
    if (/allergic to (?:nuts?|peanut|egg|milk|dairy|wheat|soya?|fish|shellfish)|food allerg|anaphyla/.test(t)) return _val('Confirmed', 'Food allergy reported', _evidence(t, [/allerg|nut|egg|milk/]));
    return { status: 'red' };
  },
  drug_allergy(t) {
    if (/no (?:known )?drug allerg|\bnkda\b|not allergic to any medic/.test(t)) return _val('None known', 'No drug allergy');
    if (/allergic to (?:penicillin|amoxicillin|antibiotics?|ibuprofen|nsaid)/.test(t)) return _val('Yes', 'Drug allergy reported', _evidence(t, [/allergic to/]));
    return { status: 'red' };
  },
  other_allergy(t) {
    if (/no other allerg/.test(t)) return _val('None known', 'No other allergy');
    return { status: 'red' };
  },

  prev_picu(t) { if (/\bpicu\b|paediatric intensive|pediatric intensive/.test(t)) return _val(/no picu|never (?:in|been to) picu|no.*intensive care/.test(t) ? 'No' : 'Yes', 'PICU history discussed', _evidence(t, [/picu|intensive/])); return { status: 'red' }; },
  prev_hdu(t) { if (/\bhdu\b|high dependency/.test(t)) return _val(/no hdu|never.*hdu/.test(t) ? 'No' : 'Yes', 'HDU history discussed', _evidence(t, [/hdu|high dependency/])); return { status: 'red' }; },
  severe_attacks(t) {
    if (/life[- ]threatening|near[- ]fatal|ventilated|resus|stopped breathing|blue light|severe attack/.test(t)) return _val('Yes', 'Severe attack history', _evidence(t, [/life|ventilat|resus|severe/]));
    if (/no severe|never had a (?:severe|bad) attack|no life[- ]threatening/.test(t)) return _val('No', 'No severe attacks');
    return { status: 'red' };
  },

  oral_steroid_courses(t) { const n = _firstInt(t, /(\d+)\s*(?:course|courses)\s*of\s*(?:oral )?steroids?/) ?? _firstInt(t, /(\d+)\s*steroid (?:course|courses)/); if (n != null) return _val(n, `${n} steroid course(s)`, _evidence(t, [/steroid/])); if (/no steroids?|no oral steroid/.test(t)) return _val(0, 'No steroid courses'); return { status: 'red' }; },
  emergency_visits(t) { const n = _firstInt(t, /(\d+)\s*(?:a&e|ed|emergency|urgent care|gp)\s*(?:visit|visits|attendance)/) ?? _firstInt(t, /(\d+)\s*(?:times? to|visits? to)\s*(?:a&e|ed|the gp)/); if (n != null) return _val(n, `${n} emergency visit(s)`, _evidence(t, [/a&e|emergency|ed\b/])); if (/one a&e|1 a&e|a&e visit|an a&e/.test(t)) return _val(1, 'One A&E visit', _evidence(t, [/a&e/])); return { status: 'red' }; },
  hospital_admissions(t) { const n = _firstInt(t, /(\d+)\s*(?:hospital )?admissions?/); if (n != null) return _val(n, `${n} admission(s)`, _evidence(t, [/admission|admitted/])); if (/no admissions?|never admitted|no hospital/.test(t)) return _val(0, 'No admissions'); return { status: 'red' }; },
  salbutamol_canisters(t) { const n = _firstInt(t, /(\d+)\s*(?:salbutamol |ventolin |blue )?(?:inhalers?|canisters?|pumps?)/); if (n != null) return _val(n, `${n} canister(s)`, _evidence(t, [/inhaler|canister/])); return { status: 'red' }; },
  days_off_school(t) { const n = _firstInt(t, /(\d+)\s*days?\s*off\s*(?:school|nursery)/); if (n != null) return _val(n, `${n} day(s) off school`, _evidence(t, [/off school/])); if (/no (?:days off|time off) school|not missed school/.test(t)) return _val(0, 'No school missed'); return { status: 'red' }; },

  fh_atopy(t) {
    const fam = 'family|father|mother|\\bdad\\b|\\bmum\\b|\\bmom\\b|brother|sister|sibling|parent|gran|nan|grandparent';
    const cond = 'asthma|eczema|hay ?fever|allergies|allergic|atopy';
    if (new RegExp(`(?:${fam})[^.]{0,40}(?:${cond})`).test(t) || new RegExp(`(?:${cond})[^.]{0,25}(?:${fam})`).test(t)) return _val('Yes', 'Family history of atopy/asthma', _evidence(t, [new RegExp(`(?:${fam})[^.]{0,40}(?:${cond})`)]));
    if (/no family history|no one in (?:the|his|her) family|nobody.*asthma/.test(t)) return _val('No', 'No family history');
    return { status: 'red' };
  },

  smoker_presence(t) {
    if (/no(?:body| one)? smokes?|nobody smokes|no smokers?|smoke[- ]?free|don'?t smoke (?:at home|in the house)/.test(t)) return _val('No', 'No smoke exposure', _evidence(t, [/smoke/]));
    if (/smokes?|vap(?:es|ing)|smoker/.test(t)) return _val('Yes', 'Household smoke exposure', _evidence(t, [/smoke|vap/]));
    return { status: 'red' };
  },
  smoker_who(t) {
    if (!/smoke|vap/.test(t)) return { status: 'red' };
    if (/both parents smoke|mum and dad smoke/.test(t)) return _val('Both parents', 'Both parents');
    if (/(?:mum|mother)[^.]{0,15}smoke/.test(t)) return _val('Mother', 'Mother');
    if (/(?:dad|father)[^.]{0,15}smoke/.test(t)) return _val('Father', 'Father');
    if (/vap(?:es|ing)|e-?cig/.test(t)) return _val('Vaping / e-cigarettes', 'Vaping / e-cigarettes');
    if (/outside|in the garden/.test(t)) return _val('Outside home only', 'Outside home only');
    return { status: 'red' };
  },

  pets(t) {
    if (/no pets?|don'?t have (?:any )?pets|no animals/.test(t)) return _val(['None'], 'None');
    const map = [['Cat', /\bcat\b/], ['Dog', /\bdog\b/], ['Rabbit', /rabbit/], ['Rodent (hamster/guinea pig)', /hamster|guinea pig|gerbil/], ['Bird', /\bbird\b|budgie|parrot/], ['Horse', /horse|pony/]];
    const hit = map.filter(([, re]) => re.test(t)).map(([o]) => o);
    if (hit.length) return _val(hit, hit.join(', '), _evidence(t, map.map(m => m[1])));
    return { status: 'red' };
  },

  immunisation(t) {
    if (/up to date|fully (?:immunised|immunized|vaccinated)|had all (?:his|her|their) (?:jabs|vaccines)/.test(t)) return _val('Up to date', 'Up to date', _evidence(t, [/immunis|vaccin|jab/]));
    if (/not up to date|behind (?:on|with).*(?:jabs|vaccines)/.test(t)) return _val('Not up to date', 'Not up to date');
    if (/declined|refused.*(?:jabs|vaccines)/.test(t)) return _val('Declined', 'Declined');
    return { status: 'red' };
  },

  attended_with(t) {
    if (/(?:mum|mother) and (?:dad|father)|both parents/.test(t)) return _val('Both parents', 'Both parents');
    if (/\bmum\b|\bmother\b/.test(t)) return _val('Mother', 'Mother');
    if (/\bdad\b|\bfather\b/.test(t)) return _val('Father', 'Father');
    return { status: 'red' };
  },
};

/* Medication detectors — a mention of the drug marks it prescribed/continued.
   Returns { status, value } where value is an object merged into meds[id]. */
const ASTHMA_MED_DETECTORS = {
  salbutamol(t) { return /salbutamol|ventolin|blue (?:inhaler|puffer|one|pump)|reliever/.test(t) ? _val({ prescribed: 'Yes' }, 'Reliever in use', _evidence(t, [/salbutamol|ventolin|blue/])) : { status: 'red' }; },
  clenil(t) { return /clenil|beclometason|beclomethason|brown (?:inhaler|puffer|one)/.test(t) ? _val({ prescribed: 'Yes' }, 'Clenil in use', _evidence(t, [/clenil|brown/])) : { status: 'red' }; },
  seretide(t) { return /seretide/.test(t) ? _val({ prescribed: 'Yes' }, 'Seretide in use', _evidence(t, [/seretide/])) : { status: 'red' }; },
  fluticasone_mdi(t) { return /flixotide|fluticasone mdi/.test(t) ? _val({ prescribed: 'Yes' }, 'Fluticasone in use', _evidence(t, [/flixotide|fluticasone/])) : { status: 'red' }; },
  symbicort_mart_turbohaler(t) { return /symbicort.*turbohaler|mart turbohaler/.test(t) ? _val({}, 'Symbicort MART in use', _evidence(t, [/symbicort/])) : { status: 'red' }; },
  symbicort_mdi(t) { return /symbicort mdi|symbicort.*mouthpiece/.test(t) ? _val({}, 'Symbicort MDI in use', _evidence(t, [/symbicort/])) : { status: 'red' }; },
  montelukast(t) { return /montelukast|singulair/.test(t) ? _val({ dose_mg: (t.match(/montelukast\s*(\d+)\s*mg/) || [])[1] || undefined }, 'Montelukast in use', _evidence(t, [/montelukast|singulair/])) : { status: 'red' }; },
};

/* Fields that are clinician-measured / documentation — never inferred from
   speech. Shown as locked grey tiles that go green once entered in the template. */
const ASTHMA_CLINICIAN_FIELDS = new Set([
  'exam_normal', 'peak_flow_na', 'peak_flow_value', 'peak_flow_pct_predicted',
  'feno_value', 'feno_interpretation', 'spirometry',
]);

/* Fields flagged Critical for the top-of-screen "Critical: x/y" indicator. */
const ASTHMA_CRITICAL_FIELDS = new Set([
  'cough_at_night', 'triggers', 'prev_picu', 'prev_hdu', 'severe_attacks',
  'oral_steroid_courses', 'emergency_visits', 'hospital_admissions',
]);

const _GREY = () => ({ status: 'grey', extracted: 'Clinician-entered' });

/* Build the checklist from the clinic template, in template order. */
function buildAsthmaChecklist() {
  const items = [];
  for (const sec of ASTHMA_TEMPLATE_SPEC.sections) {
    for (const f of (sec.fields || [])) {
      if (f.type === 'readonly' || f.id === 'act_score') continue;   // ACT has its own panel
      const clinician = ASTHMA_CLINICIAN_FIELDS.has(f.id);
      const det = ASTHMA_FIELD_DETECTORS[f.id];
      items.push({
        id: f.id, field: f.id, label: f.label, group: sec.title,
        prio: ASTHMA_CRITICAL_FIELDS.has(f.id) ? 'Critical' : 'Important',
        clinicianOnly: clinician,
        defaultPrompt: clinician ? `Enter ${f.label} (clinician-measured)` : `Discuss / document: ${f.label}`,
        detect: clinician ? _GREY : (det || (() => ({ status: 'red' }))),
      });
    }
    for (const m of (sec.medications || [])) {
      if (m.type === 'readonly') continue;
      const det = ASTHMA_MED_DETECTORS[m.id];
      items.push({
        id: 'med_' + m.id, field: 'med:' + m.id, label: m.name, group: 'Current Medications', prio: 'Important',
        defaultPrompt: `Document whether ${m.name} is prescribed/continued`,
        detect: det || (() => ({ status: 'red' })),
      });
    }
    if (sec.skin_prick) {
      items.push({ id: 'skin_prick', field: 'skin_prick', label: 'Skin prick test (wheals)', group: sec.title, prio: 'Important', clinicianOnly: true, defaultPrompt: 'Enter skin-prick wheal sizes (clinician)', detect: _GREY });
    }
  }
  return items;
}

const ASTHMA_CHECKLIST = buildAsthmaChecklist();
