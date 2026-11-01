import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Api, Permission, SellableProduct, User } from "@shared/types";
import electron from "./electronRequire";
import { activityList, logActivity } from "./activity";
import { authState, changeOwnPassword, listUsers, login, logout, permissionsFor, requireUser, resetPassword, saveUser, setUserPermissions, setupSuperadmin, userPermissions } from "./auth";
import { autoBackup, backupNow, backupStatus, backupToFolder, chooseFolder, exportCsv, restoreBackup } from "./backup";
import { purchaseCsvRead, purchasePdfPick, purchaseTableRead, purchaseTemplate } from "./purchaseImport";
import { udharBills, customerLedger, customerPrices, deletePayment, duesList, listCustomers, partyPrices, saveCustomer, saveCustomerPrice, savePayment } from "./customers";
import { getDb } from "./db";
import { addLicence, issueLicence, listLicences, registerStatus, removeLicence } from "./licenceRegister";
import { activateLicence, licenceGate, licenseStatus } from "./license";
import { printBill, printHtml, saveBillPdf } from "./print";
import { listProducts, productCategories, saveProduct, sellableByIds, sellableSearch, serialLookup, serialsAvailable, stockAdjust, stockHistory, stockReport } from "./products";
import { getPurchase, listPurchases, listSuppliers, savePurchase, saveSupplier } from "./purchases";
import { deliverRepair, getRepair, listRepairs, saveRepair, setRepairStatus } from "./repairs";
import { dashboard, gstReport, profitReport, salesDaily, tierReport } from "./reports";
import { createSale, getSale, listSales, returnSale } from "./sales";
import { getSettings, saveSettings } from "./settings";
import { UserError } from "./util";

const { app, BrowserWindow, ipcMain, Menu } = electron;

const currentDir: string = typeof __dirname !== "undefined" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const ICON = path.join(currentDir, DEV_URL ? "../public/icon.png" : "../dist/icon.png");

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;

/** Everything the screens can ask for. Each call runs here, next to the database, and checks who is signed in:
 * hiding a button on screen is not enough, so every request is checked again against the person's permissions. */
const may = (...anyOf: Parameters<typeof requireUser>) => {
  const u = requireUser(...anyOf);
  if (u.must_change_password) throw new UserError("Please set your own password first");
  return u;
};
const has = (u: User, p: Permission) => permissionsFor(u).includes(p);
/** What the shop paid stays hidden from staff who may not see purchase prices. */
const hideCost = <T extends { purchase_rate: number }>(u: User, list: T[]): T[] => (has(u, "billing.cost") ? list : list.map((p) => ({ ...p, purchase_rate: 0 })));
const hideSellableCost = (u: User, list: SellableProduct[]) => hideCost(u, list);

const superadminOnly = () => {
  const u = may();
  if (u.role !== "superadmin") throw new UserError("Only the Super Admin can do this");
  return u;
};

