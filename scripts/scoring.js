'use strict';

// ── Shared fixture-comparison scoring, used by both test.js (deterministic
// parser regression) and score-ai-results.js (on-device AI benchmark) ──────
// Keeping this in one place guarantees both are scored by identical rules —
// a numeric-match tolerance change here affects both consistently.

// Within 1% relative tolerance counts as correct — absorbs floating-point
// unit-conversion noise (e.g. 228.15 vs 228.153) and minor rounding
// differences (from the deterministic parser or an AI extraction) without
// masking a genuinely wrong value.
function valuesMatch(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  const diff = Math.abs(a - b);
  if (diff < 1e-6) return true;
  const tolerance = Math.max(Math.abs(a), Math.abs(b)) * 0.01;
  return diff <= tolerance;
}

// Compares a { markerName: value } map against its fixture, returning
// per-report metrics plus the specific markers that were missed or wrong.
function compareToFixture(fixture, extracted) {
  const fixtureNames = Object.keys(fixture.markers);
  const extractedNames = Object.keys(extracted);
  const missed = [];   // in fixture, not extracted at all
  const wrong = [];    // in both, value differs
  const correct = [];  // in both, value matches
  for (const name of fixtureNames) {
    const expected = fixture.markers[name];
    if (!(name in extracted)) { missed.push({ name, expected }); continue; }
    const actual = extracted[name];
    if (valuesMatch(expected, actual)) correct.push(name);
    else wrong.push({ name, expected, actual });
  }
  const spurious = extractedNames.filter(n => !(n in fixture.markers));

  const totalFixture = fixtureNames.length;
  const matched = correct.length + wrong.length;
  const coveragePct = totalFixture ? (correct.length / totalFixture) * 100 : 100;
  const errorPct = matched ? (wrong.length / matched) * 100 : 0;

  return { totalFixture, correct, missed, wrong, spurious, coveragePct, errorPct };
}

module.exports = { valuesMatch, compareToFixture };
