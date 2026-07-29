<script>
  import { onMount } from 'svelte';
  import { appState, loadProfiles } from './lib/state.svelte.js';
  import ProfileMenu from './components/ProfileMenu.svelte';
  import MoreMenu from './components/MoreMenu.svelte';
  import TabBar from './components/TabBar.svelte';
  import ReportTab from './components/ReportTab.svelte';
  import TimelineTab from './components/TimelineTab.svelte';
  import ReminderTab from './components/ReminderTab.svelte';

  let profileMenuOpen = $state(false);
  let moreMenuOpen = $state(false);
  let ready = $state(false);

  onMount(async () => {
    await loadProfiles();
    ready = true;
  });

  const activeProfileName = $derived(
    appState.profiles.find(p => p.id === appState.activeProfileId)?.name ?? ''
  );
</script>

<div class="app-shell">
  <header class="topbar">
    <h1>Track Blood</h1>
    <div class="topbar-actions">
      <button class="profile-btn" onclick={() => (profileMenuOpen = true)}>
        {activeProfileName || 'Profile'} ▾
      </button>
      <button class="more-btn" onclick={() => (moreMenuOpen = true)} aria-label="More">⋮</button>
    </div>
  </header>

  <main class="content">
    {#if ready && appState.activeProfileId}
      {#if appState.activeTab === 'report'}
        <ReportTab profileId={appState.activeProfileId} />
      {:else if appState.activeTab === 'timeline'}
        <TimelineTab profileId={appState.activeProfileId} />
      {:else}
        <ReminderTab profileId={appState.activeProfileId} />
      {/if}
    {/if}
  </main>

  <TabBar />

  {#if profileMenuOpen}
    <ProfileMenu onClose={() => (profileMenuOpen = false)} />
  {/if}
  {#if moreMenuOpen}
    <MoreMenu onClose={() => (moreMenuOpen = false)} />
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #090909;
    color: #f0f0f0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: env(safe-area-inset-top, 12px) 16px 12px;
    border-bottom: 1px solid #252525;
    flex-shrink: 0;
  }
  .topbar h1 { font-size: 1.1rem; margin: 0; }
  .topbar-actions { display: flex; align-items: center; gap: 8px; }
  .profile-btn {
    background: #1a1a1a;
    border: 1px solid #252525;
    color: #f0f0f0;
    border-radius: 20px;
    padding: 6px 14px;
    font-size: 0.9rem;
  }
  .more-btn {
    background: none;
    border: none;
    color: #f0f0f0;
    font-size: 1.3rem;
    padding: 2px 8px;
  }
  .content {
    flex: 1;
    overflow: hidden;
    position: relative;
  }
</style>
