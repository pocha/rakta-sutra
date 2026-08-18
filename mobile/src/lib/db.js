// ─────────────────────────────────────────────────────────────────────────────
// Local SQLite layer — single source of truth for everything except the raw
// PDF files themselves (those live in Filesystem, see reports.js).
// Not encrypted — createConnection always opens in 'no-encryption' mode, and
// no secret is ever set, so iosIsEncryption/androidIsEncryption in
// capacitor.config.json are both false to match (a mismatch there makes the
// plugin try to touch iOS Keychain / Android MasterKey it isn't set up for).
// No ORM — five tables, hand-written queries, kept deliberately small.
// ─────────────────────────────────────────────────────────────────────────────
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { parseRefRange, refRangeForUnit, convertUnit, inValueRangeForUnit, valueLimitsForUnit } from './parser.js';

const DB_NAME = 'trackblood';
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db;

// Bumped whenever markers' shape changes in a way that can't be expressed
// as a plain `CREATE TABLE IF NOT EXISTS` (e.g. dropping/renaming a
// column) — see migrateMarkersSchemaIfNeeded() below. Pre-production, only
// a handful of test installs, so the migration is destructive (drop +
// reparse from the stored PDFs) rather than a careful in-place ALTER.
const MARKERS_SCHEMA_VERSION = 2;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    report_date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- value is nullable: NULL means the marker's name was matched during
  -- parsing but no usable value was found (or the user hasn't filled it in
  -- yet) — same row shape either way, so filling one in later is just the
  -- normal upsertMarker() update path, not a separate code path. unit is
  -- whatever unit the value is actually expressed in (as printed, or as
  -- entered) — there's no fixed canonical unit anymore; reference ranges
  -- are computed on demand from that unit via refRangeForUnit(), not
  -- stored per-row.
  CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    canonical TEXT NOT NULL,
    value REAL,
    unit TEXT,
    manually_edited INTEGER NOT NULL DEFAULT 0,
    UNIQUE(report_id, canonical)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journal_marker_index (
    journal_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    canonical TEXT NOT NULL,
    PRIMARY KEY (journal_id, canonical)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    remind_at TEXT NOT NULL,
    recurrence TEXT,
    notification_id INTEGER,
    done INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS device_settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- The push notification itself only ever carries a generic "you have a
  -- reminder" alert (see /functions) — this logs the real text, read from
  -- the reminders table, only when the user taps the notification and the
  -- app is actually running to look it up. Untapped/dismissed notifications
  -- are not logged (see the root README's backend Architecture section).
  CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reminder_id INTEGER,
    text TEXT NOT NULL,
    tapped_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_reports_profile ON reports(profile_id, report_date);
  CREATE INDEX IF NOT EXISTS idx_markers_canonical ON markers(canonical);
  CREATE INDEX IF NOT EXISTS idx_journal_profile ON journal_entries(profile_id, entry_date);
  CREATE INDEX IF NOT EXISTS idx_reminders_profile ON reminders(profile_id, remind_at);
`;

export async function initDb() {
  if (db) return db;
  console.log('[initDb] platform:', Capacitor.getPlatform());

  if (Capacitor.getPlatform() === 'web') {
    console.log('[initDb] importing jeep-sqlite…');
    const { defineCustomElement } = await import('jeep-sqlite/dist/components/jeep-sqlite');
    defineCustomElement();
    console.log('[initDb] jeep-sqlite imported, creating element…');
    const el = document.createElement('jeep-sqlite');
    document.body.appendChild(el);
    console.log('[initDb] waiting for customElements.whenDefined…');
    await customElements.whenDefined('jeep-sqlite');
    console.log('[initDb] element defined, calling initWebStore…');
    await sqlite.initWebStore();
    console.log('[initDb] initWebStore done.');
  }

  // A window.location.reload() (e.g. after restoring a backup) reloads the
  // WebView but not the native layer — the JS-side plugin's in-memory
  // connection-tracking map gets reset to empty, while the native side keeps
  // the actual open SQLite connection alive underneath it. isConnection()
  // alone then lies (reports false), so createConnection() below throws
  // "Connection trackblood already exists" — a known capacitor-community/
  // sqlite webview-reload issue. checkConnectionsConsistency() reconciles the
  // JS-side map against what's really open natively before we ask; the
  // try/catch is a second line of defense in case that reconciliation still
  // races with a very recent reload.
  console.log('[initDb] checking connection consistency…');
  await sqlite.checkConnectionsConsistency();
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
  console.log('[initDb] isConnection:', isConn, '— opening connection…');
  if (isConn) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    try {
      db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
    } catch (err) {
      console.warn('[initDb] createConnection failed (likely stale native connection after reload), retrieving instead:', err);
      db = await sqlite.retrieveConnection(DB_NAME, false);
    }
  }

  console.log('[initDb] db.open()…');
  await db.open();
  console.log('[initDb] db.execute(SCHEMA)…');
  await db.execute(SCHEMA);
  const migrated = await migrateMarkersSchemaIfNeeded();

  const { values } = await db.query('SELECT COUNT(*) as n FROM profiles');
  if (values[0].n === 0) {
    await db.run('INSERT INTO profiles (name) VALUES (?)', ['You']);
  }

  if (Capacitor.getPlatform() === 'web') await sqlite.saveToStore(DB_NAME);
  console.log('[initDb] done.');
  return { db, migrated };
}

// Drops + recreates `markers` when its shape is out of date, since
// `CREATE TABLE IF NOT EXISTS` above is a no-op against an already-existing
// table with the old column shape. Returns true when a migration actually
// ran, so the caller (main.js) knows to trigger a full reparse — markers.js
// itself never calls reparseAll.js, to avoid a circular import (that file
// already imports from here).
async function migrateMarkersSchemaIfNeeded() {
  const stored = await getDeviceSetting('markers_schema_version');
  if (Number(stored) >= MARKERS_SCHEMA_VERSION) return false;

  console.log('[initDb] markers schema out of date (stored:', stored, ', current:', MARKERS_SCHEMA_VERSION, ') — dropping and recreating');
  await db.execute('DROP TABLE IF EXISTS markers;');
  await db.execute(`
    CREATE TABLE markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
      canonical TEXT NOT NULL,
      value REAL,
      unit TEXT,
      manually_edited INTEGER NOT NULL DEFAULT 0,
      UNIQUE(report_id, canonical)
    );
    CREATE INDEX IF NOT EXISTS idx_markers_canonical ON markers(canonical);
  `);
  await setDeviceSetting('markers_schema_version', String(MARKERS_SCHEMA_VERSION));
  return true;
}

async function persist() {
  if (Capacitor.getPlatform() === 'web') await sqlite.saveToStore(DB_NAME);
}

// ── Profiles ────────────────────────────────────────────────────────────────
export async function listProfiles() {
  return (await db.query('SELECT * FROM profiles ORDER BY id')).values;
}
export async function addProfile(name) {
  const r = await db.run('INSERT INTO profiles (name) VALUES (?)', [name]);
  await persist();
  return r.changes.lastId;
}
export async function deleteProfile(id) {
  await db.run('DELETE FROM profiles WHERE id = ?', [id]);
  await persist();
}

// ── Reports & markers ───────────────────────────────────────────────────────
// unvaluedCanonicals: markers whose name matched somewhere in the PDF but
// that never got a plausible value (parsePDF()'s unvaluedCanonicals) —
// inserted as {value: null, unit: null} placeholder rows so the Report
// tab can show a blank, fillable card for them instead of nothing at all.
export async function addReport(profileId, reportDate, fileName, filePath, extractedMarkers, unvaluedCanonicals = []) {
  await db.beginTransaction();
  try {
    const r = await db.run(
      'INSERT INTO reports (profile_id, report_date, file_name, file_path) VALUES (?, ?, ?, ?)',
      [profileId, reportDate, fileName, filePath],
      false
    );
    const reportId = r.changes.lastId;
    for (const [canonical, { value, unit }] of Object.entries(extractedMarkers)) {
      await db.run(
        'INSERT INTO markers (report_id, canonical, value, unit) VALUES (?, ?, ?, ?)',
        [reportId, canonical, value, unit ?? null],
        false
      );
    }
    for (const canonical of unvaluedCanonicals) {
      if (extractedMarkers[canonical]) continue; // already inserted with a real value above
      await db.run(
        'INSERT OR IGNORE INTO markers (report_id, canonical, value, unit) VALUES (?, ?, NULL, NULL)',
        [reportId, canonical],
        false
      );
    }
    await db.commitTransaction();
    await persist();
    return reportId;
  } catch (e) {
    await db.rollbackTransaction();
    throw e;
  }
}

export async function listReports(profileId) {
  return (await db.query(
    'SELECT * FROM reports WHERE profile_id = ? ORDER BY report_date DESC',
    [profileId]
  )).values;
}

// Every report across every profile — used by reparseAll.js, which isn't
// scoped to whichever profile is currently active.
export async function listAllReports() {
  return (await db.query('SELECT * FROM reports ORDER BY report_date DESC')).values;
}

// Replaces a report's auto-extracted markers with a fresh extraction, without
// touching any marker the user has hand-corrected (manually_edited = 1) for
// this report — those rows are neither deleted nor overwritten. A fresh
// value for a canonical the user already corrected is silently dropped by
// INSERT OR IGNORE, since the manually-edited row still occupies that
// (report_id, canonical) UNIQUE slot.
export async function replaceAutoExtractedMarkers(reportId, extractedMarkers, unvaluedCanonicals = []) {
  await db.beginTransaction();
  try {
    await db.run('DELETE FROM markers WHERE report_id = ? AND manually_edited = 0', [reportId], false);
    for (const [canonical, { value, unit }] of Object.entries(extractedMarkers)) {
      await db.run(
        'INSERT OR IGNORE INTO markers (report_id, canonical, value, unit) VALUES (?, ?, ?, ?)',
        [reportId, canonical, value, unit ?? null],
        false
      );
    }
    for (const canonical of unvaluedCanonicals) {
      if (extractedMarkers[canonical]) continue;
      await db.run(
        'INSERT OR IGNORE INTO markers (report_id, canonical, value, unit) VALUES (?, ?, NULL, NULL)',
        [reportId, canonical],
        false
      );
    }
    await db.commitTransaction();
    await persist();
  } catch (e) {
    await db.rollbackTransaction();
    throw e;
  }
}

export async function getReportMarkers(reportId) {
  return (await db.query(
    'SELECT * FROM markers WHERE report_id = ? ORDER BY canonical',
    [reportId]
  )).values;
}

export async function upsertMarker(reportId, canonical, value, unit) {
  await db.run(
    `INSERT INTO markers (report_id, canonical, value, unit, manually_edited)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(report_id, canonical) DO UPDATE SET value = excluded.value, unit = excluded.unit, manually_edited = 1`,
    [reportId, canonical, value, unit ?? null]
  );
  await persist();
}

// Unit-switch flow for the Report tab's per-marker unit dropdown: converts
// the marker's currently-stored value into `newUnit` and only saves if the
// converted value is still physiologically plausible — a unit switch is a
// UI action, not a manual value correction, so it shouldn't be able to
// silently write an implausible number just because the dropdown changed.
// Returns { saved: true } on success, or { saved: false, range: [lo, hi] }
// (range in newUnit, for a "value must be between X and Y" message) when
// the conversion fails the check and nothing was written.
export async function updateMarkerUnit(reportId, canonical, newUnit) {
  const rows = (await db.query(
    'SELECT value, unit FROM markers WHERE report_id = ? AND canonical = ?',
    [reportId, canonical]
  )).values;
  const row = rows[0];
  if (!row || row.value === null) return { saved: false, range: null };

  const converted = convertUnit(canonical, row.value, row.unit ?? '', newUnit);
  if (!inValueRangeForUnit(canonical, converted, newUnit)) {
    return { saved: false, range: valueLimitsForUnit(canonical, newUnit) };
  }

  await db.run(
    `INSERT INTO markers (report_id, canonical, value, unit, manually_edited)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(report_id, canonical) DO UPDATE SET value = excluded.value, unit = excluded.unit, manually_edited = 1`,
    [reportId, canonical, converted, newUnit]
  );
  await persist();
  return { saved: true, range: null };
}

export async function deleteReport(id) {
  // ON DELETE CASCADE removes its markers too; caller is responsible for
  // deleting the underlying PDF file via Filesystem before/after this call.
  await db.run('DELETE FROM reports WHERE id = ?', [id]);
  await persist();
}

// ── Journal ─────────────────────────────────────────────────────────────────
export async function addJournalEntry(profileId, entryDate, text, canonicals) {
  await db.beginTransaction();
  try {
    const r = await db.run(
      'INSERT INTO journal_entries (profile_id, entry_date, text) VALUES (?, ?, ?)',
      [profileId, entryDate, text],
      false
    );
    const id = r.changes.lastId;
    for (const canonical of canonicals) {
      await db.run(
        'INSERT OR IGNORE INTO journal_marker_index (journal_id, canonical) VALUES (?, ?)',
        [id, canonical],
        false
      );
    }
    await db.commitTransaction();
    await persist();
    return id;
  } catch (e) {
    await db.rollbackTransaction();
    throw e;
  }
}

export async function updateJournalEntry(id, entryDate, text, canonicals) {
  await db.beginTransaction();
  try {
    await db.run(
      'UPDATE journal_entries SET entry_date = ?, text = ? WHERE id = ?',
      [entryDate, text, id],
      false
    );
    await db.run('DELETE FROM journal_marker_index WHERE journal_id = ?', [id], false);
    for (const canonical of canonicals) {
      await db.run(
        'INSERT OR IGNORE INTO journal_marker_index (journal_id, canonical) VALUES (?, ?)',
        [id, canonical],
        false
      );
    }
    await db.commitTransaction();
    await persist();
  } catch (e) {
    await db.rollbackTransaction();
    throw e;
  }
}

export async function deleteJournalEntry(id) {
  await db.run('DELETE FROM journal_entries WHERE id = ?', [id]);
  await persist();
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// Default feed: one row per report (date + marker count + out-of-range count),
// one row per journal note, merged and sorted by date (newest first).
function isOutOfRange(canonical, value, unit) {
  if (value === null) return false;
  const bounds = parseRefRange(refRangeForUnit(canonical, unit ?? ''));
  if (!bounds) return false;
  return (bounds.low !== null && value < bounds.low) || (bounds.high !== null && value > bounds.high);
}

export async function getTimelineFeed(profileId) {
  const reportRows = (await db.query(
    `SELECT id, report_date as date, file_name, file_path FROM reports WHERE profile_id = ? ORDER BY report_date DESC`,
    [profileId]
  )).values;

  // ref_count previously summed "has a reference range" (true for nearly every
  // marker) instead of "value actually falls outside it" — compute the real
  // out-of-range count in JS using the same parseRefRange logic the Report
  // tab uses, rather than a SQL SUM that can't parse "< 5", "80-100", etc.
  const markerRows = (await db.query(
    `SELECT m.report_id, m.canonical, m.value, m.unit
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ?`,
    [profileId]
  )).values;

  const markersByReport = {};
  for (const row of markerRows) {
    (markersByReport[row.report_id] ??= []).push(row);
  }

  const reports = reportRows.map(r => {
    const markers = markersByReport[r.id] ?? [];
    return {
      id: r.id,
      date: r.date,
      file_name: r.file_name,
      file_path: r.file_path,
      kind: 'report',
      marker_count: markers.filter(m => m.value !== null).length,
      ref_count: markers.filter(m => isOutOfRange(m.canonical, m.value, m.unit)).length,
    };
  });

  const notes = (await db.query(
    `SELECT id, entry_date as date, text, 'note' as kind FROM journal_entries
     WHERE profile_id = ? ORDER BY entry_date DESC`,
    [profileId]
  )).values;

  return [...reports, ...notes].sort((a, b) => b.date.localeCompare(a.date));
}

// Filtered feed for a single marker: every report value for that marker +
// every journal entry indexed against it, merged by date.
export async function getMarkerTimeline(profileId, canonical) {
  const values = (await db.query(
    `SELECT r.report_date as date, m.value, m.unit, 'value' as kind
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? AND m.canonical = ? AND m.value IS NOT NULL`,
    [profileId, canonical]
  )).values;

  const notes = (await db.query(
    `SELECT j.entry_date as date, j.text, 'note' as kind
     FROM journal_entries j JOIN journal_marker_index idx ON idx.journal_id = j.id
     WHERE j.profile_id = ? AND idx.canonical = ?`,
    [profileId, canonical]
  )).values;

  return [...values, ...notes].sort((a, b) => b.date.localeCompare(a.date));
}

// Full marker × date matrix for one profile — used to build the shareable
// consolidated PDF (every report's values, one column per date).
// Sharing a PDF is meant for a quick trend snapshot, not a full archive — cap
// it to the 3 most recent reports so it stays readable (and short) on paper.
const MAX_SHARED_REPORT_DATES = 3;

export async function getConsolidatedMatrix(profileId) {
  const rows = (await db.query(
    `SELECT r.report_date as date, m.canonical, m.value, m.unit
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? AND m.value IS NOT NULL ORDER BY r.report_date DESC`,
    [profileId]
  )).values;

  // Most-recent-first, both for picking which 3 dates to include and for the
  // resulting column order — readers expect the newest report on the left.
  const allDates = [...new Set(rows.map(r => r.date))];
  const dates = allDates.slice(0, MAX_SHARED_REPORT_DATES);
  const markers = {};
  const refRanges = {};
  for (const row of rows) {
    markers[row.canonical] ??= {};
    markers[row.canonical][row.date] = row.value;
    // Most-recent row's unit wins (rows arrive newest-first) — matches the
    // shared PDF's own newest-first column order.
    refRanges[row.canonical] ??= refRangeForUnit(row.canonical, row.unit ?? '');
  }
  return { dates, markers, refRanges };
}

// Consolidated table data for the Report tab: one row per marker ever seen
// for this profile (static), with each report's value keyed by report id so
// the UI can swap which report's values are shown without re-querying —
// only the "value" column swipes between reports, marker/range stay put.
export async function getConsolidatedReportData(profileId) {
  const reports = (await db.query(
    `SELECT id, report_date as date, file_name, file_path FROM reports WHERE profile_id = ? ORDER BY report_date DESC`,
    [profileId]
  )).values;

  const markerRows = (await db.query(
    `SELECT m.report_id, m.canonical, m.value, m.unit
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ?`,
    [profileId]
  )).values;

  const reportDateById = Object.fromEntries(reports.map(r => [r.id, r.date]));
  const valuesByCanonical = {};
  const unitWithDate = {};
  for (const row of markerRows) {
    (valuesByCanonical[row.canonical] ??= {})[row.report_id] = row.value;
    const rowDate = reportDateById[row.report_id];
    const existing = unitWithDate[row.canonical];
    if (row.unit && (!existing || rowDate > existing.date)) {
      unitWithDate[row.canonical] = { unit: row.unit, date: rowDate };
    }
  }
  // One ref range per canonical, in whichever unit the most recent report
  // used — a stopgap for the current spreadsheet-style Report tab, which
  // (unlike the upcoming per-card view) shows a single static range column
  // rather than one range per displayed unit.
  const refRangeByCanonical = Object.fromEntries(
    Object.entries(unitWithDate).map(([k, v]) => [k, refRangeForUnit(k, v.unit)])
  );

  return { reports, valuesByCanonical, refRangeByCanonical };
}

export async function listKnownMarkers(profileId) {
  return (await db.query(
    `SELECT DISTINCT m.canonical FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? ORDER BY m.canonical`,
    [profileId]
  )).values.map(v => v.canonical);
}

// The unit a marker's card/chart should default to displaying — whichever
// unit appears most often across this profile's own recorded history for
// that canonical (not necessarily the config's canonical default unit;
// this profile's reports might consistently use a different one). Ties
// broken by whichever unit belongs to the most recent report.
export async function getMajorityUnitByCanonical(profileId) {
  const rows = (await db.query(
    `SELECT m.canonical, m.unit, r.report_date as date
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? AND m.value IS NOT NULL AND m.unit IS NOT NULL AND m.unit != ''
     ORDER BY r.report_date DESC`,
    [profileId]
  )).values;

  const countsByCanonical = {};
  for (const row of rows) {
    const counts = (countsByCanonical[row.canonical] ??= {});
    counts[row.unit] = (counts[row.unit] ?? 0) + 1;
  }
  // Most-recent-first row order above means the first unit seen for a given
  // count is also the most recent one — a plain `>` (not `>=`) comparison
  // below keeps that first-seen unit on a tie, which is exactly "ties
  // broken by the most recent report's unit".
  const majorityByCanonical = {};
  for (const [canonical, counts] of Object.entries(countsByCanonical)) {
    let best = null, bestCount = 0;
    for (const [unit, count] of Object.entries(counts)) {
      if (count > bestCount) { best = unit; bestCount = count; }
    }
    majorityByCanonical[canonical] = best;
  }
  return majorityByCanonical;
}

// Every value ever recorded for one marker, newest first — the data source
// for MarkerChart.svelte. Each point carries its own native unit; the
// caller converts into whatever unit it wants to plot against (see
// convertUnit() in parser-core.mjs) rather than this function picking one.
export async function getMarkerChartSeries(profileId, canonical) {
  return (await db.query(
    `SELECT r.id as report_id, r.report_date as date, m.value, m.unit
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? AND m.canonical = ? AND m.value IS NOT NULL
     ORDER BY r.report_date DESC`,
    [profileId, canonical]
  )).values;
}

// ── Reminders ────────────────────────────────────────────────────────────────
export async function addReminder(profileId, text, remindAt, recurrence, notificationId) {
  const r = await db.run(
    'INSERT INTO reminders (profile_id, text, remind_at, recurrence, notification_id) VALUES (?, ?, ?, ?, ?)',
    [profileId, text, remindAt, recurrence ?? null, notificationId ?? null]
  );
  await persist();
  return r.changes.lastId;
}

export async function updateReminder(id, text, remindAt, recurrence, notificationId) {
  await db.run(
    'UPDATE reminders SET text = ?, remind_at = ?, recurrence = ?, notification_id = ? WHERE id = ?',
    [text, remindAt, recurrence ?? null, notificationId ?? null, id]
  );
  await persist();
}

export async function setReminderDone(id, done) {
  await db.run('UPDATE reminders SET done = ? WHERE id = ?', [done ? 1 : 0, id]);
  await persist();
}

export async function deleteReminder(id) {
  await db.run('DELETE FROM reminders WHERE id = ?', [id]);
  await persist();
}

export async function listReminders(profileId) {
  return (await db.query(
    'SELECT * FROM reminders WHERE profile_id = ? ORDER BY remind_at',
    [profileId]
  )).values;
}

export async function getReminderById(id) {
  const rows = (await db.query('SELECT * FROM reminders WHERE id = ?', [id])).values;
  return rows[0] ?? null;
}

// ── Device settings ──────────────────────────────────────────────────────────
// A tiny key/value table for device-scoped settings that aren't tied to any
// profile — currently just the stable deviceId used to register this
// install with the reminder-push backend.
// ── Notification history ─────────────────────────────────────────────────────
export async function logNotificationTap(reminderId, text) {
  await db.run('INSERT INTO notification_log (reminder_id, text) VALUES (?, ?)', [reminderId, text]);
  await persist();
}

export async function listNotificationLog() {
  return (await db.query('SELECT * FROM notification_log ORDER BY tapped_at DESC')).values;
}

// Generic device-scoped key/value read/write, backing reparseAll.js's
// "has the config or app version changed since the last reparse" checks —
// deliberately generic (unlike deviceId/multiSelectHint below) since both
// triggers just need to remember one opaque string across launches.
export async function getDeviceSetting(key) {
  const rows = (await db.query('SELECT value FROM device_settings WHERE key = ?', [key])).values;
  return rows[0]?.value ?? null;
}

export async function setDeviceSetting(key, value) {
  await db.run(
    `INSERT INTO device_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
  await persist();
}

