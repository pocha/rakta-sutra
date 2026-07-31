<script>
  import { onMount } from 'svelte';
  import * as db from '../lib/db.js';
  import { parseReminderText } from '../lib/textParse.js';
  import { scheduleReminder, cancelReminder, getNotificationPermissionState } from '../lib/notifications.js';
  import { showToast } from '../lib/toast.svelte.js';
  import Fab from './Fab.svelte';
  import Icon from './Icon.svelte';

  let { profileId } = $props();

  let reminders = $state([]);
  let permissionBlocked = $state(false);

  let modalOpen = $state(false);
  let editingId = $state(null);
  let text = $state('');
  let clarifyQuestion = $state('');
  let clarifyAnswer = $state('');
  let saving = $state(false);

  onMount(async () => {
    await load();
    await refreshPermission();
  });

  async function load() {
    reminders = await db.listReminders(profileId);
  }

  async function refreshPermission() {
    permissionBlocked = (await getNotificationPermissionState()) === 'denied';
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
    if (permissionBlocked) return;
    editingId = reminder?.id ?? null;
    text = reminder?.text ?? '';
    clarifyQuestion = '';
    clarifyAnswer = '';
    modalOpen = true;
  }

  async function submit() {
    const fullText = clarifyQuestion ? `${text} ${clarifyAnswer}` : text;
    if (!text.trim()) return;

    const parsed = parseReminderText(fullText);
    if (parsed.needsClarification) {
      if (clarifyQuestion) {
        // Already asked once — don't loop forever, ask the user to just retype it plainly.
        showToast('Still couldn\'t find a time. Try being explicit, e.g. "29 Jul 9am".', 'error');
        return;
      }
      clarifyQuestion = parsed.question;
      return;
    }

    saving = true;
    try {
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
      await refreshPermission();
    } finally {
      saving = false;
    }
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
  {#if permissionBlocked}
    <div class="permission-banner">
      Notifications are turned off, so reminders can't be delivered. Enable
      notification permission for Track Blood in your device settings to add
      or receive reminders.
    </div>
  {/if}
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
          <button class="icon-btn-sm" onclick={() => openModal(r)} aria-label="Edit reminder">
            <Icon name="pen-line" size={16} />
          </button>
          <button class="icon-btn-sm danger" onclick={() => remove(r)} aria-label="Delete reminder">
            <Icon name="trash-2" size={16} />
          </button>
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
        <button class="icon-btn-sm danger" onclick={() => remove(r)} aria-label="Delete reminder">
          <Icon name="trash-2" size={16} />
        </button>
      </div>
    {/each}
  </div>

  {#if !permissionBlocked}
    <Fab icon="alarm-clock" onclick={() => openModal()} />
  {/if}

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
        <div class="sheet-actions">
          <button class="btn btn-ghost" disabled={saving} onclick={() => (modalOpen = false)}>Cancel</button>
          <button class="btn btn-primary" disabled={saving} onclick={submit}>
            {saving ? 'Saving…' : (clarifyQuestion ? 'Continue' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .reminder-tab { height: 100%; min-height: 0; display: flex; flex-direction: column; position: relative; }
  .permission-banner {
    background: var(--accent-soft); color: var(--accent-dim);
    font-size: 0.85rem; padding: 10px 16px; flex-shrink: 0;
  }
  .feed { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px 80px; }
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
  .icon-btn-sm {
    display: flex; align-items: center; justify-content: center;
    background: var(--bg); border: none; color: var(--muted-lt);
    border-radius: 8px; width: 30px; height: 30px; flex-shrink: 0;
  }
  .icon-btn-sm.danger { color: var(--accent-dim); }
  .input, .textarea { margin-bottom: 8px; }
  .question { color: var(--accent-dim); font-size: 0.88rem; }
  .sheet-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
</style>
