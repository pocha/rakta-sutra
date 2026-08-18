'use strict';

// ── Shared fixture-comparison scoring, used by test.js (deterministic
// parser regression) ──────────────────────────────────────────────────────
// Keeping this in one place guarantees every consumer is scored by
// identical rules — a numeric-match tolerance change here affects all of
// them consistently.

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

// Compares a { markerName: {value, unit} } map against its fixture (same
// shape), returning per-report metrics plus the specific markers that were
// missed or wrong. Fixture and extracted values are typically in different
// but equally valid units (the parser returns whatever unit was actually
// printed/entered, not a fixed canonical one) — `convert(canonical, value,
// fromUnit, toUnit)` is used to reconcile them before comparing, so a
// genuinely correct value expressed in a different unit than the fixture's
// never shows up as a false WRONG. `convert` is optional; omitting it (or a
// marker with no `unit` on either side) falls back to comparing the raw
// numbers as-is.
function compareToFixture(fixture, extracted, convert) {
  const fixtureNames = Object.keys(fixture.markers);
  const extractedNames = Object.keys(extracted);
  const missed = [];   // in fixture, not extracted at all
  const wrong = [];    // in both, value differs
  const correct = [];  // in both, value matches
  for (const name of fixtureNames) {
    const expected = fixture.markers[name];
    if (!(name in extracted)) { missed.push({ name, expected: expected.value }); continue; }
    const actual = extracted[name];
    const actualValue = (convert && expected.unit && actual.unit && expected.unit !== actual.unit)
      ? convert(name, actual.value, actual.unit, expected.unit)
      : actual.value;
    if (valuesMatch(expected.value, actualValue)) correct.push(name);
    else wrong.push({ name, expected: expected.value, actual: actualValue });
  }
  const spurious = extractedNames.filter(n => !(n in fixture.markers));

  const totalFixture = fixtureNames.length;
  const matched = correct.length + wrong.length;
  const coveragePct = totalFixture ? (correct.length / totalFixture) * 100 : 100;
  const errorPct = matched ? (wrong.length / matched) * 100 : 0;

  return { totalFixture, correct, missed, wrong, spurious, coveragePct, errorPct };
}

module.exports = { valuesMatch, compareToFixture };
