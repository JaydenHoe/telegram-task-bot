import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseTasks, parseUpdate, resolveDate, looksLikeUpdate, type ParsedTask } from "../lib/anthropic.js";
import {
  isAuthorized,
  insertTask,
  getTask,
  updateTask,
  findTasks,
  setPending,
  getPending,
  clearPending,
  type TaskRow,
} from "../lib/supabase.js";
import { sendMessage, answerCallback, editButtons, esc } from "../lib/telegram.js";
import { confirmCard, taskLine } from "../lib/format.js";
import { reminderInstant, humanDate } from "../lib/time.js";

const REQUIRED_LABEL: Record<string, string> = {
  date: "the date",
  location: "the location / site",
  who: "the subcontractor (who)",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always 200 quickly so Telegram doesn't retry; do work inline (fast enough).
  if (req.method !== "POST") return res.status(200).send("ok");

  // Verify the request really came from Telegram.
  const secret = req.headers["x-telegram-bot-api-secret-token"];
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }

  try {
    const update = req.body;
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("handler error:", err);
  }
  return res.status(200).send("ok");
}

// ---------------------------------------------------------------------------
// Text messages
// ---------------------------------------------------------------------------
async function handleMessage(msg: any) {
  const userId = msg.from.id as number;
  const chatId = msg.chat.id as number;
  const text = (msg.text as string).trim();

  // Only the allowlisted user(s) may control the bot, and only in private chat.
  if (msg.chat.type !== "private") return; // ignore group chatter
  if (!(await isAuthorized(userId))) {
    await sendMessage(chatId, "⛔ You're not authorised to use this bot.");
    return;
  }

  // /start and /help
  if (text === "/start" || text === "/help") {
    await sendMessage(
      chatId,
      [
        "👷 <b>Evermount Task Bot</b>",
        "",
        "Just tell me a job in normal words, e.g.:",
        "<i>this friday pipe installation at 19 hillview, subcon muthu, remind 1 day before</i>",
        "",
        "I'll confirm before saving. I post reminders &amp; daily summaries to the group.",
        "",
        "To update a job, message me: <i>muthu pipe job done, tap leaking</i>",
      ].join("\n"),
    );
    return;
  }

  // Are we mid-conversation (waiting on a follow-up answer)?
  const pending = await getPending(userId);
  if (pending?.kind === "ask_field") {
    await handleFieldReply(chatId, userId, pending.payload, text);
    return;
  }
  if (pending?.kind === "await_reschedule_date") {
    await handleRescheduleReply(chatId, userId, pending.payload.taskId, text);
    return;
  }

  // New message: is it an update to an existing job, or a new job?
  if (looksLikeUpdate(text)) {
    await handleUpdateText(chatId, text);
    return;
  }
  await handleCreate(chatId, userId, text);
}

// ---- Creating tasks ----
async function handleCreate(chatId: number, userId: number, text: string) {
  await sendMessage(chatId, "🧠 Reading that…");
  const drafts = await parseTasks(text);
  if (drafts.length === 0) {
    await sendMessage(chatId, "🤔 I couldn't find a job in that. Try: <i>tomorrow tiling at 19 hillview, subcon raj</i>");
    return;
  }
  await collectOrConfirm(chatId, userId, drafts);
}

/** Walk through any missing required fields, then show the confirm card. */
async function collectOrConfirm(chatId: number, userId: number, drafts: ParsedTask[]) {
  for (let i = 0; i < drafts.length; i++) {
    const miss = drafts[i].missing?.[0];
    if (miss) {
      await setPending(userId, "ask_field", { drafts, idx: i, field: miss });
      const which = drafts.length > 1 ? ` for job ${i + 1} (“${drafts[i].title}”)` : "";
      await sendMessage(chatId, `❓ What's ${REQUIRED_LABEL[miss]}${which}?`);
      return;
    }
  }
  // All complete — show confirmation.
  await setPending(userId, "confirm_new", { drafts });
  const cards = drafts.map((d, i) => `${drafts.length > 1 ? `<b>Job ${i + 1}</b>\n` : ""}${confirmCard(d)}`);
  await sendMessage(chatId, cards.join("\n\n"), [
    [
      { text: "✅ Confirm & save", callback_data: "save_all" },
      { text: "✖️ Discard", callback_data: "discard" },
    ],
  ]);
}

