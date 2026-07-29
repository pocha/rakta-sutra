<script>
  import { onMount } from 'svelte';
  import * as db from '../lib/db.js';
  import { parseReminderText } from '../lib/textParse.js';
  import { scheduleReminder, cancelReminder } from '../lib/notifications.js';
  import Fab from './Fab.svelte';

  let { profileId } = $props();

  let reminders = $state([]);

  let modalOpen = $state(false);
  let editingId = $state(null);
  let text = $state('');
  let clarifyQuestion = $state('');
  let clarifyAnswer = $state('');
  let errorMsg = $state('');

  onMount(load);

  async function load() {
    reminders = await db.listReminders(profileId);
  }

  const upcoming = $derived(
    reminders.filter(r => !r.done && new Date(r.remind_at) >= new Date())
             .sort((a, b) => a.remind_at.localeCompare(b.remind_at))
  );
  const past = $derived(
    reminders.filter(r => r.done || new Date(r.remind_at) < new Date())
             .sort((a, b) => b.remind_at.localeCompare(a.remind_at))
  );

  function openModal(reminder = null) {
    editingId = reminder?.id ?? null;
    text = reminder?.text ?? '';
    clarifyQuestion = '';
    clarifyAnswer = '';
    errorMsg = '';
    modalOpen = true;
  }

  async function submit() {
    errorMsg = '';
    const fullText = clarifyQuestion ? `${text} ${clarifyAnswer}` : text;
    if (!text.trim()) return;

    const parsed = parseReminderText(fullText);
    if (parsed.needsClarification) {
      if (clarifyQuestion) {
        // Already asked once — don't loop forever, ask the user to just retype it plainly.
        errorMsg = "Still couldn't find a time. Try being explicit, e.g. \"29 Jul 9am\".";
        return;
      }
      clarifyQuestion = parsed.question;
      return;
    }

    if (editingId) {
      await cancelReminder(editingId);
      await db.updateReminder(editingId, text.trim(), parsed.remindAt, parsed.recurrence, editingId);
      await scheduleReminder(editingId, text.trim(), parsed.remindAt, parsed.recurrence);
    } else {
      const id = await db.addReminder(profileId, text.trim(), parsed.remindAt, parsed.recurrence, null);
      await scheduleReminder(id, text.trim(), parsed.remindAt, parsed.recurrence);
      await db.updateReminder(id, text.trim(), parsed.remindAt, parsed.recurrence, id);
    }
    modalOpen = false;
    await load();
  }

  async function remove(reminder) {
    if (!confirm('Delete this reminder?')) return;
    await cancelReminder(reminder.id);
    await db.deleteReminder(reminder.id);
    await load();
  }

  function formatWhen(r) {
    const d = new Date(r.remind_at);
    const base = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    if (!r.recurrence) return base;
    const label = r.recurrence.startsWith('weekly:') ? `every ${r.recurrence.slice(7)}` : r.recurrence;
    return `${base} (${label})`;
  }
</script>

<div class="reminder-tab">
  <div class="feed">
    <h3>Upcoming</h3>
    {#if !upcoming.length}<p class="empty">No upcoming reminders.</p>{/if}
    {#each upcoming as r (r.id)}
      <div class="card">
        <div>
          <div class="when">{formatWhen(r)}</div>
          <div class="text">{r.text}</div>
        </div>
        <div class="actions">
          <button onclick={() => openModal(r)}>Edit</button>
          <button class="danger" onclick={() => remove(r)}>Delete</button>
        </div>
      </div>
    {/each}

    <h3>Past</h3>
    {#if !past.length}<p class="empty">No past reminders.</p>{/if}
    {#each past as r (r.id)}
      <div class="card past">
        <div>
          <div class="when">{formatWhen(r)}</div>
          <div class="text">{r.text}</div>
        </div>
        <button class="danger" onclick={() => remove(r)}>Delete</button>
      </div>
    {/each}
  </div>

  <Fab icon="⏰" onclick={() => openModal()} />

  {#if modalOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (modalOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (modalOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()}>
        <h2>{editingId ? 'Edit reminder' : 'Add reminder'}</h2>
        <textarea rows="3" placeholder="e.g. Take Vitamin D shot every Monday at 9am"
                   bind:value={text} disabled={!!clarifyQuestion}></textarea>

        {#if clarifyQuestion}
          <p class="question">{clarifyQuestion}</p>
          <input placeholder="e.g. tomorrow at 9am" bind:value={clarifyAnswer} />
        {/if}
        {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

        <div class="sheet-actions">
          <button onclick={() => (modalOpen = false)}>Cancel</button>
          <button class="primary" onclick={submit}>{clarifyQuestion ? 'Continue' : 'Save'}</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .reminder-tab { height: 100%; display: flex; flex-direction: column; position: relative; }
  .feed { flex: 1; overflow-y: auto; padding: 12px 16px 80px; }
  h3 { color: #e63946; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 8px; }
  .empty { color: #777; }
  .card {
    display: flex; justify-content: space-between; align-items: center;
    background: #1a1a1a; border: 1px solid #252525; border-radius: 10px;
    padding: 10px 12px; margin-bottom: 8px;
  }
  .card.past { opacity: 0.6; }
  .when { color: #777; font-size: 0.78rem; }
  .text { margin-top: 2px; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .actions button, .card.past button {
    font-size: 0.78rem; background: none; border: 1px solid #252525; color: #aaa;
    border-radius: 6px; padding: 3px 8px;
  }
  .danger { color: #e63946; border-color: #b52a35; }
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; z-index: 100; }
  .sheet { background: #1a1a1a; width: 100%; border-radius: 16px 16px 0 0; padding: 20px; box-sizing: border-box; }
  .sheet h2 { margin: 0 0 12px; font-size: 1.1rem; }
  .sheet textarea, .sheet input {
    width: 100%; box-sizing: border-box; background: #111; border: 1px solid #252525;
    color: #f0f0f0; border-radius: 8px; padding: 10px; font-family: inherit; resize: vertical;
    margin-bottom: 8px;
  }
  .question { color: #f0b8be; font-size: 0.9rem; }
  .error { color: #ff8891; font-size: 0.85rem; }
  .sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .sheet-actions button { padding: 8px 16px; border-radius: 8px; border: 1px solid #252525; background: none; color: #aaa; }
  .sheet-actions .primary { background: #e63946; border: none; color: #fff; }
</style>
