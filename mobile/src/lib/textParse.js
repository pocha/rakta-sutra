// ─────────────────────────────────────────────────────────────────────────────
// Rule-based free-text understanding for Journal & Reminder entries.
// No network call, no model — chrono-node for dates/times/recurrence and the
// parser's own KEYWORD_MAP for marker recognition. Fully offline.
// ─────────────────────────────────────────────────────────────────────────────
import * as chrono from 'chrono-node';
import { KEYWORD_MAP, REF_RANGES } from './parser.js';

const CANONICALS = Object.keys(REF_RANGES);

function compactNorm(text) {
  return text.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

const KEYWORD_ENTRIES = Object.entries(KEYWORD_MAP).sort(([a], [b]) => b.length - a.length);
const CANONICAL_COMPACT = CANONICALS.map(c => [c, compactNorm(c)]);

// ─────────────────────────────────────────────────────────────────────────────
// Marker recognition in free text — unlike matchLine() (which picks one
// winner for a tabular PDF row), journal text has no value/ref to disambiguate
// with, so ambiguous keywords are indexed against every candidate. Better
// recall for search than a wrong single guess.
// ─────────────────────────────────────────────────────────────────────────────
export function extractMarkersFromText(text) {
  const compact = compactNorm(text);
  if (!compact) return [];
  const found = new Set();

  // Direct canonical-name match first (e.g. "Vitamin D", "HbA1c") — unambiguous.
  for (const [canonical, compactName] of CANONICAL_COMPACT) {
    if (compact.includes(compactName)) found.add(canonical);
  }

  // Keyword fingerprint fallback for abbreviations/nouns not equal to the full name.
  for (const [kw, canonicals] of KEYWORD_ENTRIES) {
    if (compact.includes(kw)) for (const c of canonicals) found.add(c);
  }

  return [...found];
}

// ─────────────────────────────────────────────────────────────────────────────
// Journal entry: date/time defaults to right now when nothing is mentioned —
// most notes don't reference a date/time at all.
// Uses the *strict* parser (not chrono.casual) deliberately: casual mode is
// tuned for short scheduling phrases and is prone to false positives on
// ordinary sentences (e.g. grabbing a stray number as a clock time), which
// would silently push the note to some other time. Strict mode still catches
// real mentions ("yesterday", "at 9am", "last Monday") but ignores everything
// else, so "took 2 tablets" doesn't get misread as "2 o'clock".
// ─────────────────────────────────────────────────────────────────────────────
export function parseJournalText(text, refDate = new Date()) {
  const results = chrono.parse(text, refDate, { forwardDate: false });
  const when = results.length ? results[0].start.date() : refDate;
  return { date: when.toISOString(), canonicals: extractMarkersFromText(text) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reminder: needs an actual future date/time. If chrono can't find one, return
// needsClarification so the UI can ask a single follow-up question — the
// "clarification loop" from the original design, just rule-based instead of
// an LLM round-trip.
// ─────────────────────────────────────────────────────────────────────────────
const RECURRENCE_PATTERNS = [
  { re: /\bevery\s*day\b|\bdaily\b/i, recurrence: 'daily' },
  { re: /\bevery\s+week\b|\bweekly\b/i, recurrence: 'weekly' },
  { re: /\bevery\s+month\b|\bmonthly\b/i, recurrence: 'monthly' },
  { re: /\bevery\s+(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)[a-z]*day?\b/i,
    fn: m => `weekly:${m[1].slice(0, 3).toUpperCase()}` },
];

function detectRecurrence(text) {
  for (const p of RECURRENCE_PATTERNS) {
    const m = text.match(p.re);
    if (m) return p.fn ? p.fn(m) : p.recurrence;
  }
  return null;
}

export function parseReminderText(text, refDate = new Date()) {
  const recurrence = detectRecurrence(text);
  const results = chrono.casual.parse(text, refDate, { forwardDate: true });

  if (!results.length) {
    return {
      remindAt: null,
      recurrence,
      needsClarification: true,
      question: "When should I remind you? (e.g. \"tomorrow at 9am\" or \"every Monday at 8pm\")",
    };
  }

  const parsed = results[0];
  const remindAt = parsed.start.date();
  // "every Monday" without a clock time defaults to 9am — chrono otherwise
  // pins it to the current time of day, which is rarely what's meant for a recurrence.
  if (recurrence && !parsed.start.isCertain('hour')) remindAt.setHours(9, 0, 0, 0);

  return { remindAt: remindAt.toISOString(), recurrence, needsClarification: false };
}
