// ─────────────────────────────────────────────────────────────────────────────
// Svelte action: toggles a `truncated` class on the element's parent when the
// element's text is actually being clipped by CSS ellipsis. Used to only show
// the "full name" info icon next to marker names that really need it.
// ─────────────────────────────────────────────────────────────────────────────
export function truncationCheck(node) {
  function check() {
    const truncated = node.scrollWidth > node.clientWidth + 1;
    node.parentElement?.classList.toggle('truncated', truncated);
  }
  check();
  window.addEventListener('resize', check);
  return { destroy: () => window.removeEventListener('resize', check) };
}
