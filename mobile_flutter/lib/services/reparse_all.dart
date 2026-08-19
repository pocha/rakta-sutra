// Port of mobile/src/lib/reparseAll.js. Re-parses every stored report's
// original PDF against whatever config is currently active
// (ParserBridge.configureParser() must already have been called — see
// parser_config_sync.dart) and replaces each report's auto-extracted
// marker values with the fresh result.
//
// Triggered from two places, both firing this same function so the
// behavior stays identical regardless of why a reparse is needed:
//   - parser_config_sync.dart, when a freshly-synced parser-config.json or
//     wordmap differs from what was used last launch.
//   - main.dart, when the app itself has been updated (pubspec.yaml's
//     version differs from what was recorded last launch), or the markers
//     table schema just migrated — either can ship parser-core.mjs logic
//     changes, or a storage-shape change, that only takes effect on reparse.
//
// Manually-edited marker values (markers.manually_edited = 1) are never
// touched — db.dart's replaceAutoExtractedMarkers enforces that at the SQL
// level, not just here.
//
// Unlike the interactive upload flow in report_tab.dart, this DOES use a
// password-protected report's stored password (see reports.password) —
// there's no UI to prompt from in this background pass, but reparseAll can
// still succeed for those reports now, where the old Svelte app's version
// always failed them since it never stored the password anywhere.
import 'dart:convert';
import 'db.dart';
import 'parser_bridge.dart';
import 'report_files.dart';

Future<Map<String, int>>? _inFlight;

// Coalesces concurrent callers (e.g. a config-sync and an app-update check
// both firing on the same cold start) into a single pass rather than two
// overlapping ones stepping on each other's transactions.
Future<Map<String, int>> reparseAllReports() {
  return _inFlight ??= _runReparseAll().whenComplete(() => _inFlight = null);
}

Future<Map<String, int>> _runReparseAll() async {
  final reports = await Db.instance.listAllReports();
  var updated = 0, failed = 0;
  for (final report in reports) {
    try {
      final bytes = await ReportFiles.read(report['file_path'] as String);
      if (bytes == null) {
        failed++;
        continue;
      }
      final parsed = await ParserBridge.instance.parsePdf(base64Encode(bytes), password: report['password'] as String?);
      await Db.instance.replaceAutoExtractedMarkers(report['id'] as int, parsed.extracted, parsed.unvaluedCanonicals);
      updated++;
    } catch (err) {
      failed++;
      // ignore: avoid_print
      print('[reparseAll] failed to re-parse report ${report['id']} (${report['file_name']}): $err');
    }
  }
  // ignore: avoid_print
  print('[reparseAll] done — $updated updated, $failed failed, ${reports.length} total');
  return {'updated': updated, 'failed': failed, 'total': reports.length};
}
