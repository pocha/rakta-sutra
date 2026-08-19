#!/usr/bin/env node
'use strict';

// ── Setup pdfjs-dist for Node.js ──────────────────────────────────────────────
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const PDF_DIR  = path.join(__dirname, 'sample-reports');
const REPORT_PATH = path.join(__dirname, 'test-report.txt');
const PDF_NAMES = [
  'orange.pdf', 'tata-1mg.pdf', 'thyrocare.pdf', 'centro-med.pdf', 'aarthi-scans.pdf', 'neuberg-anand.pdf', 'innoquest.pdf',
  '2025-12-full-body.pdf', 'metropolis.pdf', 'thyrocare-arogyam-1.3.pdf', 'toxic-nutrient-thyrocare.pdf', 'urine-markers.pdf', 'vitamins.pdf',
  '2023_Nov03_Innoquest_Part2.pdf', '2023_Nov_Innoquest_20231103.pdf', '2024_Dec20_in_red.pdf', '2024_March_Triglycerides.pdf',
  '2025_August_MedPlus_Hyd.pdf',
  'innoquest-password-protected.pdf', 'quest-diagnostics-US.pdf', 'australia.pdf',
];

// Password-protected sample reports — filename -> password. Not a secret
// worth guarding; these are local, gitignored sample PDFs used only for
// parser regression testing.
const PDF_PASSWORDS = {
  'innoquest-password-protected.pdf': '195Z24051982',
};

// Fixtures are the hand-verified ground truth for each report — marker name
// -> expected value only (no ref; ref is a config-default/disambiguation
// concern, not something we track per-PDF — see fixture doc discussion).
function fixturePath(pdfName) {
  return path.join(PDF_DIR, pdfName.replace(/\.pdf$/i, '.json'));
}

