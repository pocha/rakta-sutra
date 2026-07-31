<script>
  import { toastState, hideToast } from '../lib/toast.svelte.js';
</script>

{#if toastState.visible}
  <div class="snackbar" class:error={toastState.type === 'error'} role="status">
    <span>{toastState.message}</span>
    <button onclick={hideToast} aria-label="Dismiss">✕</button>
  </div>
{/if}

<style>
  .snackbar {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(64px + env(safe-area-inset-bottom, 0px));
    background: #2a2a2e;
    color: #fff;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-md);
    padding: 12px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 0.88rem;
    z-index: 200;
    animation: rise 0.15s ease-out;
  }
  .snackbar.error { background: var(--accent-dim); }
  .snackbar button { background: none; border: none; color: rgba(255, 255, 255, 0.8); flex-shrink: 0; }
  @keyframes rise {
    from { transform: translateY(8px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
</style>
