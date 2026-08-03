// ─────────────────────────────────────────────────────────────────────────────
// Thin platform wrapper around the shared parsing engine (../../../parser-core.mjs,
// also used by the web app's app.js — see that file for the single source of
// truth on marker keywords, reference ranges, and PDF extraction logic).
// This file only adds what's mobile-specific: a bundled PDF.js worker instead
// of a CDN, so the app works fully offline.
// ─────────────────────────────────────────────────────────────────────────────
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { parsePDF as extractFromPdf, MARKER_GROUPS, REF_RANGES, KEYWORD_MAP, parseRefRange } from '../../../parser-core.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// configureParser() is called once at app startup (see main.js →
// parserConfigSync.js), before anything here is used.
export { MARKER_GROUPS, REF_RANGES, KEYWORD_MAP, parseRefRange };

export async function parsePDF(arrayBuffer, password) {
  return extractFromPdf(arrayBuffer, pdfjsLib, password);
}