function loadFixture(pdfName) {
  const p = fixturePath(pdfName);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeFixture(pdfName, result) {
  const markers = {};
  for (const [k, v] of Object.entries(result.extracted)) markers[k] = { value: v.value, unit: v.unit };
  const fixture = { date: result.date, markers };
  fs.writeFileSync(fixturePath(pdfName), JSON.stringify(fixture, null, 2) + '\n');
}

// sample-reports/ is its own local-only git repo (no remote configured,
// deliberately — it holds real report content including real patient PHI
// and must never be pushed anywhere). Committing before AND after every
// fixture regeneration means a bad --write-fixtures run (blindly trusting
// whatever the parser currently extracts, including gaps/false-positives)
// is a `git log`/`git checkout <commit> -- file.json` away from recovery,
// not a forensic reconstruction — see the "native-unit change" incident
// this was built after. Silently no-ops if there's nothing new to commit,
// or if sample-reports/ isn't a git repo (e.g. a fresh clone before anyone
// has run `git init` there — this script never creates that repo itself).
function commitFixtures(message) {
  if (!fs.existsSync(path.join(PDF_DIR, '.git'))) return;
  try {
    execFileSync('git', ['add', '-A'], { cwd: PDF_DIR, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', message], { cwd: PDF_DIR, stdio: 'ignore' });
  } catch {
    // Commit fails (harmlessly) when there's nothing staged to commit —
    // not worth distinguishing from a real git error here.
  }
}

const { compareToFixture } = require('./scripts/scoring.js');

async function main() {
  // --write-fixtures on its own regenerates every fixture; --write-fixtures=
  // a.pdf,b.pdf scopes it to just those files, so adding/fixing one report
  // never touches every other report's already-hand-verified fixture.
  const writeFixturesArg = process.argv.find(a => a === '--write-fixtures' || a.startsWith('--write-fixtures='));
  const writeFixtures = !!writeFixturesArg;
  const writeFixturesScope = writeFixturesArg?.includes('=')
    ? new Set(writeFixturesArg.split('=')[1].split(','))
    : null;

  // parser-core.mjs is a real ES module (shared with the mobile app) —
  // dynamic import() works from this CommonJS script without converting the
  // whole file or the package to "type": "module".
  const core = await import('./parser-core.mjs');
  // parser-config.json is plain JSON — require() reads it natively, no
  // special handling needed. Must configure before reading MARKER_GROUPS
  // (destructuring it beforehand would capture the pre-configure `null`).
  core.configureParser(require('./parser-config.json'), require('./parser-config-wordmap.json'));
  const { parsePDF, MARKER_GROUPS } = core;
  const ALL_MARKERS = MARKER_GROUPS.flatMap(g => g.keys);

  const results = [];

  for (const name of PDF_NAMES) {
    const pdfPath = path.join(PDF_DIR, name);
    if (!fs.existsSync(pdfPath)) { console.log(`SKIP: ${name} not found`); continue; }
    process.stdout.write(`Parsing ${name}... `);
    try {
      const r = await parsePDF(readArrayBuffer(pdfPath), pdfjsLib, PDF_PASSWORDS[name]);
      results.push({ name, date: r.date, extracted: r.extracted });
      console.log(`done  [${r.date}]  ${Object.keys(r.extracted).length} markers found`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  if (!results.length) { console.error('No PDFs processed.'); process.exit(1); }

  if (writeFixtures) {
    commitFixtures('Snapshot before fixture regeneration (test.js --write-fixtures)');
    const scoped = writeFixturesScope ? results.filter(r => writeFixturesScope.has(r.name)) : results;
    for (const r of scoped) writeFixture(r.name, r);
    commitFixtures(`Regenerate fixture(s): ${scoped.map(r => r.name).join(', ')}`);
    console.log(`\nWrote ${scoped.length} fixture(s) to ${PDF_DIR}. Review them by hand before trusting as ground truth.`);
    return;
  }

  // ── Per-file detail ────────────────────────────────────────────────────────
  for (const r of results) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${r.name}  [${r.date}]`);
    console.log('═'.repeat(65));

    const found   = ALL_MARKERS.filter(k => r.extracted[k] !== undefined);
    const missing = ALL_MARKERS.filter(k => r.extracted[k] === undefined);

    console.log(`\nEXTRACTED (${found.length}):`);
    for (const k of found) {
      console.log(`  ✓  ${k.padEnd(48)} ${r.extracted[k].value}`);
    }

    console.log(`\nMISSING (${missing.length}):`);
    for (const k of missing) {
      console.log(`  ✗  ${k}`);
    }
  }

  // ── Combined side-by-side table ────────────────────────────────────────────
  console.log(`\n${'═'.repeat(65)}`);
  console.log('COMBINED');
  console.log('═'.repeat(65));
  const dates = results.map(r => r.date ?? 'null');
  const header = ['Marker'.padEnd(48), ...dates.map(d => d.padEnd(14))].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const k of ALL_MARKERS) {
    const vals = results.map(r => r.extracted[k]?.value ?? '');
    if (vals.every(v => v === '')) continue;
    console.log([k.padEnd(48), ...vals.map(v => String(v).padEnd(14))].join('  '));
  }

  // ── Fixture comparison + test-report.txt ───────────────────────────────────
  const lines = [];
  lines.push('Track Blood — parser regression report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  let totalFixtureMarkers = 0, totalCorrect = 0, totalWrong = 0, totalSpurious = 0;
  let filesWithFixtures = 0;

  for (const r of results) {
    const fixture = loadFixture(r.name);
    if (!fixture) {
      lines.push(`${r.name}: NO FIXTURE (run with --write-fixtures to create one)`);
      lines.push('');
      continue;
    }
    filesWithFixtures++;
    const extractedValues = Object.fromEntries(Object.entries(r.extracted).map(([k, v]) => [k, { value: v.value, unit: v.unit }]));
    const cmp = compareToFixture(fixture, extractedValues, core.convertUnit);
    totalFixtureMarkers += cmp.totalFixture;
    totalCorrect += cmp.correct.length;
    totalWrong += cmp.wrong.length;
    totalSpurious += cmp.spurious.length;

    lines.push(`${r.name}: coverage ${cmp.coveragePct.toFixed(1)}%  error ${cmp.errorPct.toFixed(1)}%  spurious ${cmp.spurious.length}`);
    for (const m of cmp.missed) lines.push(`  MISSED    ${m.name} (expected ${m.expected})`);
    for (const w of cmp.wrong) lines.push(`  WRONG     ${w.name} (expected ${w.expected}, got ${w.actual})`);
    for (const s of cmp.spurious) lines.push(`  SPURIOUS  ${s} (got ${extractedValues[s].value})`);
    lines.push('');
  }

  const totalMatched = totalCorrect + totalWrong;
  const overallCoverage = totalFixtureMarkers ? (totalCorrect / totalFixtureMarkers) * 100 : 0;
  const overallError = totalMatched ? (totalWrong / totalMatched) * 100 : 0;
  lines.push('─'.repeat(65));
  lines.push(`TOTAL (${filesWithFixtures}/${results.length} files with fixtures): coverage ${overallCoverage.toFixed(1)}%  error ${overallError.toFixed(1)}%  spurious ${totalSpurious}`);

  fs.writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  console.log(`\nWrote ${REPORT_PATH}`);
  console.log(lines[lines.length - 1]);
}

main().catch(err => { console.error(err); process.exit(1); });
