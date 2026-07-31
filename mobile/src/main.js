import { mount } from 'svelte';
import './theme.css';
import App from './App.svelte';
import { initDb } from './lib/db.js';
import { initPush } from './lib/push.js';

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

initDb()
  .then(() => {
    mount(App, { target: document.getElementById('app') });
    initPush().catch((err) => console.error('[main] initPush failed:', err));
  })
  .catch((err) => {
    console.error('[main] initDb failed:', err);
    document.getElementById('app').innerHTML =
      `<pre style="color:#ff8891;background:#1a1a1a;padding:16px;white-space:pre-wrap;font-family:monospace;">Failed to start: ${err.message}\n\n${err.stack ?? ''}</pre>`;
  });
