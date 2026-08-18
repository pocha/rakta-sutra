import { defineConfig } from 'vite';

// Builds a small, self-contained bundle (bridge.js + pdf.worker.js) that
// the Flutter app loads into a hidden WebView and drives via
// window.trackbloodBridge.* — see src/bridge.js for the message protocol.
// Output is copied into mobile_flutter/assets/bridge/ (see build.sh).
export default defineConfig({
  base: './', // loaded from an arbitrary Flutter asset path, not a server root
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
