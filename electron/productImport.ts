import fs from "node:fs";
import path from "node:path";
import type { ProductImportResult, ProductImportRow } from "@shared/types";
import { getDb } from "./db";
import electron from "./electronRequire";
import { moveStock, saveProduct } from "./products";
import { parseCsv } from "./purchaseImport";
import { UserError, r2 } from "./util";

const { dialog } = electron;

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]/g, "");

/** Column names shops and suppliers actually use, mapped to our fields. */
const ALIASES: Record<string, string[]> = {
  name: ["name", "product", "productname", "item", "itemname", "description", "particulars", "productdescription"],
  brand: ["brand", "make", "manufacturer", "mfr", "company"],
  model: ["model", "modelno", "modelname"],
  category: ["category", "type", "group"],
  sku: ["sku", "code", "itemcode", "productcode", "partno", "partnumber"],
  barcode: ["barcode", "ean", "upc"],
  hsn: ["hsn", "hsncode"],
  gst: ["gst", "gst%", "gstrate", "tax", "tax%", "taxrate", "igst%"],
  unit: ["unit", "uom"],
  warranty: ["warranty", "warrantymonths", "warranty(months)", "warrantyinmonths"],
  serial: ["trackserialyesno", "trackserial", "serialtracked", "tracksn", "serialtrack", "hasserial", "imeitracked"],
  service: ["service", "isservice"],
  customer_price: ["customerprice", "sellingprice", "saleprice", "mrp", "retailprice", "price", "sp"],
  technician_price: ["technicianprice", "techprice", "dealerprice", "tradeprice", "wholesaleprice", "wsp"],
  cost: ["cost", "costprice", "purchaserate", "purchaseprice", "rate", "buyingprice"],
  min_stock: ["minstock", "reorderlevel", "reorder", "minimumstock", "safetystock", "lowstock"],
  rack: ["rack", "shelf", "location"],
  qty: ["qty", "quantity", "stock", "openingstock", "openingqty", "onhand", "instock"],
  serials: ["serial", "serials", "serialno", "serialnos", "serialnumber", "serialnumbers", "imei", "imeino"],
};

function columnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const k = key(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (map[field] === undefined && names.map(key).includes(k)) map[field] = i;
    }
  });
  return map;
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[₹,\s%]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const yes = (v: string) => /^(y|yes|true|1|x)$/i.test(v.trim());

type Existing = { id: number; name: string; sku: string; barcode: string };

export function productsFromTable(table: string[][], fileName: string): ProductImportResult {
  const [header, ...body] = table;
  if (!header || body.length === 0) return { ok: false, rows: [], fileName, error: "The file is empty" };
  const col = columnMap(header);
  if (col.name === undefined) return { ok: false, rows: [], fileName, error: "Could not find a Product / Name column. Use the template (Download template) for the right column names." };

  const list = getDb().prepare("select id, name, sku, barcode from products").all() as Existing[];
  const byBarcode = new Map(list.filter((p) => p.barcode).map((p) => [p.barcode, p]));
  const bySku = new Map(list.filter((p) => p.sku).map((p) => [p.sku.toUpperCase(), p]));
  const byName = new Map(list.map((p) => [p.name.trim().toLowerCase(), p]));
  const cell = (r: string[], f: string) => (col[f] === undefined ? "" : (r[col[f]] ?? "").trim());
  const seen = new Set<string>();

  const rows: ProductImportRow[] = body.map((r, i) => {
    const name = cell(r, "name");
    const sku = cell(r, "sku");
    const barcode = cell(r, "barcode");
    const hit = (barcode && byBarcode.get(barcode)) || (sku && bySku.get(sku.toUpperCase())) || (name && byName.get(name.toLowerCase())) || null;
    const serials = [...new Set(cell(r, "serials").split(/[\s,;|/]+/).map((s) => s.trim()).filter(Boolean))];
    // a cell named "serial" holds either yes/no (track by serial) or the serial numbers themselves
    const flag = cell(r, "serial");
    const track = serials.length > 0 || (col.serial !== undefined && yes(flag));
    const isService = yes(cell(r, "service"));
    const customer = r2(num(cell(r, "customer_price")));
    const technician = r2(num(cell(r, "technician_price")));
    const qty = Math.floor(num(cell(r, "qty")));
    const issues: string[] = [];
    if (!name) issues.push("No product name");
    if (!hit && !(customer > 0)) issues.push("Customer price is missing");
    if (technician > 0 && customer > 0 && technician > customer) issues.push("Technician price is higher than customer price");
    if (track && isService) issues.push("A service cannot have serial numbers");
    if (!hit && track && serials.length > 0 && qty > 0 && serials.length !== qty) issues.push(`Quantity ${qty} but ${serials.length} serial numbers`);
    const dupKey = (barcode || sku || name).toLowerCase();
    if (dupKey && seen.has(dupKey)) issues.push("Repeated in the file");
    seen.add(dupKey);
    return {
      line: i + 2,
      id: hit?.id ?? null,
      name,
      brand: cell(r, "brand"),
      model: cell(r, "model"),
      category: cell(r, "category"),
      sku,
      barcode,
      hsn: cell(r, "hsn"),
      gst_rate: cell(r, "gst") ? num(cell(r, "gst")) : 18,
      unit: cell(r, "unit"),
      warranty_months: cell(r, "warranty") ? Math.floor(num(cell(r, "warranty"))) : 12,
      track_serial: track,
      is_service: isService,
      customer_price: customer,
      technician_price: technician,
      cost: r2(num(cell(r, "cost"))),
      min_stock: Math.floor(num(cell(r, "min_stock"))),
      rack: cell(r, "rack"),
      qty: track && serials.length ? serials.length : qty,
      serial_nos: serials,
      // an empty cell never overwrites what the shop already has
      has: Object.fromEntries(
        (["brand", "model", "category", "hsn", "gst", "unit", "warranty", "min_stock", "rack", "customer_price", "technician_price", "cost"] as const).map((f) => [f, cell(r, f) !== ""])
      ) as ProductImportRow["has"],
      issues,
    };
  });
  return { ok: true, rows, fileName };
}

