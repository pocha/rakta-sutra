<script>
  let { icon = '+', onclick } = $props();
</script>

<button class="fab" {onclick} aria-label="Add">{icon}</button>

<style>
  .fab {
    position: absolute;
    right: 20px;
    bottom: 20px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #e63946;
    color: #fff;
    border: none;
    font-size: 1.4rem;
    box-shadow: 0 4px 16px rgba(230, 57, 70, 0.4);
    z-index: 10;
  }
</style>
