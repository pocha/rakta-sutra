<script>
  import { onMount, tick } from 'svelte';
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import * as db from '../lib/db.js';
  import { parsePDF, MARKER_GROUPS, REF_RANGES, parseRefRange } from '../lib/parser.js';
  import { saveReportFile, openReportFile } from '../lib/reports.js';
  import { appState } from '../lib/state.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { truncationCheck } from '../lib/actions.js';
  import { logAnalyticsEvent } from '../lib/analytics.js';
  import Fab from './Fab.svelte';
  import Icon from './Icon.svelte';

  let { profileId } = $props();

  let reports = $state([]);               // [{ id, date, file_name, file_path }] newest first
  let valuesByCanonical = $state({});      // canonical -> { reportId: value }
  let refRangeByCanonical = $state({});    // canonical -> ref_range string
  let pageIndex = $state(0);               // which report's values are currently shown
  let pagerEl = $state();
  let busy = $state(false);
  let statusMsg = $state('');
  let flashReportId = $state(null); // briefly highlights the just-uploaded/just-jumped-to column

  let menuOpen = $state(false);            // FAB action menu
  let addMarkerModalOpen = $state(false);
  let addCanonical = $state('');            // selected marker (empty until picked from suggestions)
  let addQuery = $state('');                // what the user is typing before picking one
  let addValue = $state('');

  const ALL_CANONICALS = Object.keys(REF_RANGES);

  onMount(refresh);

  $effect(() => {
    if (appState.jumpToReportId == null || !pagerEl) return;
    const idx = reports.findIndex(r => r.id === appState.jumpToReportId);
    if (idx >= 0) {
      tick().then(() => pagerEl.scrollTo({ left: idx * pagerEl.clientWidth, behavior: 'instant' }));
      pageIndex = idx;
    }
    appState.jumpToReportId = null;
  });

  async function refresh() {
    const data = await db.getConsolidatedReportData(profileId);
    reports = data.reports;
    valuesByCanonical = data.valuesByCanonical;
    refRangeByCanonical = data.refRangeByCanonical;
    if (pageIndex >= reports.length) pageIndex = 0;
  }

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

  const availableToAdd = $derived(ALL_CANONICALS.filter(c => !(c in valuesByCanonical)));
  const currentReport = $derived(reports[pageIndex]);
  const addSuggestions = $derived(
    addQuery.trim().length >= 3
      ? availableToAdd.filter(c => c.toLowerCase().includes(addQuery.trim().toLowerCase())).slice(0, 8)
      : []
  );

  function outOfRangeFor(canonical, value) {
    if (value == null || value === '') return false;
    const bounds = parseRefRange(refRangeByCanonical[canonical]);
    if (!bounds) return false;
    return (bounds.low !== null && value < bounds.low) || (bounds.high !== null && value > bounds.high);
  }

  async function saveValue(reportId, canonical, newValue) {
    const v = parseFloat(newValue);
    if (isNaN(v)) return;
    await db.upsertMarker(reportId, canonical, v, refRangeByCanonical[canonical] ?? REF_RANGES[canonical] ?? null);
    await refresh();
  }

  async function addMarkerToCurrentReport() {
    const v = parseFloat(addValue);
    if (!addCanonical || isNaN(v) || !currentReport) return;
    await db.upsertMarker(currentReport.id, addCanonical, v, REF_RANGES[addCanonical] ?? null);
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
    busy = true;
    statusMsg = 'Opening file picker…';
    try {
      const result = await FilePicker.pickFiles({ types: ['application/pdf'], readData: true });
      let lastUploadedId = null;
      for (const file of result.files) {
        statusMsg = `Reading "${file.name}"…`;
        // pdf.js takes ownership of the buffer passed to it (transferred to its
        // worker) and detaches it once parsing starts — decode a separate copy
        // for each use rather than sharing one ArrayBuffer between the two.
        const { date, extracted } = await parsePDF(base64ToArrayBuffer(file.data));
        let reportDate = date;
        if (!reportDate) {
          reportDate = window.prompt(`Could not detect a date in "${file.name}".\nEnter the report date (YYYY-MM-DD):`, '');
          if (!reportDate) continue;
        }
        const path = await saveReportFile(profileId, file.name, base64ToArrayBuffer(file.data));
        lastUploadedId = await db.addReport(profileId, reportDate, file.name, path, extracted);
        await logAnalyticsEvent('report_imported');
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
    } catch (err) {
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
    if (currentReport) openReportFile(currentReport.file_path);
  }

  function openAddMarkerModal() {
    menuOpen = false;
    resetAddMarkerForm();
    addMarkerModalOpen = true;
  }
</script>

<div class="report-tab">
  {#if statusMsg}<div class="status">{statusMsg}</div>{/if}

  {#if !reports.length}
    <p class="empty">No reports yet. Tap + to upload a blood report PDF.</p>
  {:else}
    <div class="table-wrap">
      <div class="table-head">
        <div class="col-marker">Marker</div>
        <div class="col-range">Range</div>
        <div class="col-value-nav">
          <button class="nav-btn" disabled={pageIndex === 0} onclick={() => goToPage(-1)} aria-label="Newer report">
            <Icon name="chevron-left" size={15} />
          </button>
          <div class="value-nav-title">
            <strong>{currentReport.date}</strong>
            <span class="relative">{relativeLabel(currentReport.date)}</span>
          </div>
          <button class="nav-btn" disabled={pageIndex === reports.length - 1} onclick={() => goToPage(1)} aria-label="Older report">
            <Icon name="chevron-right" size={15} />
          </button>
        </div>
      </div>

      <div class="table-body">
        <div class="static-cols">
          {#each groupedRows as row}
            {#if row.header}
              <div class="group-row">{row.header}</div>
            {:else}
              <div class="data-row">
                <span class="marker-cell">
                  <span class="marker-name" use:truncationCheck>{row.canonical}</span>
                  <button class="info-btn" onclick={() => showToast(row.canonical, 'info')} aria-label="Full marker name">
                    <Icon name="info" size={13} />
                  </button>
                </span>
                <span class="range-cell">{refRangeByCanonical[row.canonical] ?? ''}</span>
              </div>
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
                  <div class="data-row">
                    <input
                      type="number" step="any"
                      class:out-of-range={outOfRangeFor(row.canonical, valuesByCanonical[row.canonical]?.[report.id])}
                      value={valuesByCanonical[row.canonical]?.[report.id] ?? ''}
                      placeholder="—"
                      onchange={(e) => saveValue(report.id, row.canonical, e.target.value)}
                    />
                  </div>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="dots">
      {#each reports as _, i}<span class:active={i === pageIndex}></span>{/each}
    </div>
    {#if reports.length > 1}<p class="swipe-hint">Swipe, or tap ‹ ›, to compare other reports</p>{/if}
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
</div>

<style>
  .report-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }
  .status { padding: 8px 16px; font-size: 0.85rem; color: var(--muted); }

  .table-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    padding: 0 16px 96px;
  }

  .table-head {
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    background: var(--bg);
    padding: 14px 0 8px;
    z-index: 2;
    font-size: 0.78rem;
    color: var(--muted);
    font-weight: 600;
  }
  .col-marker { flex: 1; min-width: 0; }
  .col-range { width: 62px; flex-shrink: 0; text-align: center; }
  .col-value-nav {
    width: 140px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
  .value-nav-title { text-align: center; min-width: 0; }
  .value-nav-title strong { display: block; font-size: 0.82rem; color: var(--text); white-space: nowrap; }
  .relative { display: block; color: var(--muted); font-size: 0.72rem; }
  .nav-btn {
    background: var(--surface);
    border: none;
    box-shadow: var(--shadow-sm);
    color: var(--accent-dim);
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .nav-btn:disabled { color: var(--muted); opacity: 0.4; }

  .table-body { display: flex; }
  .static-cols { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .value-pager {
    width: 140px;
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

  .data-row {
    display: flex;
    align-items: center;
    height: 46px;
    border-bottom: 1px solid var(--border);
  }
  .static-cols .data-row { gap: 4px; }
  .value-page .data-row { justify-content: center; padding: 0 6px; box-sizing: border-box; }
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

  .marker-cell { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; }
  .marker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; font-size: 0.86rem; }
  .info-btn { flex-shrink: 0; background: none; border: none; color: var(--muted); padding: 2px; display: none; }
  .marker-cell.truncated .info-btn { display: flex; }
  .range-cell { width: 62px; flex-shrink: 0; font-size: 0.78rem; color: var(--muted-lt); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }

  input[type='number'] {
    width: 100%; max-width: 90px; box-sizing: border-box;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px 6px; text-align: center;
  }
  input[type='number'].out-of-range { color: var(--accent-dim); border-color: var(--accent-dim); }

  .dots { display: flex; justify-content: center; gap: 6px; padding: 4px 0; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
  .dots span.active { background: var(--accent); }
  .swipe-hint { text-align: center; color: var(--muted); font-size: 0.78rem; margin: 0; }

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
</style>
