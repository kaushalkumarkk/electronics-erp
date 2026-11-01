/** Small shared helpers for the main process. */
export { r2 } from "@shared/pricing";

const pad = (n: number) => String(n).padStart(2, "0");

/** The shop's local date-time, as stored on bills: YYYY-MM-DD HH:MM:SS. */
export function nowLocal(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayLocal(d = new Date()): string {
  return nowLocal(d).slice(0, 10);
}

/** YYYY-MM-DD a number of months after a date (warranty end). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const t = new Date(y, m - 1 + months, d);
  return todayLocal(t);
}

/** The day after a YYYY-MM-DD date, so a range can be `>= from and < next(to)` and still use the date index. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return todayLocal(new Date(y, m - 1, d + 1));
}

export class UserError extends Error {}
