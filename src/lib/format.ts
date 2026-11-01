export const rupees = (n: number | null | undefined) => {
  const v = n ?? 0;
  return `${v < 0 ? "-" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export { r2 } from "@shared/pricing";

const pad = (n: number) => String(n).padStart(2, "0");

export function today(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysAgo(n: number): string {
  return today(new Date(Date.now() - n * 86_400_000));
}

export function monthStart(): string {
  return today().slice(0, 8) + "01";
}

/** "2026-10-15 14:05:00" -> "15 Oct 2026, 2:05 pm" */
export function dateTime(s: string): string {
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? s : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dateOnly(s: string): string {
  const d = new Date(s.slice(0, 10) + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export const tierLabel = (t: "customer" | "technician") => (t === "technician" ? "Technician" : "Customer");
