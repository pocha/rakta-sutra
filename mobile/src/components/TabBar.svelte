<script>
  import { appState } from '../lib/state.svelte.js';

  const tabs = [
    { id: 'report', label: 'Report', icon: '📄' },
    { id: 'timeline', label: 'Timeline', icon: '🕘' },
    { id: 'reminder', label: 'Reminder', icon: '⏰' },
  ];
</script>

<nav class="tabbar">
  {#each tabs as t (t.id)}
    <button class:active={appState.activeTab === t.id} onclick={() => (appState.activeTab = t.id)}>
      <span class="icon">{t.icon}</span>
      <span class="label">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    display: flex;
    border-top: 1px solid #252525;
    background: #111;
    flex-shrink: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tabbar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 0;
    background: none;
    border: none;
    color: #777;
  }
  .tabbar button.active { color: #e63946; }
  .icon { font-size: 1.3rem; }
  .label { font-size: 0.72rem; }
</style>
