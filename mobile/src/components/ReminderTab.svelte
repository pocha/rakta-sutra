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
          <button class="btn btn-sm" onclick={() => openModal(r)}>Edit</button>
          <button class="btn btn-sm btn-danger" onclick={() => remove(r)}>Delete</button>
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
        <button class="btn btn-sm btn-danger" onclick={() => remove(r)}>Delete</button>
      </div>
    {/each}
  </div>

  <Fab icon="alarm-clock" onclick={() => openModal()} />

  {#if modalOpen}
    <div class="overlay" role="button" tabindex="0" onclick={() => (modalOpen = false)}
         onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (modalOpen = false)}>
      <div class="sheet" role="presentation" onclick={e => e.stopPropagation()} onkeydown={e => e.stopPropagation()}>
        <h2>{editingId ? 'Edit reminder' : 'Add reminder'}</h2>
        <textarea class="textarea" rows="3" placeholder="e.g. Take Vitamin D shot every Monday at 9am"
                   bind:value={text} disabled={!!clarifyQuestion}></textarea>

        {#if clarifyQuestion}
          <p class="question">{clarifyQuestion}</p>
          <input class="input" placeholder="e.g. tomorrow at 9am" bind:value={clarifyAnswer} />
        {/if}
        {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

        <div class="sheet-actions">
          <button class="btn btn-ghost" onclick={() => (modalOpen = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={submit}>{clarifyQuestion ? 'Continue' : 'Save'}</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .reminder-tab { height: 100%; display: flex; flex-direction: column; position: relative; }
  .feed { flex: 1; overflow-y: auto; padding: 12px 16px 80px; }
  h3 { color: var(--accent-dim); font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 18px 4px 8px; }
  .empty { color: var(--muted); padding: 0 4px; }
  .card {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 10px;
  }
  .card.past { opacity: 0.65; }
  .when { color: var(--muted); font-size: 0.78rem; }
  .text { margin-top: 2px; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  .input, .textarea { margin-bottom: 8px; }
  .question { color: var(--accent-dim); font-size: 0.88rem; }
  .error { color: var(--accent-dim); font-size: 0.85rem; }
  .sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