async function handleFieldReply(chatId: number, userId: number, payload: any, text: string) {
  const drafts: ParsedTask[] = payload.drafts;
  const { idx, field } = payload;
  if (field === "date") {
    const d = await resolveDate(text);
    drafts[idx].date = d;
    if (!d) {
      await sendMessage(chatId, "❓ I didn't catch a date. Try e.g. <i>this friday</i> or <i>3 July</i>.");
      await setPending(userId, "ask_field", { drafts, idx, field: "date" });
      return;
    }
  } else if (field === "location") {
    drafts[idx].location = text;
  } else if (field === "who") {
    drafts[idx].who = text;
  }
  // Drop this field from missing and continue.
  drafts[idx].missing = (drafts[idx].missing || []).filter((m) => m !== field);
  await collectOrConfirm(chatId, userId, drafts);
}

// ---- Updating tasks from free text ----
async function handleUpdateText(chatId: number, text: string) {
  const intent = await parseUpdate(text);
  if (intent.action === "unknown") {
    await sendMessage(chatId, "🤔 Not sure what to update. Mention the subcon or site, e.g. <i>muthu hillview job done</i>.");
    return;
  }
  const matches = await findTasks(intent.match);
  if (matches.length === 0) {
    await sendMessage(chatId, "🔍 I couldn't find a matching active job.");
    return;
  }
  if (matches.length > 1) {
    const buttons = matches.slice(0, 6).map((t) => [
      { text: `${t.title} · ${humanDate(t.task_date)}${t.who ? " · " + t.who : ""}`, callback_data: actionCb(intent.action, t.id, intent) },
    ]);
    await sendMessage(chatId, "❓ Which job did you mean?", buttons);
    return;
  }
  await applyUpdate(chatId, matches[0], intent.action, intent.remarks, intent.new_date);
}

function actionCb(action: string, id: string, intent: any): string {
  switch (action) {
    case "complete": return `done:${id}`;
    case "incomplete": return `inc:${id}`;
    case "cancel": return `cancel_task:${id}`;
    case "reschedule": return intent.new_date ? `resd:${id}:${intent.new_date}` : `res:${id}`;
    default: return `rmk:${id}`;
  }
}

async function applyUpdate(
  chatId: number,
  task: TaskRow,
  action: string,
  remarks: string | null,
  newDate: string | null,
) {
  if (action === "complete") {
    await updateTask(task.id, { status: "done", ...(remarks ? { remarks } : {}) });
    await sendMessage(chatId, `✅ Marked done: <b>${esc(task.title)}</b>${remarks ? `\n📝 ${esc(remarks)}` : ""}`);
  } else if (action === "incomplete") {
    await updateTask(task.id, { status: "incomplete", ...(remarks ? { remarks } : {}) });
    await sendMessage(chatId, `⚠️ Marked incomplete: <b>${esc(task.title)}</b>${remarks ? `\n📝 ${esc(remarks)}` : ""}`);
  } else if (action === "cancel") {
    await updateTask(task.id, { status: "cancelled", ...(remarks ? { remarks } : {}) });
    await sendMessage(chatId, `❌ Cancelled: <b>${esc(task.title)}</b>`);
  } else if (action === "remark") {
    await updateTask(task.id, { remarks: remarks ?? task.remarks });
    await sendMessage(chatId, `📝 Note added to <b>${esc(task.title)}</b>.`);
  } else if (action === "reschedule") {
    if (newDate) {
      await updateTask(task.id, {
        task_date: newDate,
        status: "pending",
        reminder_sent: false,
        reminder_at: reminderInstant(newDate, task.remind_offset_days),
      });
      await sendMessage(chatId, `📅 Moved <b>${esc(task.title)}</b> to ${humanDate(newDate)}.`);
    } else {
      await setPending(chatId, "await_reschedule_date", { taskId: task.id });
      await sendMessage(chatId, `📅 What's the new date for <b>${esc(task.title)}</b>?`);
    }
  }
}

