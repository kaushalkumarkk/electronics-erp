import { IconCopy, IconKey, IconPlus, IconRefresh, IconSearch, IconTrash } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LicenceAddInput, LicenceIssueInput, LicenceRecord, LicenceStanding } from "@shared/types";
import { api } from "@/api";
import { Badge, confirmDialog, Empty, ExportButton, Field, Modal, Pager, toast, usePaged } from "@/components/ui";
import { dateOnly, today } from "@/lib/format";
import { parseRenewalRequest } from "@/lib/renewal";

const STANDING: Record<LicenceStanding, { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  active: { label: "Active", tone: "green" },
  expiring: { label: "Expiring soon", tone: "amber" },
  expired: { label: "Expired", tone: "red" },
  lifetime: { label: "Lifetime", tone: "blue" },
};

/** A readable first password: no look-alike letters (0/O, 1/l/I). */
const PASSWORD_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const newPassword = () => Array.from(crypto.getRandomValues(new Uint32Array(8)), (n) => PASSWORD_CHARS[n % PASSWORD_CHARS.length]).join("");

const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.ok(`${what} copied`));

function ends(r: LicenceRecord): string {
  if (r.days_left === null) return "Never ends";
  if (r.days_left < 0) return `ended ${-r.days_left} day${r.days_left === -1 ? "" : "s"} ago`;
  return `${r.days_left} day${r.days_left === 1 ? "" : "s"} left`;
}

type Filter = "all" | LicenceStanding;

/** DevNexa's own view of every licence it has issued, one line per shop. It reads tools/licences.json, the same file the
 * `npm run licence` tool writes, and looks again every few seconds, so a licence made with the tool or typed into the file
 * appears here without a click. Only exists on the computer that holds the private signing key. */
