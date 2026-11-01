import type { Product, ProductInput, Serial, SerialLookup, SellableProduct, StockMove, StockRow } from "@shared/types";
import { getDb } from "./db";
import { UserError, nowLocal, r2 } from "./util";

type PRow = Omit<Product, "track_serial" | "is_service" | "active"> & { track_serial: number; is_service: number; active: number };
const toProduct = (r: PRow): Product => ({ ...r, track_serial: !!r.track_serial, is_service: !!r.is_service, active: !!r.active });

const SEARCH = `(name like @q or brand like @q or model like @q or sku like @q or barcode like @q or category like @q)`;

export function listProducts(q: string, all: boolean): Product[] {
  const rows = getDb()
    .prepare(`select * from products where ${SEARCH} ${all ? "" : "and active = 1"} order by name collate nocase limit 2000`)
    .all({ q: `%${q.trim()}%` }) as PRow[];
  return rows.map(toProduct);
}

export function productCategories(): string[] {
  return (getDb().prepare("select distinct category from products where category != '' order by category collate nocase").all() as { category: string }[]).map((r) => r.category);
}

export function saveProduct(p: ProductInput): number {
  const name = p.name.trim();
  if (!name) throw new UserError("Product name is required");
  if (!(p.gst_rate >= 0 && p.gst_rate <= 40)) throw new UserError("GST must be between 0 and 40%");
  if (!(p.customer_price > 0)) throw new UserError("Enter the customer price");
  if (!(p.technician_price >= 0)) throw new UserError("Technician price cannot be negative");
  if (p.technician_price > 0 && p.technician_price > p.customer_price) throw new UserError("The technician price is higher than the customer price. Please check both.");
  if (p.track_serial && p.is_service) throw new UserError("A service has no serial numbers");
  if (!Number.isInteger(p.warranty_months) || p.warranty_months < 0) throw new UserError("Warranty must be whole months");
  const db = getDb();
  const dup = p.barcode.trim() && db.prepare("select id from products where barcode = ? and id != ?").get(p.barcode.trim(), p.id ?? 0);
  if (dup) throw new UserError("Another product already has this barcode");

  const f = {
    name, brand: p.brand.trim(), model: p.model.trim(), category: p.category.trim(), sku: p.sku.trim(), barcode: p.barcode.trim(),
    hsn: p.hsn.trim(), gst_rate: p.gst_rate, unit: p.unit.trim() || "Pcs", warranty_months: p.warranty_months,
    track_serial: p.track_serial ? 1 : 0, is_service: p.is_service ? 1 : 0, customer_price: r2(p.customer_price),
    technician_price: r2(p.technician_price), min_stock: Math.max(0, Math.floor(p.min_stock)), rack: p.rack.trim(), active: p.active ? 1 : 0,
  };
  if (p.id) {
    const before = db.prepare("select qty, track_serial from products where id = ?").get(p.id) as { qty: number; track_serial: number } | undefined;
    if (!before) throw new UserError("Product not found");
    if (before.track_serial !== f.track_serial && before.qty !== 0) throw new UserError("Serial tracking can only be changed while the product has no stock");
    db.prepare(
      `update products set name=@name, brand=@brand, model=@model, category=@category, sku=@sku, barcode=@barcode, hsn=@hsn, gst_rate=@gst_rate,
       unit=@unit, warranty_months=@warranty_months, track_serial=@track_serial, is_service=@is_service, customer_price=@customer_price,
       technician_price=@technician_price, min_stock=@min_stock, rack=@rack, active=@active where id=@id`
    ).run({ ...f, id: p.id });
    return p.id;
  }
  return Number(
    db.prepare(
      `insert into products (name, brand, model, category, sku, barcode, hsn, gst_rate, unit, warranty_months, track_serial, is_service,
       customer_price, technician_price, purchase_rate, min_stock, rack, active)
       values (@name, @brand, @model, @category, @sku, @barcode, @hsn, @gst_rate, @unit, @warranty_months, @track_serial, @is_service,
       @customer_price, @technician_price, @purchase_rate, @min_stock, @rack, @active)`
    ).run({ ...f, purchase_rate: r2(p.purchase_rate ?? 0) }).lastInsertRowid
  );
}

