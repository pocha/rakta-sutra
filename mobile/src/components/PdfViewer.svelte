<script>
  // In-app view of a report's original PDF, via a blob URL fed to an
  // <iframe> — WebViews on both iOS and Android render PDFs natively that
  // way, far less code than a pdf.js canvas renderer, tried first per the
  // plan. Falls back to a plain message (not a custom renderer) if the
  // file can't be read at all — readReportFile() already returns null
  // rather than throwing for a missing/inaccessible file.
  import { readReportFile } from '../lib/reports.js';

  let { filePath } = $props();

  let blobUrl = $state(null);
  let loading = $state(true);
  let failed = $state(false);

  $effect(() => {
    let cancelled = false;
    let ownUrl = null;
    loading = true;
    failed = false;
    blobUrl = null;

    (async () => {
      const buf = await readReportFile(filePath);
      if (cancelled) return;
      if (!buf) { loading = false; failed = true; return; }
      ownUrl = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      blobUrl = ownUrl;
      loading = false;
    })();

    return () => {
      cancelled = true;
      if (ownUrl) URL.revokeObjectURL(ownUrl);
    };
  });
</script>

{#if loading}
  <p class="pdf-status">Loading PDF…</p>
{:else if failed}
  <p class="pdf-status">Couldn't load this report's original PDF.</p>
{:else}
  <iframe title="Original report PDF" src={blobUrl}></iframe>
{/if}

<style>
  iframe { width: 100%; height: 100%; border: none; background: #fff; display: block; }
  .pdf-status { color: var(--muted); text-align: center; padding: 40px 20px; }
</style>
