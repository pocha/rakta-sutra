<script>
  import { onMount, tick } from 'svelte';
  import { FilePicker } from '@capawesome/capacitor-file-picker';
  import * as db from '../lib/db.js';
  import { parsePDF, MARKER_GROUPS, REF_RANGES, parseRefRange } from '../lib/parser.js';
  import { saveReportFile, deleteReportFile, openReportFile } from '../lib/reports.js';
  import { appState } from '../lib/state.svelte.js';
  import Fab from './Fab.svelte';

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
        const buffer = base64ToArrayBuffer(file.data);
        const { date, extracted } = await parsePDF(buffer);
        let reportDate = date;
        if (!reportDate) {
          reportDate = window.prompt(`Could not detect a date in "${file.name}".\nEnter the report date (YYYY-MM-DD):`, '');
          if (!reportDate) continue;
        }
        const path = await saveReportFile(profileId, file.name, buffer);
        await db.addReport(profileId, reportDate, file.name, path, extracted);
      }
      pageIndex = 0;
      statusMsg = '';
      await refresh();
    } catch (err) {
      statusMsg = 'Upload failed: ' + err.message;
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
            <div>
              <strong>{report.report_date}</strong>
              <span class="relative">{relativeLabel(report.report_date)}</span>
            </div>
            <div class="page-actions">
              <button onclick={() => openReportFile(report.file_path)}>View original PDF</button>
              <button class="danger" onclick={() => removeReport(report)}>Delete</button>
            </div>
          </div>

          <div class="table-scroll">
            <table>
              <thead><tr><th>Marker</th><th>Value</th></tr></thead>
              <tbody>
                {#each groupedRows(report.id) as row}
                  {#if row.header}
                    <tr class="group-header"><td colspan="2">{row.header}</td></tr>
                  {:else}
                    <tr class:out-of-range={outOfRange(row.marker)}>
                      <td>{row.marker.canonical}</td>
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
            <button onclick={() => addMarker(report.id)}>Add</button>
          </div>
        </section>
      {/each}
    </div>

    <div class="dots">
      {#each reports as _, i}<span class:active={i === pageIndex}></span>{/each}
    </div>
  {/if}

  <Fab icon="upload" onclick={pickAndUpload} />
</div>

<style>
  .report-tab { height: 100%; display: flex; flex-direction: column; position: relative; }
  .empty { padding: 40px 20px; text-align: center; color: var(--muted); }
  .status { padding: 8px 16px; font-size: 0.85rem; color: var(--accent-dim); }
  .pager {
    flex: 1;
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
  }
  .page {
    min-width: 100%;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    box-sizing: border-box;
    overflow-y: auto;
  }
  .page-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    position: sticky;
    top: 0;
    background: var(--bg);
    padding-bottom: 10px;
    z-index: 2;
  }
  .relative { color: var(--muted); font-size: 0.85rem; margin-left: 8px; }
  .page-actions button {
    font-size: 0.78rem;
    background: var(--surface);
    border: none;
    box-shadow: var(--shadow-sm);
    color: var(--muted-lt);
    border-radius: 8px;
    padding: 5px 10px;
    margin-left: 6px;
  }
  .page-actions .danger { color: var(--accent-dim); }
  .table-scroll { background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-sm); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  th { font-size: 0.78rem; color: var(--muted); font-weight: 600; }
  .group-header td { color: var(--accent-dim); font-weight: 700; font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.04em; padding: 12px 12px 6px; border-bottom: none; background: var(--bg); }
  tr.out-of-range td { color: var(--accent-dim); }
  tr:last-child td { border-bottom: none; }
  input[type='number'] {
    width: 90px; background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px 8px;
  }
  .add-marker { display: flex; gap: 8px; padding: 14px 0 6px; }
  .add-marker select, .add-marker input { background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 8px; box-shadow: var(--shadow-sm); }
  .add-marker select { flex: 1; }
  .add-marker input { width: 80px; }
  .add-marker button { background: var(--accent); border: none; color: #fff; border-radius: 8px; padding: 8px 14px; font-weight: 500; }
  .dots { display: flex; justify-content: center; gap: 6px; padding: 8px 0; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--border); }
  .dots span.active { background: var(--accent); }
</style>
