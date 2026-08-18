// ─────────────────────────────────────────────────────────────────────────────
// Blood report parsing engine — the single source of truth for both the web
// app (app.js) and the mobile app (mobile/src/lib/parser.js, a thin wrapper
// around this file). Pure functions only: no DOM, no framework, no assumed
// PDF.js loading strategy — pdfjsLib is passed in by the caller so each
// platform can keep its own worker setup (CDN for the web, bundled for mobile).
//
// All report-format-specific knowledge (marker keywords/ranges/groups, column-
// header patterns, date formats, layout tolerances) lives in parser-config.json,
// not here — this file is pure logic that operates on whatever config is handed
// to it via configureParser(config). Each caller loads that JSON however suits
// its platform (require() in Node, a bundled import in Vite, fetch() in a
// browser) and calls configureParser() once before using parsePDF/matchLine/etc.
// This is also what makes it possible to later swap in a freshly-fetched config
// without touching this file or shipping an app update — the loading mechanism
// is entirely up to the caller.
// ─────────────────────────────────────────────────────────────────────────────

let VALUE_LIMITS = null;
let MARKER_UNITS = null;
export let REF_RANGES = null;
export let MARKER_GROUPS = null;
export let KEYWORD_MAP = null;
let KEYWORD_ENTRIES = null;
let REF_RANGE_HINTS = null;
let COL_PATTERNS = null;
let SKIP_RE = null;
let DATE_PATTERNS = null;
let LAYOUT = null;

const MONTH_MAP = {
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
};

// Call once, before using any other export, with the parsed contents of
// parser-config.json (or an equivalent object shaped the same way — e.g. a
// freshly-fetched, newer version of that same file).
//
// wordMap is the parsed contents of parser-config-wordmap.json: keywords that
// are mechanically derivable from a marker's own name (word-combinations,
// forwards or reversed — e.g. "GLOMERULAR", "DIRECTBILIRUBIN") as opposed to
// config.keywordMap's hand-curated keywords (shared-family keywords and
// aliases/acronyms that aren't textually part of any marker's own name, like
// "SGOT" or "TSH"). Kept separate because wordMap is meant to eventually be
// auto-generated from the marker list rather than maintained by hand.
export function configureParser(config, wordMap = {}) {
  VALUE_LIMITS = config.valueLimits;
  MARKER_UNITS = config.units ?? {};
  REF_RANGES = config.refRanges;
  MARKER_GROUPS = config.markerGroups;
  KEYWORD_MAP = { ...config.keywordMap, ...wordMap };
  LAYOUT = config.layout;

  // Sorted longest-first so more-specific keywords win unambiguous single-canonical matches
  KEYWORD_ENTRIES = Object.entries(KEYWORD_MAP).sort(([a], [b]) => b.length - a.length);

  // Reference range hints — auto-built from REF_RANGES for disambiguation
  REF_RANGE_HINTS = {};
  for (const [k, v] of Object.entries(REF_RANGES)) {
    const range = v.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
    if (range) { REF_RANGE_HINTS[k] = { lo: +range[1], hi: +range[2] }; continue; }
    const lt = v.match(/^[<≤]\s*(\d+\.?\d*)/);
    if (lt)  { REF_RANGE_HINTS[k] = { lo: 0, hi: +lt[1] }; continue; }
    const gt = v.match(/^[>≥]=?\s*(\d+\.?\d*)/);
    if (gt)  { REF_RANGE_HINTS[k] = { lo: +gt[1], hi: Infinity }; }
  }

  COL_PATTERNS = Object.fromEntries(
    Object.entries(config.colPatterns).map(([col, p]) => [col, new RegExp(p.source, p.flags)])
  );
  SKIP_RE = config.skipPatterns.map(p => new RegExp(p.source, p.flags));
  DATE_PATTERNS = config.datePatterns.map(p => ({
    re: new RegExp(p.source, p.flags),
    day: p.day, month: p.month, year: p.year, monthIsNumeric: p.monthIsNumeric,
  }));
}

function assertConfigured() {
  if (!LAYOUT) throw new Error('parser-core.mjs: call configureParser(config) before use.');
}

export function inValueRange(canonical, v) {
  const lim = VALUE_LIMITS[canonical];
  if (!lim) return true;
  return v >= lim[0] && v <= lim[1];
}

function unitScale(units) {
  if (!units) return 1;
  const u = units.replace(/\s/g, '').toUpperCase();
  // Exponent notation varies: a real superscript character ("10³"), a caret
  // ("10^3"), or — for the ×10⁹ case specifically — a superscript digit
  // rendered as its own separate PDF text item and reattached by the units
  // accumulator above ("10" immediately followed by a bare "9").
  const m = u.match(/10\^?([³369⁶⁹])/);
  if (!m) return 1;
  const exp = { '3':3, '³':3, '6':6, '⁶':6, '9':9, '⁹':9 }[m[1]];
  // Our default cell-count unit is cells/µL. "×10ⁿ/L" — hematology's
  // SI-preferred notation, and the form these superscript-exponent values
  // above take once the digit above the line is correctly reattached — is
  // the exact same magnitude as "×10ⁿ⁻⁶/µL" (1 L = 10⁶ µL), so the exponent
  // alone isn't enough; the denominator has to be checked to know which
  // scale is actually meant. Match bare "/L" specifically — the slash
  // immediately followed by L, nothing in between — so any micro-prefixed
  // form (/uL, /µL using the micro sign, /μL using Greek mu — labs are
  // inconsistent about which character they use) still correctly falls
  // through as "not per-liter" without needing to enumerate every spelling.
  const perLiter = /\/L$/.test(u);
  return Math.pow(10, perLiter ? exp - 6 : exp);
}

