#!/usr/bin/env node
'use strict';

// ── Keyword collision auditor for parser-config.json ─────────────────────────
// For every keyword, checks whether it is a substring of some OTHER marker's
// compact (normalized) name without that marker being listed among the
// keyword's own targets. That's exactly the "TIN is a substring of
// CREATININE" shape of bug: matchLine() scores purely by substring
// inclusion, so any keyword that happens to sit inside an unrelated marker's
// name will silently add a phantom point to that marker's candidate score
// unless the marker is either (a) deliberately included in the keyword's
// target list (so its own dedicated keyword can outscore the phantom hit) or
// (b) the collision is otherwise known-safe.
//
// Run this after any parser-config.json edit — same spirit as test.js, but
// checks the config's internal consistency rather than PDF extraction
// output.
//
// Two severities:
//   MISSING SELF-MATCH  — the marker's own compact name IS the keyword
//                          exactly, and it isn't in the keyword's target
//                          list at all. Almost certainly a bug: the
//                          marker's own defining keyword doesn't cover it.
//   SUBSTRING COLLISION — the keyword is only a piece of the marker's
//                          compact name (e.g. "TIN" inside "CREATININE").
//                          May be intentional (a shared family keyword that
//                          deliberately excludes this sibling) or may be an
//                          unreviewed accident — flagged for a human to
//                          decide, not auto-fixed.

const config = require('./parser-config.json');
const { keywordMap, valueLimits } = config;

function compactNorm(text) {
  return text.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

const ALL_MARKERS = Object.keys(valueLimits);
const MARKER_COMPACT = ALL_MARKERS.map(m => [m, compactNorm(m)]);

let selfMatchIssues = 0;
let substringIssues = 0;

for (const [kw, targets] of Object.entries(keywordMap)) {
  const targetSet = new Set(targets);
  for (const [marker, compact] of MARKER_COMPACT) {
    if (targetSet.has(marker)) continue; // already correctly mapped
    if (compact === kw) {
      console.log(`MISSING SELF-MATCH   keyword "${kw}" === compact name of "${marker}", but "${marker}" is not in keywordMap["${kw}"] (currently: [${targets.join(', ')}])`);
      selfMatchIssues++;
    } else if (compact.includes(kw)) {
      console.log(`SUBSTRING COLLISION   keyword "${kw}" is inside compact name of "${marker}" (${compact}), but "${marker}" is not in keywordMap["${kw}"] (currently: [${targets.join(', ')}])`);
      substringIssues++;
    }
  }
}

console.log(`\n${selfMatchIssues} missing self-match issue(s), ${substringIssues} substring collision(s).`);
if (selfMatchIssues > 0) process.exitCode = 1;