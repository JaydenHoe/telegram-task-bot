import { humanDate, humanTime } from "./time.js";
import { esc } from "./telegram.js";
import type { TaskRow } from "./supabase.js";

const STATUS_EMOJI: Record<TaskRow["status"], string> = {
  pending: "🟡",
  done: "✅",
  incomplete: "⚠️",
  cancelled: "❌",
};

/** A one-line summary of a task. */
export function taskLine(t: TaskRow): string {
  const time = t.task_time ? ` ${humanTime(t.task_time)}` : "";
  const loc = t.location ? ` @ ${esc(t.location)}` : "";
  const who = t.who ? ` — ${esc(t.who)}` : "";
  const rmk = t.remarks ? `\n   📝 ${esc(t.remarks)}` : "";
  return `${STATUS_EMOJI[t.status]} <b>${esc(t.title)}</b>${time}${loc}${who}${rmk}`;
}

/** The detailed confirmation card shown before saving a new task. */
export function confirmCard(t: {
  title: string;
  date: string | null;
  time: string | null;
  location: string | null;
  who: string | null;
  remind_offset_days: number;
}): string {
  const lines = [
    `📋 <b>${esc(t.title)}</b>`,
    `📅 ${t.date ? humanDate(t.date) : "—"}${t.time ? `  ⏰ ${humanTime(t.time)}` : ""}`,
    `📍 ${t.location ? esc(t.location) : "—"}`,
    `👷 ${t.who ? esc(t.who) : "—"}`,
    `🔔 Remind ${t.remind_offset_days} day(s) before, 7pm`,
  ];
  return lines.join("\n");
}
