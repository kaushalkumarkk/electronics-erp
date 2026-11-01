import type { PurchaseDetail, PurchaseInput, PurchaseRow, Supplier } from "@shared/types";
import { getDb } from "./db";
import { moveStock } from "./products";
import { UserError, nextDay, r2 } from "./util";

export function listSuppliers(): Supplier[] {
  return getDb().prepare("select * from suppliers order by name collate nocase").all() as Supplier[];
}

export function saveSupplier(s: Omit<Supplier, "id"> & { id?: number }): number {
  const name = s.name.trim();
  if (!name) throw new UserError("Supplier name is required");
  const f = { name, phone: s.phone.trim(), gstin: s.gstin.trim().toUpperCase(), address: s.address.trim() };
  const db = getDb();
  if (s.id) {
    if (db.prepare("update suppliers set name=@name, phone=@phone, gstin=@gstin, address=@address where id=@id").run({ ...f, id: s.id }).changes !== 1) throw new UserError("Supplier not found");
    return s.id;
  }
  return Number(db.prepare("insert into suppliers (name, phone, gstin, address) values (@name, @phone, @gstin, @address)").run(f).lastInsertRowid);
}

/** Books a purchase invoice: adds stock (and serial numbers), moves each product's average cost, and can refresh its selling prices. */
export function savePurchase(p: PurchaseInput, _userId: number): number {
  if (!p.invoice_no.trim()) throw new UserError("Enter the supplier's invoice number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.invoice_date)) throw new UserError("Enter the invoice date");
  if (!p.lines.length) throw new UserError("Add at least one product");
  const db = getDb();
  return db.transaction(() => {
    if (!db.prepare("select 1 from suppliers where id = ?").get(p.supplier_id)) throw new UserError("Choose a supplier");
    if (db.prepare("select 1 from purchases where supplier_id = ? and invoice_no = ?").get(p.supplier_id, p.invoice_no.trim())) {
      throw new UserError("This invoice number is already entered for this supplier");
    }
    let taxable = 0;
    let gst = 0;
    const checked = p.lines.map((l) => {
      const prod = db.prepare("select * from products where id = ?").get(l.product_id) as { id: number; name: string; qty: number; purchase_rate: number; track_serial: number; is_service: number } | undefined;
      if (!prod) throw new UserError("A product on the invoice no longer exists");
      if (prod.is_service) throw new UserError(`${prod.name} is a service and cannot be purchased`);
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new UserError(`${prod.name}: quantity must be a whole number above 0`);
      if (!(l.rate >= 0)) throw new UserError(`${prod.name}: enter the purchase rate`);
      const serials = (l.serial_nos ?? []).map((s) => s.trim()).filter(Boolean);
      if (prod.track_serial) {
        if (serials.length !== l.qty) throw new UserError(`${prod.name}: enter ${l.qty} serial numbers (you entered ${serials.length})`);
        if (new Set(serials.map((s) => s.toLowerCase())).size !== serials.length) throw new UserError(`${prod.name}: a serial number is repeated`);
        for (const s of serials) {
          if (db.prepare("select 1 from serials where product_id = ? and serial_no = ?").get(prod.id, s)) throw new UserError(`${prod.name}: serial ${s} is already in the system`);
        }
      }
      const amount = r2(l.qty * l.rate);
      const g = r2((amount * l.gst_rate) / 100);
      taxable += amount;
      gst += g;
      return { l, prod, serials, amount };
    });
    taxable = r2(taxable);
    gst = r2(gst);
    const pid = Number(
      db.prepare("insert into purchases (supplier_id, invoice_no, invoice_date, taxable, gst, total, paid, notes) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(p.supplier_id, p.invoice_no.trim(), p.invoice_date, taxable, gst, r2(taxable + gst), p.paid ? 1 : 0, p.notes.trim()).lastInsertRowid
    );
    for (const { l, prod, serials, amount } of checked) {
      db.prepare("insert into purchase_items (purchase_id, product_id, qty, rate, gst_rate, amount) values (?, ?, ?, ?, ?, ?)").run(pid, prod.id, l.qty, r2(l.rate), l.gst_rate, amount);
      // average cost across what is already on the shelf and what just arrived
      const onHand = Math.max(0, prod.qty);
      const avg = onHand + l.qty > 0 ? r2((onHand * prod.purchase_rate + l.qty * l.rate) / (onHand + l.qty)) : r2(l.rate);
      db.prepare("update products set purchase_rate = ? where id = ?").run(avg, prod.id);
      moveStock(prod.id, l.qty, "purchase", p.invoice_no.trim());
      for (const s of serials) db.prepare("insert into serials (product_id, serial_no, status, purchase_id) values (?, ?, 'in_stock', ?)").run(prod.id, s, pid);
      if (l.customer_price && l.customer_price > 0) {
        const tech = l.technician_price != null && l.technician_price >= 0 ? l.technician_price : null;
        if (tech != null && tech > l.customer_price) throw new UserError(`${prod.name}: technician price is higher than the customer price`);
        db.prepare("update products set customer_price = ?, technician_price = coalesce(?, technician_price) where id = ?").run(r2(l.customer_price), tech == null ? null : r2(tech), prod.id);
      }
    }
    return pid;
  })();
}

export function listPurchases(from: string, to: string): PurchaseRow[] {
  const rows = getDb()
    .prepare(
      `select p.id, p.supplier_id, s.name as supplier, p.invoice_no, p.invoice_date, p.taxable, p.gst, p.total, p.paid
       from purchases p join suppliers s on s.id = p.supplier_id
       where p.invoice_date >= ? and p.invoice_date < ? order by p.invoice_date desc, p.id desc`
    )
    .all(from, nextDay(to)) as (Omit<PurchaseRow, "paid"> & { paid: number })[];
  return rows.map((r) => ({ ...r, paid: !!r.paid }));
}

export function getPurchase(id: number): PurchaseDetail | null {
  const db = getDb();
  const row = db
    .prepare(
      `select p.id, p.supplier_id, s.name as supplier, p.invoice_no, p.invoice_date, p.taxable, p.gst, p.total, p.paid, p.notes
       from purchases p join suppliers s on s.id = p.supplier_id where p.id = ?`
    )
    .get(id) as (Omit<PurchaseDetail, "paid" | "items"> & { paid: number }) | undefined;
  if (!row) return null;
  const items = db
    .prepare("select pi.product_id, pr.name, pi.qty, pi.rate, pi.gst_rate, pi.amount from purchase_items pi join products pr on pr.id = pi.product_id where pi.purchase_id = ?")
    .all(id) as PurchaseDetail["items"];
  return { ...row, paid: !!row.paid, items };
}
