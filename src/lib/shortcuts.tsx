import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";

/* Keyboard layer shared by the DevNexa ERP apps (Gold, Medical, Bike, Restaurant).
 *   Alt + letter ........ open a screen (shown next to it in the side menu)
 *   Ctrl+K  or  ? ....... jump-to-screen box with the shortcut cheat sheet
 *   /  or  Ctrl+F ....... focus the search box of the current list
 *   Down / Up / Enter ... walk through a list from its search box and open a row
 *   Ctrl+N .............. press the screen's main "new" button
 *   Ctrl+Enter .......... Save / confirm in the top-most dialog
 *   Esc ................. close the top-most dialog only
 * Alt+E/F/H/V/W are left free: the development window's menu bar uses them. */

const layers: number[] = [];
let layerSeq = 0;

export const anyLayerOpen = () => layers.length > 0;

/** Registers a dialog. Only the top-most dialog reacts to Esc and Ctrl+Enter (which presses its last enabled primary button,
 * unless the screen already handled the key itself). Put the returned id on the dialog as data-layer. */
export function useLayer(onClose: () => void): string {
  const [id] = useState(() => ++layerSeq);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    layers.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || layers[layers.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const btns = document.querySelectorAll<HTMLButtonElement>(`[data-layer="${id}"] .btn-primary:not(:disabled)`);
        const b = btns[btns.length - 1];
        if (b) {
          e.preventDefault();
          b.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = layers.indexOf(id);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [id]);
  return String(id);
}

export interface HotItem {
  to: string;
  label: string;
  /** KeyboardEvent.code, e.g. "KeyD" or "Comma" */
  code: string;
  /** what is shown after "Alt+", e.g. "D" */
  hint: string;
}

const BUSY_SCREEN = /^#\/(billing|pos)/;
const SEARCH_HINT = /search|find|name|phone|bill|scan|barcode|code|medicine|item|order|customer/i;

const scopeEl = (): ParentNode => {
  const top = layers.length ? document.querySelector(`[data-layer="${layers[layers.length - 1]}"]`) : null;
  return top ?? document.querySelector("main") ?? document;
};

function searchBox(): HTMLInputElement | null {
  const inputs = Array.from(scopeEl().querySelectorAll<HTMLInputElement>("input[data-search], input[placeholder]"));
  const ok = (i: HTMLInputElement) => i.offsetParent !== null && !i.disabled && !i.readOnly && ["text", "search", ""].includes(i.type);
  return inputs.find((i) => ok(i) && i.hasAttribute("data-search")) ?? inputs.find((i) => ok(i) && SEARCH_HINT.test(i.placeholder)) ?? inputs.find(ok) ?? null;
}

const clickableRows = () => Array.from(scopeEl().querySelectorAll<HTMLElement>("tbody tr.cursor-pointer, tbody tr[tabindex]")).filter((r) => r.offsetParent !== null);

let styleAdded = false;
function addRowStyle() {
  if (styleAdded) return;
  styleAdded = true;
  const s = document.createElement("style");
  s.textContent = "tbody tr:focus { outline: none; box-shadow: inset 0 0 0 2px #d99a14; background: rgba(217,154,20,.14) !important; }";
  document.head.appendChild(s);
}

/** Installs the global shortcuts. Returns [paletteOpen, setPaletteOpen] for the <Palette /> box. */
export function useGlobalShortcuts(items: HotItem[]): [boolean, (v: boolean | ((p: boolean) => boolean)) => void] {
  const [palette, setPalette] = useState(false);
  const list = useRef(items);
  list.current = items;
  useEffect(() => {
    addRowStyle();
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target;
      const busy = BUSY_SCREEN.test(window.location.hash);
      // ---- rows: from a search box, Down jumps into the list; on a row, Up/Down/Enter work
      if (t instanceof HTMLElement && t.tagName === "TR" && !mod && !e.altKey) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const next = (e.key === "ArrowDown" ? t.nextElementSibling : t.previousElementSibling) as HTMLElement | null;
          if (next) {
            e.preventDefault();
            next.tabIndex = -1;
            next.focus();
            next.scrollIntoView({ block: "nearest" });
          }
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          t.click();
        } else if (e.key === "Escape" && !layers.length) {
          searchBox()?.focus();
        }
        return;
      }
      if (e.key === "ArrowDown" && !mod && !e.altKey && t instanceof HTMLInputElement && !busy && t === searchBox()) {
        const first = clickableRows()[0];
        if (first) {
          e.preventDefault();
          first.tabIndex = -1;
          first.focus();
        }
        return;
      }
      // ---- palette
      if ((mod && e.key.toLowerCase() === "k") || (mod && e.key === "/") || (e.key === "?" && !typing(t) && !layers.length)) {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      // ---- Alt + letter
      if (e.altKey && !mod && !e.shiftKey) {
        const hit = list.current.find((x) => x.code === e.code);
        if (hit) {
          e.preventDefault();
          window.location.hash = `#${hit.to}`;
        }
        return;
      }
      // ---- search
      if (((mod && e.key.toLowerCase() === "f") || (e.key === "/" && !typing(t))) && !palette) {
        const box = searchBox();
        if (box) {
          e.preventDefault();
          box.focus();
          box.select();
        }
        return;
      }
      // ---- new
      if (mod && e.key.toLowerCase() === "n" && !layers.length && !busy) {
        const btn = document.querySelector<HTMLButtonElement>("main button.btn-primary:not(:disabled)") ?? document.querySelector<HTMLButtonElement>("button.btn-primary:not(:disabled)");
        if (btn) {
          e.preventDefault();
          btn.click();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette]);
  return [palette, setPalette];
}

const kbd = "rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600";

/** The "Go to..." box: type part of a screen name, Up/Down, Enter. Shows the cheat sheet underneath. */
export function Palette({ items, extra = [], onClose }: { items: HotItem[]; extra?: [string, string][]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const shown = items.filter((x) => x.label.toLowerCase().includes(q.trim().toLowerCase()));
  const go = (to: string) => {
    onClose();
    window.location.hash = `#${to}`;
  };
  const sheet: [string, string][] = [
    ["Alt + letter", "Open a screen (shown in the side menu)"], ["Ctrl+K  or  ?", "This box"], ["/  or  Ctrl+F", "Search in the current list"], ["Down / Up, Enter", "Walk through a list and open a row"],
    ["Ctrl+N", "New (the screen's main button)"], ["Ctrl+Enter", "Save / confirm in any dialog"], ["Esc", "Close the dialog"], ["Ctrl+B", "Show or hide the side menu"], ...extra,
  ];
  return (
    <Modal title="Go to... / keyboard shortcuts" onClose={onClose}>
      <input
        className="input mb-2 text-base" autoFocus placeholder="Type a screen name, Up/Down to choose, Enter to open" value={q}
        onChange={(e) => { setQ(e.target.value); setAt(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && !e.ctrlKey && shown[at]) { e.preventDefault(); go(shown[at].to); }
        }} />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
        {shown.map((x, i) => (
          <button key={x.to} type="button" onClick={() => go(x.to)} onMouseEnter={() => setAt(i)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === at ? "bg-slate-100 font-bold" : ""}`}>
            <span className="flex-1">{x.label}</span><kbd className={kbd}>Alt+{x.hint}</kbd>
          </button>
        ))}
        {shown.length === 0 && <div className="py-4 text-center text-sm text-slate-400">No screen matches</div>}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {sheet.map(([k, d]) => <div key={k} className="flex items-center gap-2 text-xs"><kbd className={`${kbd} shrink-0`}>{k}</kbd><span className="text-slate-600">{d}</span></div>)}
      </div>
    </Modal>
  );
}
