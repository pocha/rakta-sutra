// ─────────────────────────────────────────────────────────────────────────────
// Usage analytics (Firebase Analytics / GA4) — counts and event names only,
// never report values, journal text, or reminder text. A failure here should
// never break the feature it's attached to.
// ─────────────────────────────────────────────────────────────────────────────
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';

export async function logAnalyticsEvent(name, params) {
  try {
    await FirebaseAnalytics.logEvent({ name, params });
  } catch (err) {
    console.error(`[analytics] logEvent(${name}) failed:`, err);
  }
}
