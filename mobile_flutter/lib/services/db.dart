// Local SQLite layer — direct port of mobile/src/lib/db.js. Same philosophy:
// no ORM, hand-written queries, deliberately small. Query results are plain
// Map<String, Object?> rows (sqflite's native shape), matching db.js's own
// "no model classes" approach rather than adding a parallel type per table.
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';
import 'parser_config.dart';
import 'parser_bridge.dart' show ParsedMarker;

class Db {
  Db._();
  static final Db instance = Db._();

  static const _markersSchemaVersion = 2;

  late Database _db;
  bool _migrated = false;
  bool get migrated => _migrated;

  // Exposed for backup.dart's restore flow, which needs the connection
  // closed before the underlying file can be replaced wholesale, then
  // reopened by calling init() again.
  Future<void> close() => _db.close();

  Future<void> init() async {
    final path = join(await getDatabasesPath(), 'trackblood.db');
    // sqflite's execute() (a thin wrapper over Android's execSQL) only runs a
    // single statement — splitting is required to run this whole multi-table
    // schema, unlike engines that accept a semicolon-separated script as-is.
    _db = await openDatabase(path, version: 1, onCreate: (db, _) async {
      for (final stmt in _schema.split(';')) {
        final trimmed = stmt.trim();
        if (trimmed.isNotEmpty) await db.execute(trimmed);
      }
    });

    final stored = await getDeviceSetting('markers_schema_version');
    if (int.tryParse(stored ?? '') != _markersSchemaVersion) {
      await _db.execute('DROP TABLE IF EXISTS markers;');
      await _db.execute('''
        CREATE TABLE markers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
          canonical TEXT NOT NULL,
          value REAL,
          unit TEXT,
          manually_edited INTEGER NOT NULL DEFAULT 0,
          UNIQUE(report_id, canonical)
        );
      ''');
      await _db.execute('CREATE INDEX IF NOT EXISTS idx_markers_canonical ON markers(canonical);');
      await setDeviceSetting('markers_schema_version', '$_markersSchemaVersion');
      _migrated = true;
    }

    // Additive column on an existing install — CREATE TABLE's own "password
    // TEXT" only takes effect for a fresh database. sqflite has no "ADD
    // COLUMN IF NOT EXISTS", so check PRAGMA table_info first rather than
    // relying on catching a "duplicate column" error.
    final reportCols = await _db.rawQuery('PRAGMA table_info(reports)');
    if (!reportCols.any((c) => c['name'] == 'password')) {
      await _db.execute('ALTER TABLE reports ADD COLUMN password TEXT');
    }

    final profileCount = Sqflite.firstIntValue(await _db.rawQuery('SELECT COUNT(*) FROM profiles')) ?? 0;
    if (profileCount == 0) {
      await _db.insert('profiles', {'name': 'You'});
    }
  }

  static const _schema = '''
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      report_date TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      password TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      canonical TEXT NOT NULL,
      value REAL,
      unit TEXT,
      manually_edited INTEGER NOT NULL DEFAULT 0,
      UNIQUE(report_id, canonical)
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      entry_date TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS journal_marker_index (
      journal_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      canonical TEXT NOT NULL,
      PRIMARY KEY (journal_id, canonical)
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      recurrence TEXT,
      notification_id INTEGER,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS device_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminder_id INTEGER,
      text TEXT NOT NULL,
      tapped_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reports_profile ON reports(profile_id, report_date);
    CREATE INDEX IF NOT EXISTS idx_markers_canonical ON markers(canonical);
    CREATE INDEX IF NOT EXISTS idx_journal_profile ON journal_entries(profile_id, entry_date);
    CREATE INDEX IF NOT EXISTS idx_reminders_profile ON reminders(profile_id, remind_at);
  ''';

  // ── Profiles ──────────────────────────────────────────────────────────
  Future<List<Map<String, Object?>>> listProfiles() => _db.query('profiles', orderBy: 'id');
  Future<int> addProfile(String name) => _db.insert('profiles', {'name': name});
  Future<void> deleteProfile(int id) => _db.delete('profiles', where: 'id = ?', whereArgs: [id]);

