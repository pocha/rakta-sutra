// Port of mobile/src/lib/notifications.js. Reminder scheduling lives
// server-side (Cloud Tasks/Scheduler, see /functions) — this only talks to
// that backend to schedule/cancel a push, and shows the local re-display
// notification when a push arrives while the app is in the foreground
// (see push.dart). Reminder text never leaves the device.
import 'dart:convert';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';
import 'db.dart';

const _functionsBase = 'https://asia-south1-track-blood.cloudfunctions.net';

final FlutterLocalNotificationsPlugin localNotifications = FlutterLocalNotificationsPlugin();

Future<bool> ensureNotificationPermission() async {
  final status = await Permission.notification.status;
  if (status.isGranted) return true;
  return (await Permission.notification.request()).isGranted;
}

// Read-only check (never prompts) — used to gate the reminder-creation UI.
Future<PermissionStatus> getNotificationPermissionState() => Permission.notification.status;

Future<Map<String, dynamic>> _callFunction(String name, Map<String, dynamic> payload) async {
  final res = await http.post(Uri.parse('$_functionsBase/$name'), headers: {'Content-Type': 'application/json'}, body: jsonEncode(payload));
  if (res.statusCode != 200) throw Exception('$name failed: ${res.statusCode}');
  return jsonDecode(res.body) as Map<String, dynamic>;
}

// Fires a local notification right now — used when a push arrives while the
// app is in the foreground, since the OS doesn't auto-display FCM alerts there.
Future<void> showReminderNow(String text, String? notificationId, String? type) async {
  await localNotifications.show(
    id: DateTime.now().millisecondsSinceEpoch.remainder(2147483647),
    title: 'Track Blood',
    body: text,
    payload: jsonEncode({'notificationId': notificationId, 'type': type}),
    notificationDetails: const NotificationDetails(
      android: AndroidNotificationDetails('reminders', 'Reminders', importance: Importance.high, priority: Priority.high),
    ),
  );
}

Future<int> scheduleReminder(int id, String text, String remindAtIso, String? recurrence) async {
  final granted = await ensureNotificationPermission();
  if (!granted) return id;
  final deviceId = await Db.instance.getOrCreateDeviceId();
  await _callFunction('scheduleReminder', {'deviceId': deviceId, 'notificationId': id, 'remindAt': remindAtIso, 'recurrence': recurrence});
  return id;
}

Future<void> cancelReminder(int id) async {
  final deviceId = await Db.instance.getOrCreateDeviceId();
  await _callFunction('cancelReminder', {'deviceId': deviceId, 'notificationId': id});
}