function withAvailable(rows: PRow[]): SellableProduct[] {
  const db = getDb();
  const serialCount = db.prepare("select count(*) as n from serials where product_id = ? and status = 'in_stock'");
  return rows.map((r) => {
    const p = toProduct(r);
    const available = p.is_service ? 9999 : p.track_serial ? (serialCount.get(p.id) as { n: number }).n : p.qty;
    return { ...p, available };
  });
}

/** Active products matching the box on the bill screen: name, brand, model, SKU or an exact barcode. */
export function sellableSearch(q: string): SellableProduct[] {
  const term = q.trim();
  const rows = getDb()
    .prepare(
      `select * from products where active = 1 and ${SEARCH}
       order by (barcode = @exact or sku = @exact) desc, name collate nocase limit 40`
    )
    .all({ q: `%${term}%`, exact: term }) as PRow[];
  return withAvailable(rows);
}

export function sellableByIds(ids: number[]): SellableProduct[] {
  if (!ids.length) return [];
  const rows = getDb().prepare(`select * from products where id in (${ids.map(() => "?").join(",")})`).all(...ids) as PRow[];
  return withAvailable(rows);
}

export function serialsAvailable(productId: number): Serial[] {
  return getDb().prepare("select id, product_id, serial_no, status, warranty_end from serials where product_id = ? and status = 'in_stock' order by serial_no").all(productId) as Serial[];
}

/** Find a unit by its serial / IMEI: who bought it, when, and whether it is still under warranty. */
export function serialLookup(serialNo: string): SerialLookup[] {
  const s = serialNo.trim();
  if (!s) return [];
  const rows = getDb()
    .prepare(
      `select se.id, se.product_id, se.serial_no, se.status, se.warranty_end, p.name as product_name,
              coalesce(sa.bill_no, '') as bill_no, coalesce(sa.bill_date, '') as bill_date, coalesce(sa.customer_name, '') as customer_name
       from serials se
       join products p on p.id = se.product_id
       left join sale_items si on si.id = se.sale_item_id
       left join sales sa on sa.id = si.sale_id
       where se.serial_no like ? order by se.id desc limit 20`
    )
    .all(`%${s}%`) as Omit<SerialLookup, "in_warranty">[];
  const today = nowLocal().slice(0, 10);
  return rows.map((r) => ({ ...r, in_warranty: r.status === "sold" && r.warranty_end !== "" && r.warranty_end >= today }));
}

export function stockReport(kind: "all" | "low" | "out"): StockRow[] {
  const where = kind === "out" ? "and qty <= 0" : kind === "low" ? "and qty <= min_stock" : "";
  const rows = getDb().prepare(`select * from products where active = 1 and is_service = 0 ${where} order by name collate nocase`).all() as PRow[];
  return rows.map((r) => ({ ...toProduct(r), value: r2(r.qty * r.purchase_rate) }));
}

export function stockAdjust(productId: number, newQty: number, reason: string): void {
  if (!Number.isInteger(newQty) || newQty < 0) throw new UserError("Enter the real count, as a whole number");
  if (!reason.trim()) throw new UserError("Give a reason for the correction");
  const db = getDb();
  db.transaction(() => {
    const p = db.prepare("select qty, track_serial, is_service from products where id = ?").get(productId) as { qty: number; track_serial: number; is_service: number } | undefined;
    if (!p) throw new UserError("Product not found");
    if (p.is_service) throw new UserError("A service has no stock");
    if (p.track_serial) throw new UserError("This product is tracked by serial number. Stock changes through purchases, sales and returns.");
    if (p.qty === newQty) return;
    db.prepare("update products set qty = ? where id = ?").run(newQty, productId);
    db.prepare("insert into stock_moves (product_id, at, kind, ref, qty, note) values (?, ?, 'adjust', '', ?, ?)").run(productId, nowLocal(), newQty - p.qty, reason.trim());
  })();
}

export function stockHistory(productId: number): StockMove[] {
  return getDb().prepare("select at as date, kind, ref, qty, note from stock_moves where product_id = ? order by id desc limit 300").all(productId) as StockMove[];
}

/** Moves stock for a product and writes the history line. Callers run this inside their own transaction. */
export function moveStock(productId: number, delta: number, kind: string, ref: string, note = ""): void {
  const db = getDb();
  db.prepare("update products set qty = qty + ? where id = ?").run(delta, productId);
  db.prepare("insert into stock_moves (product_id, at, kind, ref, qty, note) values (?, ?, ?, ?, ?, ?)").run(productId, nowLocal(), kind, ref, delta, note);
}