  // ── Reports & markers ─────────────────────────────────────────────────
  // extractedMarkers: canonical -> {value, unit}. unvaluedCanonicals: matched
  // name, no plausible value — inserted as {value: null, unit: null}
  // placeholder rows so the UI can show a blank, fillable row for them.
  // password is stored so a password-protected PDF's Raw view (and, later,
  // reparseAll) can reopen/reparse it without prompting the user again —
  // never sent anywhere, stays local like everything else.
  Future<int> addReport(int profileId, String reportDate, String fileName, String filePath,
      Map<String, ParsedMarker> extractedMarkers, List<String> unvaluedCanonicals, {String? password}) async {
    return _db.transaction((txn) async {
      final reportId = await txn.insert('reports', {
        'profile_id': profileId, 'report_date': reportDate, 'file_name': fileName, 'file_path': filePath, 'password': password,
      });
      for (final e in extractedMarkers.entries) {
        await txn.insert('markers', {'report_id': reportId, 'canonical': e.key, 'value': e.value.value, 'unit': e.value.unit});
      }
      for (final c in unvaluedCanonicals) {
        if (extractedMarkers.containsKey(c)) continue;
        await txn.insert('markers', {'report_id': reportId, 'canonical': c, 'value': null, 'unit': null},
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
      return reportId;
    });
  }

  Future<List<Map<String, Object?>>> listReports(int profileId) => _db.rawQuery(
        'SELECT *, report_date as date FROM reports WHERE profile_id = ? ORDER BY report_date DESC', [profileId],
      );

  Future<List<Map<String, Object?>>> listAllReports() =>
      _db.rawQuery('SELECT * FROM reports ORDER BY report_date DESC');

  // Replaces a report's auto-extracted markers with a fresh extraction,
  // without touching any manually-edited row for this report.
  Future<void> replaceAutoExtractedMarkers(
      int reportId, Map<String, ParsedMarker> extractedMarkers, List<String> unvaluedCanonicals) async {
    await _db.transaction((txn) async {
      await txn.delete('markers', where: 'report_id = ? AND manually_edited = 0', whereArgs: [reportId]);
      for (final e in extractedMarkers.entries) {
        await txn.insert('markers', {'report_id': reportId, 'canonical': e.key, 'value': e.value.value, 'unit': e.value.unit},
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
      for (final c in unvaluedCanonicals) {
        if (extractedMarkers.containsKey(c)) continue;
        await txn.insert('markers', {'report_id': reportId, 'canonical': c, 'value': null, 'unit': null},
            conflictAlgorithm: ConflictAlgorithm.ignore);
      }
    });
  }

  Future<List<Map<String, Object?>>> getReportMarkers(int reportId) =>
      _db.query('markers', where: 'report_id = ?', whereArgs: [reportId], orderBy: 'canonical');

  // Registers a marker name the parser doesn't know about (not in
  // parser-config.json) as a blank, editable row for this report — same
  // {value: null, unit: null} placeholder shape addReport() already uses
  // for matched-but-unvalued canonicals. Once inserted it flows through
  // getConsolidatedReportData()'s profile-wide union like any other
  // canonical, so it shows up as a normal fillable row everywhere (every
  // report, the unit picker, MarkerDetail's chart) with no special-casing —
  // every ParserConfig lookup already defaults to "no data" for an unknown
  // canonical rather than erroring.
  Future<void> registerCustomMarker(int reportId, String canonical) => _db.insert(
        'markers', {'report_id': reportId, 'canonical': canonical, 'value': null, 'unit': null},
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );

  Future<void> upsertMarker(int reportId, String canonical, double value, String? unit) => _db.rawInsert(
        '''INSERT INTO markers (report_id, canonical, value, unit, manually_edited) VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(report_id, canonical) DO UPDATE SET value = excluded.value, unit = excluded.unit, manually_edited = 1''',
        [reportId, canonical, value, unit],
      );

  // Unit-switch flow: converts + validates before writing. Returns
  // (saved, rangeLow, rangeHigh) — range non-null only when saved is false.
  Future<(bool, double?, double?)> updateMarkerUnit(int reportId, String canonical, String newUnit) async {
    final rows = await _db.query('markers', columns: ['value', 'unit'], where: 'report_id = ? AND canonical = ?', whereArgs: [reportId, canonical]);
    if (rows.isEmpty || rows.first['value'] == null) return (false, null, null);
    final row = rows.first;
    final config = ParserConfig.instance;
    final converted = config.convertUnit(canonical, row['value'] as double, row['unit'] as String? ?? '', newUnit);
    if (!config.inValueRangeForUnit(canonical, converted, newUnit)) {
      final limits = config.valueLimitsForUnit(canonical, newUnit);
      return (false, limits?.$1, limits?.$2);
    }
    await upsertMarker(reportId, canonical, converted, newUnit);
    return (true, null, null);
  }

  Future<void> deleteReport(int id) => _db.delete('reports', where: 'id = ?', whereArgs: [id]);

  // ── Journal ───────────────────────────────────────────────────────────
  Future<int> addJournalEntry(int profileId, String entryDate, String text, List<String> canonicals) =>
      _db.transaction((txn) async {
        final id = await txn.insert('journal_entries', {'profile_id': profileId, 'entry_date': entryDate, 'text': text});
        for (final c in canonicals) {
          await txn.insert('journal_marker_index', {'journal_id': id, 'canonical': c}, conflictAlgorithm: ConflictAlgorithm.ignore);
        }
        return id;
      });

  Future<void> updateJournalEntry(int id, String entryDate, String text, List<String> canonicals) =>
      _db.transaction((txn) async {
        await txn.update('journal_entries', {'entry_date': entryDate, 'text': text}, where: 'id = ?', whereArgs: [id]);
        await txn.delete('journal_marker_index', where: 'journal_id = ?', whereArgs: [id]);
        for (final c in canonicals) {
          await txn.insert('journal_marker_index', {'journal_id': id, 'canonical': c}, conflictAlgorithm: ConflictAlgorithm.ignore);
        }
      });

  Future<void> deleteJournalEntry(int id) => _db.delete('journal_entries', where: 'id = ?', whereArgs: [id]);

  // ── Timeline ──────────────────────────────────────────────────────────
  Future<List<Map<String, Object?>>> getTimelineFeed(int profileId) async {
    final reportRows = await _db.rawQuery(
      'SELECT id, report_date as date, file_name, file_path FROM reports WHERE profile_id = ? ORDER BY report_date DESC', [profileId],
    );
    final markerRows = await _db.rawQuery(
      'SELECT m.report_id, m.canonical, m.value, m.unit FROM markers m JOIN reports r ON r.id = m.report_id WHERE r.profile_id = ?',
      [profileId],
    );
    final config = ParserConfig.instance;
    final markersByReport = <int, List<Map<String, Object?>>>{};
    for (final row in markerRows) {
      (markersByReport[row['report_id'] as int] ??= []).add(row);
    }
    final reports = reportRows.map((r) {
      final markers = markersByReport[r['id'] as int] ?? const [];
      return {
        ...r,
        'kind': 'report',
        'marker_count': markers.where((m) => m['value'] != null).length,
        'ref_count': markers.where((m) => config.isOutOfRange(m['canonical'] as String, m['value'] as double?, m['unit'] as String?)).length,
      };
    }).toList();

    final notes = await _db.rawQuery(
      "SELECT id, entry_date as date, text, 'note' as kind FROM journal_entries WHERE profile_id = ? ORDER BY entry_date DESC", [profileId],
    );
    final merged = [...reports, ...notes];
    merged.sort((a, b) => (b['date'] as String).compareTo(a['date'] as String));
    return merged;
  }

  Future<List<Map<String, Object?>>> getMarkerTimeline(int profileId, String canonical) async {
    final values = await _db.rawQuery(
      "SELECT r.report_date as date, m.value, m.unit, 'value' as kind FROM markers m JOIN reports r ON r.id = m.report_id "
      "WHERE r.profile_id = ? AND m.canonical = ? AND m.value IS NOT NULL",
      [profileId, canonical],
    );
    final notes = await _db.rawQuery(
      "SELECT j.entry_date as date, j.text, 'note' as kind FROM journal_entries j JOIN journal_marker_index idx ON idx.journal_id = j.id "
      "WHERE j.profile_id = ? AND idx.canonical = ?",
      [profileId, canonical],
    );
    final merged = [...values, ...notes];
    merged.sort((a, b) => (b['date'] as String).compareTo(a['date'] as String));
    return merged;
  }

  static const _maxSharedReportDates = 3;

  // dates, markers (canonical -> date -> value), refRanges (canonical -> range string)
  Future<(List<String>, Map<String, Map<String, double>>, Map<String, String?>)> getConsolidatedMatrix(int profileId) async {
    final rows = await _db.rawQuery(
      "SELECT r.report_date as date, m.canonical, m.value, m.unit FROM markers m JOIN reports r ON r.id = m.report_id "
      "WHERE r.profile_id = ? AND m.value IS NOT NULL ORDER BY r.report_date DESC",
      [profileId],
    );
    final config = ParserConfig.instance;
    final allDates = <String>[];
    final markers = <String, Map<String, double>>{};
    final refRanges = <String, String?>{};
    for (final row in rows) {
      final date = row['date'] as String;
      if (!allDates.contains(date)) allDates.add(date);
      final canonical = row['canonical'] as String;
      (markers[canonical] ??= {})[date] = row['value'] as double;
      refRanges.putIfAbsent(canonical, () => config.refRangeForUnit(canonical, row['unit'] as String? ?? ''));
    }
    final dates = allDates.take(_maxSharedReportDates).toList();
    return (dates, markers, refRanges);
  }

  // Feeds the Report tab's swipeable value+unit column: canonical -> reportId -> {value, unit}.
  Future<(List<Map<String, Object?>>, Map<String, Map<int, Map<String, Object?>>>)> getConsolidatedReportData(int profileId) async {
    final reports = await _db.rawQuery(
      'SELECT id, report_date as date, file_name, file_path, password FROM reports WHERE profile_id = ? ORDER BY report_date DESC', [profileId],
    );
    final markerRows = await _db.rawQuery(
      'SELECT m.report_id, m.canonical, m.value, m.unit FROM markers m JOIN reports r ON r.id = m.report_id WHERE r.profile_id = ?',
      [profileId],
    );
    final valuesByCanonical = <String, Map<int, Map<String, Object?>>>{};
    for (final row in markerRows) {
      final canonical = row['canonical'] as String;
      (valuesByCanonical[canonical] ??= {})[row['report_id'] as int] = {'value': row['value'], 'unit': row['unit']};
    }
    return (reports, valuesByCanonical);
  }

  Future<List<String>> listKnownMarkers(int profileId) async {
    final rows = await _db.rawQuery(
      'SELECT DISTINCT m.canonical FROM markers m JOIN reports r ON r.id = m.report_id WHERE r.profile_id = ? ORDER BY m.canonical',
      [profileId],
    );
    return rows.map((r) => r['canonical'] as String).toList();
  }

  Future<Map<String, String>> getMajorityUnitByCanonical(int profileId) async {
    final rows = await _db.rawQuery(
      "SELECT m.canonical, m.unit, r.report_date as date FROM markers m JOIN reports r ON r.id = m.report_id "
      "WHERE r.profile_id = ? AND m.value IS NOT NULL AND m.unit IS NOT NULL AND m.unit != '' ORDER BY r.report_date DESC",
      [profileId],
    );
    final counts = <String, Map<String, int>>{};
    for (final row in rows) {
      final canonical = row['canonical'] as String;
      final unit = row['unit'] as String;
      final c = (counts[canonical] ??= {});
      c[unit] = (c[unit] ?? 0) + 1;
    }
    final result = <String, String>{};
    for (final entry in counts.entries) {
      String? best;
      var bestCount = 0;
      for (final u in entry.value.entries) {
        if (u.value > bestCount) { best = u.key; bestCount = u.value; }
      }
      if (best != null) result[entry.key] = best;
    }
    return result;
  }

  Future<List<Map<String, Object?>>> getMarkerChartSeries(int profileId, String canonical) => _db.rawQuery(
        "SELECT r.id as report_id, r.report_date as date, m.value, m.unit FROM markers m JOIN reports r ON r.id = m.report_id "
        "WHERE r.profile_id = ? AND m.canonical = ? AND m.value IS NOT NULL ORDER BY r.report_date DESC",
        [profileId, canonical],
      );

  Future<Map<String, Object?>?> getLatestMarkerValue(int profileId, String canonical) async {
    final rows = await _db.rawQuery(
      "SELECT m.value, m.unit, r.id as report_id, r.report_date as date FROM markers m JOIN reports r ON r.id = m.report_id "
      "WHERE r.profile_id = ? AND m.canonical = ? AND m.value IS NOT NULL ORDER BY r.report_date DESC LIMIT 1",
      [profileId, canonical],
    );
    return rows.isEmpty ? null : rows.first;
  }

  // ── Reminders ─────────────────────────────────────────────────────────
  Future<int> addReminder(int profileId, String text, String remindAt, String? recurrence, int? notificationId) =>
      _db.insert('reminders', {'profile_id': profileId, 'text': text, 'remind_at': remindAt, 'recurrence': recurrence, 'notification_id': notificationId});

  Future<void> updateReminder(int id, String text, String remindAt, String? recurrence, int? notificationId) => _db.update(
        'reminders', {'text': text, 'remind_at': remindAt, 'recurrence': recurrence, 'notification_id': notificationId},
        where: 'id = ?', whereArgs: [id],
      );

  Future<void> setReminderDone(int id, bool done) =>
      _db.update('reminders', {'done': done ? 1 : 0}, where: 'id = ?', whereArgs: [id]);

  Future<void> deleteReminder(int id) => _db.delete('reminders', where: 'id = ?', whereArgs: [id]);

  Future<List<Map<String, Object?>>> listReminders(int profileId) =>
      _db.query('reminders', where: 'profile_id = ?', whereArgs: [profileId], orderBy: 'remind_at');

  // Every reminder across every profile — backup.dart's restore flow cancels/
  // reschedules server-side pushes for all of them, not just the active profile.
  Future<List<Map<String, Object?>>> listAllReminders() => _db.query('reminders');

  Future<Map<String, Object?>?> getReminderById(int id) async {
    final rows = await _db.query('reminders', where: 'id = ?', whereArgs: [id]);
    return rows.isEmpty ? null : rows.first;
  }

  // ── Device settings ───────────────────────────────────────────────────
  Future<String?> getDeviceSetting(String key) async {
    final rows = await _db.query('device_settings', columns: ['value'], where: 'key = ?', whereArgs: [key]);
    return rows.isEmpty ? null : rows.first['value'] as String?;
  }

  Future<void> setDeviceSetting(String key, String value) => _db.rawInsert(
        "INSERT INTO device_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
      );

  Future<String> getOrCreateDeviceId() async {
    final existing = await getDeviceSetting('deviceId');
    if (existing != null) return existing;
    final id = const Uuid().v4();
    await setDeviceSetting('deviceId', id);
    return id;
  }

  Future<bool> shouldShowMultiSelectHint() async => (await getDeviceSetting('hideMultiSelectHint')) == null;
  Future<void> dismissMultiSelectHint() => setDeviceSetting('hideMultiSelectHint', '1');

  // ── Notification history ──────────────────────────────────────────────
  Future<void> logNotificationTap(int? reminderId, String text) =>
      _db.insert('notification_log', {'reminder_id': reminderId, 'text': text});

  Future<List<Map<String, Object?>>> listNotificationLog() => _db.query('notification_log', orderBy: 'tapped_at DESC');
}
