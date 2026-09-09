/* ============================================================
   anonymise.js — best-effort local redaction of patient identifiers
   Runs entirely in the browser (no network). Used before a consultation
   is written to the saved-history store so stored/reviewed copies do not
   carry obvious identifiers.

   This is a heuristic safety net, NOT a guarantee: it catches structured
   identifiers (emails, phone/NHS numbers, postcodes, dates) and names that
   follow a title or an explicit naming cue. A first name spoken with no
   cue ("…and Jack's cough…") may remain — always review before relying on
   it, and never enter real patient data into this prototype.
   ============================================================ */

function anonymisePatient(text) {
  if (!text) return text;
  let s = String(text);

  // ---- structured identifiers ----
  s = s.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]');
  // UK postcode (e.g. SW1A 1AA)
  s = s.replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, '[postcode]');
  // dates like 12/03/2015, 12-3-15, 12.03.2015
  s = s.replace(/\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/g, '[date]');
  // written dates like "3rd January 2015"
  s = s.replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b/gi, '[date]');
  // UK mobile
  s = s.replace(/\b(?:\+?44\s?7\d{3}|\(?07\d{3}\)?)\s?\d{3}\s?\d{3}\b/g, '[phone]');
  // NHS number (3-3-4)
  s = s.replace(/\b\d{3}\s?\d{3}\s?\d{4}\b/g, '[nhs-no]');
  // UK landline
  s = s.replace(/\b0\d{3}\s?\d{3}\s?\d{3,4}\b/g, '[phone]');
  // any long numeric id (hospital number etc.) — 7+ digits
  s = s.replace(/\b\d{7,}\b/g, '[id]');

  // ---- names ----
  // personal title + following word(s): "Mr Smith", "Dr Jones"
  s = s.replace(/\b(?:mr|mrs|ms|miss|mx|dr)\b\.?\s+[a-z][a-z'’\-]+(?:\s+[a-z'’\-]+)?/gi, '[name]');
  // explicit naming cue + a capitalised word: "his name is Jack", "called Sarah"
  s = s.replace(/\b(name'?s|name is|named|called|goes by)\s+([A-Z][a-z'’\-]+)/g, '$1 [name]');
  // paediatric cues + a capitalised word: "bringing Jack in", "little Amara"
  s = s.replace(/\b(bringing|brought|little|young|baby|master|meet)\s+([A-Z][a-z'’\-]+)\b/g, '$1 [name]');

  return s;
}

/* Anonymise an array of transcript lines ({ speaker, text, time }). */
function anonymiseLines(lines) {
  return (lines || []).map(l => ({ ...l, text: anonymisePatient(l.text) }));
}
