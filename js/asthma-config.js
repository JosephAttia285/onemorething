/* ============================================================
   asthma-config.js — paediatric asthma review: data & rules
   Loaded after config.js so it can reuse the shared detector
   helpers (_evidence, _latestMatch, _normalizeNumbers, _sentences).

   Same shape as CHECKLIST_CONFIG: each item is
   { id, label, prio, src, defaultPrompt, detect(lcText) } and
   detect() returns { status, extracted?, evidence?, missing? }.

   This is a *completeness* checklist for a consultant-led paediatric
   asthma review clinic (NICE NG245 2024) — it checks whether the key
   patient/parent-answerable review questions were covered. It does not
   diagnose, grade control, or recommend treatment. Measurement-only
   items (FeNO, spirometry, peak flow, skin-prick) are clinician-entered
   and deliberately excluded from the spoken-conversation checklist.
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

/* ---------- detector configuration ----------
   Grouped Critical / Important / Supportive so the tiles cluster the
   same way the nodule board does. Text arrives lowercased with
   spelled-out numbers already converted to digits by the engine. */
const ASTHMA_CHECKLIST = [

  /* ---------------- Critical ---------------- */

  { id: 'AS1', label: 'Symptom pattern', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'What symptoms does the child get — cough, wheeze, chest tightness, breathlessness?',
    detect(t) {
      const cough = /cough/;
      const wheez = /wheez/;
      const tight = /tight(?:ness)?[^.]{0,15}chest|chest[^.]{0,10}tight|tight chest/;
      const sob = /short(?:ness)? of breath|breathless|out of breath|puffed out|can'?t catch (?:his|her|their|my) breath|struggl\w* to breathe|difficulty breathing/;
      const hits = [['cough', cough], ['wheeze', wheez], ['chest tightness', tight], ['breathlessness', sob]]
        .filter(([, re]) => re.test(t));
      if (!hits.length) {
        if (/chesty|bad chest|(?:his|her|their) chest (?:has been|been|is)/.test(t))
          return { status: 'orange', extracted: 'Chest symptoms mentioned but not characterised.', evidence: _evidence(t, [/chest/]), missing: 'Which symptoms — cough, wheeze, chest tightness, breathlessness?' };
        return { status: 'red' };
      }
      const ev = _evidence(t, [cough, wheez, tight, sob]);
      if (hits.length >= 2) return { status: 'green', extracted: 'Reports ' + hits.map(h => h[0]).join(', ') + '.', evidence: ev };
      return { status: 'orange', extracted: hits[0][0] + ' reported; other symptoms not covered.', evidence: ev, missing: 'Ask about the full pattern — cough, wheeze, chest tightness and breathlessness.' };
    } },

  { id: 'AS2', label: 'Nocturnal / diurnal pattern', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'Are the symptoms worse at night or first thing in the morning?',
    detect(t) {
      const nightsx = /at night|night[- ]?time|overnight|during the night|in the night|wakes? (?:him|her|them|up)|waking (?:at night|him|her|them)|early morning|first thing in the morning|morning(?:s)?\b/;
      if (!nightsx.test(t)) return { status: 'red' };
      const ev = _evidence(t, [nightsx]);
      if (/every night|most nights|nightly|wakes? (?:him|her|them|up)|coughing (?:all|at) night|cough(?:ing|s)? (?:a lot )?at night|worse at night|worse (?:in|of) the (?:early )?morning|early morning/.test(t))
        return { status: 'green', extracted: 'Nocturnal / early-morning symptoms reported.', evidence: ev };
      return { status: 'orange', extracted: 'Night-time symptoms mentioned but frequency unclear.', evidence: ev, missing: 'How often at night — never, occasionally, most nights, every night?' };
    } },

  { id: 'AS3', label: 'Triggers', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'Does anything set the symptoms off — colds, exercise, allergens, smoke, weather?',
    detect(t) {
      const none = /no (?:known )?triggers|nothing (?:seems to |appears to )?sets? (?:it|him|her|them) off|no particular trigger|can'?t (?:think of|identify) (?:any )?triggers/;
      if (none.test(t)) return { status: 'green', extracted: 'No known triggers.', evidence: _evidence(t, [none]) };
      const named = [
        ['viral colds', /viral|(?:a |the |gets? a |catches? a )cold|colds\b|chest infection/],
        ['exercise', /exercise|running|running about|sport|\bpe\b|playing football|when (?:he|she|they) runs?/],
        ['pollen', /pollen|grass|tree|hay ?fever season|summer/],
        ['animals', /\bcat\b|\bdog\b|pets?|animals?|rabbit|horse/],
        ['dust', /dust|house dust mite|hoovering|dusty/],
        ['smoke', /smoke|tobacco|bonfire/],
        ['weather / damp', /cold weather|cold air|weather change|damp|mould|mold/],
        ['emotion / laughter', /laughing|laughter|emotion|excited|crying|gets upset/],
      ].filter(([, re]) => re.test(t));
      if (named.length) return { status: 'green', extracted: 'Triggers: ' + named.map(n => n[0]).join(', ') + '.', evidence: _evidence(t, named.map(n => n[1])) };
      if (/sets? (?:it|him|her|them) off|triggers?\b|brings it on|flares? (?:up|when|with)|makes? it worse/.test(t))
        return { status: 'orange', extracted: 'Triggers alluded to but not specified.', evidence: _evidence(t, [/trigger|sets .* off|brings it on|flares|worse/]), missing: 'Which specific triggers — colds, exercise, allergens, smoke, weather?' };
      return { status: 'red' };
    } },

  { id: 'AS4', label: 'Preventer (ICS) inhaler', prio: 'Critical', src: ['NICE NG245', 'BNFc'],
    defaultPrompt: 'Which preventer (steroid) inhaler is the child on, and at what dose?',
    detect(t) {
      const prev = /clenil|beclometason|beclomethason|brown (?:inhaler|puffer|one)|preventer|steroid inhaler|seretide|symbicort|fostair|fluticason|flixotide|\bqvar\b|kelhale|soprobec|purple inhaler|pink inhaler|maintenance inhaler/;
      if (!prev.test(t)) return { status: 'red' };
      const ev = _evidence(t, [prev]);
      const named = /clenil|beclomet|seretide|symbicort|fostair|fluticason|flixotide|\bqvar\b|kelhale|soprobec/.test(t);
      const use = /twice a day|two times a day|every day|daily|morning and (?:night|evening)|takes? (?:it|the)|prescribed|\d+\s*puffs?|puff twice/.test(t);
      if (named || use) return { status: 'green', extracted: 'On a preventer (ICS) inhaler.', evidence: ev };
      return { status: 'orange', extracted: 'Preventer inhaler referred to only vaguely.', evidence: ev, missing: 'Which preventer, what strength/dose, and how often?' };
    } },

  { id: 'AS5', label: 'Reliever use / frequency', prio: 'Critical', src: ['NICE NG245', 'BNFc'],
    defaultPrompt: 'How often does the child need the blue reliever inhaler?',
    detect(t) {
      const rel = /salbutamol|ventolin|blue (?:inhaler|puffer|one|pump)|reliever/;
      if (!rel.test(t)) return { status: 'red' };
      const ev = _evidence(t, [rel]);
      const freq = /\d+\s*(?:times?|x)\s*(?:a|per)\s*(?:day|week)|once a (?:day|week)|twice a (?:day|week)|two or three times|couple of times|every day|most days|daily|\d+\s*puffs?|rarely|hardly (?:ever|uses?)|only when|never needs?|doesn'?t (?:really )?need/;
      if (freq.test(t)) return { status: 'green', extracted: 'Reliever use frequency captured.', evidence: _evidence(t, [freq]) || ev };
      return { status: 'orange', extracted: 'Reliever mentioned but frequency of use not quantified.', evidence: ev, missing: 'How many times a week is the reliever actually used?' };
    } },

  { id: 'AS6', label: 'Adherence to preventer', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'How well does the child manage to take the preventer every day?',
    detect(t) {
      const ev = _evidence(t, [/miss|forget|every day|adher|takes? (?:it|the preventer|the brown)|\d+\s*(?:out of|\/)\s*14/]);
      if (/\d+\s*(?:out of|\/)\s*14/.test(t)) return { status: 'green', extracted: 'Adherence quantified (/14 doses).', evidence: ev };
      if (/(?:takes?|has) (?:it|them|the preventer|the brown)[^.]{0,20}every day|never misses|good (?:with|at taking)|takes it (?:religiously|regularly)/.test(t))
        return { status: 'green', extracted: 'Good reported adherence.', evidence: ev };
      if (/miss(?:es|ed)?\b|forget(?:s|ting)?\b|not (?:very )?good (?:with|at)|sometimes skips|doesn'?t always|hit and miss/.test(t))
        return { status: 'green', extracted: 'Adherence discussed — some missed doses reported.', evidence: ev };
      return { status: 'red' };
    } },

  { id: 'AS7', label: 'Exacerbations (last 12 months)', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'How many steroid courses, A&E/GP emergency visits or admissions in the last year?',
    detect(t) {
      const ev = _evidence(t, [/steroid|prednisolon|a&e|\bed\b|emergency|admission|admitted|hospital|attack|flare|exacerbation/]);
      const none = /no (?:steroid|admissions?|a&e|attacks?|flares?|exacerbations?)|hasn'?t needed (?:steroids?|hospital)|none (?:in the last|this year|so far)|no (?:hospital|emergency) (?:visits?|admissions?)/;
      if (none.test(t)) return { status: 'green', extracted: 'No significant exacerbations reported.', evidence: _evidence(t, [none]) };
      const topic = /steroid|prednisolon|a&e|emergency (?:department|visit)|\bed\b|urgent care|out of hours|walk[- ]?in|admitted|admission|stayed in|kept in/;
      if (topic.test(t)) {
        const hasCount = /\d+\s*(?:course|courses|times?|admission|admissions|a&e|visit|visits)/.test(t);
        if (hasCount) return { status: 'green', extracted: 'Exacerbation frequency captured.', evidence: ev };
        return { status: 'orange', extracted: 'Exacerbations mentioned but numbers unclear.', evidence: ev, missing: 'How many steroid courses, emergency visits and admissions in the last 12 months?' };
      }
      return { status: 'red' };
    } },

  { id: 'AS8', label: 'High-risk / life-threatening attacks', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'Has the child ever needed intensive care (PICU/HDU) or a life-threatening attack?',
    detect(t) {
      const risk = /\bpicu\b|paediatric intensive|pediatric intensive|intensive care|\bicu\b|\bhdu\b|high dependency|ventilat|life[- ]?threatening|near[- ]?fatal|resus|stopped breathing/;
      if (!risk.test(t)) return { status: 'red' };
      const ev = _evidence(t, [risk]);
      if (/no (?:picu|icu|hdu|intensive care)|no admissions? to intensive|never (?:been )?(?:in|admitted to) (?:intensive|picu|icu|hdu)|not (?:been )?ventilat/.test(t))
        return { status: 'green', extracted: 'No PICU/HDU or life-threatening attacks.', evidence: ev };
      return { status: 'green', extracted: 'High-risk attack history discussed.', evidence: ev };
    } },

  { id: 'AS9', label: 'Inhaler technique / spacer', prio: 'Critical', src: ['NICE NG245'],
    defaultPrompt: 'Has the inhaler technique and spacer use been checked?',
    detect(t) {
      const ev = _evidence(t, [/technique|spacer|demonstrat|show(?:ed|n)? (?:me|us|him|her)/]);
      if (/(?:inhaler )?technique|check (?:his|her|their|the|your) (?:inhaler )?technique|demonstrat\w* (?:the )?(?:technique|inhaler)|show(?:ed|n)? (?:me|us) how (?:to )?(?:use|take)|spacer (?:technique|use)/.test(t))
        return { status: 'green', extracted: 'Inhaler technique / spacer use addressed.', evidence: ev };
      if (/spacer/.test(t)) return { status: 'orange', extracted: 'Spacer mentioned; technique not explicitly checked.', evidence: ev, missing: 'Confirm inhaler technique has been observed and corrected.' };
      return { status: 'red' };
    } },

  /* ---------------- Important ---------------- */

  { id: 'AS10', label: 'Atopic history (eczema / rhinitis)', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Does the child have eczema or hay fever / allergic rhinitis?',
    detect(t) {
      const ecz = /eczema|dermatitis|atopic skin|dry (?:skin|patches)/;
      const rhin = /hay ?fever|allergic rhinitis|itchy (?:eyes|nose)|sneez|runny nose|blocked nose/;
      const ev = _evidence(t, [ecz, rhin]);
      if (/no eczema|no hay ?fever|no (?:history of )?atopy|denies eczema|no (?:skin|allergy) problems/.test(t))
        return { status: 'green', extracted: 'No eczema / hay fever.', evidence: ev };
      if (ecz.test(t) || rhin.test(t))
        return { status: 'green', extracted: 'Atopy: ' + [ecz.test(t) ? 'eczema' : null, rhin.test(t) ? 'hay fever/rhinitis' : null].filter(Boolean).join(' & ') + '.', evidence: ev };
      return { status: 'red' };
    } },

  { id: 'AS11', label: 'Allergies (food / drug / other)', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Any food, drug or environmental allergies?',
    detect(t) {
      const ev = _evidence(t, [/allerg|reacts? to|reaction to|anaphyla|epipen|\bnut|peanut|\begg|penicillin/]);
      if (/no (?:known )?allergies|no allergies|not allergic to anything|nothing (?:he|she|they)'?s allergic to|no drug allerg|\bnkda\b/.test(t))
        return { status: 'green', extracted: 'No known allergies.', evidence: ev };
      if (/allerg|anaphyla|epipen|allergic to|reacts? to|reaction to/.test(t))
        return { status: 'green', extracted: 'Allergy history discussed.', evidence: ev };
      return { status: 'red' };
    } },

  { id: 'AS12', label: 'Family history of atopy/asthma', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Is there a family history of asthma, eczema, hay fever or allergies?',
    detect(t) {
      const fam = 'family|father|mother|\\bdad\\b|\\bmum\\b|\\bmom\\b|brother|sister|sibling|parent|gran|nan|grandparent|grandmother|grandfather';
      const cond = 'asthma|eczema|hay ?fever|allergies|allergic|atopy|wheez|inhaler';
      const ev = _evidence(t, [new RegExp('(?:' + fam + ')[^.]{0,40}(?:' + cond + ')'), /family history/]);
      if (/no family history|no one in (?:the|his|her|their|our) family|nobody (?:in the family )?(?:has|had)|no (?:family )?history of asthma/.test(t))
        return { status: 'green', extracted: 'No relevant family history.', evidence: ev };
      if (new RegExp('(?:' + fam + ')[^.]{0,40}(?:' + cond + ')').test(t) || new RegExp('(?:' + cond + ')[^.]{0,25}(?:' + fam + ')').test(t))
        return { status: 'green', extracted: 'Family history of atopy / asthma reported.', evidence: ev };
      if (/family history/.test(t)) return { status: 'orange', extracted: 'Family history raised but not specified.', evidence: ev, missing: 'Any family history of asthma, eczema, hay fever or allergies?' };
      return { status: 'red' };
    } },

  { id: 'AS13', label: 'Smoke exposure at home', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Does anyone smoke or vape at home?',
    detect(t) {
      if (!/smok|vap(?:e|ing|es)|cigarett|tobacco/.test(t)) return { status: 'red' };
      const ev = _evidence(t, [/smok|vap|cigarett|tobacco/]);
      if (/no(?:body| one)? smokes?|nobody smokes|no smokers?|smoke[- ]?free|no one (?:at home )?smokes|don'?t smoke (?:at home|around|in the house)|no smoking (?:at home|in the house)/.test(t))
        return { status: 'green', extracted: 'No smoke exposure at home.', evidence: ev };
      if (/smokes?|vap(?:es|ing)|smoker|cigarett/.test(t))
        return { status: 'green', extracted: 'Household smoke / vape exposure discussed.', evidence: ev };
      return { status: 'orange', extracted: 'Smoking raised but home exposure unclear.', evidence: ev, missing: 'Does anyone smoke or vape at home, and where?' };
    } },

  { id: 'AS14', label: 'Home environment (pets / damp)', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Any pets at home, or damp / mould?',
    detect(t) {
      const ev = _evidence(t, [/pets?|\bcat\b|\bdog\b|rabbit|hamster|guinea pig|\bbird\b|damp|mould|mold/]);
      if (/no pets?|don'?t have (?:any )?pets|no animals|no damp|no mould|no mold/.test(t))
        return { status: 'green', extracted: 'No pets / damp reported.', evidence: ev };
      if (/\bcat\b|\bdog\b|rabbit|hamster|guinea pig|\bbird\b|pets?|damp|mould|mold/.test(t))
        return { status: 'green', extracted: 'Home exposures (pets / damp) discussed.', evidence: ev };
      return { status: 'red' };
    } },

  { id: 'AS15', label: 'Impact (school / activity / sleep)', prio: 'Important', src: ['NICE NG245'],
    defaultPrompt: 'Is the asthma causing time off school, limiting activity, or disturbing sleep?',
    detect(t) {
      const ev = _evidence(t, [/school|nursery|sport|\bpe\b|running|play|activit|wakes?|sleep|days off/]);
      const school = /days off (?:school|nursery)|miss(?:ed|ing|es)? (?:school|nursery|days)|off school|absent from school/;
      const activity = /can'?t (?:run|play|keep up)|stops? (?:him|her|them) (?:running|playing)|limits? (?:his|her|their)|struggles? (?:in|with) (?:pe|sport|games)|wheezy when (?:he|she|they) runs?|when (?:he|she|they) runs? (?:around|about)/;
      const sleep = /wakes? (?:him|her|them|up)|disturb\w* sleep|up at night|loses? sleep/;
      if (school.test(t) || activity.test(t) || sleep.test(t))
        return { status: 'green', extracted: 'Impact on school / activity / sleep discussed.', evidence: ev };
      if (/school|sport|\bpe\b|running|play/.test(t))
        return { status: 'orange', extracted: 'Activity/school mentioned; impact of asthma not quantified.', evidence: ev, missing: 'Any school absence or limits on sport/play because of the asthma?' };
      return { status: 'red' };
    } },

  /* ---------------- Supportive ---------------- */

  { id: 'AS16', label: 'Understanding & action plan', prio: 'Supportive', src: ['NICE NG245'],
    defaultPrompt: 'Has an asthma action plan been provided and understanding checked?',
    detect(t) {
      const ev = _evidence(t, [/action plan|self[- ]?management|what to do (?:if|when)|understand|worried|anxious|leaflet|information/]);
      if (/action plan|self[- ]?management plan|what to do if (?:it|things) (?:gets?|get) worse|emergency plan|written plan/.test(t))
        return { status: 'green', extracted: 'Asthma action plan / self-management discussed.', evidence: ev };
      if (/understand|any questions|worried|anxious|concerns?|explain/.test(t))
        return { status: 'orange', extracted: 'Understanding touched on; action plan not confirmed.', evidence: ev, missing: 'Provide and confirm a written asthma action plan.' };
      return { status: 'red' };
    } },

  { id: 'AS17', label: 'Montelukast tolerance', prio: 'Supportive', src: ['NICE NG245', 'BNFc'],
    defaultPrompt: 'If on montelukast, any sleep, mood or behaviour side effects?',
    detect(t) {
      if (!/montelukast|singulair/.test(t)) return { status: 'grey', extracted: 'Montelukast not mentioned — not applicable.' };
      const ev = _evidence(t, [/montelukast|singulair|sleep|nightmare|mood|behaviour|behavior|side effect|agitat|tolerat/]);
      if (/no side effects?|tolerat\w* (?:it )?well|no (?:problems?|issues?|nightmares?)|no (?:sleep|behaviour|behavior|mood) (?:problems?|issues?|disturbance|changes?)/.test(t))
        return { status: 'green', extracted: 'Montelukast tolerated — no neuropsychiatric side effects.', evidence: ev };
      if (/nightmare|sleep (?:problems?|disturbance)|mood|behaviour|behavior|agitat|aggress|low mood/.test(t))
        return { status: 'green', extracted: 'Montelukast side-effects reviewed.', evidence: ev };
      return { status: 'orange', extracted: 'On montelukast but neuropsychiatric side-effects not checked.', evidence: ev, missing: 'Ask about sleep disturbance, nightmares, mood or behaviour changes.' };
    } },

  { id: 'AS18', label: 'Immunisation status', prio: 'Supportive', src: ['NICE NG245'],
    defaultPrompt: 'Are the routine immunisations and flu vaccine up to date?',
    detect(t) {
      if (!/immunis|immuniz|vaccin|\bjabs?\b|flu (?:jab|vaccine|spray)/.test(t)) return { status: 'red' };
      const ev = _evidence(t, [/immunis|immuniz|vaccin|jabs?|flu/]);
      if (/up to date|had (?:his|her|their|the) (?:jabs|vaccines|flu)|all (?:his|her|their) (?:jabs|vaccines)|fully (?:immunised|immunized|vaccinated)/.test(t))
        return { status: 'green', extracted: 'Immunisations up to date.', evidence: ev };
      if (/not up to date|behind|missed (?:some|his|her)|declined|didn'?t have/.test(t))
        return { status: 'green', extracted: 'Immunisation status discussed.', evidence: ev };
      return { status: 'orange', extracted: 'Immunisation raised but status unclear.', evidence: ev, missing: 'Confirm routine immunisations and flu vaccine are up to date.' };
    } },
];
