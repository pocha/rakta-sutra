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

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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

// Reads a previously-saved report PDF back out as an ArrayBuffer, for
// re-parsing against an updated config (see reparseAll.js). Returns null
// rather than throwing if the file is gone (e.g. deleted outside the app,
// or a restore that didn't bring files along) — callers should treat that
// report as unre-parseable and skip it rather than fail the whole batch.
export async function readReportFile(path) {
  try {
    const { data } = await Filesystem.readFile({ path, directory: Directory.Data });
    return fromBase64(data);
  } catch (err) {
    console.error('[reports] readReportFile failed for', path, err);
    return null;
  }
}

export async function deleteReportFile(path) {
  await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
}

export async function openReportFile(path) {
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  await FileOpener.open({ filePath: uri, contentType: 'application/pdf' });
}
