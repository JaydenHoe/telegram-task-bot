import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

export interface TaskRow {
  id: string;
  title: string;
  task_date: string;
  task_time: string | null;
  location: string | null;
  who: string | null;
  remind_offset_days: number;
  reminder_at: string | null;
  reminder_sent: boolean;
  status: "pending" | "done" | "incomplete" | "cancelled";
  remarks: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Is this Telegram user allowed to control the bot? */
export async function isAuthorized(userId: number): Promise<boolean> {
  const { data } = await supabase
    .from("authorized_users")
    .select("telegram_user_id")
    .eq("telegram_user_id", userId)
    .maybeSingle();
  return !!data;
}

export async function insertTask(row: Partial<TaskRow>): Promise<TaskRow> {
  const { data, error } = await supabase.from("tasks").insert(row).select().single();
  if (error) throw error;
  return data as TaskRow;
}

export async function getTask(id: string): Promise<TaskRow | null> {
  const { data } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  return (data as TaskRow) ?? null;
}

export async function updateTask(id: string, patch: Partial<TaskRow>): Promise<void> {
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

/**
 * Find the most relevant active task by free-text keywords (who / location / title).
 * Returns the best single match, or a small list if ambiguous.
 */
export async function findTasks(keywords: string): Promise<TaskRow[]> {
  const terms = keywords.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["pending", "incomplete"])
    .order("task_date", { ascending: true });
  const rows = (data as TaskRow[]) ?? [];
  if (terms.length === 0) return rows;
  const scored = rows
    .map((r) => {
      const hay = `${r.title} ${r.location ?? ""} ${r.who ?? ""}`.toLowerCase();
      const score = terms.reduce((s, t) => (hay.includes(t) ? s + 1 : s), 0);
      return { r, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.r);
}

// ---- Conversation state (pending_actions) ----
export interface PendingAction {
  id: string;
  telegram_user_id: number;
  kind: "confirm_new" | "ask_field" | "await_reschedule_date" | "eod_review";
  payload: any;
  created_at: string;
}

export async function setPending(
  userId: number,
  kind: PendingAction["kind"],
  payload: any,
): Promise<void> {
  await supabase.from("pending_actions").delete().eq("telegram_user_id", userId);
  await supabase.from("pending_actions").insert({ telegram_user_id: userId, kind, payload });
}

export async function getPending(userId: number): Promise<PendingAction | null> {
  const { data } = await supabase
    .from("pending_actions")
    .select("*")
    .eq("telegram_user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PendingAction) ?? null;
}

export async function clearPending(userId: number): Promise<void> {
  await supabase.from("pending_actions").delete().eq("telegram_user_id", userId);
}
