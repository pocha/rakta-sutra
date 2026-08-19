<script>
  // Pushed full-screen (see state.svelte.js's `screen: 'markerDetail'`) when
  // a Report-tab row is tapped — mirrors how BackupScreen/NotificationsScreen
  // are pushed, so the marker name reuses App.svelte's shared topbar/back
  // button rather than this component drawing its own header. A dedicated,
  // always-full-size screen (vs. the chart previously living inside a
  // collapsing card in a scrollable list) also gives Chart.js an unambiguous
  // container to size against from its very first frame.
  import * as db from '../lib/db.js';
  import { refRangeForUnit } from '../lib/parser.js';
  import MarkerChart from './MarkerChart.svelte';
  import Skeleton from './Skeleton.svelte';

  let { canonical, profileId } = $props();

  let loading = $state(true);
  let latest = $state(null); // { value, unit, report_id, date } | null
  let majorityUnit = $state('');

  $effect(() => {
    // Re-fetch whenever the pushed marker changes (component instance is
    // reused across pushes since App.svelte keys it only by `screen`).
    canonical;
    load();
  });

  async function load() {
    loading = true;
    try {
      const [latestRow, majorityByCanonical] = await Promise.all([
        db.getLatestMarkerValue(profileId, canonical),
        db.getMajorityUnitByCanonical(profileId),
      ]);
      latest = latestRow;
      majorityUnit = majorityByCanonical[canonical] ?? latestRow?.unit ?? '';
    } finally {
      loading = false;
    }
  }

  const refRange = $derived(latest ? refRangeForUnit(canonical, latest.unit ?? '') : null);
</script>

<div class="marker-detail">
  {#if loading}
    <Skeleton rows={3} />
  {:else if !latest}
    <p class="empty">No recorded values for this marker yet.</p>
  {:else}
    <div class="latest">
      <span class="latest-value">{latest.value}</span>
      <span class="latest-unit">{latest.unit ?? ''}</span>
    </div>
    <p class="latest-date">as of {latest.date}</p>
    {#if refRange}<p class="ref-range">Reference: {refRange}</p>{/if}
    <MarkerChart {profileId} {canonical} currentReportId={latest.report_id} {majorityUnit} />
  {/if}
</div>

<style>
  .marker-detail { padding: 16px; height: 100%; overflow-y: auto; box-sizing: border-box; }
  .empty { color: var(--muted); text-align: center; padding: 40px 20px; }
  .latest { display: flex; align-items: baseline; gap: 8px; }
  .latest-value { font-size: 2.2rem; font-weight: 800; color: var(--text); }
  .latest-unit { font-size: 1rem; color: var(--muted); }
  .latest-date { color: var(--muted); font-size: 0.82rem; margin: 2px 0 0; }
  .ref-range { color: var(--muted); font-size: 0.88rem; margin: 10px 0 0; }
</style>
