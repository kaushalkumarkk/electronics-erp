import type Database from "better-sqlite3";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { STARTING_PERMISSIONS } from "@shared/types";
import electron from "./electronRequire";

const { app } = electron;

// better-sqlite3 is a native add-on: load it with require() so the bundled main file can always reach it.
const nodeRequire = typeof require !== "undefined" ? require : createRequire(import.meta.url);
const DatabaseCtor = nodeRequire("better-sqlite3") as typeof Database;

let db: Database.Database | null = null;

export function dbPath(): string {
  return path.join(app.getPath("userData"), "electronics-shop.db");
}

/** The shop's one database file, in the app's data folder. WAL + full sync so a power cut never corrupts it. */
export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  db = new DatabaseCtor(dbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Each entry runs once, in order. Never edit an entry that has shipped — add a new one. */
export const MIGRATIONS: string[] = [
  `
  create table settings (key text primary key, value text not null);

  create table users (
    id integer primary key,
    name text not null,
    username text not null unique,
    password_hash text not null,
    role text not null check (role in ('superadmin','admin')),
    active integer not null default 1,
    must_change_password integer not null default 0,
    created_at text not null default (datetime('now','localtime'))
  );
  create table role_permissions (role text not null, permission text not null, primary key (role, permission));
  create table user_permissions (user_id integer not null references users(id), permission text not null, primary key (user_id, permission));

  -- A product carries BOTH selling prices (GST included): customer_price for walk-in buyers, technician_price for trade buyers.
  create table products (
    id integer primary key,
    name text not null,
    brand text not null default '',
    model text not null default '',
    category text not null default '',
    sku text not null default '',
    barcode text not null default '',
    hsn text not null default '8517',
    gst_rate real not null default 18,
    unit text not null default 'Pcs',
    warranty_months integer not null default 0,
    track_serial integer not null default 0,
    is_service integer not null default 0,
    customer_price real not null default 0,
    technician_price real not null default 0,
    purchase_rate real not null default 0,   -- average cost per unit, before GST
    min_stock integer not null default 0,
    rack text not null default '',
    qty integer not null default 0,
    active integer not null default 1,
    created_at text not null default (datetime('now','localtime'))
  );
  create index products_name on products(name collate nocase);
  create index products_barcode on products(barcode);
  create index products_sku on products(sku);

  -- one row per physical unit for products that carry serial / IMEI numbers
  create table serials (
    id integer primary key,
    product_id integer not null references products(id),
    serial_no text not null,
    status text not null default 'in_stock' check (status in ('in_stock','sold','returned')),
    purchase_id integer,
    sale_item_id integer,
    warranty_end text not null default '',
    unique (product_id, serial_no)
  );
  create index serials_no on serials(serial_no);

  create table stock_moves (
    id integer primary key,
    product_id integer not null references products(id),
    at text not null,
    kind text not null,        -- purchase | sale | return | adjust
    ref text not null default '',
    qty integer not null,      -- signed
    note text not null default ''
  );
  create index stock_moves_product on stock_moves(product_id, at);

  create table suppliers (
    id integer primary key,
    name text not null,
    phone text not null default '',
    gstin text not null default '',
    address text not null default ''
  );

  create table purchases (
    id integer primary key,
    supplier_id integer not null references suppliers(id),
    invoice_no text not null,
    invoice_date text not null,
    taxable real not null,
    gst real not null,
    total real not null,
    paid integer not null default 0,
    notes text not null default '',
    created_at text not null default (datetime('now','localtime'))
  );
  create index purchases_date on purchases(invoice_date);

  create table purchase_items (
    id integer primary key,
    purchase_id integer not null references purchases(id),
    product_id integer not null references products(id),
    qty integer not null,
    rate real not null,
    gst_rate real not null,
    amount real not null
  );

  -- type 'technician' buyers are billed at the product's technician_price by default
  create table customers (
    id integer primary key,
    name text not null,
    phone text not null default '',
    type text not null default 'customer' check (type in ('customer','technician')),
    shop_name text not null default '',
    gstin text not null default '',
    address text not null default '',
    state text not null default '',
    credit_limit real not null default 0,
    opening_balance real not null default 0,
    active integer not null default 1,
    created_at text not null default (datetime('now','localtime'))
  );
  create index customers_name on customers(name collate nocase);
  create index customers_phone on customers(phone);

  -- a rate agreed with one party for one product (per unit, GST included); it beats both list prices
  create table customer_prices (
    customer_id integer not null references customers(id),
    product_id integer not null references products(id),
    rate real not null,
    primary key (customer_id, product_id)
  );

  create table customer_payments (
    id integer primary key,
    customer_id integer not null references customers(id),
    date text not null,
    amount real not null check (amount > 0),
    mode text not null default 'cash',
    note text not null default '',
    user_id integer
  );

  create table sales (
    id integer primary key,
    bill_seq integer not null unique,
    bill_no text not null unique,
    bill_date text not null,
    customer_id integer references customers(id),
    customer_name text not null default '',
    customer_phone text not null default '',
    customer_gstin text not null default '',
    customer_address text not null default '',
    tier text not null default 'customer',
    interstate integer not null default 0,
    taxable real not null,
    cgst real not null default 0,
    sgst real not null default 0,
    igst real not null default 0,
    bill_flat real not null default 0,
    round_off real not null default 0,
    total real not null,
    paid real not null default 0,
    payment_mode text not null default 'cash',
    notes text not null default '',
    user_id integer,
    repair_id integer
  );
  create index sales_date on sales(bill_date);
  create index sales_customer on sales(customer_id);

  -- the line keeps the price used AND both list prices as they were that day
  create table sale_items (
    id integer primary key,
    sale_id integer not null references sales(id),
    product_id integer references products(id),
    name text not null,
    hsn text not null default '',
    qty integer not null,
    returned_qty integer not null default 0,
    unit_price real not null,
    customer_price real not null default 0,
    technician_price real not null default 0,
    price_source text not null default 'customer',
    disc_pct real not null default 0,
    gst_rate real not null,
    taxable real not null,
    gst real not null,
    amount real not null,
    cost real not null default 0,    -- average purchase rate per unit at the time of sale
    warranty_months integer not null default 0
  );
  create index sale_items_sale on sale_items(sale_id);
  create index sale_items_product on sale_items(product_id);

  create table sale_returns (
    id integer primary key,
    sale_id integer not null references sales(id),
    date text not null,
    amount real not null,
    to_account real not null default 0,   -- part set against what the customer still owed
    refund_mode text not null default 'cash',
    reason text not null default '',
    user_id integer
  );

  create table repairs (
    id integer primary key,
    job_no text not null unique,
    customer_id integer references customers(id),
    customer_name text not null default '',
    phone text not null default '',
    tier text not null default 'customer',
    device text not null,
    serial_no text not null default '',
    issue text not null default '',
    accessories text not null default '',
    status text not null default 'Received',
    estimate real not null default 0,
    advance real not null default 0,
    labour real not null default 0,
    assigned_to text not null default '',
    received_at text not null,
    promised_date text not null default '',
    delivered_at text not null default '',
    sale_id integer,
    notes text not null default ''
  );
  create table repair_parts (
    id integer primary key,
    repair_id integer not null references repairs(id),
    product_id integer not null references products(id),
    qty integer not null
  );

  create table activity_log (
    id integer primary key,
    at text not null,
    user_id integer,
    action text not null,
    target text not null default '',
    detail text not null default ''
  );
  create index activity_at on activity_log(at);
  `,
];

function migrate(d: Database.Database): void {
  const current = d.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.transaction(() => {
      d.exec(MIGRATIONS[v]);
      if (v === 0) {
        const put = d.prepare("insert into role_permissions (role, permission) values ('admin', ?)");
        for (const p of STARTING_PERMISSIONS) put.run(p);
      }
      d.pragma(`user_version = ${v + 1}`);
    })();
  }
}
