import type { PriceSource, PriceTier, ReturnInput, Sale, SaleFilter, SaleInput, SaleItem, SaleRow } from "@shared/types";
import { billTotals } from "@shared/pricing";
import { getCustomer, partyPrices } from "./customers";
import { getDb } from "./db";
import { moveStock } from "./products";
import { getSettings, shopState } from "./settings";
import { UserError, addMonths, nextDay, nowLocal, r2, todayLocal } from "./util";

export interface SaleRights {
  /** may type a different price or a discount on a line */
  changeDiscount: boolean;
  /** may bill a party at the other price tier than their own */
  changeTier: boolean;
  /** may sell on credit beyond the party's credit limit */
  exceedCreditLimit: boolean;
}

interface PRow {
  id: number;
  name: string;
  hsn: string;
  gst_rate: number;
  qty: number;
  customer_price: number;
  technician_price: number;
  purchase_rate: number;
  warranty_months: number;
  track_serial: number;
  is_service: number;
  active: number;
}

/** The tier a bill is expected to use: the saved party's own type, or the shop's default for a walk-in. */
function expectedTier(customerType: PriceTier | null): PriceTier {
  return customerType ?? getSettings().default_tier;
}

/** Makes a bill. Everything is checked again here — the price on each line against the party's price, stock, serial numbers,
 * credit limit — whatever the screen showed. Both list prices are kept on every line next to the price used. */
