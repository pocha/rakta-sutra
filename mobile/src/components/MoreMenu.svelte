<script>
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import { appState } from '../lib/state.svelte.js';
  import { createBackupZip, restoreFromZipBase64 } from '../lib/backup.js';
  import { generateConsolidatedReportPdf } from '../lib/exportPdf.js';

  let { onClose } = $props();
  let busy = $state(false);
  let statusMsg = $state('');

  const activeProfileName = $derived(
    appState.profiles.find(p => p.id === appState.activeProfileId)?.name ?? ''
  );

  async function doBackup() {
    busy = true;
    statusMsg = 'Preparing backup…';
    try {
      await createBackupZip();
      statusMsg = '';
      onClose();
    } catch (e) {
      statusMsg = 'Backup failed: ' + e.message;
      console.error(e);
    } finally {
      busy = false;
    }
  }

  async function doRestore() {
    if (!confirm('Restoring a backup replaces ALL current data on this device (every profile, report, note, and reminder). Continue?')) return;
    busy = true;
    statusMsg = 'Pick a backup .zip file…';
    try {
      const result = await FilePicker.pickFiles({ types: ['application/zip'], readData: true });
      if (!result.files.length) { busy = false; statusMsg = ''; return; }
      statusMsg = 'Restoring…';
      await restoreFromZipBase64(result.files[0].data);
      statusMsg = '';
      window.location.reload();
    } catch (e) {
      statusMsg = 'Restore failed: ' + e.message;
      console.error(e);
    } finally {
      busy = false;
    }
  }

  async function doShareReport() {
    busy = true;
    statusMsg = 'Generating PDF…';
    try {
      await generateConsolidatedReportPdf(appState.activeProfileId, activeProfileName);
      statusMsg = '';
      onClose();
    } catch (e) {
      statusMsg = 'Could not generate PDF: ' + e.message;
      console.error(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="overlay" role="button" tabindex="0" onclick={onClose}
     onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onClose()}>
  <div class="sheet" role="presentation" onclick={e => e.stopPropagation()}>
    <h2>More</h2>
    {#if statusMsg}<p class="status">{statusMsg}</p>{/if}
    <button disabled={busy} onclick={doShareReport}>📤 Share consolidated report (PDF)</button>
    <button disabled={busy} onclick={doBackup}>💾 Backup data (save as zip)</button>
    <button disabled={busy} onclick={doRestore}>♻️ Restore from backup</button>
    <button class="close" onclick={onClose}>Close</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; z-index: 100; }
  .sheet { background: #1a1a1a; width: 100%; border-radius: 16px 16px 0 0; padding: 20px; box-sizing: border-box; }
  h2 { margin: 0 0 12px; font-size: 1.1rem; }
  .status { color: #f0b8be; font-size: 0.85rem; margin: 0 0 10px; }
  .sheet button {
    display: block; width: 100%; text-align: left; padding: 12px; margin-bottom: 8px;
    background: #111; border: 1px solid #252525; border-radius: 10px; color: #f0f0f0; font-size: 0.95rem;
  }
  .sheet button:disabled { opacity: 0.5; }
  .close { text-align: center; background: none; color: #aaa; }
</style>
