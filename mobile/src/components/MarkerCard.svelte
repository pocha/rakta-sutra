<script>
  // One expandable card per marker for the currently-displayed report.
  // Collapsed: name, value input, unit dropdown (shown as-is — the report's
  // own unit, not converted to any canonical one). Expanded: reference
  // range for whatever unit is currently selected, plus the trend chart.
  import { parseRefRange, refRangeForUnit, unitsFor } from '../lib/parser.js';
  import * as db from '../lib/db.js';
  import { showToast } from '../lib/toast.svelte.js';
  import { truncationCheck } from '../lib/actions.js';
  import MarkerChart from './MarkerChart.svelte';
  import Icon from './Icon.svelte';

  let { canonical, value, unit, reportId, profileId, majorityUnit, onSaved } = $props();

  let expanded = $state(false);
  let localValue = $state(value ?? '');
  let localUnit = $state(unit ?? '');

  // Re-sync when the parent swaps to a different report (a new `value`/
  // `unit` prop pair arrives for the same mounted card position).
  $effect(() => { localValue = value ?? ''; localUnit = unit ?? ''; });

  const unitOptions = $derived(unitsFor(canonical));
  const refRange = $derived(refRangeForUnit(canonical, localUnit));
  const outOfRange = $derived.by(() => {
    if (localValue === '' || localValue == null) return false;
    const bounds = parseRefRange(refRange);
    if (!bounds) return false;
    const v = Number(localValue);
    return (bounds.low !== null && v < bounds.low) || (bounds.high !== null && v > bounds.high);
  });

  function toggleExpand() {
    expanded = !expanded;
  }

  async function commitValue(newValueStr) {
    const v = parseFloat(newValueStr);
    if (isNaN(v)) return;
    localValue = v;
    await db.upsertMarker(reportId, canonical, v, localUnit || '');
    onSaved?.();
  }

  // Unit switch is a UI action, not a manual correction — only takes
  // effect if the converted value still passes the marker's plausibility
  // check (db.updateMarkerUnit does the conversion+check); otherwise
  // nothing is saved and the dropdown reverts, with a snackbar explaining
  // the valid range in the unit that was attempted.
  async function onUnitChange(e) {
    const newUnit = e.target.value;
    if (localValue === '' || localValue == null) {
      localUnit = newUnit; // nothing saved yet — just switch the picker
      return;
    }
    const result = await db.updateMarkerUnit(reportId, canonical, newUnit);
    if (result.saved) {
      localUnit = newUnit;
      onSaved?.();
    } else {
      const [lo, hi] = result.range ?? [];
      showToast(
        lo != null && hi != null
          ? `Value must be between ${lo} and ${hi} ${newUnit} to switch units — not saved.`
          : `Couldn't convert to ${newUnit} — not saved.`,
        'error'
      );
      e.target.value = localUnit;
    }
  }
</script>

<div class="marker-card">
  <button class="card-header" onclick={toggleExpand}>
    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
    <span class="marker-name" use:truncationCheck>{canonical}</span>
    <span class="value-unit" role="none" onclick={(e) => e.stopPropagation()}>
      <input
        type="number" step="any"
        class:out-of-range={outOfRange}
        value={localValue}
        placeholder="—"
        onchange={(e) => commitValue(e.target.value)}
      />
      {#if unitOptions.length > 1}
        <select value={localUnit} onchange={onUnitChange}>
          {#each unitOptions as opt (opt.unit)}
            <option value={opt.unit}>{opt.unit}</option>
          {/each}
        </select>
      {:else if localUnit}
        <span class="unit-label">{localUnit}</span>
      {/if}
    </span>
  </button>

  {#if expanded}
    <div class="card-body">
      {#if refRange}<p class="ref-range">Reference: {refRange}</p>{/if}
      <MarkerChart {profileId} {canonical} currentReportId={reportId} {majorityUnit} />
    </div>
  {/if}
</div>

<style>
  .marker-card {
    background: var(--surface);
    border-radius: var(--radius-md);
    margin-bottom: 8px;
    overflow: hidden;
  }
  .card-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 10px 12px;
    text-align: left;
    color: var(--muted);
  }
  .marker-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.9rem;
    color: var(--text);
  }
  .value-unit { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  input[type='number'] {
    width: 82px; box-sizing: border-box;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px; text-align: center; font-size: 0.9rem;
  }
  input[type='number'].out-of-range { color: var(--accent-dim); border-color: var(--accent-dim); }
  select {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px 4px; font-size: 0.8rem; max-width: 84px;
  }
  .unit-label { color: var(--muted-lt); font-size: 0.8rem; white-space: nowrap; }

  .card-body { padding: 0 12px 12px; border-top: 1px solid var(--border); }
  .ref-range { color: var(--muted); font-size: 0.82rem; margin: 10px 0 0; }
</style>
