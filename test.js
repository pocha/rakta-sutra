#!/usr/bin/env node
'use strict';

// ── Stub browser globals before requiring app.js ──────────────────────────────
global.window = {
  addEventListener: () => {},
  prompt: (_msg, def) => def ?? 'Unknown',
};
global.document = {
  getElementById: () => ({
    classList: { remove: () => {}, add: () => {} },
    innerHTML: '',
    appendChild: () => {},
    insertRow: () => ({ insertCell: () => ({ textContent: '', classList: { add: () => {} } }), className: '' }),
    createTHead: () => ({ insertRow: () => ({ appendChild: () => {} }) }),
    createTBody: () => ({ insertRow: () => ({ insertCell: () => ({ textContent: '', classList: { add: () => {} } }), className: '', colSpan: 0 }) }),
  }),
};

// ── Setup pdfjs-dist for Node.js ──────────────────────────────────────────────
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
global.pdfjsLib = pdfjsLib;

// ── Import core extraction logic from app.js ──────────────────────────────────
const { parsePDF, MARKER_GROUPS } = require('./app.js');

const fs   = require('fs');
const path = require('path');

function makeFile(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  };
}

const PDF_DIR  = __dirname;
const PDF_NAMES = ['orange.pdf', 'tata-1mg.pdf', 'thyrocare.pdf'];
const ALL_MARKERS = MARKER_GROUPS.flatMap(g => g.keys);

async function main() {
  const results = [];

  for (const name of PDF_NAMES) {
    const pdfPath = path.join(PDF_DIR, name);
    if (!fs.existsSync(pdfPath)) { console.log(`SKIP: ${name} not found`); continue; }
    process.stdout.write(`Parsing ${name}... `);
    try {
      const r = await parsePDF(makeFile(pdfPath));
      results.push({ name, date: r.date, extracted: r.extracted });
      console.log(`done  [${r.date}]  ${Object.keys(r.extracted).length} markers found`);
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  if (!results.length) { console.error('No PDFs processed.'); process.exit(1); }

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
  const dates = results.map(r => r.date);
  const header = ['Marker'.padEnd(48), ...dates.map(d => d.padEnd(14))].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const k of ALL_MARKERS) {
    const vals = results.map(r => r.extracted[k]?.value ?? '');
    if (vals.every(v => v === '')) continue;
    console.log([k.padEnd(48), ...vals.map(v => String(v).padEnd(14))].join('  '));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