const handlers: Api = {
  // The register of issued licences: the Super Admin, on the computer that holds the signing key
  registerStatus: async () => (may(), registerStatus()),
  registerList: async () => (superadminOnly(), listLicences()),
  registerIssue: async (i) => (superadminOnly(), issueLicence(i)),
  registerAdd: async (i) => (superadminOnly(), addLicence(i)),
  registerRemove: async (id) => (superadminOnly(), removeLicence(id)),
  // these three answer even while the app is locked (see LICENCE_OPEN), so no sign-in is asked for
  licenseStatus: async () => licenseStatus(),
  licenseActivate: async (key) => activateLicence(key),
  licenseBackup: async () => {
    const r = await backupNow();
    if (!r.ok && r.error) throw new UserError(r.error);
    return { ok: r.ok, path: r.path };
  },
  authState: async () => authState(),
  setupSuperadmin: async (i) => setupSuperadmin(i),
  login: async (u, p) => login(u, p),
  logout: async () => logout(),
  changeOwnPassword: async (c, n) => changeOwnPassword(c, n),

  userList: async () => listUsers(),
  userSave: async (u) => saveUser(u),
  userResetPassword: async (id, pw) => resetPassword(id, pw),
  userPermissions: async (id) => userPermissions(id),
  setUserPermissions: async (id, perms) => setUserPermissions(id, perms),

  settingsGet: async () => (may(), getSettings()),
  settingsSave: async (s) => {
    const u = may("settings");
    const saved = saveSettings(s);
    logActivity(u.id, "Settings changed", "", Object.keys(s).join(", "));
    if (s.backup_folder) void backupToFolder();
    return saved;
  },
  printHtml: async (html, paper) => (may(), printHtml(html, paper)),

  productList: async (q, all) => {
    const u = may("products.view", "purchases", "stock.view");
    return hideCost(u, listProducts(q, all));
  },
  productSave: async (p) => {
    const u = may("products.edit");
    const id = saveProduct(p);
    logActivity(u.id, p.id ? "Product edited" : "Product added", p.name, `customer ₹${p.customer_price}, technician ₹${p.technician_price}`);
    return id;
  },
  productCategories: async () => (may(), productCategories()),
  sellableSearch: async (q) => {
    const u = may("billing", "repairs");
    return hideSellableCost(u, sellableSearch(q));
  },
  sellableByIds: async (ids) => {
    const u = may("billing", "repairs");
    return hideSellableCost(u, sellableByIds(ids));
  },
  serialsAvailable: async (id) => (may("billing", "purchases", "stock.view"), serialsAvailable(id)),
  serialLookup: async (sn) => (may("billing", "bills.view", "stock.view", "repairs"), serialLookup(sn)),
  stockReport: async (kind) => {
    const u = may("stock.view");
    const rows = stockReport(kind);
    return has(u, "billing.cost") ? rows : rows.map((r) => ({ ...r, purchase_rate: 0, value: 0 }));
  },
  stockAdjust: async (id, qty, reason) => {
    const u = may("stock.adjust");
    stockAdjust(id, qty, reason);
    logActivity(u.id, "Stock corrected", `product ${id}`, `now ${qty}: ${reason}`);
  },
  stockHistory: async (id) => (may("stock.view", "products.view"), stockHistory(id)),

  supplierList: async () => (may("purchases"), listSuppliers()),
  supplierSave: async (s) => (may("purchases"), saveSupplier(s)),
  purchaseSave: async (p) => {
    const u = may("purchases");
    const id = savePurchase(p, u.id);
    logActivity(u.id, "Purchase saved", p.invoice_no, `${p.lines.length} lines`);
    return id;
  },
  purchaseList: async (from, to) => (may("purchases"), listPurchases(from, to)),
  purchaseCsvRead: async () => (may("purchases"), purchaseCsvRead()),
  purchasePdfPick: async () => (may("purchases"), purchasePdfPick()),
  purchaseTableRead: async (table, name) => (may("purchases"), purchaseTableRead(table, name)),
  purchaseTemplate: async () => (may("purchases"), purchaseTemplate()),
  udharBills: async () => (may("payments"), udharBills()),
  purchaseGet: async (id) => (may("purchases"), getPurchase(id)),

  customerList: async (q, all) => (may("customers", "billing", "payments", "repairs"), listCustomers(q, all)),
  customerSave: async (c) => {
    const u = may("customers");
    const id = saveCustomer(c);
    logActivity(u.id, c.id ? "Customer edited" : "Customer added", c.name, c.type);
    return id;
  },
  customerPrices: async (id) => (may("customers"), customerPrices(id)),
  customerPriceSave: async (cid, pid, rate) => {
    const u = may("customers");
    saveCustomerPrice(cid, pid, rate);
    logActivity(u.id, "Agreed rate set", `customer ${cid}`, `product ${pid}: ${rate ?? "removed"}`);
  },
  partyPrices: async (cid, tier, ids) => (may("billing", "repairs", "customers"), partyPrices(cid, tier, ids)),
  customerLedger: async (id) => (may("payments", "customers"), customerLedger(id)),
  paymentSave: async (p) => {
    const u = may("payments");
    const id = savePayment(p, u.id);
    logActivity(u.id, "Payment received", `customer ${p.customer_id}`, `₹${p.amount} by ${p.mode}`);
    return id;
  },
  paymentDelete: async (id) => {
    const u = may("payments");
    if (u.role !== "superadmin") throw new UserError("Only the Super Admin can delete a payment");
    deletePayment(id);
    logActivity(u.id, "Payment deleted", `#${id}`);
  },
  duesList: async () => (may("payments"), duesList()),

  saleCreate: async (s) => {
    const u = may("billing");
    const res = createSale(s, u.id, { changeDiscount: has(u, "billing.discount"), changeTier: has(u, "billing.tier"), exceedCreditLimit: u.role === "superadmin" });
    logActivity(u.id, "Bill created", res.bill_no, `${s.lines.length} lines, ${s.tier} price`);
    return res;
  },
  saleList: async (f) => (may("bills.view"), listSales(f)),
  saleGet: async (id) => {
    const u = may("bills.view", "billing");
    const sale = getSale(id);
    if (!sale || has(u, "billing.cost")) return sale;
    return { ...sale, items: sale.items.map((i) => ({ ...i, cost: 0 })) };
  },
  saleReturn: async (r) => {
    const u = may("bills.return");
    const res = returnSale(r, u.id);
    logActivity(u.id, "Sale return", `bill ${r.sale_id}`, `${r.lines.length} lines, ${r.reason}`);
    return res;
  },
  printBill: async (id) => (may("billing", "bills.view"), printBill(id)),
  saveBillPdf: async (id) => (may("billing", "bills.view"), saveBillPdf(id)),

  repairList: async (status, q) => (may("repairs"), listRepairs(status, q)),
  repairGet: async (id) => (may("repairs"), getRepair(id)),
  repairSave: async (r) => {
    const u = may("repairs");
    const id = saveRepair(r);
    logActivity(u.id, r.id ? "Job edited" : "Job received", getRepair(id)?.job_no ?? "", r.device);
    return id;
  },
  repairSetStatus: async (id, status) => {
    const u = may("repairs");
    setRepairStatus(id, status);
    logActivity(u.id, "Job status", getRepair(id)?.job_no ?? "", status);
  },
  repairDeliver: async (id, pay) => {
    const u = may("repairs", "billing");
    if (!has(u, "billing")) throw new UserError("You don't have access to billing. Ask the Super Admin.");
    const res = deliverRepair(id, pay, u.id);
    logActivity(u.id, "Job delivered", res.bill_no, `₹${res.total}`);
    return res;
  },

  dashboard: async () => {
    const u = may();
    return dashboard((p) => has(u, p));
  },
  salesDaily: async (from, to) => (may("reports"), salesDaily(from, to)),
  tierReport: async (from, to) => {
    const u = may("reports");
    const rows = tierReport(from, to);
    return has(u, "reports.profit") ? rows : rows.map((r) => ({ ...r, profit: 0 }));
  },
  gstReport: async (from, to) => (may("reports"), gstReport(from, to)),
  profitReport: async (from, to) => (may("reports.profit"), profitReport(from, to)),
  activityList: async (from, to, q) => (may("reports"), activityList(from, to, q)),

  exportCsv: async (name, rows) => (may("stock.view", "reports", "reports.profit", "customers", "payments", "purchases", "products.view"), exportCsv(name, rows)),
  backupNow: async () => (may("backup"), backupNow()),
  backupStatus: async () => {
    may("backup");
    return backupStatus();
  },
  restoreBackup: async () => (may("backup"), restoreBackup()),
  chooseFolder: async (title) => (may("backup", "settings"), (await chooseFolder(title)) ?? ""),
  dataFolder: async () => (may("backup", "settings"), app.getPath("userData")),
};