export async function productCsvRead(): Promise<ProductImportResult> {
  const res = await dialog.showOpenDialog({ title: "Choose the products file (CSV)", properties: ["openFile"], filters: [{ name: "CSV file", extensions: ["csv", "txt"] }] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, rows: [] };
  const file = res.filePaths[0];
  if (fs.statSync(file).size > 10 * 1024 * 1024) throw new UserError("That file is too big (over 10 MB)");
  return productsFromTable(parseCsv(fs.readFileSync(file, "utf8")), path.basename(file));
}

/** Saves the checked rows: new products are added (with opening stock and serial numbers if given), products already in the shop
 * are updated, changing only the columns the file actually had. All or nothing. */
export function productCsvSave(rows: ProductImportRow[]): { added: number; updated: number; stocked: number } {
  const db = getDb();
  let added = 0;
  let updated = 0;
  let stocked = 0;
  db.transaction(() => {
    for (const r of rows) {
      const where = `row ${r.line} (${r.name || "no name"})`;
      try {
        const old = r.id ? (db.prepare("select * from products where id = ?").get(r.id) as Record<string, unknown> | undefined) : undefined;
        const has = r.has;
        const pick = <T,>(flag: boolean, fromFile: T, current: unknown, fallback: T): T => (flag ? fromFile : old ? (current as T) : fallback);
        const id = saveProduct({
          id: old ? r.id! : undefined,
          name: r.name,
          brand: pick(has.brand, r.brand, old?.brand, ""),
          model: pick(has.model, r.model, old?.model, ""),
          category: pick(has.category, r.category, old?.category, ""),
          sku: r.sku || (old?.sku as string) || "",
          barcode: r.barcode || (old?.barcode as string) || "",
          hsn: pick(has.hsn, r.hsn || "8517", old?.hsn, "8517"),
          gst_rate: pick(has.gst, r.gst_rate, old?.gst_rate, 18),
          unit: pick(has.unit, r.unit || "Pcs", old?.unit, "Pcs"),
          warranty_months: pick(has.warranty, r.warranty_months, old?.warranty_months, 12),
          track_serial: old ? !!old.track_serial : r.track_serial,
          is_service: old ? !!old.is_service : r.is_service,
          customer_price: pick(has.customer_price && r.customer_price > 0, r.customer_price, old?.customer_price, r.customer_price),
          technician_price: pick(has.technician_price, r.technician_price, old?.technician_price, 0),
          min_stock: pick(has.min_stock, r.min_stock, old?.min_stock, 0),
          rack: pick(has.rack, r.rack, old?.rack, ""),
          active: old ? !!old.active : true,
        });
        if (old) {
          updated += 1;
          if (has.cost && r.cost > 0) db.prepare("update products set purchase_rate = ? where id = ?").run(r.cost, id);
        } else {
          added += 1;
          if (r.cost > 0) db.prepare("update products set purchase_rate = ? where id = ?").run(r.cost, id);
          // opening stock for a new product: serial numbers make the units, otherwise the quantity
          if (r.track_serial && r.serial_nos.length) {
            for (const sn of r.serial_nos) db.prepare("insert into serials (product_id, serial_no, status) values (?, ?, 'in_stock')").run(id, sn);
            moveStock(id, r.serial_nos.length, "adjust", "import", "Opening stock from file");
            stocked += r.serial_nos.length;
          } else if (!r.track_serial && !r.is_service && r.qty > 0) {
            moveStock(id, r.qty, "adjust", "import", "Opening stock from file");
            stocked += r.qty;
          }
        }
      } catch (e) {
        if (e instanceof UserError) throw new UserError(`${where}: ${e.message}`);
        throw e;
      }
    }
  })();
  return { added, updated, stocked };
}

/** A ready-made CSV to fill in. */
export async function productTemplate(): Promise<{ ok: boolean; path?: string }> {
  const res = await dialog.showSaveDialog({ defaultPath: "products-template.csv", filters: [{ name: "CSV (opens in Excel)", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return { ok: false };
  const rows = [
    ["Product", "Brand", "Model", "Category", "SKU", "Barcode", "HSN", "GST %", "Warranty (months)", "Customer price", "Technician price", "Cost", "Reorder level", "Rack", "Opening stock", "Track serial (yes/no)", "Serial numbers"],
    ["Samsung Galaxy A15 128GB", "Samsung", "A15", "Mobiles", "SM-A15", "", "8517", "18", "12", "15999", "14800", "13200", "2", "M-1", "", "yes", "IMEI0001 IMEI0002"],
    ["Type-C Cable 1m", "Boat", "Rugged", "Accessories", "CBL-TC1", "", "8544", "18", "6", "299", "190", "120", "20", "A-3", "40", "no", ""],
  ];
  fs.writeFileSync(res.filePath, "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n"), "utf8");
  return { ok: true, path: res.filePath };
}
