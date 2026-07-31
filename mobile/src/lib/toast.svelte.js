// ─────────────────────────────────────────────────────────────────────────────
// A single global snackbar/toast — one shared instance is enough for this app,
// so this is just reactive state plus a function to trigger it, not a queue.
// Errors stay up until the user taps the dismiss button; only non-error
// toasts (if ever used) auto-hide after `duration`.
// ─────────────────────────────────────────────────────────────────────────────
export const toastState = $state({ message: '', type: 'error', visible: false });

let hideTimer;

export function showToast(message, type = 'error', duration = 3500) {
  clearTimeout(hideTimer);
  toastState.message = message;
  toastState.type = type;
  toastState.visible = true;
  if (type !== 'error') hideTimer = setTimeout(() => (toastState.visible = false), duration);
}

export function hideToast() {
  clearTimeout(hideTimer);
  toastState.visible = false;
}
