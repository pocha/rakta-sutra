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

function inValueRange(canonical, v) {
  const lim = VALUE_LIMITS[canonical];
  if (!lim) return true;
  return v >= lim[0] && v <= lim[1];
}

function unitScale(units) {
  if (!units) return 1;
  const u = units.replace(/\s/g, '');
  if (/10[⁶6]/.test(u)) return 1_000_000;
  if (/10[³3]/.test(u) || /10\^3/.test(u)) return 1000;
  return 1;
}

// Per-marker unit conversion — distinct from unitScale() above, which only
// handles the generic "10^3"/"10^6" cell-count multiplier notation shared
// across cell-count markers. This instead converts a value printed in an
// alternate unit (e.g. T3 as "ng/dL" when our default/tracked unit is
// "ng/mL") into the marker's default unit, so VALUE_LIMITS plausibility
// checks — and everything stored/displayed — are always in that one unit.
// A marker with no config.units entry (the common case) is unaffected.
function markerUnitScale(canonical, unitsText) {
  if (!unitsText || !canonical) return 1;
  const list = MARKER_UNITS[canonical];
  if (!list) return 1;
  const u = unitsText.toLowerCase();
  for (const { unit, scale } of list) {
    if (u.includes(unit.toLowerCase())) return scale;
  }
  return 1;
}

