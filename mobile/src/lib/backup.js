// ─────────────────────────────────────────────────────────────────────────────
// Local backup / restore — a plain, unencrypted zip the user is handed via the
// native share sheet (so they can save it to Files, Drive, Dropbox, email —
// whatever they choose). No cloud API, no key management: the app's job ends
// once the zip is generated; where it lives afterward is entirely up to the
// user.
// ─────────────────────────────────────────────────────────────────────────────
import JSZip from 'jszip';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import * as db from './db.js';
import { cancelReminder, scheduleReminder } from './notifications.js';

const REPORTS_DIR = 'reports';

async function readFileAsBase64(path) {
  const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
  return data;
}

export async function createBackupZip() {
  const data = await db.exportAllData();
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2));

  const filesFolder = zip.folder('files');
  for (const report of data.reports) {
    try {
      const base64 = await readFileAsBase64(report.file_path);
      filesFolder.file(report.file_path.replace(`${REPORTS_DIR}/`, ''), base64, { base64: true });
    } catch (e) {
      console.warn(`Skipping missing report file for backup: ${report.file_path}`, e);
    }
  }

  const zipBase64 = await zip.generateAsync({ type: 'base64' });
  const fileName = `track-blood-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const path = `backups/${fileName}`;
  await Filesystem.writeFile({ path, data: zipBase64, directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });

  await Share.share({ title: 'Track Blood Backup', url: uri });
  return uri;
}

// `zipBase64` comes from FilePicker's readData:true result.
export async function restoreFromZipBase64(zipBase64) {
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const manifestText = await zip.file('manifest.json').async('string');
  const { data } = JSON.parse(manifestText);

  // Cancel every currently-scheduled notification before we replace the
  // reminders table out from under them.
  const { reminders: currentReminders } = await db.exportAllData();
  for (const r of currentReminders) await cancelReminder(r.id).catch(() => {});

  // Replace stored report files with the ones from the backup.
  await Filesystem.rmdir({ path: REPORTS_DIR, directory: Directory.Data, recursive: true }).catch(() => {});
  const filesFolder = zip.folder('files');
  for (const report of data.reports) {
    const base64 = await filesFolder.file(report.file_path.replace(`${REPORTS_DIR}/`, '')).async('base64');
    await Filesystem.writeFile({ path: report.file_path, data: base64, directory: Directory.Data, recursive: true });
  }

  await db.importAllData(data);

  // Reschedule notifications for restored, not-yet-done, future reminders.
  const now = Date.now();
  for (const r of data.reminders) {
    if (r.done || new Date(r.remind_at).getTime() < now) continue;
    await scheduleReminder(r.id, r.text, r.remind_at, r.recurrence);
  }
}
