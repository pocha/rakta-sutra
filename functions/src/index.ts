// Reminder delivery backend — the app never uploads reminder text. Only an
// opaque notificationId (the reminder's own local SQLite row id) plus a
// remind-at time/recurrence rule (metadata, not content) ever reach here.
// Every reminder — one-time or recurring — is a single Cloud Task. A
// recurring task, after sending its push, computes the next occurrence
// itself and enqueues a fresh task for it (self-rescheduling chain) rather
// than relying on a periodic sweep across all reminders — this fires at
// the exact scheduled second instead of within some polling window, and
// needs no separate Firestore state for recurring reminders at all.
//
// The push itself carries a fixed, generic alert ("You have a reminder") —
// never the actual reminder text — so the OS can display it natively even
// when the app is fully killed (no app code needs to run for that). The
// real text only ever surfaces on-device: the app looks it up locally by
// notificationId (still attached as `data`) when the user taps the
// notification, and logs it to the in-app notification history then.
import {onRequest, Request} from "firebase-functions/v2/https";
import {setGlobalOptions} from "firebase-functions";
import {defineSecret} from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import {initializeApp} from "firebase-admin/app";
import {getFirestore, Timestamp} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {CloudTasksClient} from "@google-cloud/tasks";
import {nextOccurrence} from "./recurrence";
import type {Response} from "express";

initializeApp();
setGlobalOptions({region: "asia-south1", maxInstances: 10});

const db = getFirestore();
const tasksClient = new CloudTasksClient();

const REMINDER_PUSH_SECRET = defineSecret("REMINDER_PUSH_SECRET");

const PROJECT_ID = "track-blood";
const LOCATION = "asia-south1";
const QUEUE = "reminders";

function sendReminderPushUrl(): string {
  return `https://${LOCATION}-${PROJECT_ID}.cloudfunctions.net/sendReminderPush`;
}

function withCors(
  handler: (req: Request, res: Response) => Promise<void>
) {
  return async (req: Request, res: Response) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      logger.error(err);
      res.status(500).json({error: "internal error"});
    }
  };
}

const GENERIC_ALERT_TITLE = "Track Blood";
const GENERIC_ALERT_BODY = "You have a reminder";
const RESCHEDULE_FAILED_BODY =
  "A recurring reminder couldn't be rescheduled — please reopen it and tap Save again.";

async function pushToDevice(
  deviceId: string,
  notificationId: string | number,
  options?: {body?: string; type?: string}
) {
  const deviceDoc = await db.collection("devices").doc(deviceId).get();
  const fcmToken = deviceDoc.data()?.fcmToken;
  if (!fcmToken) {
    logger.warn(`No fcmToken for device ${deviceId}`);
    return;
  }
  const body = options?.body ?? GENERIC_ALERT_BODY;
  await getMessaging().send({
    token: fcmToken,
    notification: {title: GENERIC_ALERT_TITLE, body},
    data: {notificationId: String(notificationId), type: options?.type ?? "reminder"},
    android: {
      priority: "high",
      notification: {icon: "ic_stat_icon", color: "#e63946"},
    },
    apns: {
      headers: {"apns-priority": "10"},
      payload: {aps: {alert: {title: GENERIC_ALERT_TITLE, body}}},
    },
  });
}

// Cloud Tasks task names must be reused only after ~1hr once deleted, so
// tasks are always created with an auto-generated name and the actual name
// is stashed in Firestore, keyed by notificationId, so edits/cancels (and
// each recurring re-schedule) can delete/replace the right task without
// ever reusing a name.
async function deleteExistingTask(deviceId: string, notificationId: string | number) {
  const ref = db.collection("devices").doc(deviceId).collection("tasks")
    .doc(String(notificationId));
  const snap = await ref.get();
  if (snap.exists) {
    const taskName = snap.data()?.taskName;
    if (taskName) await tasksClient.deleteTask({name: taskName}).catch(() => {});
    await ref.delete();
  }
}

async function createReminderTask(
  deviceId: string,
  notificationId: string | number,
  remindAtISO: string,
  recurrence: string | null
) {
  const [task] = await tasksClient.createTask({
    parent: tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE),
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: `${sendReminderPushUrl()}?secret=` +
          encodeURIComponent(REMINDER_PUSH_SECRET.value()),
        headers: {"Content-Type": "application/json"},
        body: Buffer.from(
          JSON.stringify({deviceId, notificationId, remindAt: remindAtISO, recurrence})
        ).toString("base64"),
      },
      scheduleTime: {seconds: Math.floor(new Date(remindAtISO).getTime() / 1000)},
    },
  });
  await db.collection("devices").doc(deviceId).collection("tasks")
    .doc(String(notificationId)).set({taskName: task.name});
}

export const registerDevice = onRequest(withCors(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const {deviceId, fcmToken} = req.body ?? {};
  if (!deviceId || !fcmToken) {
    res.status(400).json({error: "deviceId and fcmToken required"});
    return;
  }
  await db.collection("devices").doc(deviceId).set(
    {fcmToken, updatedAt: Timestamp.now()},
    {merge: true}
  );
  res.json({ok: true});
}));

export const scheduleReminder = onRequest(
  {secrets: [REMINDER_PUSH_SECRET]},
  withCors(async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }
    const {deviceId, notificationId, remindAt, recurrence} = req.body ?? {};
    if (!deviceId || notificationId === undefined || notificationId === null || !remindAt) {
      res.status(400).json({error: "deviceId, notificationId, remindAt required"});
      return;
    }

    await deleteExistingTask(deviceId, notificationId);
    await createReminderTask(deviceId, notificationId, remindAt, recurrence ?? null);
    res.json({ok: true});
  })
);

export const cancelReminder = onRequest(withCors(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const {deviceId, notificationId} = req.body ?? {};
  if (!deviceId || notificationId === undefined || notificationId === null) {
    res.status(400).json({error: "deviceId and notificationId required"});
    return;
  }
  await deleteExistingTask(deviceId, notificationId);
  res.json({ok: true});
}));

export const sendReminderPush = onRequest(
  {secrets: [REMINDER_PUSH_SECRET]},
  async (req, res) => {
    if (req.query.secret !== REMINDER_PUSH_SECRET.value()) {
      res.status(403).send("Forbidden");
      return;
    }
    const {deviceId, notificationId, remindAt, recurrence} = req.body ?? {};
    if (!deviceId || notificationId === undefined) {
      res.status(400).json({error: "deviceId and notificationId required"});
      return;
    }

    await pushToDevice(deviceId, notificationId);

    if (recurrence) {
      try {
        const next = nextOccurrence(new Date(remindAt), recurrence);
        await createReminderTask(deviceId, notificationId, next.toISOString(), recurrence);
      } catch (err) {
        logger.error(
          `Failed to reschedule recurring reminder ${notificationId} for device ${deviceId}`, err
        );
        await pushToDevice(deviceId, notificationId, {
          body: RESCHEDULE_FAILED_BODY,
          type: "reschedule_failed",
        }).catch((notifyErr) => logger.error("Failed to send reschedule-failure alert", notifyErr));
      }
    }

    res.json({ok: true});
  }
);