export function createSale(s: SaleInput, userId: number, rights: SaleRights): { id: number; bill_no: string; total: number } {
  if (!s.lines.length) throw new UserError("Add at least one item");
  if (s.tier !== "customer" && s.tier !== "technician") throw new UserError("Choose customer or technician price");
  const db = getDb();
  const settings = getSettings();

  return db.transaction(() => {
    const party = s.customer_id ? getCustomer(s.customer_id) : null;
    if (s.customer_id && !party) throw new UserError("The selected customer was not found");
    if (party && !party.active) throw new UserError(`${party.name} is switched off`);
    if (s.tier !== expectedTier(party ? party.type : null) && !rights.changeTier) {
      throw new UserError("You can't change the price type on this bill. Ask the Super Admin.");
    }

    const productIds = [...new Set(s.lines.filter((l) => l.product_id != null).map((l) => l.product_id as number))];
    const prices = partyPrices(s.customer_id, s.tier, productIds);
    const products = new Map<number, PRow>();
    for (const id of productIds) {
      const p = db.prepare("select * from products where id = ?").get(id) as PRow | undefined;
      if (!p) throw new UserError("A product on this bill no longer exists");
      products.set(id, p);
    }

    // the same product on two lines still has to fit in stock together
    const wanted = new Map<number, number>();
    const seenSerials = new Set<string>();
    const lines = s.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new UserError("Quantity must be a whole number above 0");
      if (!(l.unit_price >= 0)) throw new UserError("Price cannot be negative");
      if (!(l.disc_pct >= 0 && l.disc_pct <= 100)) throw new UserError("Discount must be between 0 and 100%");
      if (l.product_id == null) {
        const name = (l.name ?? "").trim();
        if (!name) throw new UserError("Give the service line a description");
        if (l.disc_pct > 0 && !rights.changeDiscount) throw new UserError("You can't give a discount. Ask the Super Admin.");
        return { ...l, name, hsn: "9987", gst_rate: l.gst_rate ?? settings.service_gst, customer_price: l.unit_price, technician_price: l.unit_price, source: "service" as PriceSource | "manual" | "service", cost: 0, warranty: 0, track: false, service: true, serials: [] as string[] };
      }
      const p = products.get(l.product_id)!;
      if (!p.active) throw new UserError(`${p.name} is switched off`);
      const expected = prices[p.id];
      const samePrice = Math.abs(l.unit_price - expected.price) < 0.005;
      if ((!samePrice || l.disc_pct > 0) && !rights.changeDiscount) {
        throw new UserError(`${p.name}: the price is ${expected.price.toFixed(2)} for this buyer. You can't change the price or give a discount. Ask the Super Admin.`);
      }
      const serials = (l.serial_nos ?? []).map((x) => x.trim()).filter(Boolean);
      if (!p.is_service) {
        wanted.set(p.id, (wanted.get(p.id) ?? 0) + l.qty);
        if (p.track_serial) {
          if (serials.length !== l.qty) throw new UserError(`${p.name}: pick ${l.qty} serial number(s) (you picked ${serials.length})`);
          for (const sn of serials) {
            const key = `${p.id}:${sn}`;
            if (seenSerials.has(key)) throw new UserError(`${p.name}: serial ${sn} is on the bill twice`);
            seenSerials.add(key);
            const row = db.prepare("select status from serials where product_id = ? and serial_no = ?").get(p.id, sn) as { status: string } | undefined;
            if (!row || row.status !== "in_stock") throw new UserError(`${p.name}: serial ${sn} is not in stock`);
          }
        }
      }
      return {
        ...l, name: p.name, hsn: p.hsn, gst_rate: p.gst_rate, customer_price: p.customer_price, technician_price: p.technician_price,
        source: (samePrice ? expected.source : "manual") as PriceSource | "manual" | "service", cost: p.purchase_rate, warranty: p.warranty_months,
        track: !!p.track_serial, service: !!p.is_service, serials,
      };
    });
    for (const [id, qty] of wanted) {
      const p = products.get(id)!;
      if (qty > p.qty) throw new UserError(`${p.name}: only ${p.qty} in stock`);
    }

    const shop = shopState();
    const interstate = !!party && !!party.state.trim() && !!shop && party.state.trim().toLowerCase() !== shop;
    const totals = billTotals(lines.map((l) => ({ unit_price: l.unit_price, qty: l.qty, disc_pct: l.disc_pct, gst_rate: l.gst_rate })), s.bill_flat || 0, interstate);
    if ((s.bill_flat || 0) > 0 && !rights.changeDiscount) throw new UserError("You can't give a discount. Ask the Super Admin.");
    if (totals.total <= 0) throw new UserError("The bill total is zero");

    const paid = r2(Math.min(Math.max(0, s.paid), totals.total));
    const due = r2(totals.total - paid);
    if (due > 0) {
      if (!party) throw new UserError("Choose a saved customer to put the balance on their account, or take the full payment");
      if (party.credit_limit > 0 && party.balance + due > party.credit_limit && !rights.exceedCreditLimit) {
        throw new UserError(`${party.name}'s credit limit of ₹${party.credit_limit} would be crossed. Take more payment or ask the Super Admin.`);
      }
    }

    const seq = ((db.prepare("select coalesce(max(bill_seq), 0) as n from sales").get() as { n: number }).n) + 1;
    const billNo = `${settings.bill_prefix}${String(seq).padStart(5, "0")}`;
    const now = nowLocal();
    const walkName = s.walkin_name.trim();
    const saleId = Number(
      db.prepare(
        `insert into sales (bill_seq, bill_no, bill_date, customer_id, customer_name, customer_phone, customer_gstin, customer_address, tier, interstate,
          taxable, cgst, sgst, igst, bill_flat, round_off, total, paid, payment_mode, notes, user_id, repair_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        seq, billNo, now, party?.id ?? null, party ? party.name : walkName || "Walk-in", party ? party.phone : s.walkin_phone.trim(), party?.gstin ?? "", party?.address ?? "",
        s.tier, interstate ? 1 : 0, totals.taxable, totals.cgst, totals.sgst, totals.igst, r2(s.bill_flat || 0), totals.round_off, totals.total, paid,
        s.payment_mode || "cash", s.notes.trim(), userId, s.repair_id ?? null
      ).lastInsertRowid
    );

    const putItem = db.prepare(
      `insert into sale_items (sale_id, product_id, name, hsn, qty, unit_price, customer_price, technician_price, price_source, disc_pct, gst_rate, taxable, gst, amount, cost, warranty_months)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    lines.forEach((l, i) => {
      const c = totals.lines[i];
      const itemId = Number(putItem.run(saleId, l.product_id, l.name, l.hsn, l.qty, r2(l.unit_price), l.customer_price, l.technician_price, l.source, l.disc_pct, l.gst_rate, c.taxable, c.gst, c.amount, l.cost, l.warranty).lastInsertRowid);
      if (l.product_id != null && !l.service) {
        moveStock(l.product_id, -l.qty, "sale", billNo);
        if (l.track) {
          const end = l.warranty > 0 ? addMonths(todayLocal(), l.warranty) : "";
          for (const sn of l.serials) db.prepare("update serials set status = 'sold', sale_item_id = ?, warranty_end = ? where product_id = ? and serial_no = ?").run(itemId, end, l.product_id, sn);
        }
      }
    });
    if (s.repair_id) {
      db.prepare("update repairs set status = 'Delivered', delivered_at = ?, sale_id = ? where id = ?").run(now, saleId, s.repair_id);
    }
    return { id: saleId, bill_no: billNo, total: totals.total };
  })();
}

