// ─────────────────────────────────────────────────────────────────────────────
// Re-parses every stored report's original PDF against whatever config is
// currently active (parser-core.mjs's configureParser() must already have
// been called — see parserConfigSync.js) and replaces each report's
// auto-extracted marker values with the fresh result.
//
// Triggered from two places, both firing this same function so the behavior
// stays identical regardless of why a reparse is needed:
//   - parserConfigSync.js, when a freshly-synced parser-config.json or
//     parser-config-wordmap.json differs from what was used last launch.
//   - main.js, when the app itself has been updated (package.json version
//     differs from what was recorded last launch) — a new app build can
//     ship parser-core.mjs logic changes that only take effect on reparse,
//     not just new config data.
//
// Manually-edited marker values (markers.manually_edited = 1) are never
// touched — see db.js's replaceAutoExtractedMarkers for how that's enforced
// at the SQL level, not just here.
// ─────────────────────────────────────────────────────────────────────────────
import { parsePDF } from './parser.js';
import { readReportFile } from './reports.js';
import { listAllReports, replaceAutoExtractedMarkers } from './db.js';

let inFlight = null;

// Coalesces concurrent callers (e.g. a config-sync and an app-update check
// both firing on the same cold start) into a single pass rather than two
// overlapping ones stepping on each other's transactions.
export function reparseAllReports() {
  if (!inFlight) {
    inFlight = runReparseAll().finally(() => { inFlight = null; });
  }
  return inFlight;
}

async function runReparseAll() {
  const reports = await listAllReports();
  let updated = 0, failed = 0;
  for (const report of reports) {
    try {
      const arrayBuffer = await readReportFile(report.file_path);
      if (!arrayBuffer) { failed++; continue; }
      // No password retry here (unlike the interactive upload flow in
      // ReportTab.svelte) — there's no UI to prompt from in this background
      // pass, so a password-protected report just fails like any other
      // per-report error and is skipped rather than aborting the batch.
      const { extracted } = await parsePDF(arrayBuffer);
      await replaceAutoExtractedMarkers(report.id, extracted);
      updated++;
    } catch (err) {
      failed++;
      console.error(`[reparseAll] failed to re-parse report ${report.id} (${report.file_name}):`, err);
    }
  }
  console.log(`[reparseAll] done — ${updated} updated, ${failed} failed, ${reports.length} total`);
  return { updated, failed, total: reports.length };
}
