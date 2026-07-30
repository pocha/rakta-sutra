// ─────────────────────────────────────────────────────────────────────────────
// FCM registration + receiving. The push itself only ever carries an opaque
// notificationId (the reminder's own SQLite row id) — never reminder text.
// On receipt, look the id up locally and show a normal notification now (see
// showReminderNow in notifications.js). Scheduling the push in the first
// place happens server-side, triggered from notifications.js's
// scheduleReminder/cancelReminder.
// ─────────────────────────────────────────────────────────────────────────────
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { getOrCreateDeviceId, getReminderById } from './db.js';
import { showReminderNow } from './notifications.js';
import { logAnalyticsEvent } from './analytics.js';

const FUNCTIONS_BASE = 'https://asia-south1-track-blood.cloudfunctions.net';

async function registerDeviceToken(token) {
  const deviceId = await getOrCreateDeviceId();
  await fetch(`${FUNCTIONS_BASE}/registerDevice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, fcmToken: token }),
  });
}

async function handleDataMessage(notification) {
  const notificationId = notification?.data?.notificationId;
  if (!notificationId) return;
  const reminder = await getReminderById(Number(notificationId));
  if (!reminder) return;
  await showReminderNow(reminder.text);
  await logAnalyticsEvent('notification_sent');
}

export async function initPush() {
  // Silent registration attempt — permission (alert/sound/badge) is only
  // requested inside the reminder-creation flow (ensureNotificationPermission
  // in notifications.js), not here. On Android this succeeds unconditionally;
  // on iOS, getToken() may need permission granted first, in which case this
  // simply no-ops until the user creates their first reminder and the plugin
  // is asked again there.
  try {
    const { token } = await FirebaseMessaging.getToken();
    await registerDeviceToken(token);
  } catch (err) {
    console.error('[push] getToken failed:', err);
  }

  await FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
    await registerDeviceToken(token).catch((err) => console.error('[push] token resync failed:', err));
  });

  await FirebaseMessaging.addListener('notificationReceived', async (event) => {
    await handleDataMessage(event.notification).catch((err) => console.error('[push] handling failed:', err));
  });
}
