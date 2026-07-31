// ─────────────────────────────────────────────────────────────────────────────
// FCM registration + receiving. The push itself only ever carries a fixed,
// generic alert (see /functions) — never the actual reminder text. On
// Android/iOS, a killed or backgrounded app has the OS display that generic
// alert natively, no app code involved. This file only needs to handle two
// cases where the app *is* running: showing it via a local notification in
// the foreground (the OS doesn't auto-display there), and — when the user
// taps the notification — looking up the real text locally, logging it to
// the in-app notification history (see notifications.js/db.js), and
// navigating straight to that history screen.
//
// Foreground re-display goes through @capacitor/local-notifications, which
// has its own separate tap-event system from FCM's — so both
// notificationActionPerformed (FCM, background/killed taps) and
// localNotificationActionPerformed (the foreground re-display) need to be
// handled, funneling into the same lookup-and-navigate logic.
//
// A push can also carry `type: 'reschedule_failed'` — sent by /functions
// when a recurring reminder's self-rescheduling Cloud Task chain breaks —
// which is handled distinctly (see handleNotificationTap).
// ─────────────────────────────────────────────────────────────────────────────
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { LocalNotifications } from '@capacitor/local-notifications';
import { getOrCreateDeviceId, getReminderById, logNotificationTap } from './db.js';
import { showReminderNow } from './notifications.js';
import { logAnalyticsEvent } from './analytics.js';
import { appState, openScreen } from './state.svelte.js';

const FUNCTIONS_BASE = 'https://asia-south1-track-blood.cloudfunctions.net';

async function registerDeviceToken(token) {
  const deviceId = await getOrCreateDeviceId();
  await fetch(`${FUNCTIONS_BASE}/registerDevice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, fcmToken: token }),
  });
}

async function handleForegroundNotification(notification) {
  await showReminderNow(
    notification?.body || 'You have a reminder',
    notification?.data?.notificationId,
    notification?.data?.type
  );
  await logAnalyticsEvent('notification_sent');
}

// `type: 'reschedule_failed'` is a system alert (a recurring reminder's
// self-reschedule failed server-side, see /functions), not an actual
// reminder firing — logging the *pushed* text (not a local DB lookup) and
// sending the user to the Reminder tab to fix it, instead of the
// Notifications history a normal reminder tap goes to.
async function handleNotificationTap(notificationId, type, body) {
  if (!notificationId) return;
  if (type === 'reschedule_failed') {
    await logNotificationTap(Number(notificationId), body || 'A recurring reminder needs your attention.');
    appState.activeTab = 'reminder';
    appState.screen = null;
    return;
  }
  const reminder = await getReminderById(Number(notificationId));
  if (!reminder) return;
  await logNotificationTap(reminder.id, reminder.text);
  openScreen('notifications');
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
    await handleForegroundNotification(event.notification).catch((err) => console.error('[push] foreground handling failed:', err));
  });

  await FirebaseMessaging.addListener('notificationActionPerformed', async (event) => {
    const n = event.notification;
    await handleNotificationTap(n?.data?.notificationId, n?.data?.type, n?.body)
      .catch((err) => console.error('[push] tap handling failed:', err));
  });

  await LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
    const n = event.notification;
    await handleNotificationTap(n?.extra?.notificationId, n?.extra?.type, n?.body)
      .catch((err) => console.error('[push] local notification tap handling failed:', err));
  });
}