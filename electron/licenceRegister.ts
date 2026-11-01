import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LicenceAddInput, LicenceIssueInput, LicenceRecord, LicenceStanding } from "@shared/types";
import electron from "./electronRequire";
import { PUBLIC_KEY_PEM, verifyLicence } from "./license";
import { todayLocal, UserError } from "./util";

const { app } = electron;

/** The register of every licence it has given out: one JSON file next to the private key, shared with
 * `npm run licence` (tools/licence.mjs), so a licence made with the tool or typed in by hand shows up here by itself.
 * It only works on the computer that holds the private key; on a shop's computer the Licences screen does not exist. */

type Stored = Omit<LicenceRecord, "status" | "days_left">;

export function vendorDir(): string {
  return process.env.ELECTRO_VENDOR_DIR || path.join(app.getAppPath(), "tools");
}
const keyFile = () => path.join(vendorDir(), "private-key.pem");
const registryFile = () => path.join(vendorDir(), "licences.json");

const same = (a: string, b: string) => a.replace(/\s/g, "") === b.replace(/\s/g, "");

/** True when this computer holds the private key that matches the public key inside the app. */
export function registerStatus(): { enabled: boolean; folder: string } {
  const folder = vendorDir();
  try {
    if (!fs.existsSync(keyFile())) return { enabled: false, folder };
    const pub = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(keyFile()))).export({ type: "spki", format: "pem" }).toString();
    return { enabled: same(pub, PUBLIC_KEY_PEM), folder };
  } catch {
    return { enabled: false, folder };
  }
}

function requireEnabled(): void {
  if (!registerStatus().enabled) throw new UserError("This computer does not hold the signing key, so it cannot manage licences.");
}

function readAll(): Stored[] {
  if (!fs.existsSync(registryFile())) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(registryFile(), "utf8"));
  } catch {
    throw new UserError("tools/licences.json can't be read (it may have been edited by hand with a mistake). Fix or remove the file, then try again.");
  }
  if (!Array.isArray(parsed)) throw new UserError("tools/licences.json should be a list of licences.");
  return parsed as Stored[];
}

function writeAll(list: Stored[]): void {
  const tmp = registryFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, registryFile());
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86_400_000);

function standing(expires: string | null, today = todayLocal()): { status: LicenceStanding; days_left: number | null } {
  if (!expires) return { status: "lifetime", days_left: null };
  const left = dayNumber(expires) - dayNumber(today);
  return { status: left < 0 ? "expired" : left <= 30 ? "expiring" : "active", days_left: left };
}

const withStanding = (s: Stored): LicenceRecord => ({ ...s, ...standing(s.expires) });

/** The next licence number for this year: ESE-2026-0001, 0002… */
function nextId(list: Stored[], year: string): string {
  const used = list.map((r) => r.id.match(new RegExp(`^ESE-${year}-(\\d{4})$`))?.[1]).filter((n): n is string => !!n).map(Number);
  return `ESE-${year}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(4, "0")}`;
}

const isDate = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));

export function listLicences(): LicenceRecord[] {
  requireEnabled();
  return readAll().map(withStanding).sort((a, b) => (a.issued < b.issued ? 1 : a.issued > b.issued ? -1 : a.id < b.id ? 1 : -1));
}

function cleanMachine(m: string): string {
  const v = (m || "ANY").trim().toUpperCase();
  if (v !== "ANY" && !/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(v)) throw new UserError("The Machine ID looks like 1A2B-3C4D-5E6F-7A8B. Copy it from the shop's lock screen, or leave it empty for a key that works on any computer.");
  return v;
}