export function LicencesPage() {
  const [info, setInfo] = useState<{ enabled: boolean; folder: string } | null>(null);
  const [rows, setRows] = useState<LicenceRecord[]>([]);
  const [problem, setProblem] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [issuing, setIssuing] = useState<Partial<LicenceIssueInput> | null>(null);
  const [adding, setAdding] = useState(false);
  const [made, setMade] = useState<LicenceRecord | null>(null);

  const load = useCallback(() => {
    api.registerList()
      .then((r) => { setRows(r); setProblem(""); })
      .catch((e) => setProblem(e instanceof Error ? e.message : "Could not read the register"));
  }, []);
  useEffect(() => {
    api.registerStatus().then(setInfo).catch(toast.fromError);
  }, []);
  useEffect(() => {
    if (!info?.enabled) return;
    load();
    const every = setInterval(load, 8000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(every);
      window.removeEventListener("focus", load);
    };
  }, [info?.enabled, load]);

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, expiring: 0, expired: 0, lifetime: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => rows.filter((r) => (filter === "all" || r.status === filter) && (!needle || `${r.id} ${r.shop} ${r.contact} ${r.machine} ${r.note}`.toLowerCase().includes(needle))),
    [rows, filter, needle]
  );
  const pg = usePaged(shown, `${filter}|${needle}`);

  if (!info) return null;
  if (!info.enabled) {
    return (
      <div className="card mx-auto mt-10 max-w-xl p-8 text-center text-slate-600">
        <IconKey size={34} className="mx-auto mb-2 text-slate-300" />
        <div className="font-bold text-slate-800">This computer does not hold the DevNexa signing key</div>
        <div className="mt-1 text-sm">The licence register only works on the computer where <code>tools/private-key.pem</code> is kept.</div>
      </div>
    );
  }

  const csv = () =>
    void api
      .exportCsv(`licences-${today()}.csv`, [
        ["Licence ID", "Shop", "Contact", "Computer", "Issued", "Valid until", "Standing", "Days left", "Renews", "Note"],
        ...rows.map((r) => [r.id, r.shop, r.contact, r.machine, r.issued, r.expires ?? "Lifetime", STANDING[r.status].label, r.days_left ?? "", r.renewal_of, r.note]),
      ])
      .then((x) => x.ok && toast.ok("Saved"))
      .catch(toast.fromError);

  const remove = async (r: LicenceRecord) => {
    if (!(await confirmDialog(`Remove ${r.id} (${r.shop}) from the register? The shop's key keeps working until it ends; this only forgets the record.`, { confirmLabel: "Remove", danger: true }))) return;
    api.registerRemove(r.id).then(load).catch(toast.fromError);
  };

  const tiles: [string, number, string][] = [
    ["Licences", counts.all, "text-slate-900"],
    ["Active", counts.active, "text-emerald-700"],
    ["Expiring in 30 days", counts.expiring, counts.expiring ? "text-amber-700" : "text-slate-900"],
    ["Expired", counts.expired, counts.expired ? "text-rose-700" : "text-slate-900"],
    ["Lifetime", counts.lifetime, "text-sky-700"],
  ];
  const pill = (key: Filter, label: string) => (
    <button key={key} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-xs font-bold ${filter === key ? "border-transparent bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
            <IconKey className="text-brand-500" size={24} /> Licences
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Every shop's licence: its number, when it was issued and when it ends. A shop's app locks on the end date until you issue a new key.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={() => setAdding(true)}>
            <IconPlus size={15} className="text-brand-500" /> Add manually
          </button>
          <ExportButton items={[{ label: "Download CSV", run: csv }]} />
          <button className="btn-primary" onClick={() => setIssuing({ years: 1 })}>
            <IconKey size={18} /> Issue new licence
          </button>
        </div>
      </div>

      {problem && <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-rose-200">{problem}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map(([label, n, tone]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className={`mt-1 text-2xl font-black ${tone}`}>{n}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pill("all", `All (${counts.all})`)}
        {pill("active", `Active (${counts.active})`)}
        {pill("expiring", `Expiring (${counts.expiring})`)}
        {pill("expired", `Expired (${counts.expired})`)}
        {pill("lifetime", `Lifetime (${counts.lifetime})`)}
        <div className="relative ml-auto w-72">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Shop, licence ID, phone, computer" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Licence ID</th><th className="px-4 py-3">Shop</th><th className="px-4 py-3">Computer</th><th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Valid until</th><th className="px-4 py-3">Standing</th><th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pg.items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-bold text-slate-800">{r.id}{r.renewal_of && <div className="font-sans text-[10px] font-medium text-slate-400">renews {r.renewal_of}</div>}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-900">{r.shop}</div>
                    <div className="text-xs text-slate-500">{[r.contact, r.note].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{r.machine === "ANY" ? <span className="font-sans text-slate-400">Any computer</span> : r.machine}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{dateOnly(r.issued)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-semibold text-slate-800">{r.expires ? dateOnly(r.expires) : "Lifetime"}</div>
                    <div className={`text-xs ${r.status === "expired" ? "font-semibold text-rose-600" : r.status === "expiring" ? "font-semibold text-amber-700" : "text-slate-500"}`}>{ends(r)}</div>
                  </td>
                  <td className="px-4 py-3"><Badge tone={STANDING[r.status].tone}>{STANDING[r.status].label}</Badge></td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {r.key && (
                      <button className="btn-light px-2 py-1 text-xs" title="Copy the licence key" onClick={() => copy(r.key, "Licence key")}><IconCopy size={14} /> Key</button>
                    )}{" "}
                    <button
                      className={`${r.status === "expiring" || r.status === "expired" ? "btn-primary" : "btn-light"} px-3 py-1 text-xs`}
                      title="Make the next year's key for the same shop"
                      onClick={() => setIssuing({ shop: r.shop, contact: r.contact, machine: r.machine === "ANY" ? "" : r.machine, years: 1, renewal_of: r.id, from: r.expires })}
                    >
                      <IconRefresh size={14} /> Renew
                    </button>{" "}
                    <button className="text-slate-300 hover:text-rose-600" title="Remove from the register" onClick={() => void remove(r)}><IconTrash size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <Empty text="No licences yet. Click “Issue new licence”." />}
        {rows.length > 0 && shown.length === 0 && <Empty text="No licence matches." />}
        <Pager {...pg} />
      </div>
      {issuing && (
        <IssueDialog
          start={issuing}
          known={rows}
          onClose={() => setIssuing(null)}
          onIssued={(r) => { setIssuing(null); setMade(r); load(); }}
        />
      )}
      {adding && <AddDialog onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
      {made && (
        <Modal title="Licence ready" onClose={() => setMade(null)} footer={<button className="btn-primary" onClick={() => setMade(null)}>Done</button>}>
          <div className="mb-3 text-sm text-slate-600">
            <b className="text-slate-900">{made.shop}</b> · <span className="font-mono">{made.id}</span> · {made.expires ? `valid until ${dateOnly(made.expires)}` : "lifetime"} ·{" "}
            {made.machine === "ANY" ? "any computer" : `computer ${made.machine}`}
          </div>
          <textarea className="input h-28 font-mono text-xs" readOnly value={made.key} onFocus={(e) => e.target.select()} />
          <button className="btn-primary mt-3" onClick={() => copy(made.key, "Licence key")}><IconCopy size={16} /> Copy the key</button>
          {made.owner_username && (
            <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
              <div className="font-bold text-slate-800">Owner's first login</div>
              <div className="mt-1 text-slate-700">Username <b className="font-mono">{made.owner_username}</b> · Password <b className="font-mono">{made.owner_password}</b></div>
              <button className="btn-light mt-2 py-1 text-xs" onClick={() => copy(`Licence key:\n${made.key}\n\nSign in with:\nUsername: ${made.owner_username}\nPassword: ${made.owner_password}`, "Key and login")}>
                <IconCopy size={14} /> Copy key and login together
              </button>
              <p className="mt-1 text-[11px] text-slate-500">After activating the key the shop sees the sign-in screen. Send this login with the key; they choose their own password at the first sign-in.</p>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">Send the whole key to the shop. They paste it on their lock screen or in Settings → Licence. It is saved in the register already.</p>
        </Modal>
      )}
    </div>
  );
}

/** Make a new key: for a new shop, or (from Renew) the next year for a shop already in the register. */
function IssueDialog({ start, known, onClose, onIssued }: { start: Partial<LicenceIssueInput>; known: LicenceRecord[]; onClose: () => void; onIssued: (r: LicenceRecord) => void }) {
  const [shop, setShop] = useState(start.shop ?? "");
  const [contact, setContact] = useState(start.contact ?? "");
  const [machine, setMachine] = useState(start.machine ?? "");
  const [term, setTerm] = useState<"1" | "2" | "3" | "date" | "life">("1");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [renewalOf, setRenewalOf] = useState(start.renewal_of ?? "");
  const [from, setFrom] = useState<string | null>(start.from ?? null);
  const [pasted, setPasted] = useState("");
  const [filled, setFilled] = useState("");
  // the owner's first login: the key creates it on the shop's fresh install, so they see the sign-in screen, not account setup
  const [ownerOn, setOwnerOn] = useState(!start.renewal_of);
  const [ownerName, setOwnerName] = useState("");
  const [ownerUser, setOwnerUser] = useState("owner");
  const [ownerPass, setOwnerPass] = useState(newPassword);

  /** A renewal request the shop sent (copied from its Settings → Licence): fills in the shop, its computer, its old licence and
   * its end date. */
  function readRequest(text: string) {
    setPasted(text);
    const r = parseRenewalRequest(text);
    if (!r) {
      setFilled("");
      return;
    }
    const old = known.find((k) => r.licence && k.id.toLowerCase() === r.licence.toLowerCase()) ?? known.find((k) => r.shop && k.shop.toLowerCase() === r.shop.toLowerCase());
    setShop(r.shop || old?.shop || "");
    setContact(old?.contact ?? "");
    setMachine(r.machine);
    setRenewalOf(old?.id ?? "");
    setFrom(r.ends || old?.expires || null);
    setTerm("1");
    setFilled(`Filled in from the request${old ? `, renewing ${old.id}` : ""}. Check it, then make the key.`);
  }
  const keepsDays = term !== "date" && term !== "life" && !!from && from > today();

  async function issue() {
    setBusy(true);
    try {
      const input: LicenceIssueInput = {
        shop, contact, machine, note, renewal_of: renewalOf || undefined, from,
        ...(ownerOn && !renewalOf ? { owner: { name: ownerName, username: ownerUser, password: ownerPass } } : {}),
        ...(term === "life" ? { expires: null } : term === "date" ? { expires: until } : { years: Number(term) }),
      };
      onIssued(await api.registerIssue(input));
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={renewalOf ? `Renew ${renewalOf}` : "Issue new licence"}
      onClose={onClose}
      footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || !shop.trim() || (term === "date" && !until)} onClick={() => void issue()}>Make the key</button></>}
    >
      {!start.renewal_of && (
        <Field label="Did the shop send a renewal request?" className="mb-3" hint="They copy it from Settings → Licence (or their lock screen). Paste it here and the form fills itself.">
          <textarea className="input h-16 font-mono text-xs" value={pasted} onChange={(e) => readRequest(e.target.value)} placeholder={"DevNexa renewal request\nShop: …\nLicence: …\nMachine: …"} />
          {filled && <span className="mt-1 block text-xs font-semibold text-emerald-700">{filled}</span>}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shop name *" className="col-span-2"><input className="input" autoFocus={!!start.renewal_of} value={shop} onChange={(e) => setShop(e.target.value)} placeholder="e.g. Sharma Electronics" /></Field>
        <Field label="Phone / contact"><input className="input" value={contact} onChange={(e) => setContact(e.target.value)} /></Field>
        <Field label="How long">
          <select className="input" value={term} onChange={(e) => setTerm(e.target.value as typeof term)}>
            <option value="1">1 year (yearly subscription)</option>
            <option value="2">2 years</option>
            <option value="3">3 years</option>
            <option value="date">Until a date…</option>
            <option value="life">Lifetime (never ends)</option>
          </select>
        </Field>
        {keepsDays && <div className="col-span-2 -mt-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">The new year counts from the old end date ({dateOnly(from!)}), so the days left on the old licence are kept.</div>}
        {term === "date" && <Field label="Ends on" className="col-span-2"><input type="date" className="input" min={today()} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
        <Field label="Machine ID of the shop's computer *" className="col-span-2" hint="Required. The shop reads it off its lock screen. The key works on that one computer only.">
          <input className="input font-mono uppercase" value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="1A2B-3C4D-5E6F-7A8B" />
        </Field>
        <Field label="Note" className="col-span-2"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid ₹7,500 by UPI" /></Field>
        {!renewalOf && (
          <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" className="h-4 w-4" checked={ownerOn} onChange={(e) => setOwnerOn(e.target.checked)} /> Create the owner's login with this key
            </label>
            <p className="mt-0.5 text-[11px] text-slate-500">The shop then opens on the normal sign-in screen (not "create account"). The owner is the shop's Super Admin and picks their own password after signing in. Only works on a fresh install.</p>
            {ownerOn && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <input className="input" placeholder="Owner's name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
                <input className="input" placeholder="Username" value={ownerUser} onChange={(e) => setOwnerUser(e.target.value.replace(/\s/g, ""))} />
                <div className="flex gap-1">
                  <input className="input font-mono" value={ownerPass} onChange={(e) => setOwnerPass(e.target.value.replace(/\s/g, ""))} title="The first password (at least 6 characters)" />
                  <button type="button" className="btn-light px-2" title="New random password" onClick={() => setOwnerPass(newPassword())}><IconRefresh size={14} /></button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Record a licence that was given out before the register existed, or by some other means. */
function AddDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [byKey, setByKey] = useState(true);
  const [f, setF] = useState<LicenceAddInput>({ key: "", shop: "", contact: "", machine: "", issued: today(), expires: null, id: "", note: "" });
  const [lifetime, setLifetime] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof LicenceAddInput>(k: K, v: LicenceAddInput[K]) => setF((c) => ({ ...c, [k]: v }));

  async function add() {
    setBusy(true);
    try {
      await api.registerAdd(byKey ? { ...f, shop: "", issued: "", expires: null } : { ...f, key: "", expires: lifetime ? null : f.expires });
      toast.ok("Added to the register");
      onAdded();
    } catch (e) {
      toast.fromError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a licence manually"
      onClose={onClose}
      footer={<><button className="btn-light" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || (byKey ? !f.key.trim() : !f.shop.trim())} onClick={() => void add()}>Add</button></>}
    >
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm font-bold">
        <button className={`rounded-md py-1.5 ${byKey ? "bg-white text-slate-900 shadow" : "text-slate-500"}`} onClick={() => setByKey(true)}>Paste its key</button>
        <button className={`rounded-md py-1.5 ${!byKey ? "bg-white text-slate-900 shadow" : "text-slate-500"}`} onClick={() => setByKey(false)}>Type the details</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {byKey ? (
          <Field label="Licence key" className="col-span-2" hint="The shop, licence number and dates are read from the key itself.">
            <textarea className="input h-24 font-mono text-xs" autoFocus value={f.key} onChange={(e) => set("key", e.target.value.replace(/\s/g, ""))} placeholder="ELECTRO-…" />
          </Field>
        ) : (
          <>
            <Field label="Shop name *" className="col-span-2"><input className="input" autoFocus value={f.shop} onChange={(e) => set("shop", e.target.value)} /></Field>
            <Field label="Licence number" hint="Leave empty for the next number"><input className="input font-mono uppercase" value={f.id} onChange={(e) => set("id", e.target.value.toUpperCase())} placeholder="DNX-2026-0001" /></Field>
            <Field label="Machine ID" hint="Empty = any computer"><input className="input font-mono uppercase" value={f.machine} onChange={(e) => set("machine", e.target.value)} /></Field>
            <Field label="Issued on"><input type="date" className="input" max={today()} value={f.issued} onChange={(e) => set("issued", e.target.value)} /></Field>
            <Field label="Valid until">
              <input type="date" className="input" disabled={lifetime} value={f.expires ?? ""} onChange={(e) => set("expires", e.target.value || null)} />
              <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={lifetime} onChange={(e) => setLifetime(e.target.checked)} /> Lifetime</label>
            </Field>
          </>
        )}
        <Field label="Phone / contact"><input className="input" value={f.contact} onChange={(e) => set("contact", e.target.value)} /></Field>
        <Field label="Note"><input className="input" value={f.note} onChange={(e) => set("note", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
