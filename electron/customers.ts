import type { UdharBill, AgreedPrice, Customer, CustomerInput, DueRow, LedgerRow, PartyPrice, PriceTier } from "@shared/types";
import { resolvePrice } from "@shared/pricing";
import { getDb } from "./db";
import { UserError, r2, todayLocal } from "./util";

type CRow = Omit<Customer, "active" | "balance"> & { active: number };

/** What a party owes: opening balance + the unpaid part of each bill − the part of returns set against the account − payments received. */
const BALANCE_SQL = `
  c.opening_balance
  + coalesce((select sum(s.total - s.paid) from sales s where s.customer_id = c.id), 0)
  - coalesce((select sum(r.to_account) from sale_returns r join sales s on s.id = r.sale_id where s.customer_id = c.id), 0)
  - coalesce((select sum(p.amount) from customer_payments p where p.customer_id = c.id), 0)`;

export function listCustomers(q: string, all: boolean): Customer[] {
  const like = `%${q.trim()}%`;
  const rows = getDb()
    .prepare(
      `select c.*, ${BALANCE_SQL} as balance from customers c
       where (c.name like ? or c.phone like ? or c.shop_name like ?) ${all ? "" : "and c.active = 1"}
       order by c.name collate nocase limit 1000`
    )
    .all(like, like, like) as (CRow & { balance: number })[];
  return rows.map((r) => ({ ...r, active: !!r.active, balance: r2(r.balance) }));
}

export function getCustomer(id: number): Customer | null {
  const r = getDb().prepare(`select c.*, ${BALANCE_SQL} as balance from customers c where c.id = ?`).get(id) as (CRow & { balance: number }) | undefined;
  return r ? { ...r, active: !!r.active, balance: r2(r.balance) } : null;
}

export function saveCustomer(c: CustomerInput): number {
  const name = c.name.trim();
  if (!name) throw new UserError("Name is required");
  if (c.type !== "customer" && c.type !== "technician") throw new UserError("Choose customer or technician");
  const phone = c.phone.replace(/\s+/g, "");
  if (phone && !/^[0-9+\-]{7,15}$/.test(phone)) throw new UserError("That phone number does not look right");
  if (c.credit_limit < 0) throw new UserError("Credit limit cannot be negative");
  const db = getDb();
  const dup = phone && db.prepare("select id from customers where phone = ? and id != ?").get(phone, c.id ?? 0);
  if (dup) throw new UserError("Someone with this phone number is already saved");
  const f = {
    name, phone, type: c.type, shop_name: c.shop_name.trim(), gstin: c.gstin.trim().toUpperCase(), address: c.address.trim(), state: c.state.trim(),
    credit_limit: r2(c.credit_limit), opening_balance: r2(c.opening_balance), active: c.active ? 1 : 0,
  };
  if (c.id) {
    if (db.prepare("update customers set name=@name, phone=@phone, type=@type, shop_name=@shop_name, gstin=@gstin, address=@address, state=@state, credit_limit=@credit_limit, opening_balance=@opening_balance, active=@active where id=@id").run({ ...f, id: c.id }).changes !== 1) {
      throw new UserError("Customer not found");
    }
    return c.id;
  }
  return Number(
    db.prepare("insert into customers (name, phone, type, shop_name, gstin, address, state, credit_limit, opening_balance, active) values (@name, @phone, @type, @shop_name, @gstin, @address, @state, @credit_limit, @opening_balance, @active)").run(f).lastInsertRowid
  );
}

/** Agreed rates for one party, shown next to both list prices so the shop can see what the deal is worth. */
export function customerPrices(id: number): AgreedPrice[] {
  return getDb()
    .prepare(
      `select cp.product_id, p.name, p.customer_price, p.technician_price, cp.rate
       from customer_prices cp join products p on p.id = cp.product_id where cp.customer_id = ? order by p.name collate nocase`
    )
    .all(id) as AgreedPrice[];
}

export function saveCustomerPrice(customerId: number, productId: number, rate: number | null): void {
  const db = getDb();
  if (rate == null || rate === 0) {
    db.prepare("delete from customer_prices where customer_id = ? and product_id = ?").run(customerId, productId);
    return;
  }
  if (!(rate > 0)) throw new UserError("Enter a rate above zero, or leave it empty to remove the agreed rate");
  if (!db.prepare("select 1 from customers where id = ?").get(customerId)) throw new UserError("Customer not found");
  if (!db.prepare("select 1 from products where id = ?").get(productId)) throw new UserError("Product not found");
  db.prepare("insert into customer_prices (customer_id, product_id, rate) values (?, ?, ?) on conflict(customer_id, product_id) do update set rate = excluded.rate").run(customerId, productId, r2(rate));
}

