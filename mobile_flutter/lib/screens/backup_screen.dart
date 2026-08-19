// Port of BackupScreen.svelte, backed by backup.dart's whole-DB-file zip.
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../services/backup.dart';
import '../services/legacy_migration.dart';
import '../theme.dart';

class BackupScreen extends StatefulWidget {
  const BackupScreen({super.key});
  @override
  State<BackupScreen> createState() => _BackupScreenState();
}

class _BackupScreenState extends State<BackupScreen> {
  bool _busy = false;
  String? _status;
  // Only shown if there's actually old Capacitor-app data sitting unused on
  // this device — see legacy_migration.dart. Most installs will never see
  // this card at all.
  bool _hasLegacyData = false;

  @override
  void initState() {
    super.initState();
    LegacyMigration.hasLegacyData().then((v) {
      if (mounted) setState(() => _hasLegacyData = v);
    });
  }

  Future<void> _doBackup() async {
    setState(() { _busy = true; _status = 'Preparing backup…'; });
    try {
      await BackupService.createAndShare();
      setState(() => _status = 'Backup ready — choose where to save it.');
    } catch (e) {
      setState(() => _status = null);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Backup failed: $e')));
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _doRestore() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text('Restoring a backup replaces ALL current data on this device (every profile, report, note, and reminder). Continue?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() { _busy = true; _status = 'Pick a backup .zip file…'; });
    try {
      final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: ['zip']);
      if (files.isEmpty) { setState(() => _status = null); return; }
      setState(() => _status = 'Restoring…');
      final bytes = await files.first.readAsBytes();
      await BackupService.restoreFromZipBytes(bytes);
      setState(() => _status = 'Restore complete — restart the app to see your data.');
    } catch (e) {
      setState(() => _status = null);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Restore failed: $e')));
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _doLegacyRestore() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text(
          'Track Blood found data from the old app on this device. Importing it replaces ALL current data '
          'on this device (every profile, report, note, and reminder). Continue?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() { _busy = true; _status = 'Importing your old data…'; });
    try {
      await BackupService.restoreFromLegacyCapacitorDb();
      setState(() => _status = 'Import complete — restart the app to see your data.');
    } catch (e) {
      setState(() => _status = null);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Import failed: $e')));
    } finally {
      setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Backup')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Backup', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              const Text(
                'Save everything — every profile, report, note, and reminder — as a single file. '
                'Nothing is encrypted or uploaded automatically; you choose where it goes '
                '(Files, Drive, Dropbox, email — whatever you pick from the share sheet).',
                style: TextStyle(color: kMuted),
              ),
              const SizedBox(height: 14),
              SizedBox(width: double.infinity, child: FilledButton(onPressed: _busy ? null : _doBackup, child: const Text('Create backup'))),
            ]),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text('Restore', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              const Text('Pick a backup .zip file to restore from. This replaces all current data on this device.', style: TextStyle(color: kMuted)),
              const SizedBox(height: 14),
              SizedBox(width: double.infinity, child: OutlinedButton(onPressed: _busy ? null : _doRestore, child: const Text('Restore from backup…'))),
            ]),
          ),
        ),
        if (_hasLegacyData) ...[
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Import from old app', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 8),
                const Text(
                  "Track Blood found data from the previous version of this app on your device that hasn't been "
                  'imported yet. This replaces all current data on this device.',
                  style: TextStyle(color: kMuted),
                ),
                const SizedBox(height: 14),
                SizedBox(width: double.infinity, child: OutlinedButton(onPressed: _busy ? null : _doLegacyRestore, child: const Text('Import old data…'))),
              ]),
            ),
          ),
        ],
        if (_status != null) Padding(padding: const EdgeInsets.only(top: 16), child: Text(_status!, textAlign: TextAlign.center, style: const TextStyle(color: kOk))),
      ]),
    );
  }
}