function scaleRef(ref, scale) {
  if (!ref || scale === 1) return ref;
  // Scale a "lo-hi" range string: "150-410" → "150000-410000"
  return ref.replace(/(\d+\.?\d*)/g, n => String(parseFloat(n) * scale));
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
function groupIntoLines(items) {
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

function parseUnitDimension(unitStr) {
  if (!unitStr || !unitStr.trim()) return { type: 'unitless' };
  const u = unitStr.trim().toUpperCase();
  let m = u.match(new RegExp(`^(${MASS_PREFIX_ALT})\\/(ML|DL|L)(?=\\s|$)`));
  if (m) return { type: 'concentration', microgramsPerML: MASS_PREFIX_TO_MICROGRAMS[m[1]] / VOLUME_TO_ML[m[2]] };
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

// Narrows candidates by comparing the captured unit's dimension (and, for
// concentration-type units, its normalized magnitude) against each
// candidate's own expected unit, derived from REF_RANGES. Returns a single
// canonical if exactly one candidate's dimension (and magnitude, where
// applicable) is consistent with what was actually captured; otherwise null.
function disambiguateByUnit(candidates, value, units) {
  const capturedDim = parseUnitDimension(units);
  if (!capturedDim || value === null) return null;
  const matches = candidates.filter(c => {
    const expectedDim = parseUnitDimension(extractRefRangeUnit(REF_RANGES[c]));
    if (!expectedDim || expectedDim.type !== capturedDim.type) return false;
    if (expectedDim.type !== 'concentration') return true;
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
      let best = null, bestScore = -1;
      for (const c of candidates) {
        const h = REF_RANGE_HINTS[c];
        if (!h) continue;
        const lo = Math.max(h.lo, refLo);
        const hi = Math.min(h.hi === Infinity ? refHi * 2 : h.hi, refHi === Infinity ? h.lo * 2 + 1 : refHi);
        if (lo <= hi && (hi - lo) > bestScore) { bestScore = hi - lo; best = c; }
      }
      if (best) return best;
    }
  }
  // Fallback: use the extracted value against pre-defined reference range hints
  if (value !== null) {
    const hintMatches = candidates.filter(c => {
      const h = REF_RANGE_HINTS[c];
      if (!h) return false;
      const hi = h.hi === Infinity ? value * 2 + 1 : h.hi;
      return value >= h.lo && value <= hi;
    });
    if (hintMatches.length === 1) return hintMatches[0];
    // Last resort: VALUE_LIMITS (broader physiological bounds)
    const limitMatches = candidates.filter(c => {
      const lim = VALUE_LIMITS[c];
      return lim && value >= lim[0] && value <= lim[1];
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

// A comparison operator alone (e.g. a stray "<" item, its number fragmented
// into a separate item — see reconstructRefRange) is NOT treated as a
// complete ref range here; it must be followed by a digit somewhere, or
// reconstruction never gets a chance to run since ref would already be set.
const isRefRangeToken = t => RANGE_RE.test(t) || /^[<>≤≥]=?\s*\d/.test(t);

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
function scanRowForValueRefUnits(items, colMap) {
  const hasValueCol = !!colMap && colMap.value !== undefined;
  const hasRefCol = !!colMap && colMap.reference !== undefined;
  const hasUnitsCol = !!colMap && colMap.units !== undefined;
  const valCutoff = hasValueCol ? colMap.value - LAYOUT.nameValueCutoff : -Infinity;

  let value = null, ref = null, units = '';
  const refCandidates = [];
  for (const item of items) {
    const t = item.text.trim();
    const inValueCol = hasValueCol
      ? item.x >= valCutoff && Math.abs(item.x - colMap.value) < LAYOUT.valueColumnTolerance
      : true;
    if (value === null && inValueCol) {
      const parsed = parseValueToken(t);
      if (parsed) { value = parsed.value; if (!units && parsed.units) units = parsed.units; }
    }
    const inRefCol = hasRefCol ? Math.abs(item.x - colMap.reference) < LAYOUT.referenceColumnTolerance : true;
    if (inRefCol) {
      if (ref === null && isRefRangeToken(t)) ref = t;
      refCandidates.push(item);
    }
    // Units are sometimes split across multiple PDF text items in the same
    // column (e.g. "g", "/", "dL") — accumulate all of them, or a
    // multi-token unit like "g/dL" collapses to just "g" and
    // disambiguateByUnit silently fails to recognize the unit's shape.
    if (hasUnitsCol && Math.abs(item.x - colMap.units) < LAYOUT.unitsColumnTolerance) {
      if (t && !/^\d+\.?\d*$/.test(t) && !RANGE_RE.test(t)) units += t;
    }
  }
  if (ref === null) ref = reconstructRefRange(refCandidates);
  return { value, ref, units };
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
    const laScale = unitScale(units) * markerUnitScale(canonical, units);
    if (value !== null) value = value * laScale;
    if (value !== null && inValueRange(canonical, value)) return { value, ref: scaleRef(ref, laScale) };
    // Stop if next line matches an unextracted marker
    const nameItems = colMap?.value !== undefined
      ? next.items.filter(it => it.x < colMap.value - LAYOUT.nameValueCutoff)
      : next.items;
    const nm = matchLine(nameItems.map(it => it.text).join(' '));
    if (nm) {
      const nc = nm.canonical ?? disambiguate(nm.candidates, null);
      if (nc && !extracted[nc]) break;
    }
  }
  return { value: null, ref: null };
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
    const pkNameItems = colMap?.value !== undefined
      ? next.items.filter(it => it.x < colMap.value - LAYOUT.nameValueCutoff)
      : next.items;
    const pkm = matchLine(pkNameItems.map(it => it.text).join(' '));
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

  // A single document-wide "did we ever see a header" flag is too coarse:
  // one lucky/accidental colMap match anywhere in the document (e.g. a
  // section title that happens to satisfy COL_PATTERNS.test) suppresses the
  // headerless fallback for every OTHER page too, even ones that never got
  // their own colMap and so extracted nothing at all. Decide per page
  // instead — a page falls back to headerless extraction only if it never
  // found its own colMap at all (not merely "found zero new markers" —
  // that's also true of a legitimate repeat/summary page reprinting markers
  // already extracted elsewhere, which must NOT be re-scanned headerlessly).
  //
  // Some report formats never print a detectable column header at all — no
  // "Test"/"Investigation"/"Parameter" label above the marker-name column,
  // just the values sitting there implicitly (e.g. innoquest.pdf). Headerless
  // fallback matches marker keywords directly against each line's own text
  // and scans linearly for a value/range on that line (or the next couple,
  // via the same lookahead used above) instead of anchoring on column
  // x-position — extractValueAndRef/lookAheadValue/peekNextValue already
  // fall back to exactly that when colMap is undefined.
  //
  // Two full passes, not one interleaved pass: headerless matching is far
  // more collision-prone (no column position to filter candidates), so a
  // headerless-eligible page appearing BEFORE a page with a real header
  // must never be allowed to grab a marker first and lock out the correct,
  // column-anchored value that a later page would otherwise have found —
  // tryExtractLine skips a marker once `extracted` already has it. Running
  // every page's headed pass to completion first, then only falling back
  // to headerless on pages that never found their own colMap, guarantees
  // real headed data always wins regardless of page order.
  const headerlessPages = [];
  let pageStart = null;
  for (let i = 0; i <= allLines.length; i++) {
    const isBreak = i === allLines.length || allLines[i].pageBreak;
    if (!isBreak) continue;
    if (pageStart !== null) {
      let colMap = null;
      let foundColMap = false;
      for (let j = pageStart; j < i; j++) {
        const line = allLines[j];
        if (shouldSkip(line.text)) continue;
        const newMap = detectColMap(line);
        if (newMap) {
          colMap = newMap;
          foundColMap = true;
          // Don't continue — the header line may also contain data (Thyrocare Hemoglobin)
        }
        // Only extract after we've found a header row — skips index/TOC pages
        if (!colMap) continue;
        tryExtractLine(line, j, allLines, colMap, extracted);
      }
      if (!foundColMap) headerlessPages.push([pageStart, i]);
    }
    pageStart = i + 1;
  }
  for (const [start, end] of headerlessPages) {
    for (let i = start; i < end; i++) {
      const line = allLines[i];
      if (shouldSkip(line.text)) continue;
      tryExtractLine(line, i, allLines, undefined, extracted);
    }
  }

  return {
    date: dateResult?.date ?? null,
    dateAmbiguous: dateResult?.ambiguous ?? false,
    dateAlternate: dateResult?.alternate ?? null,
    extracted,
  };
}

// Attempts to extract one marker from a single line, mutating `extracted`
// in place. `colMap` may be undefined (headerless mode).
function tryExtractLine(line, i, allLines, colMap, extracted) {
  // Match keywords only against name-column items (left of value column)
  const nameItems = colMap?.value !== undefined
    ? line.items.filter(it => it.x < colMap.value - LAYOUT.nameValueCutoff)
    : line.items;
  if (!nameItems.length) return;
  const nameText = nameItems.map(it => it.text).join('  ');

  const lm = matchLine(nameText);
  if (!lm) return;

  // Extract value+ref+units from the current line
  let { value, ref, units } = extractValueAndRef(line.items, '', colMap);
  const scale = unitScale(units);
  if (value !== null) value = value * scale;
  if (scale !== 1) ref = scaleRef(ref, scale);
  let canonical = lm.canonical ?? disambiguate(lm.candidates, ref, value, units);

  // Normalize into the marker's default unit BEFORE the plausibility check
  // below — a value still in its as-printed alternate unit (e.g. T3 as
  // "97.33 ng/dL") looks physiologically implausible against limits meant
  // for the default unit and would otherwise be discarded or trigger a
  // lookAheadValue search that wanders into an unrelated line's value.
  if (canonical) {
    const mScale = markerUnitScale(canonical, units);
    if (mScale !== 1 && value !== null) { value = value * mScale; ref = scaleRef(ref, mScale); }
  }

  // Speculative peek: name-only lines (Orange two-line structure) have no value yet —
  // look at the next line to get a value/ref so we can disambiguate.
  // Only peek when current line has no value — otherwise we'd grab the next marker's data.
  if (!canonical && lm.candidates.length > 0 && value === null) {
    const la = peekNextValue(allLines, i, colMap);
    if (la.value !== null) {
      canonical = disambiguate(lm.candidates, la.ref, la.value, la.units);
      if (canonical) { value = la.value; ref = la.ref; }
    }
  }

  if (!canonical || extracted[canonical]) return;

  // Look ahead if value is still missing or out of physiological range
  if (value === null || !inValueRange(canonical, value)) {
    ({ value, ref } = lookAheadValue(allLines, i, canonical, colMap, extracted));
  }

  if (value === null || !inValueRange(canonical, value)) return;

  extracted[canonical] = { value, ref: ref ?? REF_RANGES[canonical] ?? '' };
}
