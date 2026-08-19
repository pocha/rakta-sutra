<script>
  // One report's value+unit for one marker, inside the Report tab's
  // swipeable value column. Editing/unit-switch logic ported from the
  // retired MarkerCard.svelte — same commit/validate behavior, just without
  // the name/expand/chart parts, which now live in MarkerDetail.svelte.
  import { unitsFor, refRangeForUnit, parseRefRange } from '../lib/parser.js';
  import * as db from '../lib/db.js';
  import { showToast } from '../lib/toast.svelte.js';

  let { canonical, reportId, value, unit, onSaved } = $props();

  let localValue = $state(value ?? '');
  let localUnit = $state(unit ?? '');

  // Re-sync when the pager scrolls to a different report (a new value/unit
  // prop pair arrives for the same mounted cell position).
  $effect(() => { localValue = value ?? ''; localUnit = unit ?? ''; });

  const unitOptions = $derived(unitsFor(canonical));
  const outOfRange = $derived.by(() => {
    if (localValue === '' || localValue == null) return false;
    const bounds = parseRefRange(refRangeForUnit(canonical, localUnit));
    if (!bounds) return false;
    const v = Number(localValue);
    return (bounds.low !== null && v < bounds.low) || (bounds.high !== null && v > bounds.high);
  });

  async function commitValue(newValueStr) {
    const v = parseFloat(newValueStr);
    if (isNaN(v)) return;
    localValue = v;
    await db.upsertMarker(reportId, canonical, v, localUnit || '');
    onSaved?.();
  }

  // Unit switch is a UI action, not a manual correction — only takes effect
  // if the converted value still passes the marker's plausibility check
  // (db.updateMarkerUnit does the conversion+check); otherwise nothing is
  // saved and the dropdown reverts, with a snackbar explaining the valid
  // range in the unit that was attempted.
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

<span class="value-cell">
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

<style>
  .value-cell { display: flex; align-items: center; gap: 4px; }
  input[type='number'] {
    width: 64px; box-sizing: border-box;
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 5px; text-align: center; font-size: 0.85rem;
  }
  input[type='number'].out-of-range { color: var(--accent-dim); border-color: var(--accent-dim); }
  select {
    background: var(--bg); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 5px 2px; font-size: 0.7rem; max-width: 60px;
  }
  .unit-label {
    color: var(--muted-lt); font-size: 0.72rem; white-space: nowrap;
    max-width: 60px; overflow: hidden; text-overflow: ellipsis; display: inline-block;
  }
</style>
