<script>
  import { onMount } from 'svelte';
  import * as db from '../lib/db.js';

  let entries = $state([]);

  onMount(async () => {
    entries = await db.listNotificationLog();
  });

  function formatWhen(iso) {
    const then = new Date(iso.replace(' ', 'T') + 'Z');
    const diffMs = Date.now() - then.getTime();
    const diffMin = Math.floor(diffMs / 60_000);

    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
    return then.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<div class="notifications-screen">
  <p class="disclaimer">Only showing notifications you tapped.</p>

  {#if !entries.length}
    <p class="empty">No notifications yet.</p>
  {/if}

  {#each entries as entry (entry.id)}
    <div class="card">
      <div class="when">{formatWhen(entry.tapped_at)}</div>
      <div class="text">{entry.text}</div>
    </div>
  {/each}
</div>

<style>
  .notifications-screen { height: 100%; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  .disclaimer {
    font-size: 0.82rem;
    color: #8a6d1a;
    background: #fff6d8;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    margin: 0 0 4px;
  }
  .empty { color: var(--muted); padding: 0 4px; }
  .card { padding: 12px 14px; }
  .when { color: var(--muted); font-size: 0.78rem; }
  .text { margin-top: 2px; }
</style>
