// Port of ReminderTab.svelte (Phase 3).
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../services/db.dart';
import '../services/notifications.dart';
import '../services/parser_bridge.dart';
import '../theme.dart';

class ReminderTab extends StatefulWidget {
  final int? profileId;
  const ReminderTab({super.key, required this.profileId});

  @override
  State<ReminderTab> createState() => _ReminderTabState();
}

class _ReminderTabState extends State<ReminderTab> {
  bool _loading = true;
  List<Map<String, Object?>> _reminders = [];
  bool _permissionBlocked = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ReminderTab old) {
    super.didUpdateWidget(old);
    if (old.profileId != widget.profileId) _load();
  }

  Future<void> _load() async {
    if (widget.profileId == null) return;
    setState(() => _loading = true);
    final reminders = await Db.instance.listReminders(widget.profileId!);
    final state = await getNotificationPermissionState();
    setState(() {
      _reminders = reminders;
      _permissionBlocked = state.isDenied || state.isPermanentlyDenied;
      _loading = false;
    });
  }

  List<Map<String, Object?>> get _upcoming {
    final now = DateTime.now();
    final list = _reminders.where((r) => r['done'] != 1 && DateTime.parse(r['remind_at'] as String).isAfter(now)).toList();
    list.sort((a, b) => (a['remind_at'] as String).compareTo(b['remind_at'] as String));
    return list;
  }

  List<Map<String, Object?>> get _past {
    final now = DateTime.now();
    final list = _reminders.where((r) => r['done'] == 1 || !DateTime.parse(r['remind_at'] as String).isAfter(now)).toList();
    list.sort((a, b) => (b['remind_at'] as String).compareTo(a['remind_at'] as String));
    return list;
  }

  String _formatWhen(Map<String, Object?> r) {
    final d = DateTime.parse(r['remind_at'] as String).toLocal();
    final base = '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
    final recurrence = r['recurrence'] as String?;
    if (recurrence == null) return base;
    final label = recurrence.startsWith('weekly:') ? 'every ${recurrence.substring(7)}' : recurrence;
    return '$base ($label)';
  }

  Future<void> _openReminderSheet({Map<String, Object?>? reminder}) async {
    if (_permissionBlocked) return;
    final ctrl = TextEditingController(text: reminder?['text'] as String? ?? '');
    String? clarifyQuestion;
    final clarifyCtrl = TextEditingController();
    bool saving = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 16, right: 16, top: 16),
          child: SafeArea(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(reminder == null ? 'Add reminder' : 'Edit reminder', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              const SizedBox(height: 12),
              TextField(
                controller: ctrl,
                maxLines: 3,
                enabled: clarifyQuestion == null,
                decoration: const InputDecoration(hintText: 'e.g. Take Vitamin D shot every Monday at 9am'),
              ),
              if (clarifyQuestion != null) ...[
                const SizedBox(height: 8),
                Text(clarifyQuestion!, style: const TextStyle(color: kAccentDim)),
                TextField(controller: clarifyCtrl, decoration: const InputDecoration(hintText: 'e.g. tomorrow at 9am')),
              ],
              const SizedBox(height: 12),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                TextButton(onPressed: saving ? null : () => Navigator.pop(context), child: const Text('Cancel')),
                FilledButton(
                  onPressed: saving
                      ? null
                      : () async {
                          final fullText = clarifyQuestion != null ? '${ctrl.text} ${clarifyCtrl.text}' : ctrl.text;
                          if (ctrl.text.trim().isEmpty) return;
                          final parsed = await ParserBridge.instance.parseReminderText(fullText, DateTime.now());
                          if (parsed.needsClarification) {
                            if (clarifyQuestion != null) {
                              if (context.mounted) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('Still couldn\'t find a time. Try being explicit, e.g. "29 Jul 9am".')),
                                );
                              }
                              return;
                            }
                            setSheetState(() => clarifyQuestion = parsed.question);
                            return;
                          }
                          setSheetState(() => saving = true);
                          if (reminder != null) {
                            await cancelReminder(reminder['id'] as int);
                            await Db.instance.updateReminder(reminder['id'] as int, ctrl.text.trim(), parsed.remindAtIso!, parsed.recurrence, reminder['id'] as int);
                            await scheduleReminder(reminder['id'] as int, ctrl.text.trim(), parsed.remindAtIso!, parsed.recurrence);
                          } else {
                            final id = await Db.instance.addReminder(widget.profileId!, ctrl.text.trim(), parsed.remindAtIso!, parsed.recurrence, null);
                            await scheduleReminder(id, ctrl.text.trim(), parsed.remindAtIso!, parsed.recurrence);
                            await Db.instance.updateReminder(id, ctrl.text.trim(), parsed.remindAtIso!, parsed.recurrence, id);
                          }
                          if (context.mounted) Navigator.pop(context);
                          await _load();
                        },
                  child: Text(saving ? 'Saving…' : (clarifyQuestion != null ? 'Continue' : 'Save')),
                ),
              ]),
              const SizedBox(height: 12),
            ]),
          ),
        ),
      ),
    );
  }

  Future<void> _remove(Map<String, Object?> reminder) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(content: const Text('Delete this reminder?'), actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
        TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
      ]),
    );
    if (confirmed != true) return;
    await cancelReminder(reminder['id'] as int);
    await Db.instance.deleteReminder(reminder['id'] as int);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : Column(children: [
              if (_permissionBlocked)
                Container(
                  width: double.infinity,
                  color: kAccentSoft,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  child: const Text(
                    "Notifications are turned off, so reminders can't be delivered. Enable notification permission for Track Blood in your device settings to add or receive reminders.",
                    style: TextStyle(color: kAccentDim, fontSize: 13),
                  ),
                ),
              Expanded(
                child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 96), children: [
                  _sectionHeader('Upcoming'),
                  if (_upcoming.isEmpty) const Text('No upcoming reminders.', style: TextStyle(color: kMuted)),
                  for (final r in _upcoming) _reminderCard(r, past: false),
                  _sectionHeader('Past'),
                  if (_past.isEmpty) const Text('No past reminders.', style: TextStyle(color: kMuted)),
                  for (final r in _past) _reminderCard(r, past: true),
                ]),
              ),
            ]),
      floatingActionButton: _permissionBlocked ? null : FloatingActionButton(onPressed: () => _openReminderSheet(), child: const Icon(Icons.alarm_add)),
    );
  }

  Widget _sectionHeader(String label) =>
      Padding(padding: const EdgeInsets.only(top: 10, bottom: 6), child: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 0.5, color: kMuted)));

  Widget _reminderCard(Map<String, Object?> r, {required bool past}) {
    return Opacity(
      opacity: past ? 0.65 : 1,
      child: Card(
        child: ListTile(
          title: Text(r['text'] as String),
          subtitle: Text(_formatWhen(r)),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            if (!past) IconButton(icon: const Icon(Icons.edit_outlined, size: 20), onPressed: () => _openReminderSheet(reminder: r)),
            IconButton(icon: const Icon(Icons.delete_outline, size: 20, color: kAccentDim), onPressed: () => _remove(r)),
          ]),
        ),
      ),
    );
  }
}
