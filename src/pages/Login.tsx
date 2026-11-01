import { IconLock, IconUser } from "@tabler/icons-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@shared/types";
import { api } from "@/api";
import { ShopLogo } from "@/components/Brand";
import { PasswordInput, toast } from "@/components/ui";

function Shell({ title, shopName, subtitle, children }: { title: string; shopName?: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-brand-50 via-white to-brand-100">
     <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white p-8 shadow-xl shadow-brand-900/10">
        <div className="-mx-8 -mt-8 mb-6 h-1.5 bg-brand-600" />
        <div className="mb-6 flex flex-col items-center text-center">
          <ShopLogo size={64} className="mb-3 shadow-lg" />
          <h1 className="text-2xl font-extrabold text-slate-900">{title}</h1>
          {shopName && <div className="mt-1 text-base font-semibold text-brand-700">{shopName}</div>}
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        {children}
      </div>
     </div>
    </div>
  );
}

export function LoginPage({ shopName, onSignedIn }: { shopName: string; onSignedIn: (s: Session) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      onSignedIn(await api.login(username, password));
    } catch (err) {
      toast.fromError(err);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Electronics Shop ERP" shopName={shopName} subtitle="Sign in to continue">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Username or email</span>
          <div className="relative">
            <IconUser size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input py-2.5 pl-10 text-base" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
        </label>
        <label className="block">
          <span className="label">Password</span>
          <div className="relative">
            <IconLock size={18} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
            <PasswordInput className="input py-2.5 pl-10 text-base" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </label>
        <button className="btn-primary w-full py-3 text-base" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-slate-400">Forgot your password? Ask your Super Admin to reset it.</p>
      </form>
    </Shell>
  );
}

/** First start on a new computer: create the owner's Super Admin account. */
export function SetupPage({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [f, setF] = useState({ name: "", username: "", password: "", confirm: "" });
  const [withStaff, setWithStaff] = useState(true);
  const [staff, setStaff] = useState({ name: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) {
      toast.error("The two passwords don't match");
      return;
    }
    setBusy(true);
    try {
      const addStaff = withStaff && (staff.name.trim() || staff.username.trim() || staff.password);
      onSignedIn(await api.setupSuperadmin({ name: f.name, username: f.username, password: f.password, staff: addStaff ? staff : undefined }));
      toast.ok(addStaff ? "Welcome! Your staff login is ready too. Next, fill in your shop details in Settings." : "Welcome! Next, fill in your shop details in Settings.");
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Welcome" subtitle="Create the Super Admin account. This person controls users and what everyone else can see.">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label">Your name</span>
          <input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Username or email (for signing in)</span>
          <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, "") })} />
        </label>
        <label className="block">
          <span className="label">Password (at least 6 characters)</span>
          <PasswordInput className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Type the password again</span>
          <PasswordInput className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" className="h-4 w-4" checked={withStaff} onChange={(e) => setWithStaff(e.target.checked)} /> Also create a staff login (Admin) now
          </label>
          {withStaff && (
            <div className="mt-3 space-y-2">
              <input className="input" placeholder="Staff member's name" value={staff.name} onChange={(e) => setStaff({ ...staff, name: e.target.value })} />
              <input className="input" placeholder="Username (e.g. counter1)" value={staff.username} onChange={(e) => setStaff({ ...staff, username: e.target.value.replace(/\s/g, "") })} />
              <PasswordInput className="input" placeholder="Password (at least 6 characters)" value={staff.password} onChange={(e) => setStaff({ ...staff, password: e.target.value })} />
              <p className="text-[11px] text-slate-500">They can bill, see bills, the product list, customers and repair jobs. Change what they may do later in Users &amp; Access. Leave these empty to skip.</p>
            </div>
          )}
        </div>
        <button className="btn-primary w-full py-3 text-base" disabled={busy}>
          {busy ? "Creating…" : "Create account and start"}
        </button>
        <p className="text-center text-xs text-slate-400">Keep this password safe. Only a Super Admin can add users or reset passwords.</p>
      </form>
    </Shell>
  );
}


/** After signing in with a password someone else set (a new account or a reset), pick your own before anything else. */
export function ChooseOwnPasswordPage({ name, onDone, onCancel }: { name: string; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.next !== f.confirm) {
      toast.error("The two new passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await api.changeOwnPassword(f.current, f.next);
      toast.ok("Password set. Welcome!");
      onDone();
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title={`Hi ${name.split(" ")[0]}`} subtitle="Please set your own password before you start.">
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="label">Password you were given</span>
          <PasswordInput className="input" autoFocus value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">New password (at least 6 characters)</span>
          <PasswordInput className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">New password again</span>
          <PasswordInput className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </label>
        <button className="btn-primary w-full py-3 text-base" disabled={busy}>{busy ? "Saving…" : "Set password and continue"}</button>
        <button type="button" className="w-full text-center text-xs text-slate-400 hover:text-slate-600" onClick={onCancel}>Sign out</button>
      </form>
    </Shell>
  );
}
