import { IconCopy, IconLock, IconPhone } from "@tabler/icons-react";
import { useState } from "react";
import type { LicenseStatus } from "@shared/types";
import { api } from "@/api";
import { ShopLogo } from "@/components/Brand";
import { toast } from "@/components/ui";
import { renewalRequestText } from "@/lib/renewal";

/** The whole screen while there is no valid licence (never entered, or past its end date): nothing else in the app works
 * until a key is entered here. A shop whose licence ended can still save a copy of its own data. */
export function LicenceGate({ status, onActivated }: { status: LicenseStatus; onActivated: (s: LicenseStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const ended = status.state === "expired";

  async function activate() {
    setBusy(true);
    try {
      const next = await api.licenseActivate(key);
      toast.ok(`Licensed to ${next.licensee}. Thank you!`);
      onActivated(next);
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-50 via-white to-brand-100 p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="border-t-4 border-brand-600 bg-brand-50 px-8 py-6 text-slate-900">
          <div className="flex items-center gap-3">
            <ShopLogo size={44} />
            <div>
              <div className="text-lg font-extrabold tracking-wide">ELECTRONICS <span className="rounded border border-brand-500/30 bg-brand-500/20 px-1.5 py-0.5 align-middle text-[10px] font-bold text-brand-400">ERP</span></div>
              <div className="text-xs text-slate-500">Licence activation</div>
            </div>
          </div>
        </div>
        <div className="space-y-5 p-8">
          <div className="flex items-start gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${ended ? "bg-rose-100 text-rose-600" : "bg-brand-100 text-brand-600"}`}>
              <IconLock size={22} />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-slate-900">{ended ? "Your licence has ended" : "Licence required"}</h1>
              <p className="mt-1 text-sm text-slate-600">{status.message}</p>
              {ended && status.licensee && (
                <p className="mt-1 text-xs text-slate-500">
                  {status.licensee}{status.licence_id ? ` · ${status.licence_id}` : ""} · ended {status.expires}
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Machine ID of this computer</div>
            <div className="flex gap-2">
              <input className="input font-mono" readOnly value={status.machine_id} onFocus={(e) => e.target.select()} />
              <button className="btn-light" title="Copy" onClick={() => void navigator.clipboard.writeText(status.machine_id).then(() => toast.ok("Machine ID copied"))}>
                <IconCopy size={16} />
              </button>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">Send this ID with your shop name to get a key that works on this computer only.</div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600" htmlFor="licence-key">{ended ? "New licence key" : "Licence key"}</label>
            <textarea
              id="licence-key"
              className="input h-24 font-mono text-xs"
              autoFocus
              placeholder="ELECTRO-…"
              value={key}
              onChange={(e) => setKey(e.target.value.replace(/\s/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && key.trim() && (e.preventDefault(), void activate())}
            />
          </div>
          <button className="btn-primary w-full py-3 text-base" disabled={busy || !key.trim()} onClick={() => void activate()}>
            Activate
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <IconPhone size={14} className="text-brand-500" /> To get or renew a key, send the request below to your software provider
            </span>
            <button
              className="font-semibold text-brand-600 hover:underline"
              onClick={() => void navigator.clipboard.writeText(renewalRequestText(status)).then(() => toast.ok("Request copied. Send it to your software provider to get your key."))}
            >
              Copy {ended ? "renewal" : "licence"} request
            </button>
            {ended && (
              <button
                className="font-semibold text-brand-600 hover:underline"
                onClick={() => void api.licenseBackup().then((r) => r.ok && toast.ok("Backup saved")).catch(toast.fromError)}
              >
                Save a copy of my data
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
