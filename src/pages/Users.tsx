import { IconArrowLeft, IconKey, IconPlus, IconShieldLock } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { PERMISSIONS, type Permission, type Role, type User } from "@shared/types";
import { api } from "@/api";
import { Badge, confirmDialog, Empty, Field, Modal, PageHeader, PasswordInput, toast } from "@/components/ui";
import { dateOnly } from "@/lib/format";
import { useSession } from "@/lib/session";

const ROLE_LABEL: Record<Role, string> = { superadmin: "Super Admin", admin: "Admin" };

type Draft = { id?: number; name: string; username: string; role: Role; active: boolean; password: string };

/** Ready-made sets for the usual jobs; tick or untick anything after choosing one. */
const PRESETS: { label: string; hint: string; perms: Permission[] }[] = [
  { label: "Cashier", hint: "Bills and looks things up", perms: ["billing", "bills.view", "products.view", "stock.view", "customers", "repairs"] },
  {
    label: "Senior staff",
    hint: "Also discounts, returns, customers",
    perms: ["billing", "billing.tier", "billing.discount", "customers", "payments", "repairs", "bills.view", "bills.return", "products.view", "products.edit", "stock.view", "purchases"],
  },
  {
    label: "Manager",
    hint: "Everything except settings and backup",
    perms: PERMISSIONS.map((p) => p.key).filter((k) => k !== "settings" && k !== "backup"),
  },
];

