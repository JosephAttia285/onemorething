/* ============================================================
   asthma-template-spec.js — Paediatric Asthma Clinic Template V4
   Full field/dropdown specification (Seb, confirmed 8 Sep 2026;
   NICE NG245 2024 + BNFc). This is pure data — the single source
   of truth the structured form (asthma-form.js) renders from.
   ============================================================ */

const ASTHMA_TEMPLATE_SPEC = {
  template: 'Asthma – Clinic template V4',
  version: '1.1',
  date: '2026-09-08',
  guideline_basis: 'NICE NG245 (2024), BNF for Children',
  build_notes: [
    'Trailing dropdown on every medication line = prescribed/continued Yes-No toggle, NOT a device selector.',
    'Peak flow captures both absolute value (L/min) and % predicted.',
    'ACT = numeric entry with age-driven auto-interpretation (c-ACT vs ACT).',
    "'Hospital at' (birth) = free text; may be a country where the child was born abroad.",
  ],

  sections: [
    {
      id: 'attendance_presenting', title: 'Attendance & Presenting Complaint',
      fields: [
        { id: 'attended_with', label: 'Child attended with', type: 'select', confidence: 'High', allow_free_text: true,
          options: ['Mother', 'Father', 'Both parents', 'Mother and grandparent', 'Grandparent', 'Legal guardian', 'Foster carer', 'Kinship carer', 'Young person (attended alone)', 'Other'] },
        { id: 'symptom_duration_years', label: 'Symptoms for ___ years', type: 'number', confidence: 'High', unit: 'years', min: 0, max: 18, step: 0.5 },
      ],
    },
    {
      id: 'triggers', title: 'Triggers',
      fields: [
        { id: 'triggers', label: 'Triggers', type: 'multiselect', confidence: 'High', allow_free_text: true,
          options: ['None known', 'Viral colds', 'Dust (house dust mite)', 'Foods', 'Animals / pets', 'Exercise', 'Grass / tree pollen', 'Tobacco smoke', 'Weather change', 'Damp and mould', 'Emotions / laughter', 'Air pollution', 'Others'] },
      ],
    },
    {
      id: 'symptom_pattern', title: 'Symptom Pattern',
      fields: [
        { id: 'cough_at_night', label: 'Cough at night', type: 'select', confidence: 'Confirmed', options: ['Never', 'Occasionally', 'Most nights', 'Every night'] },
        { id: 'episodic_diurnal', label: 'Symptoms episodic and diurnal (worse at night and early morning)', type: 'boolean', confidence: 'High' },
        { id: 'symptom_free_intervals', label: 'Symptom-free intervals', type: 'boolean', confidence: 'High' },
      ],
    },
    {
      id: 'current_medications', title: 'Current Medications', subtitle: 'Dose builders — reused in the Plan',
      medications: [
        { id: 'salbutamol', name: 'Salbutamol', sentence: '2–6 puffs 4-hourly as required inhaled via spacer',
          dropdowns: [ { field: 'prescribed', label: 'Prescribed / continued', type: 'boolean', confidence: 'Confirmed' } ] },
        { id: 'clenil', name: 'Clenil (beclometasone)', sentence: '{strength} — {puffs} puff twice daily inhaled via spacer',
          dropdowns: [
            { field: 'strength', label: 'Strength (micrograms)', type: 'select', confidence: 'High', options: ['50', '100', '200', '250'] },
            { field: 'puffs', label: 'Number of puffs', type: 'select', confidence: 'High', options: ['1', '2'] },
            { field: 'prescribed', label: 'Prescribed / continued', type: 'boolean', confidence: 'Confirmed' } ] },
        { id: 'seretide', name: 'Seretide (fluticasone/salmeterol Evohaler)', sentence: '{strength} — {puffs} puff twice daily inhaled via spacer',
          dropdowns: [
            { field: 'strength', label: 'Strength (Evohaler µg — +25 salmeterol)', type: 'select', confidence: 'High', options: ['50', '125', '250'] },
            { field: 'puffs', label: 'Number of puffs', type: 'select', confidence: 'High', options: ['1', '2'] },
            { field: 'prescribed', label: 'Prescribed / continued', type: 'boolean', confidence: 'Confirmed' } ] },
        { id: 'fluticasone_mdi', name: 'Fluticasone MDI (Flixotide Evohaler)', sentence: '{strength} — {puffs} puff twice daily inhaled via spacer',
          dropdowns: [
            { field: 'strength', label: 'Strength (micrograms)', type: 'select', confidence: 'High', options: ['50', '125', '250'] },
            { field: 'puffs', label: 'Number of puffs', type: 'select', confidence: 'High', options: ['1', '2'] },
            { field: 'prescribed', label: 'Prescribed / continued', type: 'boolean', confidence: 'Confirmed' } ] },
        { id: 'symbicort_mart_turbohaler', name: 'Symbicort MART Turbohaler', sentence: '{strength} — {maintenance_puffs} puffs twice a day; 1 puff as required; maximum {max_24h} in 24 hours',
          dropdowns: [
            { field: 'strength', label: 'Strength', type: 'select', confidence: 'High', options: ['100/6', '200/6'] },
            { field: 'maintenance_puffs', label: 'Maintenance puffs', type: 'select', confidence: 'High', options: ['1', '2'] },
            { field: 'max_24h', label: 'Maximum in 24h', type: 'select', confidence: 'High', options: ['8', '12'] } ] },
        { id: 'symbicort_air', name: 'Symbicort AIR only 200/6', type: 'readonly',
          sentence: 'as required. 1 puff as required; maximum 12 puffs in 24 hours.' },
        { id: 'symbicort_mdi', name: 'Symbicort MDI (pMDI)', sentence: '{strength}, {puffs} puffs twice a day via spacer with mouthpiece; maximum {max_24h} in 24 hours',
          dropdowns: [
            { field: 'strength', label: 'Strength', type: 'select', confidence: 'Med', options: ['100/3', '200/6'] },
            { field: 'puffs', label: 'Puffs', type: 'select', confidence: 'Med', options: ['1', '2', '4'] },
            // max options depend on strength — handled in the renderer (100/3 → 16/24, 200/6 → 8/12)
            { field: 'max_24h', label: 'Maximum in 24h', type: 'select', confidence: 'Med', options: ['16', '24', '8', '12'], dependsOn: 'strength',
              optionMap: { '100/3': ['16', '24'], '200/6': ['8', '12'] } } ] },
        { id: 'montelukast', name: 'Montelukast', sentence: '{dose_mg} mg once daily by mouth',
          dropdowns: [
            { field: 'dose_mg', label: 'Dose (mg)', type: 'select', confidence: 'High', options: ['4', '5', '10'], hint: '4 mg ~6 mo–5 yr · 5 mg 6–14 yr · 10 mg 15 yr+' } ] },
      ],
    },
    {
      id: 'response_adherence_atopy', title: 'Response, Adherence & Atopy',
      fields: [
        { id: 'adherence_doses', label: 'Reported adherence (/14 doses)', type: 'number', confidence: 'High', min: 0, max: 14, unit: '/14' },
        { id: 'response_to_treatment', label: 'Response to treatment', type: 'text', long: true, confidence: 'High' },
        { id: 'eczema_present', label: 'Eczema — present?', type: 'boolean', confidence: 'High' },
        { id: 'eczema_status', label: 'Eczema — status (current vs past)', type: 'select', confidence: 'Confirmed', options: ['Active', 'Well-controlled', 'Resolved'] },
        { id: 'rhinitis_present', label: 'Hay fever / Rhinitis — present?', type: 'boolean', confidence: 'High' },
        { id: 'rhinitis_status', label: 'Hay fever / Rhinitis — status (current vs past)', type: 'select', confidence: 'Confirmed', options: ['Active', 'Well-controlled', 'Resolved'] },
        { id: 'food_allergy', label: 'Food allergy', type: 'select', confidence: 'Med', options: ['None known', 'Suspected', 'Confirmed', 'Not tested', 'Not applicable'], reveals_free_text_on: ['Suspected', 'Confirmed'], free_text_label: 'Allergen + reaction' },
        { id: 'drug_allergy', label: 'Drug allergies', type: 'select', confidence: 'Med', options: ['None known', 'Yes', 'Not applicable'], reveals_free_text_on: ['Yes'], free_text_label: 'Drug + reaction' },
        { id: 'other_allergy', label: 'Other allergies', type: 'select', confidence: 'Med', options: ['None known', 'Yes', 'Not applicable'], reveals_free_text_on: ['Yes'], free_text_label: 'Allergen + reaction' },
      ],
    },
    {
      id: 'high_risk_factors', title: 'High-Risk Factors',
      fields: [
        { id: 'prev_picu', label: 'Previous PICU admission', type: 'select', confidence: 'High', options: ['Yes', 'No', 'Unknown'] },
        { id: 'prev_hdu', label: 'Previous HDU admission', type: 'select', confidence: 'High', options: ['Yes', 'No', 'Unknown'] },
        { id: 'severe_attacks', label: 'Severe asthma attacks', type: 'select', confidence: 'High', options: ['Yes', 'No', 'Unknown'] },
        { id: 'safeguarding', label: 'Safeguarding / psychosocial issues', type: 'select', confidence: 'High', options: ['Yes', 'No', 'Unknown'], reveals_free_text_on: ['Yes'], free_text_label: 'Details' },
      ],
    },
    {
      id: 'severity_12_months', title: 'Severity in the Last 12 Months', subtitle: 'Counts (integer ≥ 0)',
      fields: [
        { id: 'oral_steroid_courses', label: 'Courses of oral steroids', type: 'number', confidence: 'High', min: 0 },
        { id: 'emergency_visits', label: 'Emergency visits to ED/UCC/GP', type: 'number', confidence: 'High', min: 0 },
        { id: 'hospital_admissions', label: 'Hospital admissions', type: 'number', confidence: 'High', min: 0 },
        { id: 'salbutamol_canisters', label: 'Salbutamol inhalers (canisters) used', type: 'number', confidence: 'High', min: 0 },
        { id: 'days_off_school', label: 'Days off school because of asthma', type: 'number', confidence: 'High', min: 0 },
      ],
    },
    {
      id: 'act_score', title: 'Asthma Control Test Score',
      fields: [
        { id: 'act_score', label: 'ACT score', type: 'act', confidence: 'Confirmed',
          tools: [
            { tool: 'c-ACT', ageMin: 4, ageMax: 11, min: 0, max: 27, wellControlled: 20 },
            { tool: 'ACT', ageMin: 12, ageMax: 120, min: 5, max: 25, wellControlled: 20, notWellMin: 16 },
          ] },
      ],
    },
    {
      id: 'background_history', title: 'Background History',
      fields: [
        { id: 'other_conditions', label: 'Other significant medical conditions', type: 'text', long: true, confidence: 'High' },
        { id: 'past_history', label: 'Past history', type: 'select', confidence: 'Confirmed', options: ['Nil of note', 'Significant'], reveals_free_text_on: ['Significant'], free_text_label: 'Details' },
        { id: 'birth_gestation', label: 'Born at (gestation)', type: 'select', confidence: 'Med', options: ['Term (37–42 wks)', 'Late preterm (34–36)', 'Moderate preterm (32–33)', 'Very preterm (28–31)', 'Extremely preterm (<28)'] },
        { id: 'birth_hospital', label: 'Hospital at (place of birth)', type: 'text', confidence: 'Confirmed', hint: 'Hospital name — or a country if born abroad' },
        { id: 'delivery_mode', label: 'Mode of delivery', type: 'select', confidence: 'High', options: ['Normal vaginal delivery', 'Ventouse', 'Forceps', 'Elective caesarean', 'Emergency caesarean'] },
        { id: 'postnatal_period', label: 'Immediate postnatal period', type: 'multiselect', confidence: 'High', allow_free_text: true,
          options: ['No postnatal complications', 'Feeding issues', 'Jaundice', 'Breathing issues', 'Other'] },
      ],
    },
    {
      id: 'family_social_history', title: 'Family & Social History',
      fields: [
        { id: 'fh_atopy', label: 'Family history of atopy', type: 'boolean', confidence: 'High', reveals_free_text_on: ['Yes'], free_text_label: 'Relative + condition' },
        { id: 'fh_other', label: 'Family history of other medical problems', type: 'boolean', confidence: 'High', reveals_free_text_on: ['Yes'], free_text_label: 'Details' },
        { id: 'pets', label: 'Pets / animal exposure', type: 'multiselect', confidence: 'Med',
          options: ['None', 'Cat', 'Dog', 'Rabbit', 'Rodent (hamster/guinea pig)', 'Bird', 'Horse', 'Other'] },
        { id: 'smoker_presence', label: 'Smoker exposure — present?', type: 'boolean', confidence: 'High' },
        { id: 'smoker_who', label: 'Smoker exposure — who / where', type: 'select', confidence: 'Confirmed', options: ['Mother', 'Father', 'Both parents', 'Other household member', 'Outside home only', 'Vaping / e-cigarettes'] },
        { id: 'immunisation', label: 'Immunisation', type: 'select', confidence: 'High', options: ['Up to date', 'Partially immunised', 'Not up to date', 'Declined', 'Unknown'] },
        { id: 'developmental_history', label: 'Developmental history', type: 'text', long: true, confidence: 'High' },
        { id: 'school', label: 'School', type: 'text', confidence: 'High' },
        { id: 'social_history', label: 'Social history', type: 'text', long: true, confidence: 'High' },
      ],
    },
    {
      id: 'examination', title: 'Examination',
      fields: [
        { id: 'exam_normal', label: 'Resp / CVS / Abdo examinations all normal', type: 'select', confidence: 'Med', options: ['Normal', 'Abnormal', 'Not applicable'], reveals_free_text_on: ['Abnormal'], free_text_label: 'Abnormal findings' },
        { id: 'peak_flow_na', label: 'Peak flow', type: 'select', confidence: 'Confirmed', options: ['Done', 'Not applicable'] },
        { id: 'peak_flow_value', label: 'Peak flow — value', type: 'number', confidence: 'Confirmed', unit: 'L/min', min: 0 },
        { id: 'peak_flow_pct_predicted', label: 'Peak flow — % predicted', type: 'number', confidence: 'Confirmed', unit: '%', min: 0, max: 200 },
        { id: 'feno_value', label: 'FeNO — value', type: 'feno', confidence: 'High', unit: 'ppb', min: 0 },
        { id: 'feno_interpretation', label: 'FeNO — interpretation', type: 'select', confidence: 'High',
          options: ['< 20 ppb — Normal', '20–34 ppb — Intermediate', '≥ 35 ppb — Positive (eosinophilic)', 'Unable to perform / Not done', 'Not applicable'] },
        { id: 'spirometry', label: 'Spirometry', type: 'select', confidence: 'Med',
          options: ['Normal', 'Obstructive pattern', 'Obstructive with significant bronchodilator reversibility', 'Restrictive pattern', 'Unable to perform (age/technique)', 'Not done', 'Not applicable'] },
      ],
      skin_prick: {
        label: 'Skin prick test wheals (mm)',
        allergens: ['Positive control', 'Negative control', 'House dust mite', 'Aspergillus fumigatus', 'Cat', 'Dog', 'Grass mix', 'Tree mix'],
      },
    },
    {
      id: 'impression_plan', title: 'Impression & Plan',
      fields: [
        { id: 'impression', label: 'Impression', type: 'text', long: true, confidence: 'High' },
        { id: 'step_up_plan', label: 'Step-up plan (if uncontrolled)', type: 'text', long: true, confidence: 'High' },
        { id: 'step_down_plan', label: 'Step-down plan', type: 'text', long: true, confidence: 'High' },
        { id: 'follow_up', label: 'Follow-up', type: 'select', confidence: 'High',
          options: ['Follow-up in ___ months', 'Discharged to GP; parent happy with GP-led follow-up', 'Patient Initiated Follow-Up (PIFU) with planned discharge in ___ months'],
          reveals_months_on: ['Follow-up in ___ months', 'Patient Initiated Follow-Up (PIFU) with planned discharge in ___ months'] },
      ],
      education_readonly: 'Education & Support (standard): Asthma Action Plan provided; inhaler technique checked and demonstrated; inhaler-technique and Turbohaler videos signposted; adherence and Montelukast neuropsychiatric side-effects discussed; house dust mite information provided.',
    },
  ],
};
