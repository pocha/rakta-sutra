# Track Blood

A local-first blood report tracker: import PDF blood reports, see every
marker's trend over time, journal health notes, and set reminders. Personal
health data — reports, marker values, journal notes, reminder text — never
leaves the device it's entered on.

This repo has three pieces:

- **Root (this directory)** — the web app, a plain HTML/JS page hosted at
  [track-blood.pocha.fyi](https://track-blood.pocha.fyi) via GitHub Pages.
- **`mobile/`** — the Android/iOS app (Capacitor + Svelte 5), the primary way
  people use Track Blood day-to-day.
- **`functions/`** — a small Firebase Cloud Functions backend that exists
  solely to deliver reminder push notifications reliably (see
  "Privacy & architecture notes" below for why this needs a backend at all).

The web app and mobile app share one parsing engine (`parser-core.mjs`, at
the repo root) — the same keyword-matching/marker-extraction logic runs on
both, so a fix here should be checked against both surfaces.

## Prerequisites

- Node.js 18+ and npm (all three pieces need this)
- **Mobile — Android**: Android Studio (SDK + emulator or a physical device)
- **Mobile — iOS**: a Mac with Xcode (dependencies are managed via Swift
  Package Manager — no CocoaPods needed)
- **Backend**: the [Firebase CLI](https://firebase.google.com/docs/cli) and
  `gcloud`, both authenticated against the `track-blood` GCP/Firebase project

---

## Web app (root)

The original, browser-only version of the app — upload a PDF, see extracted
markers, no install needed. No build step: `index.html` loads `app.js`
directly as an ES module.

### Setup

```bash
npm install   # only needed for test.js's pdfjs-dist dependency
```

Open `index.html` directly in a browser, or serve the directory with any
static file server, to develop.

### Test

```bash
node test.js
```

Parses the sample PDFs (`orange.pdf`, `tata-1mg.pdf`, `thyrocare.pdf`) through
`parser-core.mjs` and prints every extracted marker + detected report date —
the quickest way to sanity-check a parsing change before touching the mobile
app's copy of the same logic.

### Deploy

Plain static hosting, no CI: push to the branch GitHub Pages serves (the
custom domain is set via the `CNAME` file), and the site updates immediately
— there's no build artifact to generate. `mobile/deploy.sh` also pushes here
directly when publishing a new Android APK (see below).

---

## Mobile app (`mobile/`)

Built with [Svelte 5](https://svelte.dev) + [Vite](https://vitejs.dev),
wrapped for iOS/Android with [Capacitor](https://capacitorjs.com). Everything
— uploaded PDFs, extracted markers, journal notes, reminders — is stored
on-device in an encrypted SQLite database; report PDFs live in the app's
private file sandbox.

### Setup

```bash
cd mobile
npm install
```

**Develop in a browser** (fast iteration, no device needed):

```bash
npm run dev
```

Opens at `http://localhost:5173`. SQLite runs via an in-browser WASM shim
(`jeep-sqlite`), so file picking and push notifications won't work here —
only on a real device or emulator. This shim needs `public/sql-wasm.wasm`
(already committed, copied from `node_modules/sql.js/dist/sql-wasm.wasm`) —
if it's ever missing (e.g. after a clean `node_modules` wipe), the page loads
a blank white screen with no console error, since the shim's `fetch` 404s
silently and `initDb()` never resolves. Re-run if that happens:

```bash
mkdir -p public && cp node_modules/sql.js/dist/sql-wasm.wasm public/
```

### Test

There's no automated UI test suite — this app is tested on-device. Two ways
to run it:

```bash
npm run cap:android   # builds, syncs, opens Android Studio — hit Run ▶
npm run cap:ios       # builds, syncs, opens Xcode (App.xcodeproj — no
                       # .xcworkspace, dependencies are SPM not CocoaPods) — hit Run ▶
```

Or deploy straight to a connected device/emulator without opening the IDE
(the Capacitor equivalent of `flutter run`):

```bash
npx cap run android    # requires JDK 21 on JAVA_HOME — source .env first
                        # (see .env.example) if the shell's default java is older
npx cap run ios
```

**Viewing logs** (the equivalent of `flutter logs`):

```bash
# Android — the app's JS console.log output plus Java crash output:
adb logcat -s "Capacitor/Console:V" chromium:V AndroidRuntime:E

# iOS — no CLI equivalent for a real device; use Xcode's Devices and
# Simulators window → select the device → "Open Console", then filter by
# process:App (the binary's PRODUCT_NAME, not the display name "Track Blood")
```

### Deploy

`./deploy.sh` builds a signed Android release APK and an iOS archive/IPA,
and (optionally) uploads the IPA straight to App Store Connect for
TestFlight. There's no Play Store / App Store listing — Android installs
directly from a downloaded APK, iOS goes through TestFlight.

**One-time setup:**

1. **Android signing key** (not committed):
   ```bash
   keytool -genkeypair -v -keystore ~/track-blood-release.keystore \
     -alias track-blood -keyalg RSA -keysize 2048 -validity 10000
   ```
   Then create `mobile/android/keystore.properties` (gitignored):
   ```
   storeFile=/absolute/path/to/track-blood-release.keystore
   storePassword=your-store-password
   keyAlias=track-blood
   keyPassword=your-key-password
   ```
2. **App Store Connect API key** — reuse an existing one from your Apple
   Developer account if you have it (these keys aren't per-app), but you'll
   need a **new app entry** in App Store Connect for this bundle ID
   (`fyi.pocha.trackblood`) before you can upload to it. Copy
   `mobile/.env.example` to `mobile/.env` and fill in your key details (this
   file also carries the JDK 21 `JAVA_HOME` override used above).
3. Open `mobile/ios/App/App.xcodeproj` in Xcode once to set your signing
   Team — `xcodebuild` needs that configured before it can archive.

**Usage** (from `mobile/`):

```bash
./deploy.sh                          # build Android APK + iOS IPA, no upload
./deploy.sh --android-only           # just the APK
./deploy.sh --ios-only               # just the IPA
source .env && ./deploy.sh --upload  # also upload the IPA to TestFlight
```

The APK is uploaded to Firebase Storage (`gs://track-blood.firebasestorage.app/releases/`)
and, by default, the root `index.html`'s download link is updated and pushed
so the website always serves the newest version. Pass `--no-commit` to skip
that. `--force` rebuilds the same `package.json` version again (normally the
script refuses to, as a reminder to bump it first).

**Versioning:** `package.json`'s `"version"` (plain semver, e.g. `1.2.3`) is
the single source of truth — bump it before each deploy. It becomes
Android's `versionName` and iOS's marketing version directly; `deploy.sh`
derives the integer `versionCode`/build number from the same semver
(`1.2.3` → `1002003`) rather than tracking it separately.

**Regenerating the app icon** — source lives at `mobile/resources/icon.png`
(see also `icon-foreground.png`/`icon-background.png` for the Android
adaptive-icon layers):

```bash
npm run icons
```

### Project structure

```
mobile/src/
  lib/
    parser.js         Thin wrapper around the shared parser-core.mjs
    db.js              SQLite schema + all queries (single source of truth)
    reports.js         Stores/reads original PDFs via the Filesystem plugin
    textParse.js       Offline journal/reminder text understanding (chrono-node
                       + the parser's own marker keywords — no LLM, no network)
    notifications.js  Talks to the reminder backend (functions/) to schedule/
                       cancel pushes; shows a local notification in the
                       foreground (see push.js)
    push.js            FCM registration + receiving — foreground display,
                       tap-to-open-Notifications-history, reschedule-failure
                       handling
    analytics.js       Firebase Analytics event logging (counts only)
    backup.js          Zip export/restore (see below)
    exportPdf.js        Consolidated tabular PDF for sharing with a doctor
    state.svelte.js    Shared UI state: active profile, active tab, screen
  components/
    ReportTab.svelte        Paged marker table (swipe between reports),
                            edit/add values, upload, view original PDF
    TimelineTab.svelte      Chronological feed of reports + notes; marker search
    ReminderTab.svelte      Upcoming/past reminders, add/edit/delete
    NotificationsScreen.svelte  History of tapped reminder notifications
    Drawer.svelte, TabBar.svelte, Fab.svelte, BackupScreen.svelte
```

### Backup & restore

The drawer menu has three data actions:

- **Share consolidated report (PDF)** — a clean, printable table (the most
  recent 3 reports, marker groups × date) handed to the native share sheet,
  for quick access to give to a doctor.
- **Backup data** — bundles the entire local database (every profile, PDF,
  reminder, and notification-tap history) into a single `.zip` and hands it
  to the native share sheet. The app's job ends there — where the user saves
  it (Files app, Drive, Dropbox, email) is entirely their choice.
- **Restore from backup** — opens the file picker for a `.zip`, and after an
  explicit confirmation (this replaces *all* current data), restores the
  database and report files from it, then reschedules push notifications for
  any restored, not-yet-done, future reminders.

This backup is **not encrypted** — deliberate, since the zip never leaves the
device automatically and the app has no cloud integration or key to manage.

---

## Backend (`functions/`)

Firebase Cloud Functions (2nd gen, TypeScript), project `track-blood`,
region `asia-south1`. Exists for one reason: on-device local-notification
scheduling (Android's AlarmManager) turned out to be unreliable — OS battery
optimization silently drops scheduled alarms. This backend uses Cloud Tasks
instead, so the OS's own push-delivery system (not app code) is responsible
for showing the notification, which works reliably even when the app is
fully killed.

### Setup

```bash
firebase login
firebase use track-blood     # or your own project alias, see .firebaserc
cd functions
npm install
```

Local smoke-testing also needs `gcloud auth application-default login`
against a project with access to the `REMINDER_PUSH_SECRET` secret.

### Test

```bash
npm run lint    # eslint
npm run build   # tsc
npm run smoke   # end-to-end smoke test against the deployed backend
```

`npm run smoke` (`smoke-test.js`) exercises the real, deployed
`scheduleReminder` → Cloud Task → `sendReminderPush` → (for recurring
reminders) self-reschedule chain — no mocking, real Cloud Tasks/Firestore
calls. It invokes `sendReminderPush` directly with the same payload Cloud
Tasks would send, rather than waiting on real clock time, so a full run
takes seconds. Uses a throwaway device id by default (so the push just logs
"no fcmToken" rather than delivering); set `SMOKE_TEST_DEVICE_ID` to an
already-registered real device id to also confirm actual delivery.

### Deploy

```bash
firebase deploy --only functions
firebase deploy --only firestore:rules,storage    # if rules changed
```

**Secrets:** `REMINDER_PUSH_SECRET` (a shared secret validating that
`sendReminderPush` is only ever called by Cloud Tasks) lives in Secret
Manager, not a `.env` file:

```bash
firebase functions:secrets:set REMINDER_PUSH_SECRET
```

### Architecture

- `registerDevice` — upserts `devices/{deviceId}` with the app's current FCM
  token.
- `scheduleReminder` / `cancelReminder` — create/delete a Cloud Task (queue
  `reminders`) targeting `sendReminderPush` at the reminder's `remindAt`.
  Every reminder, one-time or recurring, is a single Cloud Task — there's no
  separate Firestore state for recurring reminders.
- `sendReminderPush` — the Cloud Tasks HTTP target. Sends the push, and if
  the reminder is recurring, computes the next occurrence itself
  (`recurrence.ts`'s cadence math) and enqueues a fresh Cloud Task for it —
  a self-rescheduling chain, rather than a periodic sweep, so it fires at
  the exact scheduled second. If the reschedule step fails, it sends a
  distinct "please reopen and re-save this reminder" alert instead of
  silently breaking the chain.

**Privacy design:** the push itself only ever carries a fixed, generic alert
("You have a reminder") plus an opaque `notificationId` (the reminder's own
local SQLite row id) — never the actual reminder text, which never leaves
the device. The real text only ever surfaces on-device: the app looks it up
locally by `notificationId` when the user taps the notification, and logs it
to the in-app Notifications history at that point (untapped/dismissed
notifications aren't logged — this is a known, disclosed limitation, not a
bug).