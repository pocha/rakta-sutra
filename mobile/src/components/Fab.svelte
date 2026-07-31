<script>
  import Icon from './Icon.svelte';
  let { icon = 'upload', onclick } = $props();
</script>

<button class="fab" {onclick} aria-label="Add">
  <Icon name={icon} size={24} />
</button>

<style>
  .fab {
    position: absolute;
    right: 20px;
    bottom: 20px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 6px 18px rgba(230, 57, 70, 0.35);
    z-index: 10;
    transition: transform 0.1s ease;
  }
  .fab:active { transform: scale(0.94); }
</style>
