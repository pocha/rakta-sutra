<script>
  import { appState, switchProfile, createProfile, openScreen } from '../lib/state.svelte.js';
  import Icon from './Icon.svelte';

  let { onClose } = $props();
  let addingProfile = $state(false);
  let newName = $state('');

  function pick(id) {
    switchProfile(id);
    onClose();
  }

  async function addProfile() {
    if (!newName.trim()) return;
    await createProfile(newName.trim());
    newName = '';
    addingProfile = false;
    onClose();
  }
</script>

<div class="scrim" role="button" tabindex="0" onclick={onClose}
     onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onClose()}>
  <nav class="drawer" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
    <div class="drawer-header">
      <span class="app-name">Track Blood</span>
      <span class="app-version">v{__APP_VERSION__}</span>
    </div>

    <div class="section">
      <span class="section-label">Profiles</span>
      <ul>
        {#each appState.profiles as p (p.id)}
          <li>
            <button class="profile-row" class:active={p.id === appState.activeProfileId} onclick={() => pick(p.id)}>
              <span class="avatar">{p.name.charAt(0).toUpperCase()}</span>
              {p.name}
            </button>
          </li>
        {/each}
      </ul>

      {#if addingProfile}
        <form class="add-form" onsubmit={(e) => { e.preventDefault(); addProfile(); }}>
          <input class="input" placeholder="e.g. Mom, Dad" bind:value={newName} />
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
        </form>
      {:else}
        <button class="drawer-item" onclick={() => (addingProfile = true)}>
          <span class="icon"><Icon name="plus" size={18} /></span> Add Profile
        </button>
      {/if}
    </div>

    <div class="divider"></div>

    <div class="section">
      <button class="drawer-item" onclick={() => openScreen('notifications')}>
        <span class="icon"><Icon name="bell" size={19} /></span> Notifications
      </button>
      <button class="drawer-item" onclick={() => openScreen('backup')}>
        <span class="icon"><Icon name="archive" size={19} /></span> Backup
      </button>
    </div>
  </nav>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 24, 0.35);
    z-index: 100;
    display: flex;
  }
  .drawer {
    width: min(84%, 320px);
    height: 100%;
    background: var(--surface);
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    padding: max(env(safe-area-inset-top, 20px), 20px) 0 20px;
    animation: slide-in 0.18s ease-out;
  }
  @keyframes slide-in {
    from { transform: translateX(-16px); opacity: 0.6; }
    to { transform: translateX(0); opacity: 1; }
  }
  .drawer-header { padding: 0 20px 16px; display: flex; align-items: baseline; gap: 6px; }
  .app-name { font-size: 1.15rem; font-weight: 700; }
  .app-version { font-size: 0.78rem; color: var(--muted); }
  .section { padding: 4px 12px; }
  .section-label {
    display: block;
    padding: 8px 8px 4px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  ul { list-style: none; margin: 0; padding: 0; }
  .profile-row, .drawer-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    text-align: left;
    background: none;
    border: none;
    color: var(--text);
    padding: 10px 8px;
    border-radius: var(--radius-sm);
    font-size: 0.95rem;
  }
  .profile-row:active, .drawer-item:active { background: var(--bg); }
  .profile-row.active { background: var(--accent-soft); color: var(--accent-dim); font-weight: 600; }
  .profile-row.active .avatar { background: var(--accent); color: #fff; }
  .avatar {
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--bg); color: var(--muted-lt);
    display: flex; align-items: center; justify-content: center;
    font-size: 0.8rem; font-weight: 700; flex-shrink: 0;
  }
  .icon { width: 20px; text-align: center; }
  .add-form { display: flex; gap: 6px; padding: 6px 8px; }
  .divider { height: 1px; background: var(--border); margin: 10px 12px; }
</style>
