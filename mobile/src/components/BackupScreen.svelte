<script>
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import { createBackupZip, restoreFromZipBase64 } from '../lib/backup.js';

  let busy = $state(false);
  let statusMsg = $state('');
  let statusType = $state('info'); // 'info' | 'error'

  async function doBackup() {
    busy = true;
    statusType = 'info';
    statusMsg = 'Preparing backup…';
    try {
      await createBackupZip();
      statusMsg = 'Backup ready — choose where to save it.';
    } catch (e) {
      statusType = 'error';
      statusMsg = 'Backup failed: ' + e.message;
      console.error(e);
    } finally {
      busy = false;
    }
  }

  async function doRestore() {
    if (!confirm('Restoring a backup replaces ALL current data on this device (every profile, report, note, and reminder). Continue?')) return;
    busy = true;
    statusType = 'info';
    statusMsg = 'Pick a backup .zip file…';
    try {
      const result = await FilePicker.pickFiles({ types: ['application/zip'], readData: true });
      if (!result.files.length) { busy = false; statusMsg = ''; return; }
      statusMsg = 'Restoring…';
      await restoreFromZipBase64(result.files[0].data);
      statusMsg = 'Restore complete — reloading…';
      window.location.reload();
    } catch (e) {
      statusType = 'error';
      statusMsg = 'Restore failed: ' + e.message;
      console.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="backup-screen">
  <div class="card">
    <h2>Backup</h2>
    <p class="muted">
      Save everything — every profile, report, note, and reminder — as a single
      file. Nothing is encrypted or uploaded automatically; you choose where it
      goes (Files, Drive, Dropbox, email — whatever you pick from the share sheet).
    </p>
    <button class="btn btn-primary btn-block" disabled={busy} onclick={doBackup}>Create backup</button>
  </div>

  <div class="card">
    <h2>Restore</h2>
    <p class="muted">
      Pick a backup <code>.zip</code> file to restore from. This replaces
      <strong>all</strong> current data on this device.
    </p>
    <button class="btn btn-block" disabled={busy} onclick={doRestore}>Restore from backup…</button>
  </div>

  {#if statusMsg}
    <p class="status" class:error={statusType === 'error'}>{statusMsg}</p>
  {/if}
</div>

<style>
  .backup-screen { height: 100%; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  h2 { margin: 0 0 8px; font-size: 1rem; }
  p { margin: 0 0 14px; font-size: 0.88rem; line-height: 1.5; }
  code { background: var(--bg); padding: 1px 5px; border-radius: 4px; }
  .status { text-align: center; font-size: 0.85rem; color: var(--ok); }
  .status.error { color: var(--accent-dim); }
</style>
