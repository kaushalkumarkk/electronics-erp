import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import type { LicenseStatus } from "@shared/types";
import { createFirstOwner } from "./auth";
import { getDb } from "./db";
import { todayLocal, UserError } from "./util";

/** The vendor signs a licence key for each shop with its private key (tools/licence.mjs, or Licences in the app on the vendor's own
 * computer); the app only holds the public half, so a shop can check a key but never make one.
 *
 * There is no trial: without a valid key the whole app is locked, and a key stops working on its expiry date (a yearly
 * subscription is a key that expires after one year). Only the calls in LICENCE_OPEN still work while locked, so the shop can
 * enter a new key and save a backup of its own data. */
export const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApIkOqTr8cjajgPKZeG5lz8fyj/+508GAycI0snnC100=
-----END PUBLIC KEY-----`;

export interface Payload {
  v: 1;
  /** Unique licence number, e.g. ESE-2026-0007. Keys made before licence numbers existed have none. */
  id?: string;
  shop: string;
  machine: string; // "ANY" or a Machine ID
  issued: string;
  expires: string | null;
  /** The owner's first login, created when the key is activated on a fresh install. */
  owner?: { name: string; username: string; password: string };
}

/** The only requests answered while the app is locked. */
export const LICENCE_OPEN = new Set(["licenseStatus", "licenseActivate", "licenseBackup"]);

/** The computer's own hardware id: it does not change with the network, the computer's name or a reinstall of the app. */
function hardwareId(): string {
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8", timeout: 5000 });
      return out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)?.[1] ?? "";
    }
    if (process.platform === "win32") {
      const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? "";
    }
    return fs.readFileSync("/etc/machine-id", "utf8").trim();
  } catch {
    return "";
  }
}

const formatId = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-");

/** The Machine ID used before hardware ids: it depends on the computer's name, which a Mac changes with the network. Keys made
 * for it are still accepted, so shops that already have a key are not locked out. */
function legacyMachineId(): string {
  const cpu = os.cpus()[0]?.model ?? "";
  return formatId([os.hostname(), os.userInfo().username, cpu, os.platform()].join("|"));
}

let cachedId: string | null = null;

/** Shown on the lock screen so a shop can ask for a key that works on this computer only. */
export function machineId(): string {
  if (cachedId) return cachedId;
  const hw = hardwareId();
  cachedId = hw ? formatId(`electro-hw|${hw}`) : legacyMachineId();
  return cachedId;
}

/** Checks a key's signature and that it is for this computer. Nothing about dates here (see licenseStatus). */
export function verifyLicence(key: string, checkMachine = true): { ok: true; payload: Payload } | { ok: false; error: string } {
  const m = key.trim().match(/^ELECTRO-([\w-]+)\.([\w-]+)$/);
  if (!m) return { ok: false, error: "That doesn't look like a licence key. It starts with ELECTRO- and has no spaces." };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(m[1]), crypto.createPublicKey(PUBLIC_KEY_PEM), Buffer.from(m[2], "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "This key is not valid. Check that it was copied completely." };
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Payload;
  } catch {
    return { ok: false, error: "This key is damaged." };
  }
  if (payload.v !== 1 || !payload.shop) return { ok: false, error: "This key is for a different version of the app." };
  if (checkMachine && payload.machine !== "ANY" && payload.machine !== machineId() && payload.machine !== legacyMachineId()) {
    return { ok: false, error: "This key was made for a different computer. Send the Machine ID shown here to get one for this computer." };
  }
  return { ok: true, payload };
}

const getSetting = (key: string) => (getDb().prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value;
const putSetting = (key: string, value: string) =>
  getDb().prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86_400_000);

/** Today's date, but never earlier than the latest date this app has seen: winding the clock back doesn't extend a licence. */
function trustedToday(): string {
  const today = todayLocal();
  const seen = getSetting("last_seen_date");
  if (seen && seen > today) return seen;
  if (seen !== today) putSetting("last_seen_date", today);
  return today;
}

export function licenseStatus(): LicenseStatus {
  const today = trustedToday();
  const machine = machineId();
  const none = (message: string): LicenseStatus => ({ state: "none", licensee: "", licence_id: "", machine_id: machine, issued: "", expires: null, days_left: null, message });
  const stored = getSetting("licence_key");
  if (!stored) return none("This copy is not licensed yet. Enter the licence key your software provider gave you.");
  const v = verifyLicence(stored);
  if (!v.ok) return none(v.error);
  const { shop, expires, issued, id } = v.payload;
  const base = { licensee: shop, licence_id: id ?? "", machine_id: machine, issued, expires };
  if (!expires || expires >= today) {
    const left = expires ? dayNumber(expires) - dayNumber(today) : null;
    return {
      ...base, state: "licensed", days_left: left,
      message: !expires ? `Licensed to ${shop}.` : left! <= 30 ? `Licence ends in ${left} day${left === 1 ? "" : "s"} (${expires}). Ask your software provider to renew it before then.` : `Licensed to ${shop} until ${expires}.`,
    };
  }
  return { ...base, state: "expired", days_left: 0, message: `The licence ended on ${expires}. Ask your software provider for a new licence key to carry on.` };
}

export function activateLicence(key: string): LicenseStatus {
  const v = verifyLicence(key);
  if (!v.ok) throw new UserError(v.error);
  // an ended key must never replace the one that is working
  if (v.payload.expires && v.payload.expires < trustedToday()) throw new UserError(`This key ended on ${v.payload.expires}. Ask your software provider for a current one.`);
  // a sold copy starts on the sign-in screen: the owner's login named in the key is made now (fresh install only)
  if (v.payload.owner) createFirstOwner(v.payload.owner);
  putSetting("licence_key", key.trim());
  return licenseStatus();
}

/** Null when the call may go ahead; otherwise the refusal to send back. Everything except LICENCE_OPEN is stopped while the app
 * has no valid licence, so nothing can be done (not even viewing) until a key is entered. */
export function licenceGate(request: string): { ok: false; code: "licence"; error: string } | null {
  if (LICENCE_OPEN.has(request)) return null;
  const st = licenseStatus();
  return st.state === "licensed" ? null : { ok: false, code: "licence", error: st.message };
}

/** A small line for the foot of every printed bill. */
export function licenceLine(): string {
  const s = licenseStatus();
  return s.state === "licensed" ? `Software licensed to ${s.licensee} · the vendor` : "Unlicensed copy of Electronics Shop ERP";
}
