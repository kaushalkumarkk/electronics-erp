import type { LicenseStatus } from "@shared/types";

/** What a shop sends the vendor to ask for a renewal: copied from Settings → Licence (or the lock screen), pasted into the
 * Licences screen, which fills in the shop, its licence, its end date and its computer. */
export function renewalRequestText(s: Pick<LicenseStatus, "licensee" | "licence_id" | "expires" | "machine_id">): string {
  return ["Licence renewal request", `Shop: ${s.licensee || "(not licensed yet)"}`, `Licence: ${s.licence_id || "-"}`, `Ends: ${s.expires ?? "-"}`, `Machine: ${s.machine_id}`].join("\n");
}

export interface RenewalRequest {
  shop: string;
  licence: string; // "" when it has none
  ends: string; // YYYY-MM-DD or ""
  machine: string; // "" when not readable
}

/** Reads a pasted renewal request; null if the text isn't one. */
export function parseRenewalRequest(text: string): RenewalRequest | null {
  const get = (key: string) => text.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, "im"))?.[1] ?? "";
  const machine = get("Machine").toUpperCase();
  const validMachine = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(machine) ? machine : "";
  if (!/renewal request/i.test(text) && !validMachine) return null;
  const shop = get("Shop");
  const licence = get("Licence");
  const ends = get("Ends");
  return {
    shop: shop.startsWith("(") ? "" : shop,
    licence: licence === "-" ? "" : licence,
    ends: /^\d{4}-\d{2}-\d{2}$/.test(ends) ? ends : "",
    machine: validMachine,
  };
}
