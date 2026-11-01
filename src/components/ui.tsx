import { IconChevronDown, IconChevronLeft, IconChevronRight, IconDownload, IconEye, IconEyeOff, IconX, type Icon } from "@tabler/icons-react";
import { useEffect, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from "react";
import { anyLayerOpen, useLayer } from "@/lib/shortcuts";

/* ---------- toasts ---------- */

type Toast = { id: number; text: string; kind: "ok" | "error" | "info" };
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(text: string, kind: Toast["kind"]) {
  const id = ++seq;
  toasts = [...toasts, { id, text, kind }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, kind === "error" ? 6000 : 3500);
}

export const toast = {
  ok: (t: string) => push(t, "ok"),
  error: (t: string) => push(t, "error"),
  info: (t: string) => push(t, "info"),
  fromError: (e: unknown) => push(e instanceof Error ? e.message : "Something went wrong", "error"),
};

export function ToastHost() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts
  );
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[100] flex w-96 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={`rounded px-3 py-2 text-sm font-semibold text-white shadow-lg ${t.kind === "error" ? "bg-rose-600" : t.kind === "ok" ? "bg-emerald-600" : "bg-slate-800"}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- layout pieces ---------- */

export function PageHeader({ title, subtitle, actions, icon: TitleIcon }: { title: string; subtitle?: string; actions?: ReactNode; icon?: Icon }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
          {TitleIcon && <TitleIcon className="text-brand-500" size={24} />} {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, full, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; full?: boolean; footer?: ReactNode }) {
  const layer = useLayer(onClose);
  return (
    <div data-layer={layer} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={onClose}>
      <div className={`flex max-h-[92vh] w-full flex-col rounded-2xl bg-white shadow-2xl ${full ? "max-w-[min(96vw,1400px)]" : wide ? "max-w-5xl" : "max-w-xl"}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <IconX size={20} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-slate-400">{text}</div>;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "red" | "amber" | "green" | "blue" }) {
  const map = {
    slate: "bg-slate-100 text-slate-700",
    red: "bg-rose-100 text-rose-700",
    amber: "bg-amber-100 text-amber-800",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-sky-100 text-sky-700",
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${map[tone]}`}>{children}</span>;
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="date" className="input w-40" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-sm text-slate-400">to</span>
      <input type="date" className="input w-40" value={to} onChange={(e) => onChange(from, e.target.value)} />
    </div>
  );
}

export function Stat({ label, value, tone = "slate" }: { label: string; value: ReactNode; tone?: "slate" | "green" | "red" | "amber" }) {
  const color = { slate: "text-slate-900", green: "text-emerald-700", red: "text-rose-700", amber: "text-amber-700" }[tone];
  return (
    <div className="card p-4">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${color}`}>{value}</div>
    </div>
  );
}

/** A password box with an eye button to show or hide what was typed. */
export function PasswordInput({ className = "input", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={shown ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShown((v) => !v)}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        {shown ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}

/* ---------- pagination ---------- */

export const PAGE_SIZE = 20;

/** Splits a list into pages of 20. The page goes back to 1 only when `resetKey` changes (a new search or date range),
 * not when the same list is reloaded, so saving an edit keeps you where you were. */
export function usePaged<T>(rows: T[], resetKey: string = "") {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(1), [resetKey]);
  const current = Math.min(page, pages);
  return { items: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, pages, total: rows.length, setPage };
}

/** "Showing 21–40 of 134" with Prev / Page 2 of 7 / Next, the pager Gropto Retail ERP uses. Hidden when everything fits. */
export function Pager({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (p: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || anyLayerOpen()) return;
      if (e.key === "ArrowLeft" && page > 1) setPage(page - 1);
      else if (e.key === "ArrowRight" && page < pages) setPage(page + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, pages, setPage]);
  if (total <= PAGE_SIZE) return null;
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const btn = "flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40";
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <button className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}><IconChevronLeft className="h-3.5 w-3.5" /> Prev</button>
        <span className="font-semibold text-slate-700">Page {page} of {pages} <span className="font-normal text-slate-400">(Alt+Left/Right)</span></span>
        <button className={btn} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <IconChevronRight className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

/** The download button Gropto Retail ERP uses: white, rounded, with a green icon. Give one file, or several to pick from. */
export function ExportButton({ items, label = "Download CSV", busy }: { items: { label: string; run: () => void }[]; label?: string; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  if (items.length === 0) return null;
  const one = items.length === 1;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={busy}
        onClick={() => (one ? items[0].run() : setOpen((o) => !o))}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
      >
        <IconDownload size={15} className="text-brand-500" />
        {busy ? "Preparing…" : label}
        {!one && <IconChevronDown size={13} className="text-slate-400" />}
      </button>
      {open && !one && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          {items.map((item) => (
            <button key={item.label} onClick={() => { setOpen(false); item.run(); }} className="block w-full px-4 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- confirm box ---------- */

/** Asking "are you sure?" with the browser's window.confirm() can leave Electron's text boxes unable to take typing until the
 * window loses and regains focus (it looked like the search box "sometimes not allowing me to type"). This is the in-app
 * replacement: `if (!(await confirmDialog("Clear this bill?", { confirmLabel: "Clear it", danger: true }))) return;` */
interface Ask {
  id: number;
  message: string;
  confirmLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
let asks: Ask[] = [];
let askSeq = 0;
const askListeners = new Set<() => void>();
const askEmit = () => askListeners.forEach((l) => l());

export function confirmDialog(message: string, opts: { confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    asks = [...asks, { id: ++askSeq, message, confirmLabel: opts.confirmLabel ?? "OK", danger: opts.danger ?? false, resolve }];
    askEmit();
  });
}

/** Mounted once at the app root, next to the toasts. */
export function ConfirmHost() {
  const list = useSyncExternalStore(
    (cb) => {
      askListeners.add(cb);
      return () => askListeners.delete(cb);
    },
    () => asks
  );
  const ask = list[0];
  const answer = (ok: boolean) => {
    if (!ask) return;
    asks = asks.filter((a) => a.id !== ask.id);
    ask.resolve(ok);
    askEmit();
  };
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopImmediatePropagation();
        e.preventDefault();
        answer(e.key === "Enter");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.id]);
  if (!ask) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 p-4" onMouseDown={() => answer(false)}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <div className="px-6 pb-2 pt-5">
          <div className="text-base font-extrabold text-slate-900">Please confirm</div>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{ask.message}</p>
        </div>
        <div className="flex justify-end gap-2 px-6 pb-5 pt-3">
          <button className="btn-light" onClick={() => answer(false)}>Cancel</button>
          <button className={ask.danger ? "btn-danger" : "btn-primary"} autoFocus onClick={() => answer(true)}>{ask.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Enter moves to the next field of a form (put it on the form's wrapper: onKeyDown={(e) => enterToNext(e, save)});
 * Enter in the last field runs onLast. Buttons, checkboxes and an open medicine list keep their own Enter. */
export function enterToNext(e: React.KeyboardEvent<HTMLElement>, onLast?: () => void) {
  if (e.key !== "Enter" || e.defaultPrevented) return;
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) return;
  if (t instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit"].includes(t.type)) return;
  e.preventDefault();
  const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("input:not([disabled]):not([type=checkbox]):not([type=radio]), select:not([disabled])")).filter((el) => el.offsetParent !== null);
  const i = all.indexOf(t);
  if (i >= 0 && i < all.length - 1) {
    const next = all[i + 1];
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  } else onLast?.();
}
