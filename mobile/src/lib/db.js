// ─────────────────────────────────────────────────────────────────────────────
// Local SQLite layer — single source of truth for everything except the raw
// PDF files themselves (those live in Filesystem, see reports.js).
// Encrypted at rest (see capacitor.config.json: iosIsEncryption/androidIsEncryption).
// No ORM — five tables, hand-written queries, kept deliberately small.
// ─────────────────────────────────────────────────────────────────────────────
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';
import { parseRefRange } from './parser.js';

const DB_NAME = 'trackblood';
const sqlite = new SQLiteConnection(CapacitorSQLite);
let db;

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

  CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    canonical TEXT NOT NULL,
    value REAL NOT NULL,
    ref_range TEXT,
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

  console.log('[initDb] checking isConnection…');
  const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
  console.log('[initDb] isConnection:', isConn, '— opening connection…');
  db = isConn
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

  console.log('[initDb] db.open()…');
  await db.open();
  console.log('[initDb] db.execute(SCHEMA)…');
  await db.execute(SCHEMA);

  const { values } = await db.query('SELECT COUNT(*) as n FROM profiles');
  if (values[0].n === 0) {
    await db.run('INSERT INTO profiles (name) VALUES (?)', ['You']);
  }

  if (Capacitor.getPlatform() === 'web') await sqlite.saveToStore(DB_NAME);
  console.log('[initDb] done.');
  return db;
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
export async function addReport(profileId, reportDate, fileName, filePath, extractedMarkers) {
  await db.beginTransaction();
  try {
    const r = await db.run(
      'INSERT INTO reports (profile_id, report_date, file_name, file_path) VALUES (?, ?, ?, ?)',
      [profileId, reportDate, fileName, filePath],
      false
    );
    const reportId = r.changes.lastId;
    for (const [canonical, { value, ref }] of Object.entries(extractedMarkers)) {
      await db.run(
        'INSERT INTO markers (report_id, canonical, value, ref_range) VALUES (?, ?, ?, ?)',
        [reportId, canonical, value, ref ?? null],
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

export async function getReportMarkers(reportId) {
  return (await db.query(
    'SELECT * FROM markers WHERE report_id = ? ORDER BY canonical',
    [reportId]
  )).values;
}

export async function upsertMarker(reportId, canonical, value, refRange) {
  await db.run(
    `INSERT INTO markers (report_id, canonical, value, ref_range, manually_edited)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(report_id, canonical) DO UPDATE SET value = excluded.value, manually_edited = 1`,
    [reportId, canonical, value, refRange ?? null]
  );
  await persist();
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
function isOutOfRange(value, refRange) {
  const bounds = parseRefRange(refRange);
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
    `SELECT m.report_id, m.value, m.ref_range
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
      marker_count: markers.length,
      ref_count: markers.filter(m => isOutOfRange(m.value, m.ref_range)).length,
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
    `SELECT r.report_date as date, m.value, m.ref_range, 'value' as kind
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? AND m.canonical = ?`,
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
export async function getConsolidatedMatrix(profileId) {
  const rows = (await db.query(
    `SELECT r.report_date as date, m.canonical, m.value, m.ref_range
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ? ORDER BY r.report_date`,
    [profileId]
  )).values;

  const dates = [...new Set(rows.map(r => r.date))];
  const markers = {};
  const refRanges = {};
  for (const row of rows) {
    markers[row.canonical] ??= {};
    markers[row.canonical][row.date] = row.value;
    refRanges[row.canonical] ??= row.ref_range;
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
    `SELECT m.report_id, m.canonical, m.value, m.ref_range
     FROM markers m JOIN reports r ON r.id = m.report_id
     WHERE r.profile_id = ?`,
    [profileId]
  )).values;

  const reportDateById = Object.fromEntries(reports.map(r => [r.id, r.date]));
  const valuesByCanonical = {};
  const refRangeWithDate = {};
  for (const row of markerRows) {
    (valuesByCanonical[row.canonical] ??= {})[row.report_id] = row.value;
    const rowDate = reportDateById[row.report_id];
    const existing = refRangeWithDate[row.canonical];
    if (row.ref_range && (!existing || rowDate > existing.date)) {
      refRangeWithDate[row.canonical] = { range: row.ref_range, date: rowDate };
    }
  }
  const refRangeByCanonical = Object.fromEntries(
    Object.entries(refRangeWithDate).map(([k, v]) => [k, v.range])
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
export async function getOrCreateDeviceId() {
  const rows = (await db.query('SELECT value FROM device_settings WHERE key = ?', ['deviceId'])).values;
  if (rows[0]) return rows[0].value;
  const deviceId = crypto.randomUUID();
  await db.run('INSERT INTO device_settings (key, value) VALUES (?, ?)', ['deviceId', deviceId]);
  await persist();
  return deviceId;
}

// ── Backup / restore ─────────────────────────────────────────────────────────
// Full-database dump/replace — used by backup.js to build/restore a zip.
// Not profile-scoped: a backup always covers every profile.
const TABLES_IN_FK_ORDER = ['profiles', 'reports', 'markers', 'journal_entries', 'journal_marker_index', 'reminders'];

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
