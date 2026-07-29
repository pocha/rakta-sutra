# Track Blood — Mobile App

A local-only mobile app for tracking blood reports over time. Everything —
uploaded PDFs, extracted marker values, journal notes, reminders — is stored
on-device only. Nothing is ever synced to a server.

Built with [Svelte 5](https://svelte.dev) + [Vite](https://vitejs.dev), wrapped
for iOS/Android with [Capacitor](https://capacitorjs.com). The PDF parsing
engine (`src/lib/parser.js`) is a direct port of the web app's `app.js` — same
keyword-matching logic, same marker list, no server, no network calls.

## Prerequisites

- Node.js 18+ and npm
- **For Android**: Android Studio (with an SDK + emulator or a physical device)
- **For iOS**: a Mac with Xcode and CocoaPods (`sudo gem install cocoapods`)

## Install

```bash
cd mobile
npm install
```

## Develop in a browser (fast iteration)

```bash
npm run dev
```

Opens at `http://localhost:5173`. SQLite runs via an in-browser WASM shim
(`jeep-sqlite`) so you can develop the UI without a device — file picking and
push-style local notifications won't work in this mode, only on a real device
or emulator.

This shim needs `public/sql-wasm.wasm` to exist (already committed) — it's
copied from `node_modules/sql.js/dist/sql-wasm.wasm`. If it's ever missing
(e.g. after a clean `node_modules` wipe before `sql.js` is installed), the
page loads a blank white screen with no console error, because the shim's
`fetch` 404s silently and the app's `initDb()` promise never resolves. If
that happens, re-run:

```bash
mkdir -p public && cp node_modules/sql.js/dist/sql-wasm.wasm public/
```

## Run on Android

```bash
npm run cap:android
```

This builds the web app, copies it into the native project, and opens Android
Studio. From there, hit Run ▶ on an emulator or a connected device.

To just sync changes without opening Android Studio:

```bash
npm run cap:sync
```

## Run on iOS

```bash
npm run cap:ios
```

This builds the web app, copies it into the native project, and opens Xcode.
From there, select a simulator or a connected device and hit Run ▶.

The first time, Xcode may need CocoaPods installed for the project:

```bash
cd ios/App && pod install && cd ../..
```

## Regenerating the app icon

The source icon lives at `resources/icon.png` (a 1024×1024 crop of the brand
logo, glyph only, no text — see `resources/icon-foreground.png` /
`icon-background.png` for the Android adaptive-icon layers). To regenerate
icons/splash screens into both native projects after changing it:

```bash
npm run icons
```

## Project structure

```
src/
  lib/
    parser.js         PDF parsing engine (ported from app.js, framework-free)
    db.js              SQLite schema + all queries (single source of truth)
    reports.js         Stores/reads original PDFs via the Filesystem plugin
    textParse.js        Offline journal/reminder text understanding (chrono-node
                         + the parser's own marker keywords — no LLM, no network)
    notifications.js  Schedules local (on-device) reminder notifications
    state.svelte.js    Shared UI state: active profile, active tab
  components/
    ReportTab.svelte    Paged marker table (swipe between reports), edit/add
                        values, upload, view original PDF
    TimelineTab.svelte  Chronological feed of reports + notes; marker search
    ReminderTab.svelte  Upcoming/past reminders, add/edit/delete
    ProfileMenu.svelte, TabBar.svelte, Fab.svelte, MoreMenu.svelte
  lib/
    backup.js          Zip export/restore (see "Backup & restore" below)
    exportPdf.js        Consolidated tabular PDF for sharing with a doctor
```

## Backup & restore

The "⋮" menu (top right) has three actions:

- **Share consolidated report (PDF)** — generates a clean, printable table
  (marker groups × every report date, like the CSV export) and hands it to
  the native share sheet, so it can go straight to WhatsApp, email, or
  whatever the user picks — the point being quick access to hand to a doctor.
- **Backup data** — bundles the entire local database (every profile) plus
  all stored PDFs into a single `.zip`, and hands *that* to the native share
  sheet too. The app's job ends there: where the user saves it (Files app,
  Drive, Dropbox, email to themselves) is entirely their choice.
- **Restore from backup** — opens the file picker for a `.zip`, and after an
  explicit confirmation (this replaces *all* current data, every profile),
  restores the database and report files from it.

This backup is **not encrypted**. That was a deliberate choice: the zip never
leaves the device automatically, and the app has no cloud integration or key
to manage — it's the same trust model as any other file the user chooses to
save or send themselves. If cloud auto-sync is ever added later, revisit
this — a passphrase-derived encryption key would be needed again once the
app itself starts moving data off-device.

## Data & privacy notes

- All data is stored in an encrypted local SQLite database
  (`capacitor.config.json` → `CapacitorSQLite.iosIsEncryption` /
  `androidIsEncryption`) plus the app's private file sandbox for PDFs.
- Nothing is transmitted anywhere — there is no backend, no analytics, no
  crash reporting wired in. Keep it that way if you add any third-party SDK.
- Journal and reminder text parsing (marker keyword matching, date/time/
  recurrence extraction) runs entirely on-device via `chrono-node` and plain
  keyword matching — no cloud LLM call, by design.
