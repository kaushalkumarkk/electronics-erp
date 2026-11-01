import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type Database from "better-sqlite3";
import electron from "./electronRequire";
import { closeDb, dbPath, getDb } from "./db";
import { getSettings } from "./settings";
import { todayLocal } from "./util";

const { app, dialog } = electron;
const nodeRequire = typeof require !== "undefined" ? require : createRequire(import.meta.url);
const DatabaseCtor = nodeRequire("better-sqlite3") as typeof Database;

const KEEP_AUTO = 15;

/** One automatic copy a day into the app's data folder (the last 15 are kept), so a damaged PC file can be recovered. */
export async function autoBackup(): Promise<void> {
  const dir = path.join(app.getPath("userData"), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `auto-${todayLocal()}.db`);
  if (!fs.existsSync(target)) {
    await getDb().backup(target);
    const old = fs.readdirSync(dir).filter((f) => f.startsWith("auto-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_AUTO))) fs.rmSync(path.join(dir, f), { force: true });
  }
  await backupToFolder();
}

const KEEP_FOLDER = 30;

/** Today's copy in the owner's second folder (Google Drive / OneDrive / pen drive), refreshed each time; the last 30 days are kept.
 * Does nothing (and is not an error) when no folder is chosen. */
export async function backupToFolder(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const dir = (getSettings().backup_folder || "").trim();
  if (!dir) return { ok: false, error: "Choose a backup folder in Settings first" };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `eshop-${todayLocal()}.db`);
    await getDb().backup(target);
    const old = fs.readdirSync(dir).filter((f) => /^eshop-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_FOLDER))) fs.rmSync(path.join(dir, f), { force: true });
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not copy to that folder" };
  }
}

export function backupStatus(): { folder: string; last: string; count: number } {
  const folder = (getSettings().backup_folder || "").trim();
  if (!folder) return { folder: "", last: "", count: 0 };
  try {
    const files = fs.readdirSync(folder).filter((f) => /^eshop-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    const last = files.map((f) => fs.statSync(path.join(folder, f)).mtime).sort((a, b) => b.getTime() - a.getTime())[0];
    return { folder, last: last ? last.toISOString() : "", count: files.length };
  } catch {
    return { folder, last: "", count: 0 };
  }
}

export async function chooseFolder(title: string): Promise<string | null> {
  const res = await dialog.showOpenDialog({ title, properties: ["openDirectory", "createDirectory"] });
  return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
}

/** Save a copy wherever the owner chooses — ideally a pen drive or a cloud-synced folder. */
export async function backupNow(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const res = await dialog.showSaveDialog({
    title: "Save a backup of your shop data",
    defaultPath: `electronics-shop-backup-${todayLocal()}.db`,
    filters: [{ name: "Backup", extensions: ["db"] }],
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    await getDb().backup(res.filePath);
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Backup failed" };
  }
}

/** Replace today's data with a backup file. The current data is kept aside first, then the app restarts. */
export async function restoreBackup(): Promise<{ ok: boolean; error?: string }> {
  const res = await dialog.showOpenDialog({ title: "Choose a backup to restore", properties: ["openFile"], filters: [{ name: "Backup", extensions: ["db"] }] });
  if (res.canceled || !res.filePaths[0]) return { ok: false };
  const source = res.filePaths[0];
  try {
    const probe = new DatabaseCtor(source, { readonly: true, fileMustExist: true });
    try {
      probe.prepare("select count(*) from products").get();
      probe.prepare("select count(*) from sales").get();
    } finally {
      probe.close();
    }
  } catch {
    return { ok: false, error: "That file is not a backup from this app" };
  }
  const confirm = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Restore and restart", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: "Replace all current data with this backup?",
    detail: "Bills, stock and products will become exactly as they were in the backup. Your current data is saved aside first.",
  });
  if (confirm.response !== 0) return { ok: false };

  const live = dbPath();
  await getDb().backup(path.join(path.dirname(live), `before-restore-${Date.now()}.db`));
  closeDb();
  for (const extra of ["-wal", "-shm"]) fs.rmSync(live + extra, { force: true });
  fs.copyFileSync(source, live);
  app.relaunch();
  app.exit(0);
  return { ok: true };
}

export async function exportCsv(fileName: string, rows: (string | number)[][]): Promise<{ ok: boolean; path?: string }> {
  const res = await dialog.showSaveDialog({ defaultPath: fileName, filters: [{ name: "CSV (opens in Excel)", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return { ok: false };
  fs.writeFileSync(res.filePath, toCsv(rows), "utf8");
  return { ok: true, path: res.filePath };
}

/** Rows as CSV text that Excel opens directly (with a BOM so the rupee sign and Hindi names survive). */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const t = String(v ?? "");
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
