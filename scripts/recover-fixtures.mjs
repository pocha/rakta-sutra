#!/usr/bin/env node
'use strict';

// ── One-time fixture-recovery script (v2 — full reconstruction) ─────────
// `node test.js --write-fixtures` regenerates every fixture from whatever
// the parser currently extracts — dropping every MISSED marker (nothing to
// write), baking in pre-existing WRONG values as if correct, AND baking in
// every SPURIOUS extraction as if it were legitimate ground truth. This
// reconstructs each fixture from scratch using test-report.txt (captured
// BEFORE the fixture rewrite) as the source of truth:
//   - correct markers (extracted, not flagged spurious/wrong there): keep
//     the CURRENT (freshly re-parsed) native-unit value.
//   - MISSED markers: restore the old expected value verbatim.
//   - WRONG markers: restore old expected UNLESS the got/expected ratio
//     matches a genuine configured unit-scale factor for that marker (a
//     real fix from the native-unit change, not a bug).
//   - SPURIOUS markers: excluded entirely — never real ground truth.

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

const ROOT = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'parser-config.json'), 'utf8'));
const wordMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'parser-config-wordmap.json'), 'utf8'));
const report = fs.readFileSync(path.join(ROOT, 'test-report.txt'), 'utf8');
const PDF_PASSWORDS = { 'innoquest-password-protected.pdf': '195Z24051982' };

const core = await import(path.join(ROOT, 'parser-core.mjs'));
core.configureParser(config, wordMap);

function readArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

// ── Parse test-report.txt into per-file missed/wrong/spurious lists ──────
const lines = report.split('\n');
let currentFile = null;
const byFile = {};
for (const line of lines) {
  const fileMatch = line.match(/^(\S.+\.pdf): coverage/);
  if (fileMatch) { currentFile = fileMatch[1]; byFile[currentFile] = { missed: [], wrong: [], spurious: [] }; continue; }
  const missedMatch = line.match(/^\s+MISSED\s+(.+?) \(expected ([\d.]+)\)/);
  if (missedMatch && currentFile) { byFile[currentFile].missed.push({ marker: missedMatch[1], expected: parseFloat(missedMatch[2]) }); continue; }
  const wrongMatch = line.match(/^\s+WRONG\s+(.+?) \(expected ([\d.]+), got ([\d.]+)\)/);
  if (wrongMatch && currentFile) { byFile[currentFile].wrong.push({ marker: wrongMatch[1], expected: parseFloat(wrongMatch[2]), got: parseFloat(wrongMatch[3]) }); continue; }
  const spuriousMatch = line.match(/^\s+SPURIOUS\s+(.+?) \(got/);
  if (spuriousMatch && currentFile) { byFile[currentFile].spurious.push(spuriousMatch[1]); continue; }
}

function plausibleUnitRatios(marker) {
  const list = config.units[marker];
  if (!list || list.length < 2) return [];
  const ratios = [];
  for (const a of list) for (const b of list) {
    if (a.unit === b.unit) continue;
    ratios.push(a.scale / b.scale);
  }
  return ratios;
}
function isUnitArtifact(marker, expected, got) {
  if (expected === 0) return false;
  const ratio = got / expected;
  return plausibleUnitRatios(marker).some(r => Math.abs(ratio - r) / r < 0.02);
}

// The old "expected"/"got" numbers in test-report.txt predate the
// native-unit change — they were canonical (marker-default-unit) values.
// Any entry restored verbatim from that old data is therefore in the
// marker's default unit, not whatever the report actually prints.
function defaultUnit(marker) {
  return config.units[marker]?.find(u => u.default)?.unit ?? '';
}

for (const [pdfName, { missed, wrong, spurious }] of Object.entries(byFile)) {
  const pdfPath = path.join(ROOT, 'sample-reports', pdfName);
  const fixturePath = path.join(ROOT, 'sample-reports', pdfName.replace(/\.pdf$/i, '.json'));
  if (!fs.existsSync(pdfPath) || !fs.existsSync(fixturePath)) { console.log(`SKIP: ${pdfName}`); continue; }

  const r = await core.parsePDF(readArrayBuffer(pdfPath), pdfjsLib, PDF_PASSWORDS[pdfName]);
  const spuriousSet = new Set(spurious);
  const wrongMap = new Map(wrong.map(w => [w.marker, w]));

  const markers = {};
  // Correct/matched markers: trust the fresh, current native-unit
  // {value, unit} — excludes anything flagged spurious in the
  // pre-corruption run.
  for (const [canonical, { value, unit }] of Object.entries(r.extracted)) {
    if (spuriousSet.has(canonical)) continue;
    if (wrongMap.has(canonical)) continue; // handled below
    if (value === null) continue; // matched-but-unvalued, not a real ground-truth value
    markers[canonical] = { value, unit };
  }
  // Restore MISSED entries verbatim, in the marker's default unit (see
  // defaultUnit() above for why).
  for (const { marker, expected } of missed) markers[marker] = { value: expected, unit: defaultUnit(marker) };
  // WRONG entries: keep the current native {value, unit} if it's a genuine
  // unit fix, else restore the old expected value in the default unit.
  for (const { marker, expected, got } of wrong) {
    markers[marker] = isUnitArtifact(marker, expected, got)
      ? { value: got, unit: r.extracted[marker]?.unit ?? defaultUnit(marker) }
      : { value: expected, unit: defaultUnit(marker) };
  }

  const fixture = { date: r.date, markers };
  fs.writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${pdfName}: ${Object.keys(markers).length} markers (excluded ${spurious.length} spurious)`);
}

console.log('\nDone. Run `node test.js` to verify.');
