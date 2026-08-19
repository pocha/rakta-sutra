// Port of NotificationsScreen.svelte — history of tapped notifications only
// (untapped/dismissed ones aren't logged; the push itself never carries the
// real reminder text, only a generic alert — see notifications.dart).
import 'package:flutter/material.dart';
import '../services/db.dart';
import '../theme.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  static String _formatWhen(String iso) {
    final then = DateTime.parse('${iso.replaceFirst(' ', 'T')}Z');
    final diff = DateTime.now().difference(then);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} minute${diff.inMinutes == 1 ? '' : 's'} ago';
    if (diff.inHours < 24) return '${diff.inHours} hour${diff.inHours == 1 ? '' : 's'} ago';
    return then.toLocal().toString().substring(0, 16);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: FutureBuilder<List<Map<String, Object?>>>(
        future: Db.instance.listNotificationLog(),
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final entries = snap.data!;
          return ListView(padding: const EdgeInsets.all(16), children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(color: const Color(0xFFFFF6D8), borderRadius: BorderRadius.circular(10)),
              child: const Text('Only showing notifications you tapped.', style: TextStyle(color: Color(0xFF8A6D1A), fontSize: 13)),
            ),
            if (entries.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('No notifications yet.', style: TextStyle(color: kMuted)))),
            for (final e in entries)
              Card(
                child: ListTile(
                  title: Text(e['text'] as String),
                  subtitle: Text(_formatWhen(e['tapped_at'] as String)),
                ),
              ),
          ]);
        },
      ),
    );
  }
}
