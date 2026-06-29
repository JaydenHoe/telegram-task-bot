import Anthropic from "@anthropic-ai/sdk";
import { nowSGT } from "./time.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

export interface ParsedTask {
  title: string;            // what work is being done
  date: string | null;      // YYYY-MM-DD (resolved), or null if not stated
  time: string | null;      // HH:MM 24h, or null
  location: string | null;  // site / address
  who: string | null;       // subcontractor name
  remind_offset_days: number; // default 1
  missing: string[];        // required fields the user must still provide: any of ["date","location","who"]
}

const SYSTEM = `You extract construction job details from a main-contractor's chat messages and turn them into structured tasks.

Rules:
- A single message may contain MULTIPLE jobs. If two jobs are at DIFFERENT locations, output them as SEPARATE tasks. Same location + same day = one task.
- Resolve all relative dates ("today", "tomorrow", "this friday", "next mon", "end of month") to an absolute YYYY-MM-DD using the provided current Singapore date. "this <weekday>" means the nearest upcoming occurrence of that weekday (today counts only if explicitly "today").
- time: 24h "HH:MM" if a clock time is given, else null. Do NOT invent a time.
- remind_offset_days: read phrases like "remind 1 day before" (=1), "2 days before" (=2), "remind the day before" (=1). Default to 1 if a reminder is implied but no number given, and 1 if nothing is said.
- For each task, list in "missing" any of these REQUIRED fields that are absent or unclear: "date", "location", "who". (title is always required too, but infer it from the message.) time is optional and never goes in missing.
- Keep names as written (e.g. "Muthu", "Raj"). Keep locations concise (e.g. "19 Hillview").
- Output ONLY by calling the record_tasks tool. Never write prose.`;

const TOOL: Anthropic.Tool = {
  name: "record_tasks",
  description: "Record one or more parsed construction tasks.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
            time: { type: ["string", "null"], description: "HH:MM 24h or null" },
            location: { type: ["string", "null"] },
            who: { type: ["string", "null"] },
            remind_offset_days: { type: "integer" },
            missing: {
              type: "array",
              items: { type: "string", enum: ["date", "location", "who"] },
            },
          },
          required: ["title", "date", "time", "location", "who", "remind_offset_days", "missing"],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
};

/** Parse a free-text message into one or more structured tasks. */
export async function parseTasks(message: string): Promise<ParsedTask[]> {
  const { date, weekday, time } = nowSGT();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    tool_choice: { type: "tool", name: "record_tasks" },
    tools: [TOOL],
    messages: [
      {
        role: "user",
        content: `Current Singapore date/time: ${weekday} ${date} ${time} (UTC+8).\n\nMessage:\n${message}`,
      },
    ],
  });

  const block = resp.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return [];
  const out = (block.input as { tasks: ParsedTask[] }).tasks || [];
  return out.map((t) => ({
    ...t,
    remind_offset_days: t.remind_offset_days ?? 1,
    missing: Array.isArray(t.missing) ? t.missing : [],
  }));
}

export interface UpdateIntent {
  action: "complete" | "incomplete" | "reschedule" | "cancel" | "remark" | "unknown";
  match: string;        // free-text describing which task (who/location/title keywords)
  remarks: string | null;
  new_date: string | null; // for reschedule, YYYY-MM-DD or null if user must supply
}

const UPDATE_SYSTEM = `You interpret a main-contractor's short message about an EXISTING job (not creating a new one).
Classify the intent and extract which job it refers to.
- action: "complete" (job done), "incomplete" (not finished / problem), "reschedule" (move to another date, e.g. due to rain), "cancel", "remark" (just adding a note), or "unknown".
- match: keywords identifying the job — subcontractor name and/or location and/or work type as mentioned.
- remarks: any note/comment (e.g. "tap leaking"), else null.
- new_date: for reschedule, the resolved YYYY-MM-DD if a date is given, else null. Resolve relative dates against the provided current Singapore date.
Output ONLY via the record_update tool.`;

const UPDATE_TOOL: Anthropic.Tool = {
  name: "record_update",
  description: "Record the interpreted update to an existing task.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["complete", "incomplete", "reschedule", "cancel", "remark", "unknown"] },
      match: { type: "string" },
      remarks: { type: ["string", "null"] },
      new_date: { type: ["string", "null"] },
    },
    required: ["action", "match", "remarks", "new_date"],
    additionalProperties: false,
  },
};

export async function parseUpdate(message: string): Promise<UpdateIntent> {
  const { date, weekday, time } = nowSGT();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: UPDATE_SYSTEM,
    tool_choice: { type: "tool", name: "record_update" },
    tools: [UPDATE_TOOL],
    messages: [
      {
        role: "user",
        content: `Current Singapore date/time: ${weekday} ${date} ${time} (UTC+8).\n\nMessage:\n${message}`,
      },
    ],
  });
  const block = resp.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { action: "unknown", match: "", remarks: null, new_date: null };
  }
  return block.input as UpdateIntent;
}

/** Resolve a free-text date reply ("next monday", "3 july") to YYYY-MM-DD, or null. */
export async function resolveDate(message: string): Promise<string | null> {
  const { date, weekday, time } = nowSGT();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: `Resolve the date in the user's message to an absolute YYYY-MM-DD using the given current Singapore date. Resolve relative terms ("tomorrow", "next monday", "this friday"). Reply with ONLY the date in YYYY-MM-DD format, or the single word NONE if no date is present.`,
    messages: [
      { role: "user", content: `Current Singapore date: ${weekday} ${date} ${time}.\n\n${message}` },
    ],
  });
  const text = resp.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  const m = text.text.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

/**
 * Decide whether an incoming message is creating NEW work or updating EXISTING work.
 * Cheap heuristic first; the webhook can also use button context to skip this.
 */
export function looksLikeUpdate(message: string): boolean {
  const m = message.toLowerCase();
  return /\b(done|complete|completed|finished|settled|not done|incomplete|cancel|cancelled|postpone|push|reschedule|delay|rain|remark|note)\b/.test(
    m,
  );
}
