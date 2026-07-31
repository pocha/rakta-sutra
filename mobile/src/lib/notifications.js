// ─────────────────────────────────────────────────────────────────────────────
// Reminder delivery: scheduling now lives server-side (Cloud Tasks for
// one-time reminders, a Cloud Scheduler sweep for recurring ones — see
// /functions) because on-device AlarmManager scheduling proved unreliable.
// This file only talks to that backend to schedule/cancel a push. Reminder
// text itself never leaves the device — only the reminder's own id (as an
// opaque notificationId) and its remind-at time/recurrence rule are sent;
// the push that eventually arrives carries a fixed generic alert, not the
// text (see /functions and push.js).
// ─────────────────────────────────────────────────────────────────────────────
import { LocalNotifications } from '@capacitor/local-notifications';
import { getOrCreateDeviceId } from './db.js';

const FUNCTIONS_BASE = 'https://asia-south1-track-blood.cloudfunctions.net';

export async function ensureNotificationPermission() {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'granted') return true;
  const result = await LocalNotifications.requestPermissions();
  return result.display === 'granted';
}

// Read-only check (never prompts) — used to gate the reminder-creation UI.
// 'denied' means the user was already asked and said no; 'prompt' means they
// haven't been asked yet, which shouldn't block anything.
export async function getNotificationPermissionState() {
  const { display } = await LocalNotifications.checkPermissions();
  return display;
}

async function callFunction(name, payload) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
  return res.json();
}

// Fires a local notification right now — used when a push arrives while the
// app is in the foreground (push.js), since the OS doesn't auto-display FCM
// alerts there. `notificationId`/`type` are stashed in `extra` so a tap on
// *this* notification (a separate tap-event system from FCM's, see push.js)
// can still be traced back to the reminder and handled the same way.
export async function showReminderNow(text, notificationId, type) {
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.floor(Math.random() * 2_147_483_647),
      title: 'Track Blood',
      body: text,
      extra: { notificationId, type },
    }],
  });
}

export async function scheduleReminder(id, text, remindAtISO, recurrence) {
  const granted = await ensureNotificationPermission();
  if (!granted) return id;
  const deviceId = await getOrCreateDeviceId();
  await callFunction('scheduleReminder', {
    deviceId,
    notificationId: id,
    remindAt: remindAtISO,
    recurrence: recurrence ?? null,
  });
  return id;
}

export async function cancelReminder(id) {
  const deviceId = await getOrCreateDeviceId();
  await callFunction('cancelReminder', { deviceId, notificationId: id });
}
