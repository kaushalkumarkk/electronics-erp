import { IconSettings } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { BackupStatus, PaperSize, PriceTier, Settings } from "@shared/types";
import { api } from "@/api";
import { Field, PageHeader, toast } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

export function SettingsPage() {
  const { can } = useSession();
  const [s, setS] = useState<Settings | null>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [dataDir, setDataDir] = useState("");

  useEffect(() => {
    api.settingsGet().then(setS).catch(toast.fromError);
    if (can("backup")) {
      api.backupStatus().then(setBackup).catch(() => undefined);
      api.dataFolder().then(setDataDir).catch(() => undefined);
    }
  }, [can]);
  if (!s) return null;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const canEdit = can("settings");

  async function save() {
    try {
      setS(await api.settingsSave(s!));
      toast.ok("Settings saved");
      if (can("backup")) setBackup(await api.backupStatus());
    } catch (e) {
      toast.fromError(e);
    }
  }
  async function pickFolder() {
    const f = await api.chooseFolder("Choose a folder for backup copies (Google Drive, OneDrive or a pen drive)");
    if (f) set("backup_folder", f);
  }
  async function backupNow() {
    try {
      const r = await api.backupNow();
      if (r.error) toast.error(r.error);
      else if (r.ok) toast.ok("Backup saved");
    } catch (e) {
      toast.fromError(e);
    }
  }
  async function restore() {
    try {
      const r = await api.restoreBackup();
      if (r.error) toast.error(r.error);
    } catch (e) {
      toast.fromError(e);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Settings" icon={IconSettings} actions={canEdit && <button className="btn-primary" onClick={() => void save()}>Save settings</button>} />
      {canEdit && (
        <>
          <div className="card grid gap-3 p-5 md:grid-cols-2">
            <div className="md:col-span-2 text-sm font-bold">Shop</div>
            <Field label="Shop name"><input className="input" value={s.shop_name} onChange={(e) => set("shop_name", e.target.value)} /></Field>
            <Field label="Phone"><input className="input" value={s.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Address" className="md:col-span-2"><input className="input" value={s.address} onChange={(e) => set("address", e.target.value)} /></Field>
            <Field label="GSTIN"><input className="input" value={s.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} /></Field>
            <Field label="Shop's state" hint="Parties in another state are billed IGST"><input className="input" value={s.state} onChange={(e) => set("state", e.target.value)} /></Field>
          </div>
          <div className="card grid gap-3 p-5 md:grid-cols-2">
            <div className="md:col-span-2 text-sm font-bold">Billing</div>
            <Field label="Bill number prefix"><input className="input" value={s.bill_prefix} onChange={(e) => set("bill_prefix", e.target.value)} /></Field>
            <Field label="Paper size"><select className="input" value={s.paper} onChange={(e) => set("paper", e.target.value as PaperSize)}><option value="A4">A4</option><option value="A5">A5</option><option value="80mm">80 mm receipt</option></select></Field>
            <Field label="Price used for a walk-in" hint="Saved technicians are always billed at the technician price"><select className="input" value={s.default_tier} onChange={(e) => set("default_tier", e.target.value as PriceTier)}><option value="customer">Customer price</option><option value="technician">Technician price</option></select></Field>
            <Field label="GST on service / labour (%)"><input type="number" min={0} max={40} className="input" value={s.service_gst} onChange={(e) => set("service_gst", Number(e.target.value))} /></Field>
            <Field label="Warranty note on bills" className="md:col-span-2"><input className="input" value={s.warranty_note} onChange={(e) => set("warranty_note", e.target.value)} /></Field>
            <Field label="Terms on bills" className="md:col-span-2"><input className="input" value={s.terms} onChange={(e) => set("terms", e.target.value)} /></Field>
          </div>
        </>
      )}
      {can("backup") && (
        <div className="card space-y-3 p-5">
          <div className="text-sm font-bold">Backup</div>
          <p className="text-xs text-slate-500">A copy is made automatically every day inside the app's data folder{dataDir ? ` (${dataDir})` : ""}. Add a second folder on Google Drive, OneDrive or a pen drive for safety.</p>
          <div className="flex gap-2">
            <input className="input" readOnly placeholder="No second backup folder chosen" value={s.backup_folder} />
            <button className="btn-light whitespace-nowrap" onClick={() => void pickFolder()}>Choose folder</button>
            {s.backup_folder && <button className="btn-light" onClick={() => set("backup_folder", "")}>Clear</button>}
          </div>
          {backup?.folder && <div className="text-xs text-slate-500">{backup.count} copies in that folder{backup.last ? `, latest ${dateTime(backup.last)}` : ""}</div>}
          <div className="flex gap-2"><button className="btn-light" onClick={() => void backupNow()}>Save a backup file…</button><button className="btn-light" onClick={() => void restore()}>Restore from a backup…</button></div>
          {canEdit && <p className="text-xs text-slate-400">Press "Save settings" above after choosing or clearing the folder.</p>}
        </div>
      )}
    </div>
  );
}
