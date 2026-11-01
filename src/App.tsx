import {
  IconAddressBook,
  IconBox,
  IconCash,
  IconCashRegister,
  IconChartBar,
  IconDeviceMobileCog,
  IconFileInvoice,
  IconKey,
  IconLayoutDashboard,
  IconLogout,
  IconMenu2,
  IconPackage,
  IconSettings,
  IconTruck,
  IconUserCircle,
  IconUsers,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { AuthState, LicenseStatus, Permission, Session } from "@shared/types";
import { api } from "@/api";
import { ShopLogo } from "@/components/Brand";
import { ConfirmHost, Field, Modal, PasswordInput, toast, ToastHost } from "@/components/ui";
import { Palette, useGlobalShortcuts, type HotItem } from "@/lib/shortcuts";
import { SessionContext, type SessionCtx, useSession } from "@/lib/session";
import { BillingPage } from "@/pages/Billing";
import { BillsPage } from "@/pages/Bills";
import { CustomersPage } from "@/pages/Customers";
import { DashboardPage } from "@/pages/Dashboard";
import { LicenceGate } from "@/pages/LicenceGate";
import { ChooseOwnPasswordPage, LoginPage, SetupPage } from "@/pages/Login";
import { LicencesPage } from "@/pages/Licences";
import { ProductsPage } from "@/pages/Products";
import { PurchasesPage } from "@/pages/Purchases";
import { RepairsPage } from "@/pages/Repairs";
import { ReportsPage } from "@/pages/Reports";
import { SettingsPage } from "@/pages/Settings";
import { StockPage } from "@/pages/Stock";
import { UsersPage } from "@/pages/Users";

/** Alt + key opens a screen (no Alt+E/F/H/V/W: the development menu bar uses those). */
const HOT: Record<string, [string, string]> = {
  "/dashboard": ["KeyD", "D"], "/billing": ["KeyB", "B"], "/bills": ["KeyS", "S"], "/repairs": ["KeyR", "R"], "/customers": ["KeyC", "C"],
  "/products": ["KeyM", "M"], "/purchases": ["KeyU", "U"], "/stock": ["KeyK", "K"], "/reports": ["KeyP", "P"], "/users": ["KeyZ", "Z"], "/settings": ["Comma", ","],
};

/** Each screen and the permission that opens it ("superadmin" = Super Admin only, "any" = everyone who is signed in). */
const SCREENS: { to: string; label: string; icon: typeof IconBox; need: Permission[] | "superadmin" | "any"; element: ReactNode; key?: string }[] = [
  { to: "/dashboard", label: "Dashboard", icon: IconLayoutDashboard, need: "any", element: <DashboardPage /> },
  { to: "/billing", label: "Billing", icon: IconCashRegister, need: ["billing"], element: <BillingPage />, key: "F1" },
  { to: "/bills", label: "Bills & Returns", icon: IconFileInvoice, need: ["bills.view"], element: <BillsPage /> },
  { to: "/repairs", label: "Repairs", icon: IconDeviceMobileCog, need: ["repairs"], element: <RepairsPage /> },
  { to: "/customers", label: "Customers", icon: IconAddressBook, need: ["customers", "payments"], element: <CustomersPage /> },
  { to: "/products", label: "Products & Prices", icon: IconBox, need: ["products.view"], element: <ProductsPage /> },
  { to: "/purchases", label: "Purchases", icon: IconTruck, need: ["purchases"], element: <PurchasesPage /> },
  { to: "/stock", label: "Stock", icon: IconPackage, need: ["stock.view"], element: <StockPage /> },
  { to: "/reports", label: "Reports", icon: IconChartBar, need: ["reports", "reports.profit"], element: <ReportsPage /> },
  { to: "/licences", label: "Licences", icon: IconKey, need: "superadmin", element: <LicencesPage /> },
  { to: "/settings", label: "Settings", icon: IconSettings, need: ["settings", "backup"], element: <SettingsPage /> },
  { to: "/users", label: "Users & Access", icon: IconUsers, need: "superadmin", element: <UsersPage /> },
];

export default function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [lic, setLic] = useState<LicenseStatus | null>(null);

  // without a valid licence nothing else works: checked first, when the window is used again, and at once when the back end
  // refuses a request because the licence has just ended
  const checkLicence = useCallback(() => {
    api.licenseStatus().then(setLic).catch(() => undefined);
  }, []);
  useEffect(() => {
    checkLicence();
    window.addEventListener("focus", checkLicence);
    window.addEventListener("licence-locked", checkLicence);
    const every = setInterval(checkLicence, 10 * 60_000);
    return () => {
      window.removeEventListener("focus", checkLicence);
      window.removeEventListener("licence-locked", checkLicence);
      clearInterval(every);
    };
  }, [checkLicence]);

  const reload = useCallback(async () => {
    try {
      setState(await api.authState());
    } catch (e) {
      toast.fromError(e);
    }
  }, []);
  const licensed = lic?.state === "licensed";
  useEffect(() => {
    if (licensed) void reload();
  }, [licensed, reload]);

  const setSession = (session: Session | null) => setState((s) => ({ setupNeeded: false, session, shop_name: s?.shop_name ?? "" }));

  return (
    <>
      <ToastHost />
      <ConfirmHost />
      {!lic ? null : !licensed ? (
        <LicenceGate status={lic} onActivated={setLic} />
      ) : !state ? null : state.setupNeeded ? (
        <SetupPage onSignedIn={setSession} />
      ) : !state.session ? (
        <LoginPage shopName={state.shop_name} onSignedIn={setSession} />
      ) : state.session.user.must_change_password ? (
        <ChooseOwnPasswordPage name={state.session.user.name} onDone={() => void reload()} onCancel={() => void api.logout().finally(() => setSession(null))} />
      ) : (
        <SignedIn session={state.session} onSignOut={() => setSession(null)} onRefresh={reload} />
      )}
    </>
  );
}

