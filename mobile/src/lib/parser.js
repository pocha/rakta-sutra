// ─────────────────────────────────────────────────────────────────────────────
// Thin platform wrapper around the shared parsing engine (../../../parser-core.mjs,
// also used by the web app's app.js — see that file for the single source of
// truth on marker keywords, reference ranges, and PDF extraction logic).
// This file only adds what's mobile-specific: a bundled PDF.js worker instead
// of a CDN, so the app works fully offline.
// ─────────────────────────────────────────────────────────────────────────────
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import parserConfig from '../../../parser-config.json';
import { parsePDF as extractFromPdf, configureParser, MARKER_GROUPS, REF_RANGES, KEYWORD_MAP, parseRefRange } from '../../../parser-core.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Bundled default config — see parser-core.mjs's header comment for why the
// data/logic split exists (lets report-format fixes ship without an app
// update, eventually via a fetched config instead of this bundled copy).
configureParser(parserConfig);

export { MARKER_GROUPS, REF_RANGES, KEYWORD_MAP, parseRefRange };

export async function parsePDF(arrayBuffer) {
  return extractFromPdf(arrayBuffer, pdfjsLib);
}
