// ─────────────────────────────────────────────────────────────────────────────
// Reminder delivery: scheduling now lives server-side (Cloud Tasks for
// one-time reminders, a Cloud Scheduler sweep for recurring ones — see
// /functions) because on-device AlarmManager scheduling proved unreliable.
// This file only (a) talks to that backend to schedule/cancel a push, and
// (b) shows a local notification immediately once a push actually arrives
// (see push.js). Reminder text itself never leaves the device — only the
// reminder's own id (as an opaque notificationId) and its remind-at time/
// recurrence rule are sent.
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

// Fires a local notification right now — used when a push arrives (push.js)
// and by nothing else; there's no "at a future time" local scheduling left.
export async function showReminderNow(text) {
  await LocalNotifications.schedule({
    notifications: [{
      id: Math.floor(Math.random() * 2_147_483_647),
      title: 'Track Blood',
      body: text,
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