// Per-marker unit conversion — distinct from unitScale() above, which only
// handles the generic "10^3"/"10^6" cell-count multiplier notation shared
// across cell-count markers. This instead converts a value printed in an
// alternate unit (e.g. T3 as "ng/dL" when our default/tracked unit is
// "ng/mL") into the marker's default unit, so VALUE_LIMITS plausibility
// checks — and everything stored/displayed — are always in that one unit.
// A marker with no config.units entry (the common case) is unaffected.
//
// Returns null — not 1 — when the captured unit isn't one this marker's
// own `units` table recognizes at all, deliberately distinct from "found
// an explicit entry whose scale happens to be 1" (e.g. TSH's mIU/L). Callers
// that already know their canonical (a single clean match) just want a
// scale number and should default the null case to 1 themselves; disambiguate()
// below needs to tell the two apart, since a candidate that explicitly
// recognizes the printed unit is a categorically stronger match than one
// merely assuming the value is already in its own default unit.
export function markerUnitScale(canonical, unitsText) {
  if (!unitsText || !canonical) return null;
  const list = MARKER_UNITS[canonical];
  if (!list) return null;
  const u = unitsText.toLowerCase();
  for (const { unit, scale } of list) {
    if (u.includes(unit.toLowerCase())) return scale;
  }
  return null;
}

// The clean, canonical label for whichever of a marker's known units
// appears in `unitsText` (matched the same way markerUnitScale() matches
// it — substring, case-insensitive), as opposed to `unitsText` itself.
// Needed because the raw scanned unit text sometimes carries trailing junk
// glued onto it (e.g. a reference range immediately following the unit on
// the same PDF text item, "nmol/L(8.64 - 29.00)") — harmless when the text
// was only ever used for markerUnitScale()'s substring-inclusion check, but
// wrong once `unit` is returned as a user-facing value (fixtures, the UI's
// unit dropdown, storage) rather than being discarded after matching.
export function matchedUnitLabel(canonical, unitsText) {
  if (!unitsText || !canonical) return null;
  const list = MARKER_UNITS[canonical];
  if (!list) return null;
  const u = unitsText.toLowerCase();
  for (const { unit } of list) {
    if (u.includes(unit.toLowerCase())) return unit;
  }
  return null;
}

function scaleRef(ref, scale) {
  if (!ref || scale === 1) return ref;
  // Scale a "lo-hi" range string: "150-410" → "150000-410000"
  return ref.replace(/(\d+\.?\d*)/g, n => String(parseFloat(n) * scale));
}

// Converts a value from one of a marker's known printed units to another,
// via markerUnitScale()'s existing unit->default-unit scale (go via the
// default: value * scale(from) / scale(to)). A unit unrecognized for this
// marker defaults to scale 1 (safe no-op), same convention markerUnitScale's
// other callers already use.
export function convertUnit(canonical, value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  const fromScale = markerUnitScale(canonical, fromUnit) ?? 1;
  const toScale = markerUnitScale(canonical, toUnit) ?? 1;
  return value * fromScale / toScale;
}

// Whether `value`, printed/entered in `unit`, is physiologically plausible
// for `canonical` — converts into the canonical default unit first since
// VALUE_LIMITS is defined in that unit, then defers to inValueRange().
export function inValueRangeForUnit(canonical, value, unit) {
  const scale = markerUnitScale(canonical, unit) ?? 1;
  return inValueRange(canonical, value * scale);
}

// The marker's plausibility limits, expressed in `unit` instead of its
// canonical default unit — e.g. for a "value must be between X and Y"
// message when a unit-switched value fails inValueRangeForUnit() above.
export function valueLimitsForUnit(canonical, unit) {
  const lim = VALUE_LIMITS[canonical];
  if (!lim) return null;
  const scale = markerUnitScale(canonical, unit) ?? 1;
  return [lim[0] / scale, lim[1] / scale];
}

// The marker's reference range, in `unit` instead of its canonical default
// unit — computed by inverse-scaling REF_RANGES[canonical] rather than
// hand-authoring a range per unit in config (scaleRef() already exists for
// the forward direction; this just runs it with the reciprocal factor).
export function refRangeForUnit(canonical, unit) {
  const ref = REF_RANGES[canonical];
  if (!ref) return ref;
  const scale = markerUnitScale(canonical, unit) ?? 1;
  if (scale === 1) return ref;
  return scaleRef(ref, 1 / scale);
}

// ─────────────────────────────────────────────────────────────────────────────
// Date extraction
// ─────────────────────────────────────────────────────────────────────────────
// A 2-digit year group (e.g. "25" in "08-Aug-25") is always read as 20YY —
// blood reports in this app are never plausibly from before 2000.
function fullYear(y) {
  return y.length === 2 ? `20${y}` : y;
}

// Returns { date, ambiguous, alternate } — ambiguous is true only for the
// purely-numeric day/month pattern when both groups are <= 12 and differ
// from each other, i.e. "07/10/2025" could genuinely be either 7 Oct or 10
// Jul with no way to tell from the text alone. Named-month matches (day is
// unambiguous once the month is spelled out) and cases where the numeric
// groups aren't swappable (e.g. one is > 12) are never ambiguous. Callers
// with a UI should prompt using `date` as the pre-filled default and offer
// `alternate` as the correction when `ambiguous` is true — see ReportTab
// .svelte / app.js.
function parseDate(text) {
  for (const { re, day, month, year, monthIsNumeric } of DATE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    if (monthIsNumeric) {
      const d = parseInt(m[day], 10), mo = parseInt(m[month], 10);
      if (mo > 12) continue; // not a valid month — try the next pattern
      const date = `${fullYear(m[year])}-${m[month].padStart(2,'0')}-${m[day].padStart(2,'0')}`;
      if (d <= 12 && d !== mo) {
        const alternate = `${fullYear(m[year])}-${m[day].padStart(2,'0')}-${m[month].padStart(2,'0')}`;
        return { date, ambiguous: true, alternate };
      }
      return { date, ambiguous: false, alternate: null };
    }
    const mm = MONTH_MAP[m[month].toLowerCase().slice(0,3)];
    if (!mm) continue;
    return { date: `${fullYear(m[year])}-${mm}-${m[day].padStart(2,'0')}`, ambiguous: false, alternate: null };
  }
  return null;
}

