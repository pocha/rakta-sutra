<script>
  // In-app view of a report's original PDF, rendered page-by-page onto
  // <canvas> via pdf.js — NOT an iframe/blob-URL viewer. Android's system
  // WebView (unlike desktop Chrome) has no built-in inline PDF renderer, so
  // that approach showed a blank pane; pdf.js sidesteps this entirely since
  // it paints PDFs itself using plain Canvas2D, the same API the app's
  // trend chart already renders with successfully on this device.
  //
  // Quick/for-testing: password-protected source PDFs aren't handled here
  // yet (the password given at import time isn't persisted) — deferred.
  import { pdfjsLib } from '../lib/parser.js';
  import { readReportFile } from '../lib/reports.js';

  let { filePath } = $props();

  let containerEl = $state();
  let loading = $state(true);
  let failed = $state(false);
  let failReason = $state('');

  $effect(() => {
    let cancelled = false;
    loading = true;
    failed = false;
    if (containerEl) containerEl.innerHTML = '';

    (async () => {
      const buf = await readReportFile(filePath);
      if (cancelled) return;
      if (!buf) { loading = false; failed = true; failReason = "Couldn't read the file."; return; }

      try {
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        if (cancelled) return;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;

          // Scale to the container's own width so pages fill the screen
          // edge-to-edge regardless of the PDF's native page size.
          const containerWidth = containerEl?.clientWidth || 360;
          const unscaledViewport = page.getViewport({ scale: 1 });
          const scale = containerWidth / unscaledViewport.width;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'pdf-page';
          containerEl?.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        loading = false;
      } catch (err) {
        if (cancelled) return;
        loading = false;
        failed = true;
        failReason = err.name === 'PasswordException'
          ? 'This PDF is password-protected — viewing it here isn\'t supported yet.'
          : `Couldn't render this PDF (${err.message}).`;
        console.error('[PdfViewer] render failed:', err.message);
      }
    })();

    return () => { cancelled = true; };
  });
</script>

<div class="pdf-scroll">
  {#if loading}<p class="pdf-status">Loading PDF…</p>{/if}
  {#if failed}<p class="pdf-status">{failReason}</p>{/if}
  <div class="pdf-pages" bind:this={containerEl}></div>
</div>

<style>
  .pdf-scroll { width: 100%; height: 100%; overflow-y: auto; overscroll-behavior: contain; background: var(--bg); }
  .pdf-pages { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 32px; }
  .pdf-pages :global(canvas.pdf-page) { max-width: 100%; box-shadow: var(--shadow-sm); }
  .pdf-status { color: var(--muted); text-align: center; padding: 40px 20px; }
</style>
