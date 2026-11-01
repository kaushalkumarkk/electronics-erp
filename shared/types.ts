/** The contract between the screens (src/) and the back end (electron/). Every call the UI can make is listed in `Api`. */

/* ---------- people and access ---------- */

export type Role = "superadmin" | "admin";

export const PERMISSIONS = [
  { key: "billing", label: "Make bills", group: "Sales" },
  { key: "billing.tier", label: "Switch a bill between customer and technician price", group: "Sales" },
  { key: "billing.discount", label: "Change prices and give discounts on a bill", group: "Sales" },
  { key: "billing.cost", label: "See purchase cost and margin", group: "Sales" },
  { key: "bills.view", label: "See past bills", group: "Sales" },
  { key: "bills.return", label: "Take sale returns", group: "Sales" },
  { key: "products.view", label: "See the product list", group: "Inventory" },
  { key: "products.edit", label: "Add and edit products and their prices", group: "Inventory" },
  { key: "stock.view", label: "See stock", group: "Inventory" },
  { key: "stock.adjust", label: "Correct stock", group: "Inventory" },
  { key: "purchases", label: "Purchases and suppliers", group: "Buying" },
  { key: "customers", label: "Customers and technicians", group: "Parties" },
  { key: "payments", label: "Receive payments and see dues", group: "Parties" },
  { key: "repairs", label: "Repair job cards", group: "Service" },
  { key: "reports", label: "Reports", group: "Insights" },
  { key: "reports.profit", label: "Profit reports", group: "Insights" },
  { key: "settings", label: "Shop settings", group: "Admin" },
  { key: "backup", label: "Backup and restore", group: "Admin" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/** What a newly added Admin can do until the Super Admin changes it. */
export const STARTING_PERMISSIONS: Permission[] = ["billing", "bills.view", "products.view", "stock.view", "customers", "repairs"];

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
}
export interface Session {
  user: User;
  permissions: Permission[];
}
export interface AuthState {
  setupNeeded: boolean;
  session: Session | null;
  shop_name: string;
}

/* ---------- settings ---------- */

export type PaperSize = "80mm" | "A5" | "A4";

export interface Settings {
  shop_name: string;
  address: string;
  phone: string;
  gstin: string;
  state: string;
  bill_prefix: string;
  /** price shown on a new bill when no saved party is picked */
  default_tier: PriceTier;
  /** GST % on repair labour / service lines */
  service_gst: number;
  paper: PaperSize;
  terms: string;
  warranty_note: string;
  /** a second place for backups (Google Drive / OneDrive / pen drive folder) */
  backup_folder: string;
}

/* ---------- prices ---------- */

/** The two prices every product carries: what a walk-in customer pays, and what a technician (trade buyer) pays. */
export type PriceTier = "customer" | "technician";
export type PriceSource = "agreed" | "technician" | "customer";

export interface PartyPrice {
  price: number;
  source: PriceSource;
}

/* ---------- products and stock ---------- */

export interface Product {
  id: number;
  name: string;
  brand: string;
  model: string;
  category: string;
  sku: string;
  barcode: string;
  hsn: string;
  gst_rate: number;
  unit: string;
  /** months of warranty given to the buyer */
  warranty_months: number;
  /** each unit has its own serial / IMEI number */
  track_serial: boolean;
  /** labour or a service: no stock */
  is_service: boolean;
  /** price for a walk-in customer, per unit, GST included */
  customer_price: number;
  /** price for a technician / trade buyer, per unit, GST included */
  technician_price: number;
  /** average cost per unit before GST (hidden from staff without billing.cost) */
  purchase_rate: number;
  min_stock: number;
  rack: string;
  active: boolean;
  qty: number;
}
export type ProductInput = Omit<Product, "id" | "qty" | "purchase_rate"> & { id?: number; purchase_rate?: number };

export interface Serial {
  id: number;
  product_id: number;
  serial_no: string;
  status: "in_stock" | "sold" | "returned";
  warranty_end: string;
}

export interface SerialLookup extends Serial {
  product_name: string;
  bill_no: string;
  bill_date: string;
  customer_name: string;
  in_warranty: boolean;
}

export interface StockRow extends Product {
  value: number;
}
export interface StockMove {
  date: string;
  kind: string;
  ref: string;
  qty: number;
  note: string;
}

/* ---------- parties ---------- */

export interface Customer {
  id: number;
  name: string;
  phone: string;
  /** `technician` buyers get the technician price by default */
  type: PriceTier;
  shop_name: string;
  gstin: string;
  address: string;
  state: string;
  credit_limit: number;
  opening_balance: number;
  active: boolean;
  /** what they owe now */
  balance: number;
}
export type CustomerInput = Omit<Customer, "id" | "balance"> & { id?: number };

export interface AgreedPrice {
  product_id: number;
  name: string;
  customer_price: number;
  technician_price: number;
  rate: number;
}

export interface Payment {
  id: number;
  customer_id: number;
  date: string;
  amount: number;
  mode: string;
  note: string;
}
export interface LedgerRow {
  date: string;
  kind: "opening" | "bill" | "return" | "payment";
  ref: string;
  debit: number;
  credit: number;
  balance: number;
}
export interface DueRow {
  customer_id: number;
  name: string;
  phone: string;
  type: PriceTier;
  balance: number;
  oldest_bill: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  gstin: string;
  address: string;
}

/* ---------- purchases ---------- */

export interface PurchaseLineInput {
  product_id: number;
  qty: number;
  /** per unit, before GST */
  rate: number;
  gst_rate: number;
  serial_nos: string[];
  /** optionally update the product's selling prices with this purchase */
  customer_price?: number;
  technician_price?: number;
}
export interface PurchaseInput {
  supplier_id: number;
  invoice_no: string;
  invoice_date: string;
  paid: boolean;
  notes: string;
  lines: PurchaseLineInput[];
}
export interface PurchaseRow {
  id: number;
  supplier_id: number;
  supplier: string;
  invoice_no: string;
  invoice_date: string;
  taxable: number;
  gst: number;
  total: number;
  paid: boolean;
}
export interface PurchaseDetail extends PurchaseRow {
  notes: string;
  items: { product_id: number; name: string; qty: number; rate: number; gst_rate: number; amount: number }[];
}

/* ---------- billing ---------- */

export interface SellableProduct extends Product {
  /** units that can still be sold (serial products: serials in stock) */
  available: number;
}

export interface SaleLineInput {
  /** null for a free-text service / labour line */
  product_id: number | null;
  name?: string;
  qty: number;
  /** per unit, GST included, as shown on the bill */
  unit_price: number;
  disc_pct: number;
  /** for a free-text line */
  gst_rate?: number;
  serial_nos?: string[];
}

export interface SaleInput {
  customer_id: number | null;
  /** name typed for a walk-in, when no saved party is picked */
  walkin_name: string;
  walkin_phone: string;
  tier: PriceTier;
  lines: SaleLineInput[];
  /** rupees off the whole bill */
  bill_flat: number;
  payment_mode: string;
  /** amount received now; the rest goes on the customer's account */
  paid: number;
  notes: string;
  repair_id?: number;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number | null;
  name: string;
  hsn: string;
  qty: number;
  returned_qty: number;
  /** the price actually used, GST included */
  unit_price: number;
  /** both list prices as they stood when the bill was made */
  customer_price: number;
  technician_price: number;
  price_source: PriceSource | "manual" | "service";
  disc_pct: number;
  gst_rate: number;
  taxable: number;
  gst: number;
  amount: number;
  cost: number;
  warranty_months: number;
  serial_nos: string[];
}

export interface Sale {
  id: number;
  bill_no: string;
  bill_date: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  customer_gstin: string;
  customer_address: string;
  tier: PriceTier;
  interstate: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  bill_flat: number;
  round_off: number;
  total: number;
  paid: number;
  payment_mode: string;
  notes: string;
  user_name: string;
  repair_id: number | null;
  items: SaleItem[];
}
export interface SaleRow {
  id: number;
  bill_no: string;
  bill_date: string;
  customer_name: string;
  tier: PriceTier;
  total: number;
  paid: number;
  payment_mode: string;
  returned: number;
}
export interface SaleFilter {
  from: string;
  to: string;
  q: string;
  tier?: PriceTier | "";
}

export interface ReturnInput {
  sale_id: number;
  reason: string;
  /** cash | upi | card | credit-note (kept on the customer's account) */
  refund_mode: string;
  lines: { sale_item_id: number; qty: number; serial_nos?: string[] }[];
}

/* ---------- repairs ---------- */

export const REPAIR_STATUSES = ["Received", "Diagnosing", "Waiting for parts", "Repairing", "Ready", "Delivered", "Cancelled"] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export interface RepairPart {
  product_id: number;
  name: string;
  qty: number;
  unit_price: number;
}
export interface Repair {
  id: number;
  job_no: string;
  customer_id: number | null;
  customer_name: string;
  phone: string;
  tier: PriceTier;
  device: string;
  serial_no: string;
  issue: string;
  accessories: string;
  status: RepairStatus;
  estimate: number;
  advance: number;
  labour: number;
  assigned_to: string;
  received_at: string;
  promised_date: string;
  delivered_at: string;
  sale_id: number | null;
  notes: string;
  parts: RepairPart[];
}
export type RepairInput = Omit<Repair, "id" | "job_no" | "received_at" | "delivered_at" | "sale_id" | "parts" | "customer_name"> & {
  id?: number;
  customer_name: string;
  parts: { product_id: number; qty: number }[];
};

/* ---------- reports ---------- */

export interface DayTotal {
  date: string;
  bills: number;
  customer_total: number;
  technician_total: number;
  total: number;
}
export interface TierRow {
  tier: PriceTier;
  bills: number;
  units: number;
  sales: number;
  profit: number;
}
export interface GstRow {
  gst_rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
export interface ProfitRow {
  name: string;
  qty: number;
  sales: number;
  cost: number;
  profit: number;
}
export interface DashboardData {
  today: { bills: number; sales: number } | null;
  month: { bills: number; sales: number } | null;
  receivable: number | null;
  low_stock: number | null;
  open_repairs: number | null;
  ready_repairs: number | null;
  last_days: DayTotal[] | null;
  top_products: { name: string; qty: number }[] | null;
}
export interface ActivityRow {
  at: string;
  user_name: string;
  action: string;
  target: string;
  detail: string;
}

export interface BackupStatus {
  last: string;
  folder: string;
  count: number;
}

/* ---------- licence ---------- */

export interface LicenseStatus {
  state: "licensed" | "expired" | "none";
  licensee: string;
  licence_id: string;
  machine_id: string;
  issued: string;
  expires: string | null; // null = lifetime
  days_left: number | null;
  message: string;
}

/** active / expiring (30 days or less left) / expired / lifetime */
export type LicenceStanding = "active" | "expiring" | "expired" | "lifetime";

/** One line of DevNexa's register of licences it has issued (the file tools/licences.json). */
export interface LicenceRecord {
  id: string;
  shop: string;
  contact: string;
  machine: string; // "ANY" or the shop computer's Machine ID
  issued: string;
  expires: string | null;
  key: string; // "" for a record added by hand without its key
  note: string;
  renewal_of: string; // the licence this one replaced
  /** The owner's first login that the key creates on a fresh install (so the shop sees the login screen, not account setup). */
  owner_name?: string;
  owner_username?: string;
  owner_password?: string;
  created_at: string;
  status: LicenceStanding;
  days_left: number | null;
}

export interface LicenceIssueInput {
  shop: string;
  contact: string;
  machine: string; // "" or "ANY" = any computer
  years?: number; // 1 by default
  /** Renewing early: the term counts from this date when it is later than today, so the days left on the old licence are kept. */
  from?: string | null;
  /** The owner's first login. Activating the key on a fresh install creates this Super Admin, who must choose their own password at the first sign-in. */
  owner?: { name: string; username: string; password: string };
  expires?: string | null; // a date, or null for a lifetime key (instead of years)
  note: string;
  renewal_of?: string;
}

/** A licence already given out: paste its key and the rest is read from it, or type the details. */
export interface LicenceAddInput {
  key: string;
  shop: string;
  contact: string;
  machine: string;
  issued: string;
  expires: string | null;
  id: string; // empty = next number
  note: string;
}

/* ---------- the API ---------- */

export interface Api {
  licenseStatus(): Promise<LicenseStatus>;
  licenseActivate(key: string): Promise<LicenseStatus>;
  /** Saves a copy of the shop's data (works while locked, so an expired shop never loses its records). */
  licenseBackup(): Promise<{ ok: boolean; path?: string }>;

  /** DevNexa's register of issued licences: only on the computer that holds the private key (tools/private-key.pem). */
  registerStatus(): Promise<{ enabled: boolean; folder: string }>;
  registerList(): Promise<LicenceRecord[]>;
  registerIssue(i: LicenceIssueInput): Promise<LicenceRecord>;
  registerAdd(i: LicenceAddInput): Promise<LicenceRecord>;
  registerRemove(id: string): Promise<void>;

  purchaseCsvRead(): Promise<PurchaseImportResult>;
  purchasePdfPick(): Promise<{ ok: boolean; fileName?: string; data?: Uint8Array }>;
  purchaseTableRead(table: string[][], fileName: string): Promise<PurchaseImportResult>;
  purchaseTemplate(): Promise<{ ok: boolean; path?: string }>;
  udharBills(): Promise<UdharBill[]>;

  authState(): Promise<AuthState>;
  setupSuperadmin(i: { name: string; username: string; password: string; staff?: { name: string; username: string; password: string } }): Promise<Session>;
  login(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;
  changeOwnPassword(current: string, next: string): Promise<void>;

  userList(): Promise<User[]>;
  userSave(u: { id?: number; name: string; username: string; role: Role; active: boolean; password?: string }): Promise<number>;
  userResetPassword(id: number, password: string): Promise<void>;
  userPermissions(id: number): Promise<Permission[]>;
  setUserPermissions(id: number, perms: Permission[]): Promise<void>;

  settingsGet(): Promise<Settings>;
  settingsSave(s: Partial<Settings>): Promise<Settings>;
  printHtml(html: string, paper: PaperSize): Promise<{ ok: boolean; error?: string }>;

  productList(q: string, all: boolean): Promise<Product[]>;
  productSave(p: ProductInput): Promise<number>;
  productCategories(): Promise<string[]>;
  sellableSearch(q: string): Promise<SellableProduct[]>;
  sellableByIds(ids: number[]): Promise<SellableProduct[]>;
  serialsAvailable(productId: number): Promise<Serial[]>;
  serialLookup(serialNo: string): Promise<SerialLookup[]>;
  stockReport(kind: "all" | "low" | "out"): Promise<StockRow[]>;
  stockAdjust(productId: number, newQty: number, reason: string): Promise<void>;
  stockHistory(productId: number): Promise<StockMove[]>;

  supplierList(): Promise<Supplier[]>;
  supplierSave(s: Omit<Supplier, "id"> & { id?: number }): Promise<number>;
  purchaseSave(p: PurchaseInput): Promise<number>;
  purchaseList(from: string, to: string): Promise<PurchaseRow[]>;
  purchaseGet(id: number): Promise<PurchaseDetail | null>;

  customerList(q: string, all: boolean, limit?: number): Promise<Customer[]>;
  customerSave(c: CustomerInput): Promise<number>;
  customerPrices(id: number): Promise<AgreedPrice[]>;
  customerPriceSave(customerId: number, productId: number, rate: number | null): Promise<void>;
  /** the price each product would sell at for this buyer (agreed rate, else the tier's price) */
  partyPrices(customerId: number | null, tier: PriceTier, productIds: number[]): Promise<Record<number, PartyPrice>>;
  customerLedger(id: number): Promise<LedgerRow[]>;
  paymentSave(p: { customer_id: number; amount: number; mode: string; note: string; date?: string }): Promise<number>;
  paymentDelete(id: number): Promise<void>;
  duesList(): Promise<DueRow[]>;

  saleCreate(s: SaleInput): Promise<{ id: number; bill_no: string; total: number }>;
  saleList(f: SaleFilter): Promise<SaleRow[]>;
  saleGet(id: number): Promise<Sale | null>;
  saleReturn(r: ReturnInput): Promise<{ refund: number; to_account: number }>;
  printBill(id: number): Promise<{ ok: boolean; error?: string }>;
  saveBillPdf(id: number): Promise<{ ok: boolean; path?: string; error?: string }>;

  repairList(status: string, q: string): Promise<Repair[]>;
  repairGet(id: number): Promise<Repair | null>;
  repairSave(r: RepairInput): Promise<number>;
  repairSetStatus(id: number, status: RepairStatus): Promise<void>;
  repairDeliver(id: number, pay: { mode: string; paid: number }): Promise<{ id: number; bill_no: string; total: number }>;

  dashboard(): Promise<DashboardData>;
  salesDaily(from: string, to: string): Promise<DayTotal[]>;
  tierReport(from: string, to: string): Promise<TierRow[]>;
  gstReport(from: string, to: string): Promise<GstRow[]>;
  profitReport(from: string, to: string): Promise<ProfitRow[]>;
  activityList(from: string, to: string, q: string): Promise<ActivityRow[]>;

  exportCsv(name: string, rows: (string | number)[][]): Promise<{ ok: boolean; path?: string }>;
  backupNow(): Promise<{ ok: boolean; path?: string; error?: string }>;
  backupStatus(): Promise<BackupStatus>;
  restoreBackup(): Promise<{ ok: boolean; error?: string }>;
  chooseFolder(title: string): Promise<string>;
  dataFolder(): Promise<string>;
}

/* ---------- purchase import (CSV / PDF) ---------- */

export interface PurchaseImportRow {
  /** the row in the file (the header is row 1) */
  line: number;
  name: string;
  sku: string;
  barcode: string;
  /** the product this row matched, or null when it is new */
  product_id: number | null;
  qty: number;
  rate: number;
  gst_rate: number;
  customer_price: number;
  technician_price: number;
  serial_nos: string[];
  track_serial: boolean;
  hsn: string;
  brand: string;
  category: string;
  issues: string[];
}
export interface PurchaseImportResult {
  ok: boolean;
  rows: PurchaseImportRow[];
  fileName?: string;
  error?: string;
}

/* ---------- udhar (credit) ---------- */

/** A bill with money still owed on it. */
export interface UdharBill {
  sale_id: number;
  bill_no: string;
  bill_date: string;
  customer_id: number;
  customer_name: string;
  phone: string;
  tier: PriceTier;
  total: number;
  paid: number;
  due: number;
  days: number;
}
