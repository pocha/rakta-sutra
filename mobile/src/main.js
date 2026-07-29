import { mount } from 'svelte';
import App from './App.svelte';
import { initDb } from './lib/db.js';

initDb().then(() => {
  mount(App, { target: document.getElementById('app') });
});
