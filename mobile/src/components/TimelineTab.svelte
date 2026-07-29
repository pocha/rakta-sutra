<script>
  import { onMount } from 'svelte';
  import * as db from '../lib/db.js';
  import { REF_RANGES, parseRefRange } from '../lib/parser.js';
  import { parseJournalText } from '../lib/textParse.js';
  import { jumpToReport } from '../lib/state.svelte.js';
  import Fab from './Fab.svelte';

  let { profileId } = $props();

  let feed = $state([]);
  let expandedReportId = $state(null);
  let query = $state('');
  let knownMarkers = $state([]);
  let activeMarker = $state(null);      // set when a search suggestion is picked
  let markerTimeline = $state([]);

  let noteModalOpen = $state(false);
  let noteText = $state('');
  let editingNoteId = $state(null);

  onMount(load);

  async function load() {
    feed = await db.getTimelineFeed(profileId);
    knownMarkers = await db.listKnownMarkers(profileId);
  }

  const suggestions = $derived(
    query.trim().length
      ? knownMarkers.filter(m => m.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
      : []
  );

  async function pickMarker(marker) {
    activeMarker = marker;
    query = marker;
    markerTimeline = await db.getMarkerTimeline(profileId, marker);
  }

  function clearSearch() {
    activeMarker = null;
    query = '';
    markerTimeline = [];
  }

  function outOfRange(entry) {
    const bounds = parseRefRange(entry.ref_range);
    if (!bounds) return false;
    return (bounds.low !== null && entry.value < bounds.low) ||
           (bounds.high !== null && entry.value > bounds.high);
  }

  // Report entries in the default feed only carry counts, not per-marker
  // detail — fetched lazily on expand.
  let reportDetail = $state({});
  async function toggleExpand(report) {
    if (expandedReportId === report.id) { expandedReportId = null; return; }
    expandedReportId = report.id;
    if (!reportDetail[report.id]) {
      const markers = await db.getReportMarkers(report.id);
      reportDetail = { ...reportDetail, [report.id]: markers.filter(outOfRange) };
    }
  }

  function openNoteModal(note = null) {
    editingNoteId = note?.id ?? null;
    noteText = note?.text ?? '';
    noteModalOpen = true;
  }

  async function saveNote() {
    if (!noteText.trim()) return;
    const { date, canonicals } = parseJournalText(noteText, new Date());
    if (editingNoteId) {
      await db.updateJournalEntry(editingNoteId, date, noteText.trim(), canonicals);
    } else {
      await db.addJournalEntry(profileId, date, noteText.trim(), canonicals);
    }
    noteModalOpen = false;
    noteText = '';
    editingNoteId = null;
    await load();
    if (activeMarker) markerTimeline = await db.getMarkerTimeline(profileId, activeMarker);
  }

  async function deleteNote(id) {
    if (!confirm('Delete this note?')) return;
    await db.deleteJournalEntry(id);
    await load();
    if (activeMarker) markerTimeline = await db.getMarkerTimeline(profileId, activeMarker);
  }
</script>

<div class="timeline-tab">
  <div class="search">
    <input class="input" placeholder="Search a marker (e.g. Vitamin D)…" bind:value={query}
           oninput={() => { if (activeMarker && query !== activeMarker) activeMarker = null; }} />
    {#if activeMarker}
      <button class="clear" onclick={clearSearch}>✕</button>
    {:else if suggestions.length}
      <ul class="suggestions">
        {#each suggestions as s}
          <li><button onclick={() => pickMarker(s)}>{s}</button></li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="feed">
    {#if activeMarker}
      <h3 class="marker-heading">{activeMarker}</h3>
      {#if !markerTimeline.length}
        <p class="empty">No test results or notes for this marker yet.</p>
      {/if}
      {#each markerTimeline as entry}
        <div class="card">
          <span class="date">{entry.date}</span>
          {#if entry.kind === 'value'}
            <span class:out-of-range={outOfRange(entry)}>
              Test value: <strong>{entry.value}</strong> {entry.ref_range ? `(ref ${entry.ref_range})` : ''}
            </span>
          {:else}
            <span>{entry.text}</span>
          {/if}
        </div>
      {/each}
    {:else if !feed.length}
      <p class="empty">Nothing yet — upload a report or add a journal note.</p>
    {:else}
      {#each feed as item (item.kind + item.id)}
        {#if item.kind === 'report'}
          <div class="card report-card">
            <div class="card-head" role="button" tabindex="0" onclick={() => toggleExpand(item)}
                 onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleExpand(item)}>
              <span class="date">{item.date}</span>
              <span>Report uploaded — {item.marker_count} markers{item.ref_count ? `, ${item.ref_count} out of range` : ''}</span>
            </div>
            {#if expandedReportId === item.id}
              <div class="expanded">
                {#if reportDetail[item.id]?.length}
                  <ul>
                    {#each reportDetail[item.id] as m}
                      <li>{m.canonical}: <strong>{m.value}</strong> (ref {m.ref_range})</li>
                    {/each}
                  </ul>
                {:else}
                  <p class="ok">All markers within range.</p>
                {/if}
                <button class="link" onclick={() => jumpToReport(item.id)}>View full report →</button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="card note-card">
            <span class="date">{item.date}</span>
            <span class="note-text">{item.text}</span>
            <div class="note-actions">
              <button class="btn btn-sm" onclick={() => openNoteModal(item)}>Edit</button>
              <button class="btn btn-sm btn-danger" onclick={() => deleteNote(item.id)}>Delete</button>
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <Fab icon="pen-line" onclick={() => openNoteModal()} />

  {#if noteModalOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (noteModalOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (noteModalOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
        <h2>{editingNoteId ? 'Edit note' : 'Add note'}</h2>
        <textarea class="textarea" rows="4" placeholder="e.g. Took a Vitamin D shot today" bind:value={noteText}></textarea>
        <div class="sheet-actions">
          <button class="btn btn-ghost" onclick={() => (noteModalOpen = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={saveNote}>Save</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .timeline-tab { height: 100%; display: flex; flex-direction: column; position: relative; }
  .search { position: relative; padding: 12px 16px; flex-shrink: 0; }
  .search input { padding-right: 34px; }
  .search .clear {
    position: absolute; right: 26px; top: 22px; background: none; border: none; color: var(--muted);
  }
  .suggestions {
    position: absolute; left: 16px; right: 16px; top: 52px; z-index: 5;
    background: var(--surface); border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    list-style: none; margin: 0; padding: 4px; max-height: 240px; overflow-y: auto;
  }
  .suggestions li button {
    width: 100%; text-align: left; padding: 9px 10px; background: none; border: none; color: var(--text); border-radius: 8px;
  }
  .suggestions li button:active { background: var(--bg); }
  .feed { flex: 1; overflow-y: auto; padding: 0 16px 80px; }
  .empty { color: var(--muted); text-align: center; padding: 40px 20px; }
  .marker-heading { color: var(--accent-dim); margin: 8px 0; }
  .card { margin-bottom: 10px; }
  .card-head { display: flex; flex-direction: column; gap: 3px; cursor: pointer; }
  .date { color: var(--muted); font-size: 0.78rem; }
  .expanded { margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px; }
  .expanded ul { margin: 0; padding-left: 18px; }
  .expanded .ok { color: var(--ok); margin: 0; }
  .link { background: none; border: none; color: var(--accent); padding: 6px 0 0; font-weight: 500; }
  .note-card { display: flex; flex-direction: column; gap: 4px; }
  .note-actions { display: flex; gap: 8px; margin-top: 6px; }
</style>
