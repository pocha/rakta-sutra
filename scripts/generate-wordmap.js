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
//     - A candidate proposed by more than one marker is kept as a SHARED
//       keyword — every proposing marker becomes a target, same shape as a
//       hand-curated ambiguous keyword like "GLOBULIN" or "VITAMIN". This
//       used to resolve to a single "full name" owner (or drop the keyword
//       entirely if no single owner was obvious) on the theory that the
//       losing marker(s) would always have their own separate, unambiguous
//       keyword to fall back on — but test-parser-config.js's collision
//       audit showed that assumption doesn't always hold (e.g. "Mean
//       Corpuscular Hemoglobin Concentration" has no fallback that reliably
//       distinguishes it from "Mean Corpuscular Hemoglobin"/"...Volume" at
//       this prefix length). Accumulating every claimant instead means no
//       valid candidate is silently dropped; parser-core.mjs's
//       ref-range/unit-based disambiguation is what's actually responsible
//       for picking the right one when a shared keyword fires on a report
//       line, exactly as it already does for hand-curated shared keywords.
//     - A candidate proposed by only one marker, but which is *also* an
//       accidental substring of some OTHER marker's full compact name (one
//       that never proposed it itself — e.g. "NEUTROPHILS", proposed only
//       by "Neutrophils %" once its trailing "%" strips to nothing, is also
//       the literal first word of "Neutrophils Absolute"), is dropped. Same
//       "TIN inside CREATININE" shape of risk test-parser-config.js flags
//       after the fact; caught here before it's ever emitted.

const config = require('../parser-config.json');

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

// Naive singular form of a token — strip a trailing "S", but only when the
// token is long enough that removing it still leaves a real word-shaped
// result (avoids mangling short words, or words that end in "S" without
// being a simple plural, e.g. "STATUS"). A real report sometimes prints the
// singular cell-type name ("Absolute Basophil Count") even though our own
// marker name is plural ("Basophils Absolute") — this lets that combination
// get generated mechanically alongside the plural form, instead of needing
// a hand-curated keywordMap entry per marker.
function singularize(token) {
  return token.length > 4 && token.endsWith('S') ? token.slice(0, -1) : null;
}

const existingKeywords = new Set(Object.keys(config.keywordMap));
const markers = Object.keys(config.valueLimits);
const markerCompact = new Map(markers.map(m => [m, compact(m)]));

// Pass 1 — collect every marker's own candidates independently.
// proposals: candidate string -> [marker, ...]
const proposals = new Map();
function propose(kw, marker) {
  if (!proposals.has(kw)) proposals.set(kw, []);
  proposals.get(kw).push(marker);
}

for (const marker of markers) {
  const tokens = tokenize(marker);
  if (tokens.length === 1) {
    propose(tokens[0], marker);
    continue;
  }
  for (let len = 2; len <= tokens.length; len++) {
    propose(tokens.slice(0, len).join(''), marker);
  }
  if (tokens.length === 2) {
    propose(tokens.slice().reverse().join(''), marker);
  }

  // Same cumulative-prefix/reversal generation again, but with each token
  // that has a naive singular form swapped in — a real report sometimes
  // prints the singular cell-type name ("Absolute Basophil Count") even
  // though our own marker name is plural ("Basophils Absolute").
  const singularTokens = tokens.map(t => singularize(t) ?? t);
  if (singularTokens.some((t, i) => t !== tokens[i])) {
    for (let len = 2; len <= singularTokens.length; len++) {
      propose(singularTokens.slice(0, len).join(''), marker);
    }
    if (singularTokens.length === 2) {
      propose(singularTokens.slice().reverse().join(''), marker);
    }
  }
}

// Pass 2 — resolve.
const wordMap = {};
let skippedExisting = 0, sharedCount = 0, skippedForeignSubstring = 0;

for (const [kw, claimants] of proposals) {
  if (existingKeywords.has(kw)) { skippedExisting++; continue; }

  // Every distinct marker that proposed this candidate keeps it — no single
  // "owner" is chosen. A marker can appear more than once in claimants (its
  // plain-token and singularized-token proposals can coincide), so dedupe.
  const owners = [...new Set(claimants)];

  // Markers that already explicitly proposed this candidate (whether or not
  // they end up sharing it) were accounted for above — only a marker that
  // never proposed it at all, yet still happens to contain it as a
  // substring, counts as a "foreign" collision here.
  const claimantMarkers = new Set(owners);
  const collidesForeign = [...markerCompact].some(([otherMarker, otherCompact]) =>
    !claimantMarkers.has(otherMarker) && otherCompact.includes(kw));
  if (collidesForeign) { skippedForeignSubstring++; continue; }

  if (owners.length > 1) {
    sharedCount++;
    console.error(`SHARING auto-keyword "${kw}" among ${owners.length} markers: ${owners.map(o => `"${o}"`).join(', ')}`);
  }
  wordMap[kw] = owners;
}

console.log(`Generated ${Object.keys(wordMap).length} keywords from ${markers.length} markers (${skippedExisting} skipped for colliding with an existing keywordMap key, ${sharedCount} shared among multiple markers, ${skippedForeignSubstring} skipped for being a substring of a different marker's name).`);

// Alphabetical (case-insensitive) so the output is easy to scan/diff by hand
// — matches parser-config.json's own key ordering.
const collator = new Intl.Collator('en', { sensitivity: 'base' });
const sortedEntries = Object.entries(wordMap).sort(([a], [b]) => collator.compare(a, b));

require('fs').writeFileSync(
  '../parser-config-wordmap.json',
  '{\n' + sortedEntries.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n'
);
