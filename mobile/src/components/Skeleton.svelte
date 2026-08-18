<script>
  // Loading placeholder shown between a tab's onMount firing and its SQLite
  // read resolving — replaces the previous flash of the tab's "empty" state
  // on every cold load/tab switch. Sized via `rows`; uses the app's own
  // theme custom properties so it matches light/dark automatically.
  let { rows = 5 } = $props();
</script>

<div class="skeleton" aria-hidden="true">
  {#each Array(rows) as _}
    <div class="skeleton-row">
      <span class="bar bar-label"></span>
      <span class="bar bar-value"></span>
    </div>
  {/each}
</div>

<style>
  .skeleton { padding: 16px; }
  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 46px;
    border-bottom: 1px solid var(--border);
  }
  .bar {
    display: block;
    height: 14px;
    border-radius: 7px;
    background: linear-gradient(90deg, var(--border) 25%, var(--surface) 50%, var(--border) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  .bar-label { flex: 1; }
  .bar-value { width: 70px; flex-shrink: 0; }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