export function UsersPage() {
  const { session, refresh } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [selected, setSelected] = useState<User | null>(null);
  const [perms, setPerms] = useState<Permission[]>([]);
  const [savedPerms, setSavedPerms] = useState<Permission[]>([]);

  const load = useCallback(async () => {
    try {
      setUsers(await api.userList());
    } catch (e) {
      toast.fromError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const dirty = [...perms].sort().join() !== [...savedPerms].sort().join();

  /** Clicking a person opens what they may do (an Admin's ticks; a Super Admin always has everything). */
  async function select(u: User) {
    if (selected?.id === u.id) return;
    if (dirty && !(await confirmDialog(`You changed ${selected?.name}'s access but did not save. Discard the changes?`, { confirmLabel: "Discard changes", danger: true }))) return;
    setSelected(u);
    if (u.role !== "admin") {
      setPerms([]);
      setSavedPerms([]);
      return;
    }
    try {
      const p = await api.userPermissions(u.id);
      setPerms(p);
      setSavedPerms(p);
    } catch (e) {
      toast.fromError(e);
    }
  }

  async function savePerms() {
    if (!selected) return;
    try {
      await api.setUserPermissions(selected.id, perms);
      setSavedPerms(perms);
      toast.ok(`${selected.name}'s access saved. It applies straight away.`);
    } catch (e) {
      toast.fromError(e);
    }
  }

  const toggle = (key: Permission, on: boolean) => setPerms(on ? [...perms, key] : perms.filter((x) => x !== key));
  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  const current = selected ? (users.find((u) => u.id === selected.id) ?? selected) : null;

  /** Back to the list of users (asks first if there are unsaved changes). */
  async function back() {
    if (dirty && !(await confirmDialog("You changed access but did not save. Discard the changes?", { confirmLabel: "Discard changes", danger: true }))) return;
    setSelected(null);
    setPerms([]);
    setSavedPerms([]);
  }

  return (
    <div className={current ? "max-w-4xl" : "max-w-5xl"}>
      {!current && (
        <>
          <PageHeader
            title="Users & Access"
            subtitle="Click an Admin to choose what they can see and do."
            actions={
              <button className="btn-primary" onClick={() => setDraft({ name: "", username: "", role: "admin", active: true, password: "" })}>
                <IconPlus size={18} /> Add user
              </button>
            }
          />
          <div className="card overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Name / username</th>
                  <th className="th">Role</th>
                  <th className="th">Since</th>
                  <th className="th">Access</th>
                  <th className="th text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} onClick={() => void select(u)} className={`cursor-pointer hover:bg-slate-50 ${u.active ? "" : "opacity-50"}`}>
                    <td className="td w-full max-w-0">
                      <div className="truncate font-semibold">
                        {u.name} {u.id === session.user.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500" title={u.username}>{u.username}</div>
                    </td>
                    <td className="td whitespace-nowrap">
                      <Badge tone={u.role === "superadmin" ? "blue" : "slate"}>{ROLE_LABEL[u.role]}</Badge> {!u.active && <Badge tone="red">Off</Badge>}
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">{dateOnly(u.created_at)}</td>
                    <td className="td whitespace-nowrap text-sm font-semibold text-brand-700">{u.role === "admin" ? "Choose access ›" : <span className="font-normal text-slate-400">Everything</span>}</td>
                    <td className="td whitespace-nowrap text-right">
                      <button className="btn-light px-3 py-1 text-xs" title="Set a new password" onClick={(e) => { e.stopPropagation(); setResetFor(u); }}>
                        <IconKey size={14} /> Password
                      </button>{" "}
                      <button className="btn-light px-3 py-1 text-xs" onClick={(e) => { e.stopPropagation(); setDraft({ ...u, password: "" }); }}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && <Empty text="No users" />}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Switch a user off instead of deleting, so their old bills still show who made them. There must always be one active Super Admin.
          </p>
        </>
      )}

      {current && (
        <>
          <PageHeader
            title={current.name}
            subtitle={`${ROLE_LABEL[current.role]} · ${current.username}`}
            actions={<button className="btn-light" onClick={() => void back()}><IconArrowLeft size={18} /> All users</button>}
          />
          {current.role !== "admin" ? (
            <div className="card flex flex-col items-center gap-2 p-10 text-center text-slate-500">
              <IconShieldLock size={36} className="text-brand-600" />
              <div className="font-bold text-slate-800">{current.name} is a Super Admin</div>
              <div className="text-sm">A Super Admin can use everything, including this screen. There is nothing to choose.</div>
            </div>
          ) : (
            <div className="card">
              <div className="sticky top-0 z-10 rounded-t-xl border-b border-slate-100 bg-white p-4 pb-3">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <IconShieldLock size={18} className="text-brand-600" /> What {current.name} can do
                  <span className="ml-auto text-xs font-normal text-slate-500">{perms.length} of {PERMISSIONS.length} allowed</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-500">Quick set:</span>
                  {PRESETS.map((p) => (
                    <button key={p.label} title={p.hint} onClick={() => setPerms(p.perms)} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-700">
                      {p.label}
                    </button>
                  ))}
                  <button onClick={() => setPerms(PERMISSIONS.map((p) => p.key))} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-700">All</button>
                  <button onClick={() => setPerms([])} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-700">None</button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button className="btn-primary flex-1" disabled={!dirty} onClick={() => void savePerms()}>{dirty ? "Save access" : "Saved"}</button>
                  <button className="btn-light" disabled={!dirty} onClick={() => setPerms(savedPerms)}>Undo</button>
                </div>
                {dirty && <p className="mt-1.5 text-[11px] font-semibold text-amber-600">You have changes that are not saved yet.</p>}
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th w-36">Area</th>
                    <th className="th">What they can do</th>
                    <th className="th w-24 text-center">Allowed</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) =>
                    PERMISSIONS.filter((p) => p.group === g).map((p, i) => (
                      <tr key={p.key} className={`${i === 0 ? "border-t border-slate-200" : ""} ${perms.includes(p.key) ? "" : "text-slate-400"}`}>
                        {i === 0 && (
                          <td className="td align-top text-xs font-bold uppercase tracking-wide text-slate-500" rowSpan={PERMISSIONS.filter((x) => x.group === g).length}>
                            {g}
                          </td>
                        )}
                        <td className="td py-1.5">
                          <label className="block cursor-pointer" htmlFor={`perm-${p.key}`}>{p.label}</label>
                        </td>
                        <td className="td py-1.5 text-center">
                          <input id={`perm-${p.key}`} type="checkbox" className="h-4 w-4 cursor-pointer" checked={perms.includes(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {draft && (
        <UserForm
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await load();
            await refresh();
          }}
        />
      )}
      {resetFor && <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function UserForm({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(draft);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.userSave({ id: f.id, name: f.name, username: f.username, role: f.role, active: f.active, password: f.id ? undefined : f.password });
      toast.ok(f.id ? "User updated" : `User ${f.username} created`);
      onSaved();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={f.id ? "Edit user" : "Add user"}
      onClose={onClose}
      footer={
        <>
          <button className="btn-light" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>Save</button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Full name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Username or email" hint="Used to sign in. A short name (like ravi) or an email address.">
          <input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.replace(/\s/g, "") })} />
        </Field>
        {!f.id && (
          <Field label="First password" hint="At least 6 characters. They will be asked to set their own at first sign-in.">
            <PasswordInput className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        )}
        <Field label="Role">
          <div className="grid grid-cols-2 gap-2">
            {(["admin", "superadmin"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setF({ ...f, role: r })}
                className={`rounded-lg border-2 p-3 text-left ${f.role === r ? "border-brand-600 bg-brand-50" : "border-slate-200"}`}
              >
                <div className="text-sm font-bold">{ROLE_LABEL[r]}</div>
                <div className="text-xs text-slate-500">{r === "admin" ? "Sees only what you allow" : "Everything, including users"}</div>
              </button>
            ))}
          </div>
        </Field>
        {f.id && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Can sign in (untick to switch this account off)
          </label>
        )}
      </div>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const [pw, setPw] = useState("");
  async function save() {
    try {
      await api.userResetPassword(user.id, pw);
      toast.ok(`New password set for ${user.name}`);
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal
      title={`New password for ${user.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn-light" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>Set password</button>
        </>
      }
    >
      <Field label="New password" hint="At least 6 characters. Tell it to the person; they will be asked to set their own when they sign in.">
        <PasswordInput className="input" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}
