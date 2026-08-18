#!/usr/bin/env node
'use strict';

// ── Dumps row-grouped report text for every sample-reports/*.pdf ────────────
// Reuses parser-core.mjs's own groupIntoLines() so the text an LLM benchmark
// sees is the exact same row-reconstructed view the deterministic parser
// itself works from (fair comparison, and far more compact/legible than a
// raw per-text-fragment dump — matters for a context-window-limited
// on-device model). Writes one .txt file per report to the given output dir.
//
//   node scripts/dump-report-lines.mjs <output-dir> [password-file.json]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PDF_DIR = path.join(ROOT, 'sample-reports');

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/dump-report-lines.mjs <output-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

// Same password map as test.js — not a secret, local gitignored sample PDFs.
const PDF_PASSWORDS = { 'innoquest-password-protected.pdf': '195Z24051982' };

const core = await import(path.join(ROOT, 'parser-core.mjs'));
core.configureParser(require(path.join(ROOT, 'parser-config.json')), require(path.join(ROOT, 'parser-config-wordmap.json')));
const { groupIntoLines } = core;

const pdfFiles = fs.readdirSync(PDF_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));

for (const name of pdfFiles) {
  const data = new Uint8Array(fs.readFileSync(path.join(PDF_DIR, name)));
  try {
    const doc = await getDocument({ data, password: PDF_PASSWORDS[name], useSystemFonts: true }).promise;
    const rows = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const line of groupIntoLines(content.items)) rows.push(line.text);
    }
    // Multi-page reports (e.g. one lab-report-per-page bundles like
    // australia.pdf) commonly repeat the same patient/address/clinic-header
    // block verbatim on every page — pure noise for an LLM, it bloats token
    // count (a direct cause of "exceeded context window" failures on longer
    // reports) and puts repeated proper nouns/addresses in front of the
    // model for no benefit. Drop exact-duplicate lines, keeping only the
    // first occurrence — real per-row data (dates, values) differs page to
    // page and is never an exact duplicate, so this only removes boilerplate.
    const seen = new Set();
    const dedupedRows = rows.filter(line => {
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
    const outPath = path.join(outDir, name.replace(/\.pdf$/i, '.txt'));
    fs.writeFileSync(outPath, dedupedRows.join('\n') + '\n');
    console.log(`${name} -> ${dedupedRows.length} lines (${rows.length - dedupedRows.length} duplicate lines removed)`);
  } catch (err) {
    console.log(`${name}: ERROR ${err.message}`);
  }
}
