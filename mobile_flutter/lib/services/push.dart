// Port of mobile/src/lib/push.js. The push itself only ever carries a
// fixed, generic alert (see /functions) — never the actual reminder text.
// A killed/backgrounded app has the OS display that generic alert
// natively; this only handles the app-is-running cases: foreground
// re-display (FCM doesn't auto-show there) and tap routing, which merges
// FCM's tap events with flutter_local_notifications' own separate ones
// (the foreground re-display) into the same lookup-and-navigate logic.
import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;
import 'package:flutter/material.dart';
import 'db.dart';
import 'notifications.dart';
import '../navigation.dart';
import '../screens/notifications_screen.dart';
import '../state/app_state.dart';

const _functionsBase = 'https://asia-south1-track-blood.cloudfunctions.net';

Future<void> _registerDeviceToken(String token) async {
  final deviceId = await Db.instance.getOrCreateDeviceId();
  await http.post(
    Uri.parse('$_functionsBase/registerDevice'),
    headers: {'Content-Type': 'application/json'},
    body: jsonEncode({'deviceId': deviceId, 'fcmToken': token}),
  );
}

Future<void> _handleForegroundMessage(RemoteMessage message) async {
  await showReminderNow(message.notification?.body ?? 'You have a reminder', message.data['notificationId'], message.data['type']);
}

// type == 'reschedule_failed' is a system alert (a recurring reminder's
// self-reschedule failed server-side) — logs the pushed text directly and
// routes to the Reminder tab to fix it, instead of Notifications history.
Future<void> _handleNotificationTap(AppState appState, String? notificationId, String? type, String? body) async {
  if (notificationId == null) return;
  if (type == 'reschedule_failed') {
    await Db.instance.logNotificationTap(int.tryParse(notificationId), body ?? 'A recurring reminder needs your attention.');
    appState.setActiveTab(2);
    return;
  }
  final reminder = await Db.instance.getReminderById(int.parse(notificationId));
  if (reminder == null) return;
  await Db.instance.logNotificationTap(reminder['id'] as int, reminder['text'] as String);
  // Notifications history is reached via the Drawer, not a tab — push it
  // directly via the global navigator key since there's no BuildContext here.
  navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => const NotificationsScreen()));
}

Future<void> initPush(AppState appState) async {
  await localNotifications.initialize(
    settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')),
    onDidReceiveNotificationResponse: (response) {
      final data = response.payload != null ? jsonDecode(response.payload!) as Map<String, dynamic> : const {};
      _handleNotificationTap(appState, data['notificationId'] as String?, data['type'] as String?, response.payload);
    },
  );

  // Silent registration — permission is only requested inside the
  // reminder-creation flow (ensureNotificationPermission), not here.
  try {
    final token = await FirebaseMessaging.instance.getToken();
    if (token != null) await _registerDeviceToken(token);
  } catch (err) {
    // ignore: avoid_print
    print('[push] getToken failed: $err');
  }

  FirebaseMessaging.instance.onTokenRefresh.listen((token) => _registerDeviceToken(token).catchError((_) {}));
  FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
  FirebaseMessaging.onMessageOpenedApp.listen((m) => _handleNotificationTap(appState, m.data['notificationId'], m.data['type'], m.notification?.body));

  final initial = await FirebaseMessaging.instance.getInitialMessage();
  if (initial != null) {
    await _handleNotificationTap(appState, initial.data['notificationId'], initial.data['type'], initial.notification?.body);
  }
}
