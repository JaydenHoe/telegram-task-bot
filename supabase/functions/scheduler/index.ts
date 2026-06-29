// Supabase Edge Function (Deno).
// Invoked every minute by pg_cron. Decides what (if anything) is due right now
// in Singapore time: reminders, the 3x daily summaries, and end-of-day prompts.
//
// Deploy:  supabase functions deploy scheduler --no-verify-jwt
// Secrets: supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_GROUP_CHAT_ID=... SCHEDULER_SECRET=...
//          (SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY are provided automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const GROUP_CHAT_ID = Deno.env.get("TELEGRAM_GROUP_CHAT_ID")!;
const SCHEDULER_SECRET = Deno.env.get("SCHEDULER_SECRET")!;

const SUMMARY_SLOTS: Record<string, string> = {
  "08:00": "summary_morning",
  "13:00": "summary_afternoon",
  "18:00": "summary_evening",
};
const EOD_SLOT = "18:05"; // end-of-day completion prompts

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function sgtNow() {
  const sgt = new Date(Date.now() + 8 * 3600 * 1000);
  return {
    date: sgt.toISOString().slice(0, 10),
    hm: sgt.toISOString().slice(11, 16),
  };
}
function humanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00+08:00`);
  const sgt = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${DAYS[sgt.getUTCDay()]} ${sgt.getUTCDate()} ${MONTHS[sgt.getUTCMonth()]}`;
}
function humanTime(t?: string | null): string {
  if (!t) return "";
  let h = parseInt(t.slice(0, 2), 10);
  const m = t.slice(3, 5);
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return ` ${h}:${m}${ap}`;
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) console.error(`tg ${method}:`, j.description);
  return j;
}
const send = (chat: string | number, text: string, buttons?: any) =>
  tg("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });

/** Run a job at most once per Singapore day. */
async function once(jobKey: string, date: string): Promise<boolean> {
  const { error } = await supabase.from("scheduler_log").insert({ job_key: jobKey, run_date: date });
  return !error; // unique-violation => already ran
}

function line(t: any): string {
  const emoji = { pending: "🟡", done: "✅", incomplete: "⚠️", cancelled: "❌" }[t.status] ?? "•";
  const loc = t.location ? ` @ ${esc(t.location)}` : "";
  const who = t.who ? ` — ${esc(t.who)}` : "";
  const rmk = t.remarks ? `\n   📝 ${esc(t.remarks)}` : "";
  return `${emoji} <b>${esc(t.title)}</b>${humanTime(t.task_time)}${loc}${who}${rmk}`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-scheduler-secret") !== SCHEDULER_SECRET) {
    return new Response("unauthorized", { status: 401 });
  }
  const { date, hm } = sgtNow();
  const did: string[] = [];

  // 1) Due reminders -> group
  const { data: dueReminders } = await supabase
    .from("tasks")
    .select("*")
    .eq("reminder_sent", false)
    .in("status", ["pending", "incomplete"])
    .lte("reminder_at", new Date().toISOString());
  for (const t of dueReminders ?? []) {
    await send(
      GROUP_CHAT_ID,
      `⏰ <b>Reminder</b>\nTomorrow is the job:\n\n${line(t)}\n📅 ${humanDate(t.task_date)}`,
    );
    await supabase.from("tasks").update({ reminder_sent: true }).eq("id", t.id);
    did.push(`reminder:${t.id}`);
  }

  // 2) Daily summaries -> group (8am / 1pm / 6pm)
  const slot = SUMMARY_SLOTS[hm];
  if (slot && (await once(slot, date))) {
    await sendSummary(slot, date);
    did.push(slot);
  }

  // 3) End-of-day completion prompts -> each manager privately
  if (hm === EOD_SLOT && (await once("eod", date))) {
    await sendEod(date);
    did.push("eod");
  }

  return new Response(JSON.stringify({ ok: true, date, hm, did }), {
    headers: { "Content-Type": "application/json" },
  });
});

async function sendSummary(slot: string, date: string) {
  const label =
    slot === "summary_morning" ? "🌅 Morning" : slot === "summary_afternoon" ? "🌤️ Afternoon" : "🌆 Evening";

  const { data: today } = await supabase
    .from("tasks")
    .select("*")
    .eq("task_date", date)
    .neq("status", "cancelled")
    .order("task_time", { ascending: true });

  const { data: overdue } = await supabase
    .from("tasks")
    .select("*")
    .lt("task_date", date)
    .in("status", ["pending", "incomplete"])
    .order("task_date", { ascending: true });

  const parts: string[] = [`${label} update — ${humanDate(date)}`];

  parts.push("\n📅 <b>Today</b>");
  parts.push((today?.length ? today.map(line).join("\n") : "—  no jobs today"));

  if (overdue?.length) {
    parts.push("\n⚠️ <b>Overdue / still pending</b>");
    parts.push(overdue.map((t) => `${line(t)}  <i>(${humanDate(t.task_date)})</i>`).join("\n"));
  }

  await send(GROUP_CHAT_ID, parts.join("\n"));
}

async function sendEod(date: string) {
  // Tasks that were due today and not yet closed out.
  const { data: due } = await supabase
    .from("tasks")
    .select("*")
    .eq("task_date", date)
    .eq("status", "pending");
  if (!due?.length) return;

  const { data: managers } = await supabase
    .from("authorized_users")
    .select("telegram_user_id")
    .eq("can_manage", true);

  for (const m of managers ?? []) {
    await send(m.telegram_user_id, `🌙 <b>End of day check</b> — how did today's jobs go?`);
    for (const t of due) {
      await send(m.telegram_user_id, line(t), [
        [
          { text: "✅ Done", callback_data: `done:${t.id}` },
          { text: "⚠️ Incomplete", callback_data: `inc:${t.id}` },
          { text: "📅 Reschedule", callback_data: `res:${t.id}` },
        ],
      ]);
    }
  }
}