async function handleRescheduleReply(chatId: number, userId: number, taskId: string, text: string) {
  const d = await resolveDate(text);
  if (!d) {
    await sendMessage(chatId, "❓ I didn't catch a date. Try <i>next monday</i> or <i>5 July</i>.");
    return;
  }
  const task = await getTask(taskId);
  await clearPending(userId);
  if (!task) {
    await sendMessage(chatId, "That job no longer exists.");
    return;
  }
  await updateTask(taskId, {
    task_date: d,
    status: "pending",
    reminder_sent: false,
    reminder_at: reminderInstant(d, task.remind_offset_days),
  });
  await sendMessage(chatId, `📅 Moved <b>${esc(task.title)}</b> to ${humanDate(d)}.`);
}

// ---------------------------------------------------------------------------
// Button taps (callback queries)
// ---------------------------------------------------------------------------
async function handleCallback(cb: any) {
  const userId = cb.from.id as number;
  const chatId = cb.message.chat.id as number;
  const messageId = cb.message.message_id as number;
  const data = cb.data as string;

  if (!(await isAuthorized(userId))) {
    await answerCallback(cb.id, "Not authorised");
    return;
  }

  // Save / discard a freshly parsed batch.
  if (data === "save_all") {
    const pending = await getPending(userId);
    await answerCallback(cb.id);
    await editButtons(chatId, messageId, []); // remove buttons
    if (pending?.kind !== "confirm_new") {
      await sendMessage(chatId, "That draft expired. Please retype the job.");
      return;
    }
    const drafts: ParsedTask[] = pending.payload.drafts;
    const saved: TaskRow[] = [];
    for (const d of drafts) {
      if (!d.date) continue;
      const row = await insertTask({
        title: d.title,
        task_date: d.date,
        task_time: d.time,
        location: d.location,
        who: d.who,
        remind_offset_days: d.remind_offset_days,
        reminder_at: reminderInstant(d.date, d.remind_offset_days),
        created_by: userId,
      });
      saved.push(row);
    }
    await clearPending(userId);
    const lines = saved.map((t) => `${taskLine(t)}\n   📅 ${humanDate(t.task_date)} · 🔔 ${humanDate(reminderDateOf(t))} 7pm`);
    await sendMessage(chatId, `💾 Saved:\n\n${lines.join("\n\n")}`);
    return;
  }

  if (data === "discard") {
    await clearPending(userId);
    await answerCallback(cb.id, "Discarded");
    await editButtons(chatId, messageId, []);
    await sendMessage(chatId, "🗑️ Discarded. Nothing saved.");
    return;
  }

  // Per-task action buttons (from update flow, EOD prompts, summaries).
  const [verb, id, extra] = data.split(":");
  const task = await getTask(id);
  if (!task) {
    await answerCallback(cb.id, "Job not found");
    return;
  }
  if (verb === "done") {
    await applyUpdate(chatId, task, "complete", null, null);
  } else if (verb === "inc") {
    await applyUpdate(chatId, task, "incomplete", null, null);
  } else if (verb === "cancel_task") {
    await applyUpdate(chatId, task, "cancel", null, null);
  } else if (verb === "resd") {
    await applyUpdate(chatId, task, "reschedule", null, extra);
  } else if (verb === "res") {
    await applyUpdate(chatId, task, "reschedule", null, null);
  }
  await answerCallback(cb.id, "Done");
  await editButtons(chatId, messageId, []);
}

/** The calendar date a task's reminder fires on (for display). */
function reminderDateOf(t: TaskRow): string {
  const d = new Date(`${t.task_date}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() - t.remind_offset_days);
  return d.toISOString().slice(0, 10);
}
