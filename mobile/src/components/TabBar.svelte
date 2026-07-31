<script>
  import { appState } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';

  const tabs = [
    { id: 'report', label: 'Report', icon: 'file-text' },
    { id: 'timeline', label: 'Timeline', icon: 'history' },
    { id: 'reminder', label: 'Reminder', icon: 'bell' },
  ];
</script>

<nav class="tabbar">
  {#each tabs as t (t.id)}
    <button class:active={appState.activeTab === t.id} onclick={() => (appState.activeTab = t.id)}>
      <Icon name={t.icon} size={22} />
      <span class="label">{t.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tabbar {
    display: flex;
    background: var(--surface);
    box-shadow: 0 -1px 3px rgba(20, 20, 30, 0.05);
    flex-shrink: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  .tabbar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 0 8px;
    background: none;
    border: none;
    color: var(--muted);
  }
  .tabbar button.active { color: var(--accent); }
  .label { font-size: 0.72rem; font-weight: 500; }
</style>
