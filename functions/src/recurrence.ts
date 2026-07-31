// Server-side mirror of the cadence math in mobile/src/lib/notifications.js's
// toScheduleOn — daily/weekly/monthly/weekly:DOW — but computing the next
// absolute fire time (a Date) instead of a Capacitor `schedule` object. Only
// the cadence rule is shared here, never reminder text (that never leaves
// the device).
const WEEKDAY_INDEX: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

export function nextOccurrence(from: Date, recurrence: string): Date {
  const next = new Date(from);
  if (recurrence === "daily") {
    next.setDate(next.getDate() + 1);
    return next;
  }
  if (recurrence === "weekly") {
    next.setDate(next.getDate() + 7);
    return next;
  }
  if (recurrence === "monthly") {
    // setMonth() alone overflows short months (Jan 31 + 1 month -> Mar 3, since
    // Feb has no 31st) — clamp to the target month's actual last day instead.
    const day = next.getDate();
    const targetMonth = next.getMonth() + 1;
    const daysInTargetMonth = new Date(next.getFullYear(), targetMonth + 1, 0).getDate();
    next.setMonth(targetMonth, Math.min(day, daysInTargetMonth));
    return next;
  }
  if (recurrence.startsWith("weekly:")) {
    const target = WEEKDAY_INDEX[recurrence.slice(7)];
    if (target === undefined) {
      throw new Error(`Unknown weekday in recurrence: ${recurrence}`);
    }
    next.setDate(next.getDate() + 1);
    while (next.getDay() !== target) next.setDate(next.getDate() + 1);
    return next;
  }
  throw new Error(`Unknown recurrence: ${recurrence}`);
}
