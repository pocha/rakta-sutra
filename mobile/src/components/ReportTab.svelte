<script>
  import { onMount, tick } from 'svelte';
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import * as db from '../lib/db.js';
  import { parsePDF, MARKER_GROUPS, REF_RANGES, parseRefRange } from '../lib/parser.js';
  import { saveReportFile, deleteReportFile, openReportFile } from '../lib/reports.js';
  import { appState } from '../lib/state.svelte.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { truncationCheck } from '../lib/actions.js';
  import Fab from './Fab.svelte';
  import Icon from './Icon.svelte';

  let { profileId } = $props();

  let reports = $state([]);          // [{ id, report_date, file_name, file_path }]
  let markersByReport = $state({});  // reportId -> [{ id, canonical, value, ref_range }]
  let pageIndex = $state(0);
  let addCanonical = $state('');
  let addValue = $state('');
  let busy = $state(false);
  let statusMsg = $state('');
  let pagerEl = $state();

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
    reports = await db.listReports(profileId);
    const entries = await Promise.all(reports.map(async r => [r.id, await db.getReportMarkers(r.id)]));
    markersByReport = Object.fromEntries(entries);
  }

  function groupedRows(reportId) {
    const markers = markersByReport[reportId] ?? [];
    const byName = Object.fromEntries(markers.map(m => [m.canonical, m]));
    const present = new Set(markers.map(m => m.canonical));
    const rows = [];
    for (const group of MARKER_GROUPS) {
      const inGroup = group.keys.filter(k => present.has(k));
      if (!inGroup.length) continue;
      rows.push({ header: group.label });
      for (const k of inGroup) rows.push({ marker: byName[k] });
    }
    const ungrouped = [...present].filter(k => !MARKER_GROUPS.some(g => g.keys.includes(k)));
    if (ungrouped.length) {
      rows.push({ header: 'Other' });
      for (const k of ungrouped) rows.push({ marker: byName[k] });
    }
    return rows;
  }

  function availableToAdd(reportId) {
    const present = new Set((markersByReport[reportId] ?? []).map(m => m.canonical));
    return ALL_CANONICALS.filter(c => !present.has(c));
  }

  function outOfRange(marker) {
    const bounds = parseRefRange(marker.ref_range);
    if (!bounds) return false;
    return (bounds.low !== null && marker.value < bounds.low) ||
           (bounds.high !== null && marker.value > bounds.high);
  }

  async function saveValue(reportId, marker, newValue) {
    const v = parseFloat(newValue);
    if (isNaN(v)) return;
    await db.upsertMarker(reportId, marker.canonical, v, marker.ref_range);
    await refresh();
  }

  async function addMarker(reportId) {
    const v = parseFloat(addValue);
    if (!addCanonical || isNaN(v)) return;
    await db.upsertMarker(reportId, addCanonical, v, REF_RANGES[addCanonical] ?? null);
    addCanonical = '';
    addValue = '';
    await refresh();
  }

  async function removeReport(report) {
    if (!confirm(`Delete report "${report.file_name}" (${report.report_date})? This removes it and all its values.`)) return;
    await db.deleteReport(report.id);
    await deleteReportFile(report.file_path);
    pageIndex = 0;
    await refresh();
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function pickAndUpload() {
    busy = true;
    statusMsg = 'Opening file picker…';
    try {
      const result = await FilePicker.pickFiles({ types: ['application/pdf'], readData: true });
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
        await db.addReport(profileId, reportDate, file.name, path, extracted);
      }
      pageIndex = 0;
      statusMsg = '';
      await refresh();
    } catch (err) {
      statusMsg = '';
      showToast('Upload failed: ' + err.message, 'error');
      console.error(err);
    } finally {
      busy = false;
    }
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

  // '‹' moves toward index-1 (newer report, leftmost); '›' moves toward
  // index+1 (older report) — matches reports[] being sorted newest-first.
  function goToPage(delta) {
    const target = Math.min(Math.max(pageIndex + delta, 0), reports.length - 1);
    pagerEl.scrollTo({ left: target * pagerEl.clientWidth, behavior: 'smooth' });
  }
</script>

<div class="report-tab">
  {#if statusMsg}<div class="status">{statusMsg}</div>{/if}

  {#if !reports.length}
    <p class="empty">No reports yet. Tap + to upload a blood report PDF.</p>
  {:else}
    <div class="pager" bind:this={pagerEl} onscroll={onScroll}>
      {#each reports as report, i (report.id)}
        <section class="page">
          <div class="page-head">
            <div class="page-head-spacer" aria-hidden="true"></div>
            <div class="page-head-nav">
              <button class="nav-btn" disabled={i === 0} onclick={() => goToPage(-1)} aria-label="Newer report">
                <Icon name="chevron-left" size={18} />
              </button>
              <div class="page-head-title">
                <strong>{report.report_date}</strong>
                <span class="relative">{relativeLabel(report.report_date)}</span>
              </div>
              <button class="nav-btn" disabled={i === reports.length - 1} onclick={() => goToPage(1)} aria-label="Older report">
                <Icon name="chevron-right" size={18} />
              </button>
            </div>
            <div class="page-head-actions">
              <button class="icon-btn-sm" onclick={() => openReportFile(report.file_path)} aria-label="View original PDF">
                <Icon name="eye" size={18} />
              </button>
              <button class="icon-btn-sm danger" onclick={() => removeReport(report)} aria-label="Delete report">
                <Icon name="trash-2" size={17} />
              </button>
            </div>
          </div>

          <div class="table-scroll">
            <table>
              <thead><tr><th>Marker</th><th>Range</th><th>Value</th></tr></thead>
              <tbody>
                {#each groupedRows(report.id) as row}
                  {#if row.header}
                    <tr class="group-header"><td colspan="3">{row.header}</td></tr>
                  {:else}
                    <tr class:out-of-range={outOfRange(row.marker)}>
                      <td>
                        <div class="marker-cell">
                          <span class="marker-name" use:truncationCheck>{row.marker.canonical}</span>
                          <button class="info-btn" onclick={() => showToast(row.marker.canonical, 'info')} aria-label="Full marker name">
                            <Icon name="info" size={14} />
                          </button>
                        </div>
                      </td>
                      <td class="range-cell">{row.marker.ref_range ?? ''}</td>
                      <td>
                        <input
                          type="number" step="any"
                          value={row.marker.value}
                          onchange={(e) => saveValue(report.id, row.marker, e.target.value)}
                        />
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>

          <div class="add-marker">
            <select bind:value={addCanonical}>
              <option value="">Add missing marker…</option>
              {#each availableToAdd(report.id) as c}<option value={c}>{c}</option>{/each}
            </select>
            <input type="number" step="any" placeholder="Value" bind:value={addValue} />
            <button class="icon-btn-sm add-btn" onclick={() => addMarker(report.id)} aria-label="Add marker">
              <Icon name="plus" size={18} />
            </button>
          </div>
        </section>
      {/each}
    </div>

    <div class="dots">
      {#each reports as _, i}<span class:active={i === pageIndex}></span>{/each}
    </div>
    {#if reports.length > 1}<p class="swipe-hint">Swipe, or tap ‹ ›, to see other reports</p>{/if}
  {/if}

  <Fab icon="upload" onclick={pickAndUpload} />
</div>

<style>
  .report-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }
  .status { padding: 8px 16px; font-size: 0.85rem; color: var(--muted); }
  .pager {
    flex: 1;
    min-height: 0;
    height: 100%;
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  .page {
    min-width: 100%;
    height: 100%;
    min-height: 0;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    padding: 14px 16px 96px;
    box-sizing: border-box;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  .page-head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    position: sticky;
    top: 0;
    background: var(--bg);
    padding-bottom: 10px;
    z-index: 2;
  }
  .page-head-spacer { min-width: 0; }
  .page-head-nav { display: flex; align-items: center; justify-content: center; gap: 4px; }
  .page-head-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
  .page-head-title { text-align: center; min-width: 96px; }
  .relative { color: var(--muted); font-size: 0.8rem; display: block; }
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
  .icon-btn-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface);
    border: none;
    box-shadow: var(--shadow-sm);
    color: var(--muted-lt);
    border-radius: 8px;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
  }
  .icon-btn-sm.danger { color: var(--accent-dim); }
  .swipe-hint { text-align: center; color: var(--muted); font-size: 0.78rem; margin: 0 0 6px; }
  .table-scroll { background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); overflow: auto; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); overflow: hidden; }
  th { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
  th:nth-child(1), td:nth-child(1) { width: 58%; }
  th:nth-child(2), td:nth-child(2) { width: 22%; }
  th:nth-child(3), td:nth-child(3) { width: 20%; }
  .marker-cell { display: flex; align-items: center; gap: 4px; width: 100%; }
  .marker-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .info-btn { flex-shrink: 0; background: none; border: none; color: var(--muted); padding: 2px; display: none; }
  .marker-cell.truncated .info-btn { display: flex; }
  .range-cell { font-size: 0.78rem; color: var(--muted-lt); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .group-header td { color: var(--accent-dim); font-weight: 700; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 12px 12px 6px; border-bottom: none; background: var(--bg); }
  tr.out-of-range td { color: var(--accent-dim); }
  tr:last-child td { border-bottom: none; }
  input[type='number'] {
    width: 100%; max-width: 88px; box-sizing: border-box;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px 6px;
  }
  .add-marker { display: flex; gap: 8px; padding: 14px 0 6px; align-items: center; }
  .add-marker select, .add-marker input { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px; box-shadow: var(--shadow-sm); }
  .add-marker select { flex: 1; }
  .add-marker input { width: 80px; }
  .add-btn { background: var(--accent); color: #fff; box-shadow: none; }
  .dots { display: flex; justify-content: center; gap: 6px; padding: 8px 0; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
  .dots span.active { background: var(--accent); }
</style>
