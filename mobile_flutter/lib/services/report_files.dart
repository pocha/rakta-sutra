// Port of mobile/src/lib/reports.js — stores original uploaded PDFs in the
// app's private sandbox. The DB only ever stores a path pointer to these.
import 'dart:io';
import 'dart:typed_data';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class ReportFiles {
  static Future<Directory> _reportsDir() async {
    final docs = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(docs.path, 'reports'));
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  static Future<String> save(int profileId, String fileName, Uint8List bytes) async {
    final dir = await _reportsDir();
    final relPath = 'reports/$profileId-${DateTime.now().millisecondsSinceEpoch}-$fileName';
    final file = File(p.join(dir.parent.path, relPath));
    await file.writeAsBytes(bytes);
    return relPath;
  }

  // Returns null (doesn't throw) if the file is missing — callers should
  // skip that report rather than fail a whole batch operation.
  static Future<Uint8List?> read(String relPath) async {
    try {
      final docs = await getApplicationDocumentsDirectory();
      return await File(p.join(docs.path, relPath)).readAsBytes();
    } catch (_) {
      return null;
    }
  }

  static Future<void> delete(String relPath) async {
    try {
      final docs = await getApplicationDocumentsDirectory();
      await File(p.join(docs.path, relPath)).delete();
    } catch (_) {}
  }

  static Future<String> absolutePath(String relPath) async {
    final docs = await getApplicationDocumentsDirectory();
    return p.join(docs.path, relPath);
  }
}
