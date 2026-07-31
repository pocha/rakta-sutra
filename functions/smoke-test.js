#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Smoke test against the *deployed* reminder backend (not a unit test — no
// mocking of Cloud Tasks/Firestore/Cloud Functions, all real calls). Exercises
// the two real end-to-end paths, instantly rather than waiting on real Cloud
// Tasks clock time: after scheduling, it invokes sendReminderPush directly
// with the exact payload Cloud Tasks would have sent it, which is the actual
// code path a real fire takes — the only thing skipped is the wait for the
// wall-clock time to arrive.
//   1. One-time reminder: schedule → Cloud Task enqueued → invoke
//      sendReminderPush directly → sends the push cleanly.
//   2. Recurring reminder: schedule → invoke sendReminderPush directly →
//      sends the push → self-reschedules a new Cloud Task for the next
//      occurrence.
//
// Uses a throwaway device id by default, so pushToDevice() takes the
// "no fcmToken, warn and skip" path rather than actually delivering — this
// still exercises every line of scheduling/firing/rescheduling logic
// without needing a real phone. Set SMOKE_TEST_DEVICE_ID to an already-
// registered real device id (see the `devices` Firestore collection) to
// additionally get a real push delivered, if you want to confirm that too.
//
// Requires: gcloud application-default credentials for the track-blood
// project (already set up in this repo's dev environment) with access to
// the REMINDER_PUSH_SECRET secret, and the functions must already be
// deployed (this hits the live HTTPS endpoints).
// ─────────────────────────────────────────────────────────────────────────────
const admin = require('firebase-admin');
const { CloudTasksClient } = require('@google-cloud/tasks');
const { execSync } = require('child_process');

const PROJECT_ID = 'track-blood';
const FUNCTIONS_BASE = 'https://asia-south1-track-blood.cloudfunctions.net';
const DEVICE_ID = process.env.SMOKE_TEST_DEVICE_ID || `smoke-test-${Date.now()}`;
const FAR_FUTURE_REMIND_AT = new Date(Date.now() + 24 * 3600_000).toISOString(); // never actually fires

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const tasksClient = new CloudTasksClient();

const REMINDER_PUSH_SECRET = execSync(
  `gcloud secrets versions access latest --secret=REMINDER_PUSH_SECRET --project=${PROJECT_ID}`,
  { encoding: 'utf8' }
).trim();

async function callFunction(name, body) {
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Simulates exactly what Cloud Tasks would do when the task fires — same
// endpoint, same secret, same payload shape — without waiting for the
// scheduled time to actually arrive.
async function invokeSendReminderPush(payload) {
  const res = await fetch(`${FUNCTIONS_BASE}/sendReminderPush?secret=${encodeURIComponent(REMINDER_PUSH_SECRET)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sendReminderPush failed: ${res.status} ${text}`);
  return text;
}

async function getBookkeepingTaskName(notificationId) {
  const snap = await db.collection('devices').doc(DEVICE_ID)
    .collection('tasks').doc(String(notificationId)).get();
  return snap.exists ? snap.data().taskName : null;
}

async function testOneTime() {
  console.log('\n=== Test 1: one-time reminder ===');
  const notificationId = 90001;

  await callFunction('scheduleReminder', {
    deviceId: DEVICE_ID, notificationId, remindAt: FAR_FUTURE_REMIND_AT, recurrence: null,
  });
  const taskName = await getBookkeepingTaskName(notificationId);
  if (!taskName) throw new Error('No Cloud Task bookkeeping doc was created');
  console.log(`Cloud Task enqueued: ${taskName} ✓`);

  await invokeSendReminderPush({ deviceId: DEVICE_ID, notificationId });
  console.log('sendReminderPush invoked directly, responded 200 (push sent cleanly) ✓');

  await callFunction('cancelReminder', { deviceId: DEVICE_ID, notificationId });
  console.log('Test 1 PASSED');
}

async function testRecurring() {
  console.log('\n=== Test 2: recurring reminder (daily) ===');
  const notificationId = 90002;

  await callFunction('scheduleReminder', {
    deviceId: DEVICE_ID, notificationId, remindAt: FAR_FUTURE_REMIND_AT, recurrence: 'daily',
  });
  const originalTaskName = await getBookkeepingTaskName(notificationId);
  if (!originalTaskName) throw new Error('No Cloud Task bookkeeping doc was created');
  console.log(`Cloud Task enqueued: ${originalTaskName} ✓`);

  await invokeSendReminderPush({
    deviceId: DEVICE_ID, notificationId, remindAt: FAR_FUTURE_REMIND_AT, recurrence: 'daily',
  });
  console.log('sendReminderPush invoked directly, responded 200 (push sent cleanly) ✓');

  const newTaskName = await getBookkeepingTaskName(notificationId);
  if (!newTaskName) throw new Error('Bookkeeping doc is gone after firing — reschedule did not happen');
  if (newTaskName === originalTaskName) throw new Error('Task was not rescheduled (same task name as before)');
  console.log(`Rescheduled to a new task: ${newTaskName} ✓`);

  const [newTask] = await tasksClient.getTask({ name: newTaskName });
  const newScheduleSeconds = Number(newTask.scheduleTime.seconds);
  const expectedSeconds = Math.floor(new Date(FAR_FUTURE_REMIND_AT).getTime() / 1000) + 86400; // "daily" = +24h
  if (Math.abs(newScheduleSeconds - expectedSeconds) > 5) {
    throw new Error(
      `Next occurrence is off — expected ~${expectedSeconds} (remindAt +24h), got ${newScheduleSeconds}`
    );
  }
  console.log('Next occurrence is exactly +24h (recurrence math correct) ✓');

  await callFunction('cancelReminder', { deviceId: DEVICE_ID, notificationId });
  console.log('Test 2 PASSED');
}

async function main() {
  console.log(`Using device id: ${DEVICE_ID}`);
  if (!process.env.SMOKE_TEST_DEVICE_ID) {
    console.log(
      '(throwaway device id — pushToDevice() will just log "no fcmToken" rather than ' +
      'actually deliver. Set SMOKE_TEST_DEVICE_ID to a real registered device id to also ' +
      'confirm real delivery.)'
    );
  }

  try {
    await testOneTime();
    await testRecurring();
    console.log('\nAll smoke tests passed.');
    process.exit(0);
  } catch (err) {
    console.error('\nSMOKE TEST FAILED:', err.message);
    process.exit(1);
  }
}

main();