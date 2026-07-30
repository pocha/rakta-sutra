import { mount } from 'svelte';
import './theme.css';
import App from './App.svelte';
import { initDb } from './lib/db.js';
import { initPush } from './lib/push.js';

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
