#!/usr/bin/env node
'use strict';

// ── Dumps the raw text items pdfjs extracts from a PDF, one per line ────────
// Use this whenever you need to see exactly what parser-core.mjs sees before
// column-mapping/keyword-matching runs — e.g. verifying a "spurious" result
// against the real source line, or scoping out a new report's layout before
// writing its fixture. Usage:
//
//   node scripts/dump-pdf-text.mjs sample-reports/some-report.pdf
//   node scripts/dump-pdf-text.mjs sample-reports/some-report.pdf --xy   (include x/y position, useful for column/layout debugging)

import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { getDocument } = require('pdfjs-dist/legacy/build/pdf.js');

const path = process.argv[2];
const withXY = process.argv.includes('--xy');
if (!path) {
  console.error('Usage: node scripts/dump-pdf-text.mjs <path-to-pdf> [--xy]');
  process.exit(1);
}

const data = new Uint8Array(fs.readFileSync(path));
const doc = await getDocument({ data, useSystemFonts: true }).promise;
console.log('pages:', doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  for (const item of content.items) {
    const pos = withXY ? ` x=${item.transform[4].toFixed(1)} y=${item.transform[5].toFixed(1)}` : '';
    console.log(`p${p} ${JSON.stringify(item.str)}${pos}`);
  }
}