/** One channel for all calls. A UserError's message is shown to the person; anything else is logged and kept generic. */
ipcMain.handle("api", async (_event, name: string, args: unknown[]) => {
  const fn = (handlers as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name];
  if (!fn) return { ok: false, error: "Unknown request" };
  // no valid licence (never entered, or past its end date): nothing else works
  const locked = licenceGate(name);
  if (locked) return locked;
  try {
    return { ok: true, value: await fn(...(Array.isArray(args) ? args : [])) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(`[api] ${name} failed`, e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    title: "Electronics Shop ERP",
    icon: ICON,
    webPreferences: { preload: path.join(currentDir, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadFile(path.join(currentDir, "../dist/index.html"));
}

app.setAppUserModelId("com.devnexa.electronicserp");
// One fixed data folder whether started from the installer or with `npm run dev`.
app.setPath("userData", path.join(app.getPath("appData"), "electronics-shop-erp"));

app.whenReady().then(() => {
  if (!DEV_URL) Menu.setApplicationMenu(null);
  getDb(); // opens the shop's database and brings its tables up to date
  createWindow();
  void autoBackup().catch((e) => console.error("[backup] daily copy failed", e));
  setInterval(() => void autoBackup().catch((e) => console.error("[backup] hourly copy failed", e)), 60 * 60 * 1000);
});

app.on("window-all-closed", () => app.quit());
