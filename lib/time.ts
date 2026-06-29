// All time logic is anchored to Singapore (UTC+8, no daylight saving).

const SGT_OFFSET = "+08:00";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Current instant, broken into Singapore-local parts. */
export function nowSGT(): { date: string; time: string; weekday: string; iso: string } {
  const now = new Date();
  // Shift to SGT wall-clock by adding 8h, then read UTC fields.
  const sgt = new Date(now.getTime() + 8 * 3600 * 1000);
  const date = sgt.toISOString().slice(0, 10);       // YYYY-MM-DD
  const time = sgt.toISOString().slice(11, 16);       // HH:MM
  const weekday = DAYS[sgt.getUTCDay()];
  return { date, time, weekday, iso: now.toISOString() };
}

/** "2026-07-03" -> "Fri 3 Jul 2026" */
export function humanDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00${SGT_OFFSET}`);
  const sgt = new Date(d.getTime() + 8 * 3600 * 1000);
  return `${DAYS[sgt.getUTCDay()]} ${sgt.getUTCDate()} ${MONTHS[sgt.getUTCMonth()]} ${sgt.getUTCFullYear()}`;
}

/** "09:00" -> "9:00am" ; null/"" -> "" */
export function humanTime(t?: string | null): string {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m}${ampm}`;
}

/**
 * The exact UTC instant to fire a reminder:
 * (task_date − offsetDays) at 19:00 Singapore time.
 */
export function reminderInstant(taskDate: string, offsetDays: number): string {
  const base = new Date(`${taskDate}T19:00:00${SGT_OFFSET}`);
  base.setUTCDate(base.getUTCDate() - offsetDays);
  return base.toISOString();
}

/** Today's Singapore date as YYYY-MM-DD. */
export function todaySGT(): string {
  return nowSGT().date;
}