/** The price each product sells at for this buyer. Used by the bill screen (to show it) and by createSale (to check it). */
export function partyPrices(customerId: number | null, tier: PriceTier, productIds: number[]): Record<number, PartyPrice> {
  const out: Record<number, PartyPrice> = {};
  if (!productIds.length) return out;
  const db = getDb();
  const marks = productIds.map(() => "?").join(",");
  const products = db.prepare(`select id, customer_price, technician_price from products where id in (${marks})`).all(...productIds) as { id: number; customer_price: number; technician_price: number }[];
  const agreed = new Map<number, number>();
  if (customerId) {
    for (const r of db.prepare(`select product_id, rate from customer_prices where customer_id = ? and product_id in (${marks})`).all(customerId, ...productIds) as { product_id: number; rate: number }[]) {
      agreed.set(r.product_id, r.rate);
    }
  }
  for (const p of products) out[p.id] = resolvePrice(p, tier, agreed.get(p.id));
  return out;
}

export function savePayment(p: { customer_id: number; amount: number; mode: string; note: string; date?: string }, userId: number): number {
  if (!(p.amount > 0)) throw new UserError("Enter the amount received");
  if (!getCustomer(p.customer_id)) throw new UserError("Customer not found");
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : todayLocal();
  return Number(
    getDb().prepare("insert into customer_payments (customer_id, date, amount, mode, note, user_id) values (?, ?, ?, ?, ?, ?)").run(p.customer_id, date, r2(p.amount), p.mode || "cash", p.note.trim(), userId).lastInsertRowid
  );
}

export function deletePayment(id: number): void {
  if (getDb().prepare("delete from customer_payments where id = ?").run(id).changes !== 1) throw new UserError("Payment not found");
}

/** Opening balance, then every bill (what was left unpaid), return (set against the account) and payment, with a running balance. */
export function customerLedger(id: number): LedgerRow[] {
  const db = getDb();
  const c = getCustomer(id);
  if (!c) throw new UserError("Customer not found");
  type Ev = { date: string; kind: LedgerRow["kind"]; ref: string; debit: number; credit: number };
  const ev: Ev[] = [];
  for (const s of db.prepare("select bill_date, bill_no, total, paid from sales where customer_id = ?").all(id) as { bill_date: string; bill_no: string; total: number; paid: number }[]) {
    ev.push({ date: s.bill_date, kind: "bill", ref: s.bill_no, debit: r2(s.total - s.paid), credit: 0 });
  }
  for (const r of db.prepare("select r.date, s.bill_no, r.to_account from sale_returns r join sales s on s.id = r.sale_id where s.customer_id = ? and r.to_account > 0").all(id) as { date: string; bill_no: string; to_account: number }[]) {
    ev.push({ date: r.date, kind: "return", ref: r.bill_no, debit: 0, credit: r.to_account });
  }
  for (const p of db.prepare("select date, amount, mode, id from customer_payments where customer_id = ?").all(id) as { date: string; amount: number; mode: string; id: number }[]) {
    ev.push({ date: p.date, kind: "payment", ref: `#${p.id} ${p.mode}`, debit: 0, credit: p.amount });
  }
  // same day: bills first, then returns, then payments
  const order = { opening: 0, bill: 1, return: 2, payment: 3 };
  ev.sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || order[a.kind] - order[b.kind] || a.date.localeCompare(b.date));
  let bal = c.opening_balance;
  const rows: LedgerRow[] = [{ date: "", kind: "opening", ref: "Opening balance", debit: 0, credit: 0, balance: bal }];
  for (const e of ev) {
    bal = r2(bal + e.debit - e.credit);
    rows.push({ ...e, balance: bal });
  }
  return rows;
}

/** Everyone who owes money, biggest first. */
export function duesList(): DueRow[] {
  const rows = getDb()
    .prepare(
      `select c.id as customer_id, c.name, c.phone, c.type, ${BALANCE_SQL} as balance,
              coalesce((select min(s.bill_date) from sales s where s.customer_id = c.id and s.total > s.paid), '') as oldest_bill
       from customers c where c.active = 1`
    )
    .all() as DueRow[];
  return rows.filter((r) => r.balance > 0.005).map((r) => ({ ...r, balance: r2(r.balance) })).sort((a, b) => b.balance - a.balance);
}

/** Every bill that still has money owed on it (the udhar tab), oldest first. The part of a return set against the account counts as paid. */
export function udharBills(): UdharBill[] {
  const rows = getDb()
    .prepare(
      `select s.id as sale_id, s.bill_no, s.bill_date, s.customer_id, s.customer_name, s.customer_phone as phone, s.tier, s.total, s.paid,
              s.total - s.paid - coalesce((select sum(r.to_account) from sale_returns r where r.sale_id = s.id), 0) as due
       from sales s where s.customer_id is not null and s.total > s.paid order by s.bill_date`
    )
    .all() as (Omit<UdharBill, "days"> & { due: number })[];
  const today = Date.parse(todayLocal() + "T00:00:00Z");
  return rows
    .filter((r) => r.due > 0.005)
    .map((r) => ({ ...r, due: r2(r.due), days: Math.max(0, Math.round((today - Date.parse(r.bill_date.slice(0, 10) + "T00:00:00Z")) / 86_400_000)) }));
}