function extractDate(lines) {
  const textLines = lines.filter(l => !l.pageBreak && l.text);
  const priority = textLines.filter(l =>
    /coll|collection|sct|date\s*:/i.test(l.text) && !/released|received|report\s*date/i.test(l.text)
  );
  for (const line of [...priority, ...textLines]) {
    const d = parseDate(line.text);
    if (d) return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF text extraction — group items into lines by Y coordinate
// ─────────────────────────────────────────────────────────────────────────────
export function groupIntoLines(items) {
  const bucket = LAYOUT.lineBucket;
  const map = new Map();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const rawY = item.transform[5];
    const y = Math.round(rawY / bucket) * bucket;
    if (!map.has(y)) map.set(y, []);
    map.get(y).push({ x: item.transform[4], y: rawY, w: item.width ?? 0, text: item.str.trim() });
  }
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([bucketY, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { bucketY, items: sorted, text: sorted.map(i => i.text).join('  ') };
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Column map detection — finds header row, records X positions
// ─────────────────────────────────────────────────────────────────────────────
function detectColMap(line) {
  const colMap = {};
  for (const item of line.items) {
    for (const [col, re] of Object.entries(COL_PATTERNS)) {
      if (!colMap[col] && re.test(item.text)) { colMap[col] = item.x; break; }
    }
  }
  // test and value are mandatory; reference is optional (some pages use TEST NAME | TECHNOLOGY | VALUE | UNITS)
  if (colMap.test === undefined || colMap.value === undefined) return null;
  // test must be the leftmost column (x = 0 or smallest among all detected)
  const allX = Object.values(colMap);
  if (colMap.test !== Math.min(...allX)) return null;
  return colMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact normalisation — strip everything except A-Z 0-9, normalise AE→E
// ─────────────────────────────────────────────────────────────────────────────
function compactNorm(text) {
  return text.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

// A keyword this short (e.g. "LH", "PT", "ALT") is a substring-collision
// magnet: compactNorm() strips spaces/punctuation before matching, so
// "medical history" silently becomes "MEDICALHISTORY" — which contains
// "LH" at the seam between the two words, even though neither word has
// anything to do with Luteinizing Hormone. Below this length, require the
// keyword to be a whole token on its own (see SHORT_KEYWORD_MAX_LEN below)
// rather than a raw substring of the fully-merged line.
const SHORT_KEYWORD_MAX_LEN = 3;

// Same word-splitting rule generate-wordmap.js uses to derive keywords from
// marker names — kept in sync so a compound abbreviation like "SGPT/ALT"
// still tokenizes into two separate words ("SGPT", "ALT") rather than
// fusing into one, which would defeat exact-match for short keywords.
function tokenize(text) {
  return text.split(/[\s/(),-]+/).map(compactNorm).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker matching — keyword fingerprint on compact line text
// Returns { canonical, candidates } or null
// ─────────────────────────────────────────────────────────────────────────────
export function matchLine(lineText) {
  const compact = compactNorm(lineText);
  if (!compact) return null;
  const tokens = new Set(tokenize(lineText));
  const scores = {};  // canonical → hit count
  for (const [kw, canonicals] of KEYWORD_ENTRIES) {
    const hit = kw.length <= SHORT_KEYWORD_MAX_LEN ? tokens.has(kw) : compact.includes(kw);
    if (!hit) continue;
    for (const c of canonicals) scores[c] = (scores[c] ?? 0) + 1;
  }
  const entries = Object.entries(scores);
  if (!entries.length) return null;
  const maxScore = Math.max(...entries.map(([, s]) => s));
  const winners = entries.filter(([, s]) => s === maxScore).map(([c]) => c);
  if (winners.length === 1) return { canonical: winners[0], candidates: winners };
  return { canonical: null, candidates: winners };
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit-based disambiguation — some markers share a keyword-ambiguous name
// fragment but are measured on completely different scales (blood Albumin in
// g/dL vs Urinary Microalbumin in μg/mL) — VALUE_LIMITS/REF_RANGE_HINTS alone
// can't separate them, since the same headline number is plausible either
// way. The unit's *shape* reliably can: mass-prefix over a volume
// denominator is a concentration (g/dL, mg/dL, μg/mL, ...), mass-prefix over
// a mass denominator is a ratio (μg/mg, mg/g, ...), and no unit at all is
// its own distinct category. This is deliberately pattern-based rather than
// exact-string matching against an expected unit, so it tolerates minor
// spelling differences between labs (gm/dL vs g/dL, mcg vs μg vs ug, a
// trailing " of Creatinine", etc.) instead of needing every variant
// anticipated in advance. Only used where we've actually seen this class of
// conflict (currently the Albumin family) — see disambiguate() below.
// ─────────────────────────────────────────────────────────────────────────────
const MASS_PREFIX_TO_MICROGRAMS = { NG: 0.001, MCG: 1, UG: 1, ΜG: 1, MG: 1000, GM: 1_000_000, G: 1_000_000 };
const VOLUME_TO_ML = { ML: 1, DL: 100, L: 1000 };
const MASS_PREFIX_ALT = 'NG|MCG|UG|ΜG|MG|GM|G';
// Molar-prefixed units (mmol/L, umol/L, ...) are a real concentration too,
// just not one convertible to a mass-based magnitude without knowing the
// substance's molar mass (which varies per marker — see MARKER_UNITS
// instead for that). Recognizing the *type* alone, with no comparable
// microgramsPerML, is still enough to correctly rule out unitless
// candidates (e.g. a "*Ratio" marker) below — that's the only thing this
// was silently failing to do before, since a report that prints every value
// in SI/molar units never matched the mass-only regex and always sent
// disambiguateByUnit home empty-handed.
const MOLAR_PREFIX_ALT = 'NMOL|UMOL|ΜMOL|MMOL|MOL';

function parseUnitDimension(unitStr) {
  if (!unitStr || !unitStr.trim()) return { type: 'unitless' };
  const u = unitStr.trim().toUpperCase();
  let m = u.match(new RegExp(`^(${MASS_PREFIX_ALT})\\/(ML|DL|L)(?=\\s|$)`));
  if (m) return { type: 'concentration', microgramsPerML: MASS_PREFIX_TO_MICROGRAMS[m[1]] / VOLUME_TO_ML[m[2]] };
  m = u.match(new RegExp(`^(${MOLAR_PREFIX_ALT})\\/(ML|DL|L)(?=\\s|$)`));
  if (m) return { type: 'concentration', microgramsPerML: null };
  m = u.match(new RegExp(`^(${MASS_PREFIX_ALT})\\/(${MASS_PREFIX_ALT})(?=\\s|$)`));
  if (m) return { type: 'ratio' };
  return null; // unrecognized shape — not used for disambiguation
}

// Pulls the trailing unit text off a refRanges string, e.g. "3.2-4.8 g/dL" -> "g/dL",
// "< 25 ug/mL" -> "ug/mL", "0.9-2" -> "" (no unit).
function extractRefRangeUnit(refRangeStr) {
  if (!refRangeStr) return '';
  const m = refRangeStr.match(/([a-zA-Zμ%][a-zA-Zμ%/\s]*)$/);
  return m ? m[1].trim() : '';
}

// Narrows candidates to just the ones whose own expected unit (from
// REF_RANGES) has the same *dimension type* as what was actually captured
// on the line — the coarse, always-safe half of unit-based disambiguation.
// A captured concentration unit (mass- or molar-prefixed) rules out any
// candidate that's unitless (e.g. a bare "*Ratio" marker, which prints no
// unit at all) regardless of whether we can compare magnitudes. Used as a
// pre-filter ahead of ref-range overlap scoring, which has no other way to
// tell a genuine concentration marker apart from an unrelated ratio that
// happens to share a keyword — an unscoped overlap comparison between an
// open-ended ratio threshold and a concentration marker's real range is
// meaningless, not just imprecise. Returns `candidates` unchanged when the
// captured unit's shape isn't recognized at all (nothing to narrow by).
function filterByUnitType(candidates, units) {
  const capturedDim = parseUnitDimension(units);
  if (!capturedDim) return candidates;
  const narrowed = candidates.filter(c => {
    const expectedDim = parseUnitDimension(extractRefRangeUnit(REF_RANGES[c]));
    return expectedDim && expectedDim.type === capturedDim.type;
  });
  return narrowed.length ? narrowed : candidates;
}

// Narrows candidates by comparing the captured unit's normalized magnitude
// against each candidate's own expected unit/range, derived from
// REF_RANGES. Returns a single canonical if exactly one candidate's
// magnitude is consistent with what was actually captured; otherwise null.
// Only meaningful between two mass-based concentration units — a molar unit
// has no comparable magnitude without knowing the substance's molar mass,
// so it's filterByUnitType's job (type only) to narrow those, not this.
function disambiguateByUnit(candidates, value, units) {
  const capturedDim = parseUnitDimension(units);
  if (!capturedDim || value === null || capturedDim.type !== 'concentration' || capturedDim.microgramsPerML === null) return null;
  const matches = candidates.filter(c => {
    const expectedDim = parseUnitDimension(extractRefRangeUnit(REF_RANGES[c]));
    if (!expectedDim || expectedDim.type !== 'concentration' || expectedDim.microgramsPerML === null) return false;
    const lim = VALUE_LIMITS[c];
    if (!lim) return true;
    const normalizedValue = value * capturedDim.microgramsPerML;
    return normalizedValue >= lim[0] * expectedDim.microgramsPerML && normalizedValue <= lim[1] * expectedDim.microgramsPerML;
  });
  return matches.length === 1 ? matches[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Disambiguation — pick best canonical from candidates using PDF ref range
// ─────────────────────────────────────────────────────────────────────────────
export function disambiguate(candidates, ref, value = null, units = '') {
  // units === '' is itself meaningful (a genuinely unitless marker, e.g. a
  // ratio) — don't skip unit-based disambiguation just because the string
  // is empty, only when we have no value to evaluate it against at all.
  if (candidates.length > 1 && value !== null) {
    const byUnit = disambiguateByUnit(candidates, value, units);
    if (byUnit) return byUnit;
  }
  // Narrow by unit dimension type before scoring ref-range overlap below —
  // a captured concentration unit (mass- or molar-based) can never
  // plausibly belong to an unrelated unitless "*Ratio" marker that only
  // happens to share a keyword, regardless of how well its printed range
  // numerically overlaps. Do this even when disambiguateByUnit above
  // couldn't pick a single winner (e.g. two same-family concentration
  // candidates) — it still rules out anything with the wrong dimension.
  if (candidates.length > 1 && units) {
    candidates = filterByUnitType(candidates, units);
    if (candidates.length === 1) return candidates[0];
  }
  // Primary: use ref range printed on the PDF line (overlap scoring)
  if (ref) {
    let refLo, refHi;
    const rm = ref.match(/(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
    if (rm) { refLo = +rm[1]; refHi = +rm[2]; }
    const lt = ref.match(/^[<≤]\s*(\d+\.?\d*)/);
    if (lt)  { refLo = 0; refHi = +lt[1]; }
    const gt = ref.match(/^[>≥]=?\s*(\d+\.?\d*)/);
    if (gt)  { refLo = +gt[1]; refHi = Infinity; }
    if (refLo !== undefined) {
      // Normalize the printed ref into each candidate's own default unit
      // before scoring overlap — comparing raw numbers across candidates
      // that use different units (Urea's mmol/L vs Blood Urea Nitrogen's
      // mg/dL, both sharing the "UREA" keyword) is meaningless otherwise.
      // A candidate whose own `units` table explicitly recognizes the
      // printed unit is categorically a stronger match than one merely
      // assuming the value is already in its default unit (markerUnitScale
      // returning null) — prefer any explicit match over any assumed one
      // before comparing overlap width within the same tier, or a
      // wide-but-wrong assumed-default candidate's range can trivially
      // swallow the raw, unconverted numbers and win regardless (confirmed:
      // this is exactly how Creatinine (Urine) — no known umol/L form —
      // used to steal Creatinine's own serum-result row).
      let best = null, bestScore = -1, bestExplicit = false;
      for (const c of candidates) {
        const h = REF_RANGE_HINTS[c];
        if (!h) continue;
        const explicitScale = markerUnitScale(c, units);
        const explicit = explicitScale !== null;
        const scale = explicitScale ?? 1;
        const nRefLo = refLo * scale;
        const nRefHi = refHi === Infinity ? Infinity : refHi * scale;
        const lo = Math.max(h.lo, nRefLo);
        const hi = Math.min(h.hi === Infinity ? nRefHi * 2 : h.hi, nRefHi === Infinity ? h.lo * 2 + 1 : nRefHi);
        if (lo > hi) continue;
        const score = hi - lo;
        if (explicit && !bestExplicit) { best = c; bestScore = score; bestExplicit = true; }
        else if (explicit === bestExplicit && score > bestScore) { best = c; bestScore = score; }
      }
      if (best) return best;
    }
  }
  // Fallback: use the extracted value against pre-defined reference range
  // hints, normalized per-candidate the same way as above.
  if (value !== null) {
    const normalized = c => value * (markerUnitScale(c, units) ?? 1);
    const hintMatches = candidates.filter(c => {
      const h = REF_RANGE_HINTS[c];
      if (!h) return false;
      const nValue = normalized(c);
      const hi = h.hi === Infinity ? nValue * 2 + 1 : h.hi;
      return nValue >= h.lo && nValue <= hi;
    });
    if (hintMatches.length === 1) return hintMatches[0];
    // Last resort: VALUE_LIMITS (broader physiological bounds)
    const limitMatches = candidates.filter(c => {
      const lim = VALUE_LIMITS[c];
      if (!lim) return false;
      const nValue = normalized(c);
      return nValue >= lim[0] && nValue <= lim[1];
    });
    if (limitMatches.length === 1) return limitMatches[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value and reference extraction
// ─────────────────────────────────────────────────────────────────────────────
const NUM_RE   = /^-?\d+\.?\d*$/;
// Some report generators emit a value and its unit as one combined PDF text
// item (e.g. "2.46 mcIU/mL") instead of two separate items — NUM_RE alone
// can't match that since it requires the *whole* string to be numeric. This
// extracts a leading number followed by trailing unit text as a fallback.
const NUM_WITH_TRAILING_RE = /^(-?\d+\.?\d*)\s+(\S.*)$/;
// Below/above-detection-limit ("censored") values are common for markers
// with a hard floor/ceiling — e.g. "< 5.5" for urine microalbumin. Treat the
// threshold itself as the value, same simplification RANGE_RE already makes
// for "< X"/"> X" *reference* ranges — not clinically exact, but a
// reasonable value for trend tracking rather than dropping the result.
const CENSORED_NUM_RE = /^[<>≤≥]\s*(-?\d+\.?\d*)$/;
const RANGE_RE = /^\d+\.?\d*\s*[-–]\s*\d+\.?\d*$|^[<>≤≥]=?\s*\d+\.?\d*$|^\d+:\d+\s*[-–]\s*\d+:\d+$/;

// Shared value-token parser, tried in this order regardless of layout
// (headed or headerless): a bare number, a number with trailing unit text
// glued on, or a censored ("< X") value. Used by every value-matching site
// below so headerless reports get the same tiered fallback headed ones do.
function parseValueToken(rawText) {
  const t = rawText.trim().replace(/,/g, '');
  if (NUM_RE.test(t)) return { value: parseFloat(t), units: null };
  // Only accept the trailing text as a unit if it's digit-free — a real unit
  // never contains one, whereas this same shape also matches the leading
  // day of an unrelated date/timestamp string (e.g. "27 Mar 2024, 01:29 PM"),
  // which headerless mode has no column position to filter out.
  const m = t.match(NUM_WITH_TRAILING_RE);
  if (m && !/\d/.test(m[2])) return { value: parseFloat(m[1]), units: m[2] };
  const cm = t.match(CENSORED_NUM_RE);
  if (cm) return { value: parseFloat(cm[1]), units: null };
  return null;
}

// A "lo-hi" range with a unit glued onto the same PDF item, e.g.
// "65-99 mg/dL" — RANGE_RE itself requires the whole item to be just the
// range (nothing after) since it's also used to keep ref-range-shaped items
// out of the units accumulator, where this shape never belongs regardless
// of what follows. This is a separate, narrower pattern just for accepting
// the token as a real printed ref range in the first place — downstream
// parsing (disambiguate()'s own ref-range regex) already tolerates trailing
// text fine, it just never got the chance to see it.
const RANGE_WITH_UNIT_RE = /^\d+\.?\d*\s*[-–]\s*\d+\.?\d*\s+\D/;

// A comparison operator alone (e.g. a stray "<" item, its number fragmented
// into a separate item — see reconstructRefRange) is NOT treated as a
// complete ref range here; it must be followed by a digit somewhere, or
// reconstruction never gets a chance to run since ref would already be set.
const isRefRangeToken = t => RANGE_RE.test(t) || /^[<>≤≥]=?\s*\d/.test(t) || RANGE_WITH_UNIT_RE.test(t);

// Reconstructs a reference range a report generator split across multiple
// adjacent PDF text items, when no single item matched isRefRangeToken on
// its own. Handles two shapes seen in the wild: two bare numbers meant to
// be the low/high bound ("150", "199" -> "150-199"), and a comparison
// operator separated from its number/parens ("(", "<", " 200)" -> "< 200").
function reconstructRefRange(items) {
  const cleaned = items.map(it => it.text.replace(/\x00/g, '').trim()).filter(Boolean);
  const nums = cleaned.filter(t => /^\d+\.?\d*$/.test(t));
  if (nums.length >= 2) return nums[0] + '-' + nums[1];
  const joined = cleaned.join(' ').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
  const m = joined.match(/^([<>≤≥]=?)\s*(\d+\.?\d*)$/);
  return m ? `${m[1]} ${m[2]}` : null;
}

// Scans a row's items for value/ref/units. When colMap has a position for
// value/reference/units, candidates are filtered to that column; otherwise
// (headerless layout) every item in the row is a candidate. This positional
// filtering is the only difference between headed and headerless layouts —
// the token parsing and ref-range reconstruction below is identical either way.
// Matches a unit printed as its own separate PDF text item next to (not
// glued onto) the number — "mmol/L", "ng/dL", "umol/L", "IU/mL". Requires a
// "/" so ordinary words (marker names, "Total", row labels) never qualify;
// only used as a fallback when there's no colMap.units to position-filter
// against, so it's restricted to items appearing after the value itself.
const UNIT_TOKEN_RE = /^[a-zA-Zμµ][a-zA-Zμµ%0-9]*\/[a-zA-Zμµ][a-zA-Zμµ0-9]*$/;

function scanRowForValueRefUnits(items, colMap) {
  const hasValueCol = !!colMap && colMap.value !== undefined;
  const hasRefCol = !!colMap && colMap.reference !== undefined;
  const hasUnitsCol = !!colMap && colMap.units !== undefined;
  const valCutoff = hasValueCol ? colMap.value - LAYOUT.nameValueCutoff : -Infinity;

  let value = null, ref = null, units = '', valueItemX = null;
  const refCandidates = [];
  for (const item of items) {
    const t = item.text.trim();
    const inValueCol = hasValueCol
      ? item.x >= valCutoff && Math.abs(item.x - colMap.value) < LAYOUT.valueColumnTolerance
      : true;
    if (value === null && inValueCol) {
      const parsed = parseValueToken(t);
      if (parsed) {
        value = parsed.value;
        valueItemX = item.x;
        if (!units && parsed.units) units = parsed.units;
      }
    }
    const inRefCol = hasRefCol ? Math.abs(item.x - colMap.reference) < LAYOUT.referenceColumnTolerance : true;
    if (inRefCol) {
      if (ref === null && isRefRangeToken(t)) ref = t;
      refCandidates.push(item);
    }
    // Units are sometimes split across multiple PDF text items in the same
    // column (e.g. "g", "/", "dL") — accumulate all of them, or a
    // multi-token unit like "g/dL" collapses to just "g" and
    // disambiguateByUnit silently fails to recognize the unit's shape. A
    // bare digit is normally excluded here (it's more likely a stray
    // reference-range fragment than part of the unit) — except right after
    // an accumulated "...10", where it's the superscript exponent of a
    // "×10ⁿ" cell-count unit rendered as its own text item (slightly
    // Y-offset from the base line, but still landing in the units column).
    if (hasUnitsCol && Math.abs(item.x - colMap.units) < LAYOUT.unitsColumnTolerance) {
      const isBareDigit = /^\d+\.?\d*$/.test(t);
      const isExponentDigit = isBareDigit && /10$/.test(units);
      if (t && (!isBareDigit || isExponentDigit) && !RANGE_RE.test(t)) units += t;
    }
  }
  // No units column to anchor to (headerless mode, or a page whose header
  // never got detected) — fall back to the first unit-shaped item printed
  // after the value itself, e.g. "4.86 | mmol/L | (< 5.20)".
  if (!hasUnitsCol && !units && valueItemX !== null) {
    const after = items.filter(it => it.x > valueItemX).sort((a, b) => a.x - b.x);
    for (let i = 0; i < after.length; i++) {
      const t = after[i].text.trim();
      if (UNIT_TOKEN_RE.test(t)) { units = t; break; }
      // Same "×10ⁿ" reconstruction as the colMap.units path above, for rows
      // that never got a colMap at all — "x10" | "9" | "/L" as three
      // separate items with no single one matching UNIT_TOKEN_RE alone.
      if (/^x10\^?$/i.test(t) && after[i + 1]) {
        let combined = t, j = i + 1;
        if (/^\d$/.test(after[j].text.trim())) { combined += after[j].text.trim(); j++; }
        if (after[j] && /^\/[a-zA-Zμµ]+$/.test(after[j].text.trim())) {
          units = combined + after[j].text.trim();
          break;
        }
      }
    }
  }
  if (ref === null) ref = reconstructRefRange(refCandidates);
  return { value, ref, units };
}

// Items left of the value column — i.e. the marker-name portion of a row —
// or the whole row unfiltered in headerless mode (no value column to anchor
// to). Shared by every site that needs "just the name text" from a row:
// tryExtractLine's own line, and lookAheadValue/peekNextValue checking
// whether the *next* row is itself a marker name before wandering past it.
function nameItemsOf(items, colMap) {
  return colMap?.value !== undefined
    ? items.filter(it => it.x < colMap.value - LAYOUT.nameValueCutoff)
    : items;
}

function extractValueAndRef(lineItems, alias, colMap) {
  // When alias is provided, find where the marker name ends so we skip name tokens
  let markerEndX = 0;
  if (alias) {
    let accumulated = '';
    for (const item of lineItems) {
      accumulated += (accumulated ? '  ' : '') + item.text;
      if (accumulated.replace(/\s+/g, ' ').toUpperCase().includes(alias)) {
        markerEndX = item.x + item.w;
        break;
      }
    }
  }
  const after = lineItems.filter(i => i.x >= markerEndX - LAYOUT.markerEndTolerance);
  return scanRowForValueRefUnits(after, colMap);
}

// ─────────────────────────────────────────────────────────────────────────────
// Look-ahead value — scan next 1-2 lines for a value in VALUE_LIMITS range
// Only stops early if the next line is an *unextracted* marker
// ─────────────────────────────────────────────────────────────────────────────
function lookAheadValue(allLines, i, canonical, colMap, extracted) {
  for (let j = i + 1; j <= Math.min(i + LAYOUT.lookAheadLines, allLines.length - 1); j++) {
    const next = allLines[j];
    if (next.pageBreak) break;
    let { value, ref, units } = scanRowForValueRefUnits(next.items, colMap);
    // `value`/`ref` returned below stay in the marker's NATIVE unit (only
    // ×10ⁿ notation-normalized) — `canonicalValue`, additionally scaled
    // into the marker's fixed default unit, exists only for the
    // plausibility check here, same native/canonical split as tryExtractLine.
    const notationScale = unitScale(units);
    const nativeValue = value !== null ? value * notationScale : null;
    const nativeRef = notationScale !== 1 ? scaleRef(ref, notationScale) : ref;
    const mScale = markerUnitScale(canonical, units) ?? 1;
    const canonicalValue = nativeValue !== null && mScale !== 1 ? nativeValue * mScale : nativeValue;
    if (canonicalValue !== null && inValueRange(canonical, canonicalValue)) {
      return { value: nativeValue, ref: nativeRef, units };
    }
    // Stop if next line matches an unextracted marker
    const nm = matchLine(nameItemsOf(next.items, colMap).map(it => it.text).join(' '));
    if (nm) {
      const nc = nm.canonical ?? disambiguate(nm.candidates, null);
      if (nc && !extracted[nc]) break;
    }
  }
  return { value: null, ref: null, units: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Speculative peek — scan next 1-2 lines for value+ref without canonical constraint
// Used when the marker name line has no value (Orange two-line structure)
// ─────────────────────────────────────────────────────────────────────────────
function peekNextValue(allLines, i, colMap) {
  for (let j = i + 1; j <= Math.min(i + LAYOUT.lookAheadLines, allLines.length - 1); j++) {
    const next = allLines[j];
    if (next.pageBreak) break;
    const { value, ref, units } = scanRowForValueRefUnits(next.items, colMap);
    if (value !== null) return { value, ref, units };
    // Stop if this line is a marker name — don't skip over it to grab its value
    const pkm = matchLine(nameItemsOf(next.items, colMap).map(it => it.text).join(' '));
    if (pkm) break;
  }
  return { value: null, ref: null, units: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lines to skip
// ─────────────────────────────────────────────────────────────────────────────
const shouldSkip = t => SKIP_RE.some(re => re.test(t.trim()));

// ─────────────────────────────────────────────────────────────────────────────
// Out-of-range parser
// ─────────────────────────────────────────────────────────────────────────────
export function parseRefRange(refStr) {
  if (!refStr) return null;
  const s = refStr.trim();
  let m = s.match(/^([\d.]+)\s*[-–]\s*([\d.]+)/);
  if (m) return { low: parseFloat(m[1]), high: parseFloat(m[2]) };
  m = s.match(/^[<≤]=?\s*([\d.]+)/);
  if (m) return { low: null, high: parseFloat(m[1]) };
  m = s.match(/^[>≥]=?\s*([\d.]+)/);
  if (m) return { low: parseFloat(m[1]), high: null };
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a single PDF. `pdfjsLib` is injected by the caller (CDN global on the
// web, bundled import on mobile) so this file makes no assumption about how
// PDF.js is loaded. Never blocks on a date-entry prompt — if no date can be
// detected, `date` comes back null and the caller's UI layer asks the user.
// `password` is optional; if the PDF needs one and none (or a wrong one) was
// given, pdf.js rejects with a PasswordException (err.name === 'PasswordException')
// — the caller's UI layer is expected to catch that specifically, prompt for
// a password, and retry with a freshly-decoded arrayBuffer (pdf.js transfers/
// detaches the one it's given to its worker, even on a failed attempt).
// ─────────────────────────────────────────────────────────────────────────────
export async function parsePDF(arrayBuffer, pdfjsLib, password) {
  assertConfigured();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;
  const allLines = [];
  let scanned = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    if (content.items.length < LAYOUT.minItemsPerPage) { scanned++; continue; }
    allLines.push({ pageBreak: true });
    allLines.push(...groupIntoLines(content.items));
  }

  if (scanned === pdf.numPages) {
    throw new Error('This PDF appears to be a scanned image — text extraction is not possible.');
  }

  const dateResult = extractDate(allLines.slice(0, 50));

  const extracted = {};

  // Column-anchored (headed) extraction can fail a line for reasons no
  // page-level flag can capture: no header seen yet on this page (index/TOC
  // pages, or a page whose header uses wording detectColMap doesn't
  // recognize), or — the case that motivated retrying per LINE rather than
  // per page — a colMap that's valid for one section of a page but stale
  // for a later section with a different column layout (seen in reports
  // that switch between a single-value table and a dual SI/conventional-
  // unit table within the same page, only one of which the last-seen colMap
  // actually matches). Track failures at line granularity instead: any line
  // that doesn't yield a new extraction under the headed pass — whether
  // because there's no colMap yet or the current one just doesn't fit this
  // row — becomes a candidate for headerless retry (matching marker
  // keywords directly against the line's own text and scanning linearly for
  // a value, no column position needed; extractValueAndRef/lookAheadValue/
  // peekNextValue already fall back to exactly that when colMap is
  // undefined).
  //
  // Two full passes, not one interleaved pass: headerless matching is far
  // more collision-prone (no column position to filter candidates), so a
  // retry candidate appearing BEFORE the line with the real, column-
  // anchored value must never be allowed to grab a marker first and lock
  // out the correct value — tryExtractLine skips a marker once `extracted`
  // already has it. Running the headed pass across the whole document to
  // completion first, then only retrying lines that came up empty,
  // guarantees real headed data always wins regardless of line order.
  const retryLines = [];
  let colMap = null;
  // Canonicals whose name matched somewhere in the document but that never
  // got a plausible value on ANY line — tracked separately from `extracted`
  // (not written into it) so a later line that DOES find a real value for
  // the same canonical still wins normally; only canonicals that end the
  // whole parse still absent from `extracted` are truly "matched, no value".
  const unvalued = new Set();
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (line.pageBreak) { colMap = null; continue; }
    if (shouldSkip(line.text)) continue;
    const newMap = detectColMap(line);
    if (newMap) colMap = newMap; // don't `continue` — the header line may also contain data (Thyrocare Hemoglobin)
    const before = Object.keys(extracted).length;
    if (colMap) tryExtractLine(line, i, allLines, colMap, extracted, unvalued);
    if (Object.keys(extracted).length === before) retryLines.push(i);
  }
  for (const i of retryLines) {
    const line = allLines[i];
    tryExtractLine(line, i, allLines, undefined, extracted, unvalued);
  }

  return {
    date: dateResult?.date ?? null,
    dateAmbiguous: dateResult?.ambiguous ?? false,
    dateAlternate: dateResult?.alternate ?? null,
    extracted,
    unvaluedCanonicals: [...unvalued].filter(c => !extracted[c]),
  };
}

// Attempts to extract one marker from a single line, mutating `extracted`
// (and `unvalued`, for matched-but-valueless canonicals) in place. `colMap`
// may be undefined (headerless mode).
function tryExtractLine(line, i, allLines, colMap, extracted, unvalued) {
  // Match keywords only against name-column items (left of value column)
  const nameItems = nameItemsOf(line.items, colMap);
  if (!nameItems.length) return;
  const nameText = nameItems.map(it => it.text).join('  ');

  const lm = matchLine(nameText);
  if (!lm) return;

  // `value`/`ref`/`units` below stay in the marker's NATIVE unit (as
  // printed, only ×10ⁿ notation-normalized) throughout this function — this
  // is what ultimately gets returned/stored. `canonicalValue`, additionally
  // converted into the marker's fixed default unit via markerUnitScale,
  // exists ONLY for the plausibility check and disambiguation below —
  // VALUE_LIMITS/REF_RANGES are defined in that default unit, so a value
  // still in an alternate as-printed unit (e.g. T3 as "97.33 ng/dL") looks
  // physiologically implausible against limits meant for a different unit
  // and would otherwise be wrongly discarded.
  let { value, ref, units } = extractValueAndRef(line.items, '', colMap);
  const scale = unitScale(units);
  if (value !== null) value = value * scale;
  if (scale !== 1) ref = scaleRef(ref, scale);
  let canonical = lm.canonical ?? disambiguate(lm.candidates, ref, value, units);

  let mScale = canonical ? (markerUnitScale(canonical, units) ?? 1) : 1;
  let canonicalValue = value !== null && mScale !== 1 ? value * mScale : value;

  // Speculative peek: name-only lines (Orange two-line structure) have no value yet —
  // look at the next line to get a value/ref so we can disambiguate.
  // Only peek when current line has no value — otherwise we'd grab the next marker's data.
  if (!canonical && lm.candidates.length > 0 && value === null) {
    const la = peekNextValue(allLines, i, colMap);
    if (la.value !== null) {
      canonical = disambiguate(lm.candidates, la.ref, la.value, la.units);
      if (canonical) {
        value = la.value; ref = la.ref; units = la.units;
        mScale = markerUnitScale(canonical, units) ?? 1;
        canonicalValue = mScale !== 1 ? value * mScale : value;
      }
    }
  }

  if (!canonical || extracted[canonical]) return;

  // Look ahead if value is still missing or out of physiological range
  if (canonicalValue === null || !inValueRange(canonical, canonicalValue)) {
    const la = lookAheadValue(allLines, i, canonical, colMap, extracted);
    value = la.value; ref = la.ref; units = la.units;
    mScale = value !== null ? (markerUnitScale(canonical, units) ?? 1) : 1;
    canonicalValue = value !== null && mScale !== 1 ? value * mScale : value;
  }

  if (canonicalValue === null || !inValueRange(canonical, canonicalValue)) {
    unvalued.add(canonical);
    return;
  }

  // matchedUnitLabel() only cleans units for markers with a configured
  // alternate-units list; a marker with just one implicit default unit has
  // no such list to match against, so the raw scanned text (which can still
  // carry a reference range glued onto the same PDF item, e.g.
  // "ug/L(4.0 - 15.2)") falls through unchanged. Strip anything from the
  // first non-unit character onward as a general fallback — units never
  // legitimately contain "(", "<", ">", or a digit-space-digit range.
  const rawUnit = matchedUnitLabel(canonical, units) || units || MARKER_UNITS[canonical]?.find(u => u.default)?.unit || '';
  const unit = rawUnit.replace(/[(<>].*$/, '').trim();
  extracted[canonical] = { value, unit, ref: ref ?? refRangeForUnit(canonical, unit) ?? '' };
}
