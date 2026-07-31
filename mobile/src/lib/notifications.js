// ─────────────────────────────────────────────────────────────────────────────
// Local (on-device) notification scheduling — no server, no push service.
// Recurrence is intentionally dumb (daily/weekly/monthly/weekly-on-day),
// matching the "easy interface for a future reminder" scope, not a full RRULE.
// ─────────────────────────────────────────────────────────────────────────────
import { LocalNotifications } from '@capacitor/local-notifications';

const WEEKDAY_TO_CHRONO = { SUN: 1, MON: 2, TUE: 3, WED: 4, THU: 5, FRI: 6, SAT: 7 };

export async function ensureNotificationPermission() {
  const { display } = await LocalNotifications.checkPermissions();
  if (display === 'granted') return true;
  const result = await LocalNotifications.requestPermissions();
  return result.display === 'granted';
}

function toScheduleOn(remindAtISO, recurrence) {
  const at = new Date(remindAtISO);
  if (!recurrence) return { at };
  if (recurrence === 'daily') return { every: 'day', on: { hour: at.getHours(), minute: at.getMinutes() } };
  if (recurrence === 'weekly') return { every: 'week', on: { hour: at.getHours(), minute: at.getMinutes() } };
  if (recurrence === 'monthly') return { every: 'month', on: { day: at.getDate(), hour: at.getHours(), minute: at.getMinutes() } };
  if (recurrence.startsWith('weekly:')) {
    const day = WEEKDAY_TO_CHRONO[recurrence.slice(7)];
    return { every: 'week', on: { weekday: day, hour: at.getHours(), minute: at.getMinutes() } };
  }
  return { at };
}

export async function scheduleReminder(id, text, remindAtISO, recurrence) {
  await ensureNotificationPermission();
  const schedule = toScheduleOn(remindAtISO, recurrence);
  await LocalNotifications.schedule({
    notifications: [{
      id,
      title: 'Track Blood',
      body: text,
      schedule,
    }],
  });
  return id;
}

export async function cancelReminder(id) {
  await LocalNotifications.cancel({ notifications: [{ id }] });
}
