import crypto from "node:crypto";
import { PERMISSIONS, type AuthState, type Permission, type Role, type Session, type User } from "@shared/types";
import { getDb } from "./db";
import { getSettings } from "./settings";
import { UserError } from "./util";

/** Who is signed in on this computer right now. Kept only in memory: closing the app signs everyone out. */
let current: User | null = null;

const ALL: Permission[] = PERMISSIONS.map((p) => p.key);

type URow = Omit<User, "active" | "must_change_password"> & { active: number; must_change_password: number; password_hash: string };
const toUser = ({ password_hash: _h, ...u }: URow): User => ({ ...u, active: !!u.active, must_change_password: !!u.must_change_password });

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function checkPassword(p: string): void {
  if (p.length < 6) throw new UserError("Password must be at least 6 characters");
}

/** A short name (ravi, counter1) or an email address. */
function checkUsername(u: string): string {
  const name = u.trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,80}$/.test(name)) throw new UserError("Username: a short name or an email address, with no spaces");
  return name;
}

/** What this person may use: everything for a Super Admin, otherwise what was ticked for them in Users & Access. */
export function permissionsFor(user: { id: number; role: Role }): Permission[] {
  if (user.role === "superadmin") return ALL;
  const rows = getDb().prepare("select permission from user_permissions where user_id = ?").all(user.id) as { permission: string }[];
  return rows.map((r) => r.permission).filter((p): p is Permission => (ALL as string[]).includes(p));
}

/** Creates the shop owner's Super Admin account named in a licence key, on a fresh install only. The shop then sees the normal
 * sign-in screen, and the owner must choose their own password after the first sign-in. Returns whether it made the account. */
export function createFirstOwner(o: { name: string; username: string; password: string }): boolean {
  const db = getDb();
  if ((db.prepare("select count(*) as n from users").get() as { n: number }).n > 0) return false;
  if (!o.name.trim()) throw new UserError("This licence has no owner name for the first login");
  const username = checkUsername(o.username);
  checkPassword(o.password);
  db.prepare("insert into users (name, username, password_hash, role, must_change_password) values (?, ?, ?, 'superadmin', 1)").run(o.name.trim(), username, hashPassword(o.password));
  return true;
}

export function giveStartingPermissions(userId: number): void {
  const db = getDb();
  if (db.prepare("select 1 from user_permissions where user_id = ?").get(userId)) return;
  db.prepare("insert into user_permissions (user_id, permission) select ?, permission from role_permissions where role = 'admin'").run(userId);
}

function session(): Session | null {
  return current ? { user: current, permissions: permissionsFor(current) } : null;
}

export function authState(): AuthState {
  const count = (getDb().prepare("select count(*) as n from users").get() as { n: number }).n;
  return { setupNeeded: count === 0, session: session(), shop_name: getSettings().shop_name };
}

/** The very first account on a new install. Only works while there are no users at all. */
export function setupSuperadmin(input: { name: string; username: string; password: string; staff?: { name: string; username: string; password: string } }): Session {
  if (!authState().setupNeeded) throw new UserError("The Super Admin already exists. Please sign in.");
  if (!input.name.trim()) throw new UserError("Please enter your name");
  const username = checkUsername(input.username);
  checkPassword(input.password);
  // an optional first staff (Admin) login, checked before anything is saved so a mistake leaves nothing half-made
  const staff = input.staff;
  const staffUsername = staff ? checkUsername(staff.username) : "";
  if (staff) {
    if (!staff.name.trim()) throw new UserError("Please enter the staff member's name");
    checkPassword(staff.password);
    if (staffUsername === username) throw new UserError("The staff login needs a different username from yours");
  }
  const db = getDb();
  return db.transaction(() => {
    const id = Number(
      db.prepare("insert into users (name, username, password_hash, role) values (?, ?, ?, 'superadmin')").run(input.name.trim(), username, hashPassword(input.password)).lastInsertRowid
    );
    if (staff) {
      // the owner chose this password on the setup screen, so it is not forced to change at the first sign-in
      const staffId = Number(
        db.prepare("insert into users (name, username, password_hash, role) values (?, ?, ?, 'admin')").run(staff.name.trim(), staffUsername, hashPassword(staff.password)).lastInsertRowid
      );
      giveStartingPermissions(staffId);
    }
    current = toUser(db.prepare("select * from users where id = ?").get(id) as URow);
    return session()!;
  })();
}

// a few wrong passwords in a row slow down further tries
let failures = 0;
let lockedUntil = 0;

export function login(username: string, password: string): Session {
  username = username.trim().toLowerCase();
  if (Date.now() < lockedUntil) throw new UserError(`Too many wrong tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.`);
  const row = getDb().prepare("select * from users where username = ?").get(username) as URow | undefined;
  if (!row || !passwordMatches(password, row.password_hash)) {
    failures += 1;
    if (failures >= 5) {
      lockedUntil = Date.now() + 30_000;
      failures = 0;
    }
    throw new UserError("Wrong username or password");
  }
  if (!row.active) throw new UserError("This account is switched off. Ask the Super Admin.");
  failures = 0;
  current = toUser(row);
  return session()!;
}

