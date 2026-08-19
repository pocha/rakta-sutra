// ONE-TIME BRIDGE — Capacitor → Flutter cutover only. Exists solely to
// migrate a device that had the old Capacitor/Svelte app (same Android
// applicationId, fyi.pocha.trackblood, using @capacitor-community/sqlite)
// installed before updating in place to this Flutter rewrite. Safe to
// delete entirely in a future release once existing installs have had a
// chance to migrate.
//
// Both apps share the same applicationId, so an in-place update keeps the
// app's private data directory intact — but Flutter's sqflite opens a
// differently-named db file (trackblood.db) than the Capacitor plugin used
// (trackbloodSQLite.db, see @capacitor-community/sqlite's UtilsFile.java),
// so without this the new app would just see an empty database with the
// old one sitting there unused, looking like total data loss. Schema is
// otherwise identical to db.dart's (db.js hasn't drifted since the Flutter
// port), so this just copies every row across as-is, preserving ids so
// foreign keys stay valid, then copies the report PDFs from Capacitor's
// Directory.Data location (== getApplicationSupportDirectory() on Android)
// to this app's getApplicationDocumentsDirectory() location.
//
// Deliberately does NOT reparse anything here — main.dart's existing
// reparse-on-update logic (parser_config_sync.dart / reparse_all.dart)
// already does that for free afterward on the automatic install path,
// since lastAppVersion/lastConfigHash were never set by the old app. A
// caller triggering migrate() outside that startup sequence (see
// backup.dart's manual restore fallback) needs to call
// reparseAllReports() itself once this returns.
import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

class LegacyMigration {
  static Future<String> _oldDbPath() async => p.join(await getDatabasesPath(), 'trackbloodSQLite.db');

  static Future<bool> hasLegacyData() async => File(await _oldDbPath()).exists();

  // [db] must already be open with the current schema created (Db.init()
  // calls this before seeding a default profile, passing its own _db).
  // Copies happen inside one transaction so a failure partway through
  // leaves [db] exactly as empty as it started, safe to retry next launch.
  static Future<void> migrate(Database db) async {
    final oldPath = await _oldDbPath();
    if (!await File(oldPath).exists()) return;

    final oldDb = await openDatabase(oldPath, readOnly: true);
    try {
      await db.transaction((txn) async {
        // Dependency order matters for the FK columns even though sqflite
        // doesn't enforce them by default — keeps this readable as "parents
        // before children" regardless.
        for (final table in [
          'profiles', 'reports', 'markers', 'journal_entries', 'journal_marker_index', 'reminders', 'notification_log',
        ]) {
          for (final row in await oldDb.query(table)) {
            await txn.insert(table, row, conflictAlgorithm: ConflictAlgorithm.replace);
          }
        }
        // Only deviceId carries over — avoids registering a second device
        // with the reminder-push backend for what's actually the same
        // physical device. markers_schema_version/hideMultiSelectHint are
        // either managed by db.dart itself or harmless to reset.
        final deviceId = await oldDb.query('device_settings', where: 'key = ?', whereArgs: ['deviceId']);
        if (deviceId.isNotEmpty) {
          await txn.insert('device_settings', {'key': 'deviceId', 'value': deviceId.first['value']},
              conflictAlgorithm: ConflictAlgorithm.replace);
        }
      });

      final reports = await db.query('reports', columns: ['file_path']);
      final oldReportsRoot = await getApplicationSupportDirectory();
      final newReportsRoot = await getApplicationDocumentsDirectory();
      for (final r in reports) {
        final relPath = r['file_path'] as String;
        final src = File(p.join(oldReportsRoot.path, relPath));
        if (!await src.exists()) continue;
        final dest = File(p.join(newReportsRoot.path, relPath));
        await dest.parent.create(recursive: true);
        await src.copy(dest.path);
      }
    } finally {
      await oldDb.close();
    }
  }
}