/** Makes a signed key for a shop and writes it into the register. One year by default; `expires: null` is a lifetime key. */
export function issueLicence(input: LicenceIssueInput): LicenceRecord {
  requireEnabled();
  const shop = input.shop.trim();
  if (!shop) throw new UserError("Enter the shop's name");
  const machine = cleanMachine(input.machine);
  if (machine === "ANY") throw new UserError("Enter the Machine ID from the shop's lock screen. Every key is made for one computer.");
  const today = todayLocal();
  let expires: string | null;
  if (input.expires === null) expires = null;
  else if (input.expires !== undefined) {
    if (!isDate(input.expires)) throw new UserError("The end date must look like 2027-12-31");
    if (input.expires < today) throw new UserError("The end date is already past");
    expires = input.expires;
  } else {
    const years = Math.round(input.years ?? 1);
    if (!(years >= 1 && years <= 10)) throw new UserError("A licence lasts 1 to 10 years");
    // renewing before the old end date counts the new term from that date, so the shop does not lose the days it has left
    const base = input.from && isDate(input.from) && input.from > today ? input.from : today;
    const d = new Date(base + "T12:00:00");
    d.setFullYear(d.getFullYear() + years);
    expires = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // the owner's first login, if one is wanted: the key creates it on the shop's fresh install
  let owner: { name: string; username: string; password: string } | undefined;
  const o = input.owner;
  if (o && (o.name.trim() || o.username.trim() || o.password)) {
    const username = o.username.trim().toLowerCase();
    if (!o.name.trim()) throw new UserError("Enter the owner's name for the first login");
    if (!/^[a-z0-9._@+-]{3,80}$/.test(username)) throw new UserError("The owner's username is a short name or an email address, with no spaces");
    if (o.password.length < 6) throw new UserError("The owner's first password needs at least 6 characters");
    owner = { name: o.name.trim(), username, password: o.password };
  }
  const list = readAll();
  const id = nextId(list, today.slice(0, 4));
  const payload = Buffer.from(JSON.stringify({ v: 1, id, shop, machine, issued: today, expires, ...(owner ? { owner } : {}) })).toString("base64url");
  const signature = crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(fs.readFileSync(keyFile()))).toString("base64url");
  const rec: Stored = {
    id, shop, contact: input.contact.trim(), machine, issued: today, expires, key: `ELECTRO-${payload}.${signature}`,
    note: input.note.trim(), renewal_of: input.renewal_of ?? "", created_at: new Date().toISOString(),
    ...(owner ? { owner_name: owner.name, owner_username: owner.username, owner_password: owner.password } : {}),
  };
  writeAll([...list, rec]);
  return withStanding(rec);
}

/** Records a licence that was given out some other way: paste its key (the details are read from it) or type them in. */
export function addLicence(input: LicenceAddInput): LicenceRecord {
  requireEnabled();
  const list = readAll();
  let rec: Stored;
  if (input.key.trim()) {
    const v = verifyLicence(input.key, false);
    if (!v.ok) throw new UserError(v.error);
    const p = v.payload;
    const id = p.id || input.id.trim() || nextId(list, (p.issued || todayLocal()).slice(0, 4));
    rec = { id, shop: p.shop, contact: input.contact.trim(), machine: p.machine, issued: p.issued, expires: p.expires, key: input.key.trim(), note: input.note.trim(), renewal_of: "", created_at: new Date().toISOString() };
  } else {
    const shop = input.shop.trim();
    if (!shop) throw new UserError("Enter the shop's name, or paste its licence key");
    if (!isDate(input.issued)) throw new UserError("Enter the date it was issued");
    if (input.expires !== null && !isDate(input.expires)) throw new UserError("Enter the end date, or choose lifetime");
    if (input.expires !== null && input.expires < input.issued) throw new UserError("It can't end before it was issued");
    const id = input.id.trim() || nextId(list, input.issued.slice(0, 4));
    if (!/^[A-Za-z0-9-]{3,30}$/.test(id)) throw new UserError("A licence number uses letters, numbers and dashes");
    rec = { id, shop, contact: input.contact.trim(), machine: cleanMachine(input.machine), issued: input.issued, expires: input.expires, key: "", note: input.note.trim(), renewal_of: "", created_at: new Date().toISOString() };
  }
  if (list.some((r) => r.id.toLowerCase() === rec.id.toLowerCase())) throw new UserError(`${rec.id} is already in the register`);
  writeAll([...list, rec]);
  return withStanding(rec);
}

export function removeLicence(id: string): void {
  requireEnabled();
  const list = readAll();
  if (!list.some((r) => r.id === id)) throw new UserError("That licence is not in the register");
  writeAll(list.filter((r) => r.id !== id));
}