export function logout(): void {
  current = null;
}

export function currentUser(): User | null {
  return current;
}

/** Stops the request unless someone is signed in (and, when given, may use one of these permissions). */
export function requireUser(...anyOf: Permission[]): User {
  if (!current) throw new UserError("Please sign in again");
  // re-read so a switched-off account or changed role takes effect at once
  const row = getDb().prepare("select * from users where id = ?").get(current.id) as URow | undefined;
  if (!row || !row.active) {
    current = null;
    throw new UserError("Your account was switched off. Please sign in again.");
  }
  current = toUser(row);
  if (anyOf.length && !anyOf.some((p) => permissionsFor(current!).includes(p))) {
    throw new UserError("You don't have access to this. Ask the Super Admin.");
  }
  return current;
}

export function requireSuperadmin(): User {
  const u = requireUser();
  if (u.role !== "superadmin") throw new UserError("Only the Super Admin can do this");
  return u;
}

export function changeOwnPassword(currentPassword: string, next: string): void {
  const u = requireUser();
  const row = getDb().prepare("select password_hash from users where id = ?").get(u.id) as { password_hash: string };
  if (!passwordMatches(currentPassword, row.password_hash)) throw new UserError("Your current password is wrong");
  checkPassword(next);
  if (passwordMatches(next, row.password_hash)) throw new UserError("Choose a password different from the current one");
  getDb().prepare("update users set password_hash = ?, must_change_password = 0 where id = ?").run(hashPassword(next), u.id);
  current = { ...u, must_change_password: false };
}

export function listUsers(): User[] {
  requireSuperadmin();
  return (getDb().prepare("select * from users order by role desc, name collate nocase").all() as URow[]).map(toUser);
}

export function saveUser(u: { id?: number; name: string; username: string; role: Role; active: boolean; password?: string }): number {
  const me = requireSuperadmin();
  if (!u.name.trim()) throw new UserError("Name is required");
  if (u.role !== "superadmin" && u.role !== "admin") throw new UserError("Choose a role");
  const username = checkUsername(u.username);
  const db = getDb();
  const clash = db.prepare("select id from users where username = ? and id != ?").get(username, u.id ?? 0);
  if (clash) throw new UserError("That username is already taken");

  if (u.id) {
    const before = db.prepare("select * from users where id = ?").get(u.id) as URow | undefined;
    if (!before) throw new UserError("User not found");
    const losingSuperadmin = before.role === "superadmin" && before.active && (u.role !== "superadmin" || !u.active);
    if (losingSuperadmin) {
      const others = (db.prepare("select count(*) as n from users where role = 'superadmin' and active = 1 and id != ?").get(u.id) as { n: number }).n;
      if (others === 0) throw new UserError("There must always be at least one active Super Admin");
    }
    if (u.id === me.id && !u.active) throw new UserError("You can't switch off your own account");
    db.prepare("update users set name = ?, username = ?, role = ?, active = ? where id = ?").run(u.name.trim(), username, u.role, u.active ? 1 : 0, u.id);
    if (u.role === "admin") giveStartingPermissions(u.id);
    return u.id;
  }
  checkPassword(u.password ?? "");
  const id = Number(
    // the person picks their own password at first sign-in
    db.prepare("insert into users (name, username, password_hash, role, active, must_change_password) values (?, ?, ?, ?, ?, 1)")
      .run(u.name.trim(), username, hashPassword(u.password!), u.role, u.active ? 1 : 0).lastInsertRowid
  );
  if (u.role === "admin") giveStartingPermissions(id);
  return id;
}

export function resetPassword(id: number, password: string): void {
  requireSuperadmin();
  checkPassword(password);
  if (getDb().prepare("update users set password_hash = ?, must_change_password = 1 where id = ?").run(hashPassword(password), id).changes !== 1) throw new UserError("User not found");
}

/** What one Admin may do (Super Admin only). */
export function userPermissions(userId: number): Permission[] {
  requireSuperadmin();
  const u = getDb().prepare("select id, role from users where id = ?").get(userId) as { id: number; role: Role } | undefined;
  if (!u) throw new UserError("User not found");
  return permissionsFor(u);
}

export function setUserPermissions(userId: number, perms: Permission[]): void {
  requireSuperadmin();
  const db = getDb();
  const u = db.prepare("select id, role from users where id = ?").get(userId) as { id: number; role: Role } | undefined;
  if (!u) throw new UserError("User not found");
  if (u.role !== "admin") throw new UserError("A Super Admin always has everything");
  const valid = [...new Set(perms)].filter((p) => (ALL as string[]).includes(p));
  db.transaction(() => {
    db.prepare("delete from user_permissions where user_id = ?").run(userId);
    const put = db.prepare("insert into user_permissions (user_id, permission) values (?, ?)");
    for (const p of valid) put.run(userId, p);
  })();
}