export async function getOrCreateDeviceId() {
  const rows = (await db.query('SELECT value FROM device_settings WHERE key = ?', ['deviceId'])).values;
  if (rows[0]) return rows[0].value;
  const deviceId = crypto.randomUUID();
  await db.run('INSERT INTO device_settings (key, value) VALUES (?, ?)', ['deviceId', deviceId]);
  await persist();
  return deviceId;
}

export async function shouldShowMultiSelectHint() {
  const rows = (await db.query('SELECT value FROM device_settings WHERE key = ?', ['hideMultiSelectHint'])).values;
  return !rows[0];
}

export async function dismissMultiSelectHint() {
  await db.run(
    `INSERT INTO device_settings (key, value) VALUES ('hideMultiSelectHint', '1')
     ON CONFLICT(key) DO UPDATE SET value = '1'`
  );
  await persist();
}

// ── Backup / restore ─────────────────────────────────────────────────────────
// Full-database dump/replace — used by backup.js to build/restore a zip.
// Not profile-scoped: a backup always covers every profile.
const TABLES_IN_FK_ORDER = ['profiles', 'reports', 'markers', 'journal_entries', 'journal_marker_index', 'reminders', 'notification_log'];

export async function exportAllData() {
  const data = {};
  for (const table of TABLES_IN_FK_ORDER) {
    data[table] = (await db.query(`SELECT * FROM ${table}`)).values;
  }
  return data;
}

export async function importAllData(data) {
  await db.beginTransaction();
  try {
    await db.run('DELETE FROM profiles', [], false); // cascades to every child table
    // notification_log isn't FK-linked to profiles (it's history, not
    // per-profile data), so the cascade above doesn't clear it — do it
    // explicitly or a restore would just pile new rows on top of old ones.
    await db.run('DELETE FROM notification_log', [], false);
    for (const table of TABLES_IN_FK_ORDER) {
      const rows = data[table] ?? [];
      for (const row of rows) {
        const cols = Object.keys(row);
        const placeholders = cols.map(() => '?').join(', ');
        await db.run(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
          cols.map(c => row[c]),
          false
        );
      }
    }
    await db.commitTransaction();
    await persist();
  } catch (e) {
    await db.rollbackTransaction();
    throw e;
  }
}
