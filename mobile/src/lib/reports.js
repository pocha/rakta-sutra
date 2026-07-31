// ─────────────────────────────────────────────────────────────────────────────
// Stores the original uploaded PDF in the app's private sandbox (never synced —
// no iCloud/Google Drive backup, see Directory.Data + excludeFromBackup below).
// The DB only ever stores a path pointer to this file.
// ─────────────────────────────────────────────────────────────────────────────
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

const REPORTS_DIR = 'reports';

function toBase64(arrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function saveReportFile(profileId, fileName, arrayBuffer) {
  const path = `${REPORTS_DIR}/${profileId}-${Date.now()}-${fileName}`;
  await Filesystem.writeFile({
    path,
    data: toBase64(arrayBuffer),
    directory: Directory.Data,
    recursive: true,
  });
  return path;
}

export async function deleteReportFile(path) {
  await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
}

export async function openReportFile(path) {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  await FileOpener.open({ filePath: uri, contentType: 'application/pdf' });
}