export function listSales(f: SaleFilter): SaleRow[] {
  const like = `%${f.q.trim()}%`;
  return getDb()
    .prepare(
      `select s.id, s.bill_no, s.bill_date, s.customer_name, s.tier, s.total, s.paid, s.payment_mode,
              coalesce((select sum(r.amount) from sale_returns r where r.sale_id = s.id), 0) as returned
       from sales s
       where s.bill_date >= @from and s.bill_date < @to and (s.bill_no like @q or s.customer_name like @q or s.customer_phone like @q)
         and (@tier = '' or s.tier = @tier)
       order by s.id desc limit 1000`
    )
    .all({ from: f.from, to: nextDay(f.to), q: like, tier: f.tier ?? "" }) as SaleRow[];
}

export function getSale(id: number): Sale | null {
  const db = getDb();
  const row = db
    .prepare("select s.*, coalesce(u.name, '') as user_name from sales s left join users u on u.id = s.user_id where s.id = ?")
    .get(id) as (Omit<Sale, "interstate" | "items"> & { interstate: number }) | undefined;
  if (!row) return null;
  const items = (db.prepare("select * from sale_items where sale_id = ? order by id").all(id) as (Omit<SaleItem, "serial_nos">)[]).map((i) => ({
    ...i,
    serial_nos: (db.prepare("select serial_no from serials where sale_item_id = ? order by serial_no").all(i.id) as { serial_no: string }[]).map((r) => r.serial_no),
  }));
  return { ...row, interstate: !!row.interstate, items };
}

/** Takes goods back. The refund is worked from what the customer actually paid for each unit (after discounts). Whatever the
 * customer still owed on the bill is cleared first; the rest is paid back, or kept as a credit on the account. */
export function returnSale(r: ReturnInput, userId: number): { refund: number; to_account: number } {
  if (!r.lines.length) throw new UserError("Choose what is being returned");
  if (!r.reason.trim()) throw new UserError("Give a reason for the return");
  const db = getDb();
  return db.transaction(() => {
    const sale = getSale(r.sale_id);
    if (!sale) throw new UserError("Bill not found");
    let amount = 0;
    for (const l of r.lines) {
      const item = sale.items.find((i) => i.id === l.sale_item_id);
      if (!item) throw new UserError("A returned line is not on this bill");
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new UserError("Return quantity must be a whole number above 0");
      if (l.qty > item.qty - item.returned_qty) throw new UserError(`${item.name}: only ${item.qty - item.returned_qty} left to return`);
      amount += r2((item.amount * l.qty) / item.qty);
      if (item.product_id != null) {
        const p = db.prepare("select is_service, track_serial from products where id = ?").get(item.product_id) as { is_service: number; track_serial: number };
        if (!p.is_service) {
          if (p.track_serial) {
            const sns = (l.serial_nos ?? []).map((x) => x.trim()).filter(Boolean);
            if (sns.length !== l.qty) throw new UserError(`${item.name}: choose ${l.qty} serial number(s) being returned`);
            for (const sn of sns) {
              if (!item.serial_nos.includes(sn)) throw new UserError(`${item.name}: serial ${sn} was not sold on this bill`);
              db.prepare("update serials set status = 'in_stock', sale_item_id = null, warranty_end = '' where product_id = ? and serial_no = ?").run(item.product_id, sn);
            }
          }
          moveStock(item.product_id, l.qty, "return", sale.bill_no, r.reason.trim());
        }
      }
      db.prepare("update sale_items set returned_qty = returned_qty + ? where id = ?").run(l.qty, item.id);
    }
    amount = r2(amount);
    const priorToAccount = (db.prepare("select coalesce(sum(to_account), 0) as n from sale_returns where sale_id = ?").get(sale.id) as { n: number }).n;
    const owed = Math.max(0, r2(sale.total - sale.paid - priorToAccount));
    let toAccount = 0;
    if (sale.customer_id) toAccount = r.refund_mode === "credit-note" ? amount : Math.min(amount, owed);
    else if (r.refund_mode === "credit-note") throw new UserError("A credit note needs a saved customer");
    db.prepare("insert into sale_returns (sale_id, date, amount, to_account, refund_mode, reason, user_id) values (?, ?, ?, ?, ?, ?, ?)")
      .run(sale.id, nowLocal(), amount, r2(toAccount), r.refund_mode, r.reason.trim(), userId);
    return { refund: r2(amount - toAccount), to_account: r2(toAccount) };
  })();
}
