import type { Settings } from "@shared/types";
import { getDb } from "./db";
import { UserError } from "./util";

const DEFAULTS: Settings = {
  shop_name: "My Electronics Shop",
  address: "",
  phone: "",
  gstin: "",
  state: "",
  bill_prefix: "INV-",
  default_tier: "customer",
  service_gst: 18,
  paper: "A4",
  terms: "Goods once sold will not be taken back without the bill.",
  warranty_note: "Warranty as per manufacturer terms. Physical damage and liquid damage are not covered.",
  backup_folder: "",
};

export function getSettings(): Settings {
  const rows = getDb().prepare("select key, value from settings").all() as { key: string; value: string }[];
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const out = { ...DEFAULTS } as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (saved[k] === undefined) continue;
    out[k] = typeof DEFAULTS[k] === "number" ? Number(saved[k]) : saved[k];
  }
  return out as unknown as Settings;
}

export function saveSettings(s: Partial<Settings>): Settings {
  if (s.shop_name !== undefined && !s.shop_name.trim()) throw new UserError("Shop name is required");
  if (s.default_tier !== undefined && s.default_tier !== "customer" && s.default_tier !== "technician") throw new UserError("Choose customer or technician");
  if (s.service_gst !== undefined && !(s.service_gst >= 0 && s.service_gst <= 40)) throw new UserError("GST on service must be 0–40%");
  const put = getDb().prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value");
  getDb().transaction(() => {
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (s[k] !== undefined) put.run(k, String(s[k]).trim());
    }
  })();
  return getSettings();
}

/** The shop's state, lower-cased, to tell an in-state bill (CGST + SGST) from an interstate one (IGST). */
export function shopState(): string {
  return getSettings().state.trim().toLowerCase();
}
