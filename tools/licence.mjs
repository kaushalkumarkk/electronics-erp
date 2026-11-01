import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.env.ELECTRO_VENDOR_DIR || path.dirname(fileURLToPath(import.meta.url));
const privatePath = path.join(dir, "private-key.pem");
const registryPath = path.join(dir, "licences.json");
const [, , command, ...rest] = process.argv;

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const arg = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => iso(new Date());
const fail = (m) => {
  console.error(m);
  process.exit(1);
};
const dayNumber = (d) => Math.round(Date.parse(d + "T00:00:00Z") / 86_400_000);

function readRegistry() {
  if (!fs.existsSync(registryPath)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    if (!Array.isArray(list)) throw new Error("not a list");
    return list;
  } catch (e) {
    return fail(`${registryPath} can't be read (${e.message}). Fix or remove the file, then try again.`);
  }
}
function writeRegistry(list) {
  fs.writeFileSync(registryPath + ".tmp", JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(registryPath + ".tmp", registryPath);
}
function nextId(list, year) {
  const used = list.map((r) => String(r.id).match(new RegExp(`^DNX-${year}-(\\d{4})$`))?.[1]).filter(Boolean).map(Number);
  return `DNX-${year}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(4, "0")}`;
}
function standing(expires) {
  if (!expires) return "lifetime";
  const left = dayNumber(expires) - dayNumber(today());
  return left < 0 ? "EXPIRED" : left <= 30 ? `expiring in ${left} days` : `active (${left} days left)`;
}

if (command === "init") {
  if (fs.existsSync(privatePath)) fail(`${privatePath} already exists. Not overwriting: licences you already issued would stop working.`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  console.log(`Private key saved to ${privatePath}`);
  console.log("KEEP IT SECRET AND BACK IT UP somewhere safe (not in git, not on a shop's computer). Lose it and you can't issue licences that match the app.\n");
  console.log("Public key (paste into PUBLIC_KEY_PEM in electron/license.ts):\n");
  console.log(publicKey.export({ type: "spki", format: "pem" }));
} else if (command === "issue") {
  const shop = arg("shop")?.trim();
  if (!shop) fail('Give the shop name: --shop "Shop name"');
  if (!fs.existsSync(privatePath)) fail("No private key yet. Run: node tools/licence.mjs init");
  const machine = (arg("machine") ?? "ANY").toUpperCase();
  if (machine !== "ANY" && !/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(machine)) fail("The Machine ID looks like 1A2B-3C4D-5E6F-7A8B (copy it from the shop's lock screen).");
  let expires;
  if (rest.includes("--lifetime")) expires = null;
  else if (arg("expires")) {
    expires = arg("expires");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) fail("The date must look like 2027-12-31");
  } else {
    const years = Number(arg("years") ?? 1); // a yearly subscription unless told otherwise
    if (!(years >= 1 && years <= 10)) fail("--years must be 1 to 10");
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    expires = iso(d);
  }
  // optional: the shop owner's first login, created by the key on a fresh install (the shop then opens on the sign-in screen)
  let owner;
  if (arg("owner-name") || arg("owner-username") || arg("owner-password")) {
    owner = { name: (arg("owner-name") ?? "").trim(), username: (arg("owner-username") ?? "").trim().toLowerCase(), password: arg("owner-password") ?? "" };
    if (!owner.name) fail("--owner-name is needed for the owner's login");
    if (!/^[a-z0-9._@+-]{3,80}$/.test(owner.username)) fail("--owner-username: a short name or an email address, no spaces");
    if (owner.password.length < 6) fail("--owner-password needs at least 6 characters");
  }
  const list = readRegistry();
  const id = nextId(list, today().slice(0, 4));
  const payload = b64(JSON.stringify({ v: 1, id, shop, machine, issued: today(), expires, ...(owner ? { owner } : {}) }));
  const signature = crypto.sign(null, Buffer.from(payload), crypto.createPrivateKey(fs.readFileSync(privatePath)));
  const key = `ELECTRO-${payload}.${b64(signature)}`;
  list.push({
    id, shop, contact: arg("contact") ?? "", machine, issued: today(), expires, key, note: arg("note") ?? "", renewal_of: arg("renews") ?? "", created_at: new Date().toISOString(),
    ...(owner ? { owner_name: owner.name, owner_username: owner.username, owner_password: owner.password } : {}),
  });
  writeRegistry(list);
  console.log(`\n${id}  ·  ${shop}  ·  ${machine === "ANY" ? "any computer" : `computer ${machine}`}  ·  ${expires ? `valid until ${expires}` : "lifetime"}\n`);
  console.log(`${key}\n`);
  if (owner) console.log(`Owner's first login (send it with the key): username ${owner.username}  password ${owner.password}\n`);
  console.log(`Saved in ${registryPath}`);
} else if (command === "list") {
  const list = readRegistry();
  if (list.length === 0) console.log("No licences issued yet.");
  for (const r of [...list].sort((a, b) => String(b.issued).localeCompare(String(a.issued)))) {
    console.log(`${r.id}  ${String(r.shop).padEnd(36)}  ${r.issued} → ${r.expires ?? "lifetime"}  ${standing(r.expires)}${r.contact ? `  ${r.contact}` : ""}`);
  }
} else if (command === "verify") {
  const m = (rest[0] ?? "").trim().match(/^ELECTRO-([\w-]+)\.([\w-]+)$/);
  if (!m) fail("That is not a licence key.");
  if (!fs.existsSync(privatePath)) fail("Needs the private key (tools/private-key.pem) to check against.");
  const publicKey = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(privatePath)));
  console.log(crypto.verify(null, Buffer.from(m[1]), publicKey, Buffer.from(m[2], "base64url")) ? "Signature OK" : "BAD SIGNATURE");
  console.log(JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")));
} else {
  console.log("Commands: init | issue --shop NAME [--contact PHONE] [--machine ID] [--years N | --expires DATE | --lifetime] [--note TEXT] | list | verify KEY");
}
