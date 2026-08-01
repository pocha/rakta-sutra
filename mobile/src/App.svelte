<script>
  import { onMount } from 'svelte';
  import { appState, loadProfiles, closeScreen } from './lib/state.svelte.js';
  import { generateConsolidatedReportPdf } from './lib/exportPdf.js';
  import { showToast } from './lib/toast.svelte.js';
  import Drawer from './components/Drawer.svelte';
  import BackupScreen from './components/BackupScreen.svelte';
  import NotificationsScreen from './components/NotificationsScreen.svelte';
  import TabBar from './components/TabBar.svelte';
  import ReportTab from './components/ReportTab.svelte';
  import TimelineTab from './components/TimelineTab.svelte';
  import ReminderTab from './components/ReminderTab.svelte';
  import Snackbar from './components/Snackbar.svelte';
  import Icon from './components/Icon.svelte';
  import logo from './assets/logo.png';

  let ready = $state(false);
  let sharing = $state(false);

  onMount(async () => {
    await loadProfiles();
    ready = true;
  });

  const activeProfileName = $derived(
    appState.profiles.find(p => p.id === appState.activeProfileId)?.name ?? ''
  );

  async function shareReport() {
    sharing = true;
    try {
      await generateConsolidatedReportPdf(appState.activeProfileId, activeProfileName);
    } catch (e) {
      showToast('Could not generate PDF: ' + e.message, 'error');
      console.error(e);
    } finally {
      sharing = false;
    }
  }
</script>

<div class="app-shell">
  <header class="topbar">
    {#if appState.screen}
      <button class="icon-btn" onclick={closeScreen} aria-label="Back">←</button>
      <h1>{appState.screen === 'notifications' ? 'Notifications' : 'Backup & Restore'}</h1>
    {:else}
      <button class="icon-btn" onclick={() => (appState.drawerOpen = true)} aria-label="Menu">☰</button>
      <img class="logo" src={logo} alt="" />
      <h1>Track Blood</h1>
      {#if appState.activeTab === 'report'}
        <button class="share-btn" disabled={sharing} onclick={shareReport}>
          <Icon name="share-2" size={16} /> Share Report
        </button>
      {/if}
    {/if}
  </header>

  <main class="content">
    {#if appState.screen === 'backup'}
      <BackupScreen />
    {:else if appState.screen === 'notifications'}
      <NotificationsScreen />
    {:else if ready && appState.activeProfileId}
      {#if appState.activeTab === 'report'}
        <ReportTab profileId={appState.activeProfileId} />
      {:else if appState.activeTab === 'timeline'}
        <TimelineTab profileId={appState.activeProfileId} />
      {:else}
        <ReminderTab profileId={appState.activeProfileId} />
      {/if}
    {/if}
  </main>

  {#if !appState.screen}
    <TabBar />
  {/if}

  {#if appState.drawerOpen}
    <Drawer onClose={() => (appState.drawerOpen = false)} />
  {/if}

  <Snackbar />
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: max(env(safe-area-inset-top, 12px), 12px) 16px 12px;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    flex-shrink: 0;
    z-index: 5;
  }
  .topbar h1 {
    font-size: 1.2rem;
    font-weight: 800;
    margin: 0;
    color: var(--accent-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .logo { width: 28px; height: auto; object-fit: contain; margin-top: -14px; }
  .icon-btn {
    background: none;
    border: none;
    color: var(--text);
    font-size: 1.1rem;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .icon-btn:active { background: var(--bg); }
  .icon-btn:disabled { opacity: 0.4; }
  .share-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 5px;
    flex-shrink: 0;
    background: var(--accent-soft);
    color: var(--accent-dim);
    border: none;
    border-radius: 999px;
    padding: 6px 12px 6px 10px;
    font-size: 0.78rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .share-btn:disabled { opacity: 0.5; }
  .content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    position: relative;
    background: var(--bg);
  }
</style>
