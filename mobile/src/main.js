import { mount } from 'svelte';
import './theme.css';
import App from './App.svelte';
import { initDb } from './lib/db.js';
import { initPush } from './lib/push.js';
import { initParserConfig } from './lib/parserConfigSync.js';
import { showToast } from './lib/toast.svelte.js';

// WKWebView (iOS) has historically lacked ReadableStream async iteration —
// pdf.js's getTextContent() does `for await (const value of readableStream)`,
// which throws "undefined is not a function" there without this. Chromium
// (Android) already has it, so this is a no-op there.
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype[Symbol.asyncIterator] = function () {
    const reader = this.getReader();
    return {
      async next() {
        const { done, value } = await reader.read();
        return { done, value };
      },
      async return(value) {
        await reader.cancel(value);
        return { done: true, value };
      },
      [Symbol.asyncIterator]() { return this; },
    };
  };
}

// initDb() has no internal timeout (unlike initParserConfig(), which already
// bounds its own fetch) — if the native SQLite bridge ever hangs instead of
// resolving/rejecting, Promise.all below would wait forever, mount() would
// never run, and the app would show a permanent, silent blank screen. Race
// it against a timeout so a hang surfaces as the same "Failed to start"
// error screen a real rejection would.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

Promise.all([withTimeout(initDb(), 10000, 'initDb'), initParserConfig()])
  .then(() => {
    mount(App, { target: document.getElementById('app') });
    // Flips index.html's global error/rejection handlers from "replace the
    // blank screen" to "show a toast" — the app is genuinely usable past
    // this point, so a full-screen takeover on some later, possibly minor
    // error would be a worse experience than the error itself.
    window.__appMounted = true;
    window.__reportError = (message) => showToast(message, 'error');
    initPush().catch((err) => console.error('[main] initPush failed:', err));
  })
  .catch((err) => {
    console.error('[main] init failed:', err);
    window.__showFatalError('The app failed to start.', `${err.message}\n\n${err.stack ?? ''}`);
  });
