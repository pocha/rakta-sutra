<script>
  import { onMount, tick } from 'svelte';
  import { Capacitor } from '@capacitor/core';
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import * as db from '../lib/db.js';
  import multiSelectHintImg from '../assets/multiselect-hint.jpg';
  import { parsePDF, MARKER_GROUPS, REF_RANGES } from '../lib/parser.js';
  import { saveReportFile } from '../lib/reports.js';
  import { appState, openMarkerDetail } from '../lib/state.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { logAnalyticsEvent } from '../lib/analytics.js';
  import Fab from './Fab.svelte';
  import Icon from './Icon.svelte';
  import ValueCell from './ValueCell.svelte';
  import PdfViewer from './PdfViewer.svelte';
  import Skeleton from './Skeleton.svelte';

  let { profileId } = $props();

  let loading = $state(true);
  let reports = $state([]);                // [{ id, date, file_name, file_path }] newest first
  let valuesByCanonical = $state({});      // canonical -> { [reportId]: {value, unit} }
  let pageIndex = $state(0);               // which report's value column is currently shown
  let activeSubTab = $state('extracted');  // 'extracted' | 'raw'
  let pagerEl = $state();
  let busy = $state(false);
  let statusMsg = $state('');
  let flashReportId = $state(null);        // briefly highlights the just-uploaded/just-jumped-to column

  let menuOpen = $state(false);            // FAB action menu
  let addMarkerModalOpen = $state(false);
  let multiSelectHintOpen = $state(false);
  let hideMultiSelectHintChecked = $state(false);
  let addCanonical = $state('');            // selected marker (empty until picked from suggestions)
  let addQuery = $state('');                // what the user is typing before picking one
  let addValue = $state('');

  const ALL_CANONICALS = Object.keys(REF_RANGES);

  onMount(refresh);

  $effect(() => {
    if (appState.jumpToReportId == null || !reports.length || !pagerEl) return;
    const idx = reports.findIndex(r => r.id === appState.jumpToReportId);
    if (idx >= 0) {
      activeSubTab = 'extracted';
      tick().then(() => pagerEl.scrollTo({ left: idx * pagerEl.clientWidth, behavior: 'instant' }));
      pageIndex = idx;
    }
    appState.jumpToReportId = null;
  });

  async function refresh() {
    loading = true;
    try {
      const data = await db.getConsolidatedReportData(profileId);
      reports = data.reports;
      valuesByCanonical = data.valuesByCanonical;
      if (pageIndex >= reports.length) pageIndex = 0;
    } finally {
      loading = false;
    }
  }

  const currentReport = $derived(reports[pageIndex]);

  const groupedRows = $derived.by(() => {
    const present = new Set(Object.keys(valuesByCanonical));
    const rows = [];
    for (const group of MARKER_GROUPS) {
      const inGroup = group.keys.filter(k => present.has(k));
      if (!inGroup.length) continue;
      rows.push({ header: group.label });
      for (const k of inGroup) rows.push({ canonical: k });
    }
    const ungrouped = [...present].filter(k => !MARKER_GROUPS.some(g => g.keys.includes(k)));
    if (ungrouped.length) {
      rows.push({ header: 'Other' });
      for (const k of ungrouped) rows.push({ canonical: k });
    }
    return rows;
  });

  const availableToAdd = $derived(
    currentReport ? ALL_CANONICALS.filter(c => valuesByCanonical[c]?.[currentReport.id] === undefined) : []
  );
  const addSuggestions = $derived(
    addQuery.trim().length >= 3
      ? availableToAdd.filter(c => c.toLowerCase().includes(addQuery.trim().toLowerCase())).slice(0, 8)
      : []
  );

  async function addMarkerToCurrentReport() {
    const v = parseFloat(addValue);
    if (!addCanonical || isNaN(v) || !currentReport) return;
    await db.upsertMarker(currentReport.id, addCanonical, v, '');
    resetAddMarkerForm();
    addMarkerModalOpen = false;
    await refresh();
  }

  function resetAddMarkerForm() {
    addCanonical = '';
    addQuery = '';
    addValue = '';
  }

  function pickAddSuggestion(canonical) {
    addCanonical = canonical;
    addQuery = canonical;
  }

  function relativeLabel(dateStr) {
    const days = Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (days < 365) return `${Math.round(days / 30)} month${Math.round(days / 30) > 1 ? 's' : ''} ago`;
    return `${Math.round(days / 365)} year${Math.round(days / 365) > 1 ? 's' : ''} ago`;
  }

  function onScroll(e) {
    const w = e.target.clientWidth;
    pageIndex = Math.round(e.target.scrollLeft / w);
  }

  // '‹' moves toward index-1 (newer report); '›' moves toward index+1 (older) —
  // matches reports[] being sorted newest-first.
  function goToPage(delta) {
    const target = Math.min(Math.max(pageIndex + delta, 0), reports.length - 1);
    pagerEl.scrollTo({ left: target * pagerEl.clientWidth, behavior: 'smooth' });
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function pickAndUpload() {
    menuOpen = false;
    // The multi-select hint is Android-only: iOS routes every cloud provider
    // (Dropbox, Drive, iCloud) through one system Files browser where
    // Apple's own "Select" affordance works consistently, so there's no
    // equivalent quirk to explain there.
    if (Capacitor.getPlatform() === 'android' && await db.shouldShowMultiSelectHint()) {
      hideMultiSelectHintChecked = false;
      multiSelectHintOpen = true;
      return;
    }
    await runPickAndUpload();
  }

  async function dismissMultiSelectHintAndUpload() {
    multiSelectHintOpen = false;
    if (hideMultiSelectHintChecked) await db.dismissMultiSelectHint();
    await runPickAndUpload();
  }

  // Tries to parse a (possibly password-protected) PDF, prompting for a
  // password and retrying as many times as the user is willing to. Returns
  // null if the user cancels the password prompt, so the caller can skip
  // just this one file rather than aborting the whole batch.
  async function parseWithPasswordRetry(file) {
    let password;
    for (;;) {
      try {
        // pdf.js takes ownership of the buffer passed to it (transferred to
        // its worker) and detaches it — even on a failed/password attempt —
        // so a fresh copy is needed on every attempt, not just every file.
        return await parsePDF(base64ToArrayBuffer(file.data), password);
      } catch (err) {
        if (err.name !== 'PasswordException') throw err;
        password = window.prompt(`"${file.name}" is password protected.\nEnter the password:`, '');
        if (!password) return null;
      }
    }
  }

  async function runPickAndUpload() {
    busy = true;
    statusMsg = 'Opening file picker…';
    try {
      const result = await FilePicker.pickFiles({ types: ['application/pdf'], readData: true });
      let lastUploadedId = null;
      const failed = [];
      // Seeded from what's already on file for this profile, then grown as
      // this batch runs — so uploading two same-dated PDFs in one go also
      // flags the second against the first, not just against pre-existing
      // reports. Same date is never a real conflict (reports are identified
      // by their own id, never by date — see reports/markers schema in
      // db.js), this is purely a "did you mean to do this" nudge.
      const seenDates = new Set(reports.map(r => r.date));
      for (const file of result.files) {
        try {
          statusMsg = `Reading "${file.name}"…`;
          const parsed = await parseWithPasswordRetry(file);
          if (!parsed) continue; // user cancelled the password prompt — skip this file

          const { date, dateAmbiguous, dateAlternate, extracted, unvaluedCanonicals } = parsed;
          let reportDate = date;
          // dateAmbiguous means the numeric day/month order genuinely could
          // go either way (e.g. "07/10/2025") — prompt with our best guess
          // pre-filled rather than silently picking one. Accepting the
          // default (just tapping OK) keeps `date` as-is; editing the field
          // corrects it.
          if (dateAmbiguous) {
            reportDate = window.prompt(
              `The date in "${file.name}" could be ${date} or ${dateAlternate} — which is correct?\nEdit below if neither is right (YYYY-MM-DD):`,
              date
            ) || date;
          } else if (!reportDate) {
            reportDate = window.prompt(`Could not detect a date in "${file.name}".\nEnter the report date (YYYY-MM-DD):`, '');
            if (!reportDate) continue;
          }
          if (seenDates.has(reportDate)) {
            const proceed = window.confirm(
              `You already have a report dated ${reportDate}.\n\n` +
              `Add "${file.name}" as a separate report for the same date anyway? ` +
              `You can remove either one later from the Timeline tab.`
            );
            if (!proceed) continue;
          }
          seenDates.add(reportDate);
          const path = await saveReportFile(profileId, file.name, base64ToArrayBuffer(file.data));
          lastUploadedId = await db.addReport(profileId, reportDate, file.name, path, extracted, unvaluedCanonicals);
          await logAnalyticsEvent('report_imported');
        } catch (err) {
          // One bad file (corrupt, unsupported, etc.) shouldn't abort the
          // rest of the batch — record it and keep going.
          failed.push(`${file.name}: ${err.message}`);
          console.error('[pickAndUpload] failed for', file.name, ':', err.message);
          console.error('[pickAndUpload] stack:', err.stack);
        }
      }
      statusMsg = '';
      await refresh();

      // Jump to the report just uploaded specifically — it may not be index 0
      // if its date is older than an already-existing report.
      const idx = lastUploadedId != null ? reports.findIndex(r => r.id === lastUploadedId) : -1;
      pageIndex = idx >= 0 ? idx : 0;
      await tick();
      pagerEl?.scrollTo({ left: pageIndex * pagerEl.clientWidth, behavior: 'instant' });

      if (lastUploadedId != null) {
        flashReportId = lastUploadedId;
        setTimeout(() => { flashReportId = null; }, 1800);
      }
      if (failed.length) showToast(failed.join('\n'), 'error');
    } catch (err) {
      // Only errors outside the per-file loop land here now — e.g. the file
      // picker itself failing, or refresh()/db calls unrelated to one file.
      statusMsg = '';
      showToast('Upload failed: ' + err.message, 'error');
      // Capacitor's native console bridge JSON-serializes console.error args,
      // and Error objects serialize to "{}" (message/stack aren't enumerable
      // own properties) — log them as plain strings so they actually show up
      // in the native device console.
      console.error('[pickAndUpload] failed:', err.message);
      console.error('[pickAndUpload] stack:', err.stack);
    } finally {
      busy = false;
    }
  }

  function viewCurrentPdf() {
    menuOpen = false;
    if (!currentReport) return;
    activeSubTab = 'raw';
  }

  function openAddMarkerModal() {
    menuOpen = false;
    resetAddMarkerForm();
    addMarkerModalOpen = true;
  }
</script>

<div class="report-tab">
  {#if statusMsg}<div class="status">{statusMsg}</div>{/if}

  {#if loading}
    <Skeleton rows={6} />
  {:else if !reports.length}
    <p class="empty">No reports yet. Tap + to upload a blood report PDF.</p>
  {:else}
    <div class="report-nav">
      <button class="nav-btn" disabled={pageIndex === 0} onclick={() => goToPage(-1)} aria-label="Newer report">
        <Icon name="chevron-left" size={15} />
      </button>
      <div class="nav-title">
        <strong>{currentReport.date}</strong>
        <span class="relative">{relativeLabel(currentReport.date)}</span>
      </div>
      <button class="nav-btn" disabled={pageIndex === reports.length - 1} onclick={() => goToPage(1)} aria-label="Older report">
        <Icon name="chevron-right" size={15} />
      </button>
    </div>

    <div class="sub-tabs">
      <button class="sub-tab" class:active={activeSubTab === 'extracted'} onclick={() => (activeSubTab = 'extracted')}>Extracted</button>
      <button class="sub-tab" class:active={activeSubTab === 'raw'} onclick={() => (activeSubTab = 'raw')}>Raw</button>
    </div>

    {#if activeSubTab === 'raw'}
      <div class="raw-pane">
        <PdfViewer filePath={currentReport.file_path} />
      </div>
    {:else}
      <div class="table-wrap">
        <div class="table-body">
          <div class="static-cols">
            {#each groupedRows as row}
              {#if row.header}
                <div class="group-row">{row.header}</div>
              {:else}
                <button class="data-row marker-row" onclick={() => openMarkerDetail(row.canonical)}>
                  <span class="marker-name">{row.canonical}</span>
                </button>
              {/if}
            {/each}
          </div>

          <div class="value-pager" bind:this={pagerEl} onscroll={onScroll}>
            {#each reports as report (report.id)}
              <div class="value-page" class:flash={flashReportId === report.id}>
                {#each groupedRows as row}
                  {#if row.header}
                    <div class="group-row">&nbsp;</div>
                  {:else}
                    {@const cell = valuesByCanonical[row.canonical]?.[report.id]}
                    <div class="data-row">
                      <ValueCell
                        canonical={row.canonical}
                        reportId={report.id}
                        value={cell?.value ?? null}
                        unit={cell?.unit ?? ''}
                        onSaved={refresh}
                      />
                    </div>
                  {/if}
                {/each}
              </div>
            {/each}
          </div>

          <div class="chevron-col">
            {#each groupedRows as row}
              {#if row.header}
                <div class="group-row">&nbsp;</div>
              {:else}
                <button class="data-row chevron-row" onclick={() => openMarkerDetail(row.canonical)} aria-label="View {row.canonical} details">
                  <Icon name="chevron-right" size={15} />
                </button>
              {/if}
            {/each}
          </div>
        </div>
      </div>

      {#if reports.length > 1}<p class="swipe-hint">Swipe, or tap ‹ ›, to compare other reports</p>{/if}
    {/if}
  {/if}

  <Fab icon="plus" onclick={() => (menuOpen = true)} />

  {#if menuOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (menuOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (menuOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
        <h2>Add</h2>
        <button class="menu-item" disabled={busy} onclick={pickAndUpload}>
          <Icon name="upload" size={18} /> Upload report
        </button>
        <button class="menu-item" disabled={!reports.length} onclick={openAddMarkerModal}>
          <Icon name="plus" size={18} /> Add missing marker
        </button>
        <button class="menu-item" disabled={!reports.length} onclick={viewCurrentPdf}>
          <Icon name="eye" size={18} /> View raw PDF
        </button>
        <button class="btn btn-ghost btn-block" onclick={() => (menuOpen = false)}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if addMarkerModalOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (addMarkerModalOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (addMarkerModalOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
        <h2>Add missing marker</h2>
        {#if currentReport}
          <p class="muted">Adds a value to {currentReport.date} ({relativeLabel(currentReport.date)})</p>
        {/if}
        <div class="add-marker-row">
          {#if addCanonical}
            <div class="marker-chip">
              <span>{addCanonical}</span>
              <button class="chip-x" onclick={() => { addCanonical = ''; addQuery = ''; }} aria-label="Change marker">
                <Icon name="x" size={14} />
              </button>
            </div>
          {:else}
            <div class="marker-search">
              <input class="input" placeholder="Type a marker name (3+ letters)…" bind:value={addQuery} />
              {#if addSuggestions.length}
                <ul class="suggestions">
                  {#each addSuggestions as s}
                    <li><button onclick={() => pickAddSuggestion(s)}>{s}</button></li>
                  {/each}
                </ul>
              {/if}
            </div>
          {/if}
          <input class="input value-input" type="number" step="any" placeholder="Value" bind:value={addValue} />
        </div>
        <div class="sheet-actions">
          <button class="btn btn-ghost" onclick={() => (addMarkerModalOpen = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={addMarkerToCurrentReport}>Add</button>
        </div>
      </div>
    </div>
  {/if}

  {#if multiSelectHintOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (multiSelectHintOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (multiSelectHintOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
        <h2>Tip: selecting multiple reports</h2>
        <p class="muted">
          If your reports are in Dropbox, Google Drive, or another cloud app, tapping
          a file's name usually imports just that one. Tap the small arrow icon on
          the right of the source instead — that opens it in a view that lets you
          select several files at once.
        </p>
        <img class="hint-img" src={multiSelectHintImg} alt="Tap the arrow icon on the right of a source, not its name, to enable multi-select" />
        <label class="hint-checkbox">
          <input type="checkbox" bind:checked={hideMultiSelectHintChecked} />
          Don't show this again
        </label>
        <div class="sheet-actions">
          <button class="btn btn-primary btn-block" onclick={dismissMultiSelectHintAndUpload}>Continue</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .report-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }
  .status { padding: 8px 16px; font-size: 0.85rem; color: var(--muted); }

  .report-nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 16px 8px;
  }
  .nav-title { text-align: center; min-width: 120px; }
  .nav-title strong { display: block; font-size: 0.92rem; color: var(--text); }
  .relative { display: block; color: var(--muted); font-size: 0.75rem; }
  .nav-btn {
    background: var(--surface);
    border: none;
    box-shadow: var(--shadow-sm);
    color: var(--accent-dim);
    border-radius: 50%;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .nav-btn:disabled { color: var(--muted); opacity: 0.4; }

  .sub-tabs { display: flex; gap: 6px; padding: 4px 16px 10px; flex-shrink: 0; }
  .sub-tab {
    flex: 1;
    background: var(--surface);
    border: none;
    border-radius: var(--radius-sm);
    padding: 8px;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
  }
  .sub-tab.active { background: var(--accent-soft); color: var(--accent-dim); }

  .raw-pane { flex: 1; min-height: 0; }

  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0 16px 96px;
  }

  .table-body { display: flex; }
  .static-cols { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .value-pager {
    width: 168px;
    flex-shrink: 0;
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  .value-page { min-width: 100%; scroll-snap-align: start; display: flex; flex-direction: column; }
  .value-page.flash { animation: value-flash 1.8s ease-out; }
  @keyframes value-flash {
    0% { background: var(--accent-soft-strong); }
    100% { background: transparent; }
  }
  .chevron-col { width: 26px; flex-shrink: 0; display: flex; flex-direction: column; }

  .data-row {
    display: flex;
    align-items: center;
    height: 46px;
    border-bottom: 1px solid var(--border);
    background: none;
    border-left: none;
    border-right: none;
    border-top: none;
    width: 100%;
    text-align: left;
    padding: 0;
    color: inherit;
    font: inherit;
  }
  .marker-row { gap: 4px; }
  .value-page .data-row { justify-content: center; padding: 0 4px; box-sizing: border-box; }
  .chevron-row { justify-content: center; color: var(--muted); }

  .group-row {
    height: 32px;
    display: flex;
    align-items: flex-end;
    color: var(--accent-dim);
    font-weight: 700;
    font-size: 0.76rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-bottom: 4px;
  }

  .marker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: 0.86rem; }

  .swipe-hint { text-align: center; color: var(--muted); font-size: 0.78rem; margin: 0 0 8px; }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    background: var(--bg);
    border: none;
    border-radius: var(--radius-sm);
    padding: 12px 14px;
    font-size: 0.95rem;
    color: var(--text);
    margin-bottom: 8px;
  }
  .menu-item:disabled { opacity: 0.4; }

  .add-marker-row { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 4px; }
  .marker-search { position: relative; flex: 1; min-width: 0; }
  .marker-chip {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 10px 10px 12px;
    font-size: 0.95rem;
  }
  .marker-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-x { flex-shrink: 0; background: none; border: none; color: var(--muted); display: flex; }
  .value-input { width: 90px; flex-shrink: 0; }
  .suggestions {
    position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
    background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    list-style: none; margin: 0; padding: 4px; max-height: 200px; overflow-y: auto;
  }
  .suggestions li button {
    width: 100%; text-align: left; padding: 9px 10px; background: none; border: none; color: var(--text); border-radius: 8px;
  }
  .suggestions li button:active { background: var(--bg); }
  .hint-img { width: 100%; border-radius: var(--radius-md); margin: 10px 0; display: block; }
  .hint-checkbox { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-bottom: 14px; }
</style>
