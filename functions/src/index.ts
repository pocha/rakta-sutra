// Reminder delivery backend — the app never uploads reminder text. Only an
// opaque notificationId (the reminder's own local SQLite row id) plus a
// remind-at time/recurrence rule (metadata, not content) ever reach here.
// One-time reminders are scheduled as a Cloud Task; recurring reminders are
// tracked in Firestore and swept periodically. Either way, sending the push
// itself only ever carries {notificationId} — the app looks up the actual
// text locally when it receives it.
import {setGlobalOptions} from "firebase-functions";
import {onRequest, Request} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
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

async function pushToDevice(deviceId: string, notificationId: string | number) {
  const deviceDoc = await db.collection("devices").doc(deviceId).get();
  const fcmToken = deviceDoc.data()?.fcmToken;
  if (!fcmToken) {
    logger.warn(`No fcmToken for device ${deviceId}`);
    return;
  }
  await getMessaging().send({
    token: fcmToken,
    data: {notificationId: String(notificationId)},
    android: {priority: "high"},
    apns: {
      headers: {"apns-priority": "10", "apns-push-type": "background"},
      payload: {aps: {"content-available": 1}},
    },
  });
}

// Cloud Tasks task names must be reused only after ~1hr once deleted, so
// tasks are always created with an auto-generated name and the actual name
// is stashed in Firestore, keyed by notificationId, so edits/cancels can
// delete the right task without ever reusing a name.
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
    await db.collection("devices").doc(deviceId).collection("reminders")
      .doc(String(notificationId)).delete().catch(() => {});

    if (!recurrence) {
      const [task] = await tasksClient.createTask({
        parent: tasksClient.queuePath(PROJECT_ID, LOCATION, QUEUE),
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: `${sendReminderPushUrl()}?secret=` +
              encodeURIComponent(REMINDER_PUSH_SECRET.value()),
            headers: {"Content-Type": "application/json"},
            body: Buffer.from(JSON.stringify({deviceId, notificationId})).toString("base64"),
          },
          scheduleTime: {seconds: Math.floor(new Date(remindAt).getTime() / 1000)},
        },
      });
      await db.collection("devices").doc(deviceId).collection("tasks")
        .doc(String(notificationId)).set({taskName: task.name});
    } else {
      await db.collection("devices").doc(deviceId).collection("reminders")
        .doc(String(notificationId)).set({
          recurrence,
          nextFireAt: Timestamp.fromDate(new Date(remindAt)),
        });
    }
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
  await db.collection("devices").doc(deviceId).collection("reminders")
    .doc(String(notificationId)).delete().catch(() => {});
  res.json({ok: true});
}));

export const sendReminderPush = onRequest(
  {secrets: [REMINDER_PUSH_SECRET]},
  async (req, res) => {
    if (req.query.secret !== REMINDER_PUSH_SECRET.value()) {
      res.status(403).send("Forbidden");
      return;
    }
    const {deviceId, notificationId} = req.body ?? {};
    if (!deviceId || notificationId === undefined) {
      res.status(400).json({error: "deviceId and notificationId required"});
      return;
    }
    await pushToDevice(deviceId, notificationId);
    res.json({ok: true});
  }
);

export const sweepRecurringReminders = onSchedule("every 15 minutes", async () => {
  const now = Timestamp.now();
  const snap = await db.collectionGroup("reminders").where("nextFireAt", "<=", now).get();
  for (const doc of snap.docs) {
    const {recurrence, nextFireAt} = doc.data();
    const deviceId = doc.ref.parent.parent?.id;
    if (!deviceId) continue;
    const notificationId = doc.id;
    await pushToDevice(deviceId, notificationId);
    const next = nextOccurrence((nextFireAt as Timestamp).toDate(), recurrence);
    await doc.ref.update({nextFireAt: Timestamp.fromDate(next)});
  }
});