function SignedIn({ session, onSignOut, onRefresh }: { session: Session; onSignOut: () => void; onRefresh: () => Promise<void> }) {
  const ctx = useMemo<SessionCtx>(
    () => ({
      session,
      can: (p) => session.permissions.includes(p),
      isSuperadmin: session.user.role === "superadmin",
      signOut: () => {
        void api.logout().finally(onSignOut);
      },
      refresh: onRefresh,
    }),
    [session, onSignOut, onRefresh]
  );
  // the Licences screen is only for the vendor's own computer (where the signing key is kept)
  const [vendor, setVendor] = useState(false);
  useEffect(() => {
    if (ctx.isSuperadmin) api.registerStatus().then((r) => setVendor(r.enabled)).catch(() => setVendor(false));
  }, [ctx.isSuperadmin]);
  const screens = SCREENS.filter((s) => (s.to === "/licences" ? ctx.isSuperadmin && vendor : s.need === "any" ? true : s.need === "superadmin" ? ctx.isSuperadmin : s.need.some(ctx.can)));
  const hotItems: HotItem[] = screens.flatMap((x) => (HOT[x.to] ? [{ to: x.to, label: x.label, code: HOT[x.to][0], hint: HOT[x.to][1] }] : []));
  const [palette, setPalette] = useGlobalShortcuts(hotItems);

  const [menuOpen, setMenuOpen] = useState(() => {
    try {
      return localStorage.getItem("sidebar_collapsed") !== "1";
    } catch {
      return true;
    }
  });
  const toggleMenu = useCallback(() => {
    setMenuOpen((o) => {
      try {
        localStorage.setItem("sidebar_collapsed", o ? "1" : "0");
      } catch {
        // remembered for this session only
      }
      return !o;
    });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMenu]);

  // a switched-off account or changed access shows up when the window is used again
  useEffect(() => {
    const onFocus = () => void onRefresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [onRefresh]);

  return (
    <SessionContext.Provider value={ctx}>
      <HashRouter>
        <Shortcuts canBill={ctx.can("billing")} />
        <div className="flex h-full overflow-hidden bg-brand-50">
          <Sidebar screens={screens} open={menuOpen} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <TopBar open={menuOpen} onToggle={toggleMenu} />
            <Main screens={screens} />
          </div>
        </div>
        {palette && <Palette items={hotItems} extra={[["F1", "Open Billing"], ["F2 / F4", "Billing: search / customer"], ["F6 / F7", "Billing: hold / clear bill"], ["F8 / F9", "Billing: save / save and print"]]} onClose={() => setPalette(false)} />}
      </HashRouter>
    </SessionContext.Provider>
  );
}

/** The side menu is grouped: each screen sits under one heading. Users & Access opens from the profile menu in the top bar. */
const NAV_GROUPS: { label: string; routes: string[] }[] = [
  { label: "Sales", routes: ["/billing", "/bills", "/repairs", "/customers"] },
  { label: "Inventory", routes: ["/products", "/stock"] },
  { label: "Buying", routes: ["/purchases"] },
  { label: "Insights", routes: ["/reports"] },
  { label: "Settings", routes: ["/settings", "/licences"] },
];

function Sidebar({ screens, open }: { screens: typeof SCREENS; open: boolean }) {
  const [shop, setShop] = useState("");
  const [shut, setShut] = useState<Record<string, boolean>>({});
  const [hovered, setHovered] = useState<{ label: string; top: number } | null>(null);
  const location = useLocation();
  useEffect(() => {
    api.settingsGet().then((s) => setShop(s.shop_name)).catch(() => undefined);
  }, [location.pathname]);

  const byRoute = new Map(screens.map((s) => [s.to, s]));
  const dashboard = byRoute.get("/dashboard");
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.routes.flatMap((r) => (byRoute.has(r) ? [byRoute.get(r)!] : [])) })).filter((g) => g.items.length > 0);

  const link = (n: (typeof SCREENS)[number]) => (
    <NavLink
      key={n.to}
      to={n.to}
      onMouseEnter={(e) => {
        if (!open) {
          const r = e.currentTarget.getBoundingClientRect();
          setHovered({ label: n.label, top: r.top + r.height / 2 });
        }
      }}
      onMouseLeave={() => setHovered(null)}
      className={({ isActive }) =>
        open
          ? `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-all ${isActive ? "bg-brand-600 font-semibold text-white" : "text-slate-300 hover:bg-slate-800/80 hover:text-white"}`
          : `flex h-9 w-9 items-center justify-center rounded-xl transition-all ${isActive ? "bg-brand-600 text-white" : "text-slate-400 hover:bg-slate-800/80 hover:text-white"}`
      }
    >
      <n.icon size={open ? 16 : 18} stroke={1.8} />
      {open && <span className="flex-1">{n.label}</span>}
      {open && (n.key || HOT[n.to]) && <kbd className="rounded bg-black/20 px-1.5 text-[10px]">{n.key ?? `Alt+${HOT[n.to][1]}`}</kbd>}
    </NavLink>
  );

  return (
    <>
      <aside className={`print:hidden z-40 flex shrink-0 select-none flex-col border-r border-slate-800 bg-slate-900 shadow-xl transition-all duration-300 ease-in-out ${open ? "w-60" : "w-16"}`}>
        <div className={`flex shrink-0 items-center border-b border-slate-800 bg-slate-950/40 py-3 ${open ? "px-3.5" : "justify-center px-2"}`}>
          {open ? (
            <div className="flex min-w-0 items-center gap-2.5">
              <ShopLogo size={30} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-extrabold tracking-wide text-white">
                  <span>ELECTRONICS</span>
                  <span className="rounded border border-brand-400/30 bg-brand-500/20 px-1.5 py-0.5 text-[9px] font-bold text-brand-300">ERP</span>
                </div>
                <div className="truncate text-[10px] font-medium text-slate-400">{shop}</div>
              </div>
            </div>
          ) : (
            <ShopLogo size={34} />
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-2 text-sm" onMouseLeave={() => setHovered(null)}>
          {dashboard && <div className={open ? "mb-2 px-2" : "mb-2 flex justify-center px-1.5"}>{link(dashboard)}</div>}
          {groups.map((g, i) => (
            <div key={g.label} className={open ? "mb-2 px-2" : "mb-1.5 px-1.5"}>
              {open ? (
                <button className="flex w-full items-center justify-between px-2 py-1 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200" onClick={() => setShut((c) => ({ ...c, [g.label]: !c[g.label] }))}>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
                    {g.label}
                  </span>
                  <span className="text-[10px]">{shut[g.label] ? "▸" : "▾"}</span>
                </button>
              ) : (
                i > 0 && <div className="mx-2 my-1.5 border-t border-slate-800/80" />
              )}
              {(open ? !shut[g.label] : true) && <div className={open ? "mt-1 space-y-0.5" : "flex flex-col items-center space-y-1"}>{g.items.map(link)}</div>}
            </div>
          ))}
        </nav>

      </aside>
      {!open && hovered && (
        <div className="pointer-events-none fixed z-50 flex items-center" style={{ left: 68, top: hovered.top, transform: "translateY(-50%)" }}>
          <div className="-mr-1 z-10 h-2 w-2 rotate-45 border-b border-l border-slate-700/80 bg-slate-900" />
          <div className="whitespace-nowrap rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white shadow-2xl">{hovered.label}</div>
        </div>
      )}
    </>
  );
}

function TopBar({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const { session, isSuperadmin, signOut } = useSession();
  const [menu, setMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [shop, setShop] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api.settingsGet().then((s) => setShop(s.shop_name)).catch(() => undefined);
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);
  const item = "flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50";

  return (
    <header className="print:hidden relative z-30 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 pb-2 pt-2.5">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-brand-600" />
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 transition-all hover:bg-brand-50 hover:text-slate-900 active:scale-95"
          title={open ? "Close the side menu (Ctrl+B)" : "Open the side menu (Ctrl+B)"}
        >
          <IconMenu2 size={18} />
        </button>
        <span className="text-sm font-bold text-slate-700">{shop}</span>
      </div>
      <div className="relative" ref={ref}>
        <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1 pl-1.5 pr-3 transition hover:bg-slate-50">
          <IconUserCircle size={28} className="text-slate-400" />
          <span className="text-left leading-tight">
            <span className="block text-xs font-bold text-slate-800">{session.user.name}</span>
            <span className="block text-[10px] text-slate-500">{isSuperadmin ? "Super Admin" : "Admin"}</span>
          </span>
        </button>
        {menu && (
          <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <div className="truncate text-xs font-bold text-slate-900">{session.user.name}</div>
              <div className="truncate text-[11px] text-slate-500">{session.user.username}</div>
            </div>
            <button className={item} onClick={() => { setMenu(false); setPwOpen(true); }}>
              <IconCash size={15} className="text-brand-500" /> Change my password
            </button>
            {isSuperadmin && (
              <NavLink to="/users" className={item} onClick={() => setMenu(false)}>
                <IconUsers size={15} className="text-brand-500" /> Users & Access
              </NavLink>
            )}
            <button className={`${item} border-t border-slate-100 text-rose-600`} onClick={signOut}>
              <IconLogout size={15} /> Sign out
            </button>
          </div>
        )}
      </div>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </header>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  async function save() {
    if (f.next !== f.confirm) {
      toast.error("The new passwords don't match");
      return;
    }
    try {
      await api.changeOwnPassword(f.current, f.next);
      toast.ok("Password changed");
      onClose();
    } catch (e) {
      toast.fromError(e);
    }
  }
  return (
    <Modal
      title="Change my password"
      onClose={onClose}
      footer={
        <>
          <button className="btn-light" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void save()}>Change password</button>
        </>
      }
    >
      <div className="space-y-3 text-slate-800">
        <Field label="Current password"><PasswordInput className="input" autoFocus value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
        <Field label="New password (at least 6 characters)"><PasswordInput className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="New password again"><PasswordInput className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Shortcuts({ canBill }: { canBill: boolean }) {
  const location = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1" && canBill) {
        e.preventDefault();
        if (location.pathname !== "/billing") window.location.hash = "#/billing";
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.pathname, canBill]);
  return null;
}

/** The page area. Billing fills the screen with its own scrolling; other screens scroll as a whole. */
function Main({ screens }: { screens: typeof SCREENS }) {
  const location = useLocation();
  return (
    <main className={`min-w-0 flex-1 p-5 ${location.pathname === "/billing" ? "overflow-hidden" : "overflow-y-auto"}`}>
              <LicenceBanner />
              {screens.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-slate-500">
                  <div>
                    <div className="text-lg font-bold">You don't have access to any screen yet</div>
                    <div className="text-sm">Ask the Super Admin to allow screens for Admins.</div>
                  </div>
                </div>
              ) : (
                <div key={location.pathname} className={`page-in ${location.pathname === "/billing" ? "h-full" : ""}`}>
                <Routes>
                  {screens.map((s) => (
                    <Route key={s.to} path={s.to} element={s.element} />
                  ))}
                  <Route path="*" element={<Navigate to={screens[0].to} replace />} />
                </Routes>
                </div>
              )}
            </main>
  );
}

/** A strip above every screen only during the last 30 days of a licence, so the renewal is arranged before the app locks. */
function LicenceBanner() {
  const [st, setSt] = useState<LicenseStatus | null>(null);
  const location = useLocation();
  useEffect(() => {
    api.licenseStatus().then(setSt).catch(() => undefined);
  }, [location.pathname]);
  if (!st || st.state !== "licensed" || st.days_left === null || st.days_left > 30) return null;
  return (
    <div className="mb-3 rounded-xl bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">
      Your subscription ends in {st.days_left} day{st.days_left === 1 ? "" : "s"}. Please renew your licence before then.
    </div>
  );
}
