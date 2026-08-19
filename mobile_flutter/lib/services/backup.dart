// Local backup/restore — rebuilt from scratch for the native rewrite (no
// compatibility requirement with the old JSON-manifest zip format, see the
// plan's §6). Zips the raw sqlite file itself alongside the report PDFs,
// instead of dumping every table to JSON and replaying inserts in FK order
// on restore — simpler, and there's no schema-shape duplication to keep in
// sync with db.dart.
import 'dart:io';
import 'package:archive/archive_io.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:sqflite/sqflite.dart' show getDatabasesPath;
import 'db.dart';
import 'notifications.dart';

class BackupService {
  static Future<void> createAndShare() async {
    final dbPath = p.join(await getDatabasesPath(), 'trackblood.db');
    final docs = await getApplicationDocumentsDirectory();
    final reportsDir = Directory(p.join(docs.path, 'reports'));

    final archive = Archive();
    final dbBytes = await File(dbPath).readAsBytes();
    archive.addFile(ArchiveFile('trackblood.db', dbBytes.length, dbBytes));

    if (await reportsDir.exists()) {
      await for (final entity in reportsDir.list(recursive: true)) {
        if (entity is! File) continue;
        final bytes = await entity.readAsBytes();
        final relPath = 'reports/${p.relative(entity.path, from: reportsDir.path)}';
        archive.addFile(ArchiveFile(relPath, bytes.length, bytes));
      }
    }

    final zipBytes = ZipEncoder().encode(archive);
    final tempDir = await getTemporaryDirectory();
    final fileName = 'track-blood-backup-${DateTime.now().toIso8601String().substring(0, 10)}.zip';
    final zipFile = File(p.join(tempDir.path, fileName));
    await zipFile.writeAsBytes(zipBytes);

    await SharePlus.instance.share(ShareParams(files: [XFile(zipFile.path)], title: 'Track Blood Backup'));
  }

  // Replaces ALL current data on the device. Cancels every currently-
  // scheduled push before the DB (which owns that state) gets wiped out
  // from under them, then reschedules future non-done reminders from the
  // restored data once it's back.
  static Future<void> restoreFromZipBytes(List<int> zipBytes) async {
    final archive = ZipDecoder().decodeBytes(zipBytes);
    final dbEntries = archive.files.where((f) => f.name == 'trackblood.db');
    if (dbEntries.isEmpty) throw Exception('Backup zip is missing trackblood.db');
    final dbEntry = dbEntries.first;

    final currentReminders = await Db.instance.listAllReminders();
    for (final r in currentReminders) {
      await cancelReminder(r['id'] as int).catchError((_) {});
    }

    await Db.instance.close();

    final dbPath = p.join(await getDatabasesPath(), 'trackblood.db');
    await File(dbPath).writeAsBytes(dbEntry.content as List<int>);

    final docs = await getApplicationDocumentsDirectory();
    final reportsDir = Directory(p.join(docs.path, 'reports'));
    if (await reportsDir.exists()) await reportsDir.delete(recursive: true);
    await reportsDir.create(recursive: true);
    for (final file in archive.files.where((f) => f.isFile && f.name.startsWith('reports/'))) {
      final outFile = File(p.join(docs.path, file.name));
      await outFile.parent.create(recursive: true);
      await outFile.writeAsBytes(file.content as List<int>);
    }

    await Db.instance.init();

    final now = DateTime.now();
    for (final r in await Db.instance.listAllReminders()) {
      if (r['done'] == 1) continue;
      if (!DateTime.parse(r['remind_at'] as String).isAfter(now)) continue;
      await scheduleReminder(r['id'] as int, r['text'] as String, r['remind_at'] as String, r['recurrence'] as String?);
    }
  }
}
