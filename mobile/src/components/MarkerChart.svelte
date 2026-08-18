<script>
  // Per-marker trend line — fetched lazily, only when a MarkerCard expands
  // (not eagerly for every collapsed card, which would mean one chart-data
  // query per marker per report load).
  import { onMount, onDestroy } from 'svelte';
  import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';
  import * as db from '../lib/db.js';
  import { convertUnit } from '../lib/parser.js';

  Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

  let { profileId, canonical, currentReportId, majorityUnit } = $props();

  let canvasEl = $state();
  let chart = null;
  let loading = $state(true);
  let hasData = $state(false);

  onMount(async () => {
    const series = await db.getMarkerChartSeries(profileId, canonical);
    loading = false;
    hasData = series.length > 0;
    if (!hasData || !canvasEl) return;

    // series is newest-first (see getMarkerChartSeries) — plotted in that
    // same order so the X axis reads latest-on-the-left, matching what was
    // asked for, and each point highlighted if it's the report currently
    // being viewed.
    const unit = majorityUnit || series[0].unit || '';
    const labels = series.map(p => p.date);
    const values = series.map(p => convertUnit(canonical, p.value, p.unit || unit, unit));
    const isCurrent = series.map(p => p.report_id === currentReportId);

    chart = new Chart(canvasEl, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: '#e63946',
          backgroundColor: 'transparent',
          pointBackgroundColor: isCurrent.map(c => (c ? '#e63946' : '#9aa0a6')),
          pointBorderColor: isCurrent.map(c => (c ? '#e63946' : '#9aa0a6')),
          pointRadius: isCurrent.map(c => (c ? 5 : 3)),
          tension: 0.15,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { title: { display: true, text: unit } },
        },
      },
    });
  });

  onDestroy(() => chart?.destroy());
</script>

{#if loading}
  <p class="chart-status">Loading chart…</p>
{:else if !hasData}
  <p class="chart-status">Not enough history for a chart yet.</p>
{:else}
  <div class="chart-wrap"><canvas bind:this={canvasEl}></canvas></div>
{/if}

<style>
  .chart-wrap { height: 180px; margin-top: 10px; }
  .chart-status { color: var(--muted); font-size: 0.85rem; text-align: center; padding: 16px 0; margin: 0; }
</style>
