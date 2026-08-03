#!/usr/bin/env node
'use strict';

// ── Auto-generates parser-config-wordmap.json from the marker list ──────────
// For every marker canonical name in parser-config.json's valueLimits, derives
// keywords mechanically from its own words — no hand-curation, no aliases,
// no acronyms (those stay in parser-config.json's keywordMap since they can't
// be derived from the marker's own name, e.g. "SGOT", "TSH").
//
// Rules (deliberately conservative — see caveats below):
//   - Single-word marker (e.g. "Calcium")   -> the word itself is the keyword.
//   - Multi-word marker (N >= 2 words)      -> cumulative prefixes of length
//     2..N (e.g. "Glomerular Filtration Rate (eGFR)" -> GlomerularFiltration,
//     GlomerularFiltrationRate, GlomerularFiltrationRateEGFR). A *single*
//     bare word is never generated from a multi-word marker — that's exactly
//     the "floating qualifier" shape of bug this session found repeatedly
//     (e.g. bare "DIRECT" colliding with "Indirect"), so it's excluded.
//   - Exactly 2-word markers additionally get the reversed order too (e.g.
//     "Bilirubin Direct" -> BILIRUBINDIRECT and DIRECTBILIRUBIN), since real
//     reports sometimes print modifier-noun pairs in either order.
//
// Explicitly NOT generated (left as a future step, per instruction): subset
// combinations that drop a leading word without being a plain prefix — e.g.
// "NITROGENCREATININERATIO" from "Blood Urea Nitrogen/Creatinine Ratio" is a
// suffix, not a prefix, and stays hand-curated in keywordMap for now.
//
// Collision handling, two passes:
//   Pass 1 — every marker proposes its own candidates independently, no
//     cross-checking yet.
//   Pass 2 — resolve overlaps:
//     - A candidate that collides with an existing hand-curated keywordMap
//       key is dropped (that key is often deliberately shared across
//       multiple markers, e.g. "VITAMIN", and must never be silently
//       overwritten by a single-marker auto-generated entry).
//     - A candidate explicitly proposed by two different markers: if
//       exactly one proposal is that marker's *entire* compact name (not
//       just a partial prefix of a longer sibling), the full-name owner
//       keeps it — e.g. "APOLIPOPROTEINB" is "Apolipoprotein B"'s whole
//       identity but only a partial prefix of "Apolipoprotein B/A1 Ratio",
//       so "Apolipoprotein B" keeps it (mirrors "VITAMIND" staying the
//       shared base keyword while "Vitamin D2"/"D3" rely on their own
//       longer keywords instead of needing "VITAMIND" itself). If neither
//       or both sides are full-name matches, drop both — not expected given
//       the conservative rules above, but safe to bail on.
//     - A candidate proposed by only one marker, but which is *also* an
//       accidental substring of some OTHER marker's full compact name (one
//       that never proposed it itself — e.g. "NEUTROPHILS", proposed only
//       by "Neutrophils %" once its trailing "%" strips to nothing, is also
//       the literal first word of "Neutrophils Absolute"), is dropped. Same
//       "TIN inside CREATININE" shape of risk test-parser-config.js flags
//       after the fact; caught here before it's ever emitted.

const config = require('./parser-config.json');

function compact(s) {
  return s.replace(/\x00/g, '').toUpperCase().replace(/AE/g, 'E').replace(/[^A-Z0-9]/g, '');
}

function tokenize(name) {
  // Split on whitespace/slash/paren/comma/hyphen, then compact each piece and
  // drop anything that compacts to empty — a bare "%" (e.g. "Neutrophils %")
  // is a non-empty split token but has no letters/digits of its own, so
  // without this second filter it silently becomes a stray empty "word"
  // that pollutes prefix/reversal generation.
  return name.split(/[\s/(),-]+/).map(compact).filter(Boolean);
}

const existingKeywords = new Set(Object.keys(config.keywordMap));
const markers = Object.keys(config.valueLimits);
const markerCompact = new Map(markers.map(m => [m, compact(m)]));

// Pass 1 — collect every marker's own candidates independently.
// proposals: candidate string -> [{ marker, isFullName }, ...]
const proposals = new Map();
function propose(kw, marker, isFullName) {
  if (!proposals.has(kw)) proposals.set(kw, []);
  proposals.get(kw).push({ marker, isFullName });
}

for (const marker of markers) {
  const tokens = tokenize(marker);
  if (tokens.length === 1) {
    propose(tokens[0], marker, true);
    continue;
  }
  for (let len = 2; len <= tokens.length; len++) {
    propose(tokens.slice(0, len).join(''), marker, len === tokens.length);
  }
  if (tokens.length === 2) {
    // The reversed order is never this marker's canonical full name (that's
    // the forward order) — always a partial-strength claim.
    propose(tokens.slice().reverse().join(''), marker, false);
  }
}

// Pass 2 — resolve.
const wordMap = {};
let skippedExisting = 0, skippedAmbiguous = 0, skippedForeignSubstring = 0;

for (const [kw, claimants] of proposals) {
  if (existingKeywords.has(kw)) { skippedExisting++; continue; }

  let owner;
  if (claimants.length === 1) {
    owner = claimants[0].marker;
  } else {
    const fullNameClaimants = claimants.filter(c => c.isFullName);
    if (fullNameClaimants.length === 1) {
      owner = fullNameClaimants[0].marker;
      console.error(`RESOLVING ambiguous auto-keyword "${kw}": giving it to "${owner}" (its full name) over ${claimants.filter(c => c.marker !== owner).map(c => `"${c.marker}"`).join(', ')} (only a partial prefix there)`);
    } else {
      console.error(`SKIPPING ambiguous auto-keyword "${kw}": ${claimants.map(c => `"${c.marker}"`).join(' and ')} would all claim it`);
      skippedAmbiguous++;
      continue;
    }
  }

  // Markers that already explicitly proposed this candidate (win or lose)
  // were accounted for above — only a marker that never proposed it at all,
  // yet still happens to contain it as a substring, counts as a "foreign"
  // collision here.
  const claimantMarkers = new Set(claimants.map(c => c.marker));
  const collidesForeign = [...markerCompact].some(([otherMarker, otherCompact]) =>
    !claimantMarkers.has(otherMarker) && otherCompact.includes(kw));
  if (collidesForeign) { skippedForeignSubstring++; continue; }

  wordMap[kw] = [owner];
}

console.log(`Generated ${Object.keys(wordMap).length} keywords from ${markers.length} markers (${skippedExisting} skipped for colliding with an existing keywordMap key, ${skippedAmbiguous} skipped as unresolvably ambiguous, ${skippedForeignSubstring} skipped for being a substring of a different marker's name).`);

require('fs').writeFileSync(
  './parser-config-wordmap.json',
  '{\n' + Object.entries(wordMap).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n'
);
