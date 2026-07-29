<script>
  import { appState, switchProfile, createProfile } from '../lib/state.svelte.js';

  let { onClose } = $props();
  let newName = $state('');

  function pick(id) {
    switchProfile(id);
    onClose();
  }

  async function add() {
    if (!newName.trim()) return;
    await createProfile(newName.trim());
    newName = '';
    onClose();
  }
</script>

<div class="overlay" role="button" tabindex="0" onclick={onClose}
     onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onClose()}>
  <div class="sheet" role="presentation" onclick={e => e.stopPropagation()}>
    <h2>Profiles</h2>
    <ul>
      {#each appState.profiles as p (p.id)}
        <li>
          <button class:active={p.id === appState.activeProfileId} onclick={() => pick(p.id)}>
            {p.name}
          </button>
        </li>
      {/each}
    </ul>
    <form onsubmit={(e) => { e.preventDefault(); add(); }}>
      <input placeholder="Add profile (e.g. Mom, Dad)" bind:value={newName} />
      <button type="submit">Add</button>
    </form>
    <button class="close" onclick={onClose}>Close</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: flex-end; z-index: 100;
  }
  .sheet {
    background: #1a1a1a; width: 100%; border-radius: 16px 16px 0 0;
    padding: 20px; box-sizing: border-box;
  }
  h2 { margin: 0 0 12px; font-size: 1.1rem; }
  ul { list-style: none; padding: 0; margin: 0 0 16px; }
  li button {
    width: 100%; text-align: left; padding: 12px; margin-bottom: 6px;
    background: #111; border: 1px solid #252525; border-radius: 10px;
    color: #f0f0f0; font-size: 1rem;
  }
  li button.active { border-color: #e63946; }
  form { display: flex; gap: 8px; margin-bottom: 12px; }
  input {
    flex: 1; padding: 10px; border-radius: 8px; border: 1px solid #252525;
    background: #111; color: #f0f0f0;
  }
  form button { padding: 10px 16px; border-radius: 8px; border: none; background: #e63946; color: #fff; }
  .close { width: 100%; padding: 10px; background: none; border: 1px solid #252525; border-radius: 8px; color: #aaa; }
</style>
