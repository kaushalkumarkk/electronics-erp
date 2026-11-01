import type { DashboardData, DayTotal, GstRow, Permission, ProfitRow, TierRow } from "@shared/types";
import { getDb } from "./db";
import { duesList } from "./customers";
import { nextDay, r2, todayLocal } from "./util";

/** Per-line figures net of anything returned: (qty − returned) / qty of the line's value. */
const NET_Q = "(si.qty - si.returned_qty)";
const NET_AMOUNT = `(si.amount * ${NET_Q} / si.qty)`;
const NET_TAXABLE = `(si.taxable * ${NET_Q} / si.qty)`;
const NET_GST = `(si.gst * ${NET_Q} / si.qty)`;

export function salesDaily(from: string, to: string): DayTotal[] {
  const rows = getDb()
    .prepare(
      `select substr(s.bill_date, 1, 10) as date, count(distinct s.id) as bills,
              coalesce(sum(case when s.tier = 'customer' then ${NET_AMOUNT} else 0 end), 0) as customer_total,
              coalesce(sum(case when s.tier = 'technician' then ${NET_AMOUNT} else 0 end), 0) as technician_total
       from sales s join sale_items si on si.sale_id = s.id
       where s.bill_date >= ? and s.bill_date < ? group by substr(s.bill_date, 1, 10) order by date desc`
    )
    .all(from, nextDay(to)) as Omit<DayTotal, "total">[];
  return rows.map((r) => ({ ...r, customer_total: r2(r.customer_total), technician_total: r2(r.technician_total), total: r2(r.customer_total + r.technician_total) }));
}

/** How much was sold at the customer price and how much at the technician price, with the profit each brought. */
export function tierReport(from: string, to: string): TierRow[] {
  const rows = getDb()
    .prepare(
      `select s.tier, count(distinct s.id) as bills, coalesce(sum(${NET_Q}), 0) as units, coalesce(sum(${NET_AMOUNT}), 0) as sales,
              coalesce(sum(${NET_TAXABLE} - si.cost * ${NET_Q}), 0) as profit
       from sales s join sale_items si on si.sale_id = s.id
       where s.bill_date >= ? and s.bill_date < ? group by s.tier`
    )
    .all(from, nextDay(to)) as TierRow[];
  return (["customer", "technician"] as const).map((t) => {
    const r = rows.find((x) => x.tier === t);
    return { tier: t, bills: r?.bills ?? 0, units: r?.units ?? 0, sales: r2(r?.sales ?? 0), profit: r2(r?.profit ?? 0) };
  });
}

export function gstReport(from: string, to: string): GstRow[] {
  const rows = getDb()
    .prepare(
      `select si.gst_rate, coalesce(sum(${NET_TAXABLE}), 0) as taxable,
              coalesce(sum(case when s.interstate = 0 then ${NET_GST} / 2 else 0 end), 0) as cgst,
              coalesce(sum(case when s.interstate = 0 then ${NET_GST} / 2 else 0 end), 0) as sgst,
              coalesce(sum(case when s.interstate = 1 then ${NET_GST} else 0 end), 0) as igst
       from sales s join sale_items si on si.sale_id = s.id
       where s.bill_date >= ? and s.bill_date < ? group by si.gst_rate order by si.gst_rate`
    )
    .all(from, nextDay(to)) as GstRow[];
  return rows.map((r) => ({ ...r, taxable: r2(r.taxable), cgst: r2(r.cgst), sgst: r2(r.sgst), igst: r2(r.igst) }));
}

export function profitReport(from: string, to: string): ProfitRow[] {
  const rows = getDb()
    .prepare(
      `select si.name, coalesce(sum(${NET_Q}), 0) as qty, coalesce(sum(${NET_TAXABLE}), 0) as sales, coalesce(sum(si.cost * ${NET_Q}), 0) as cost
       from sales s join sale_items si on si.sale_id = s.id
       where s.bill_date >= ? and s.bill_date < ? group by si.name having qty > 0 order by sales desc`
    )
    .all(from, nextDay(to)) as Omit<ProfitRow, "profit">[];
  return rows.map((r) => ({ ...r, sales: r2(r.sales), cost: r2(r.cost), profit: r2(r.sales - r.cost) }));
}

function totalSince(from: string): { bills: number; sales: number } {
  const r = getDb()
    .prepare(
      `select count(distinct s.id) as bills, coalesce(sum(${NET_AMOUNT}), 0) as sales
       from sales s join sale_items si on si.sale_id = s.id where s.bill_date >= ? and s.bill_date < ?`
    )
    .get(from, nextDay(todayLocal())) as { bills: number; sales: number };
  return { bills: r.bills, sales: r2(r.sales) };
}

/** The home screen. Each part is filled only if the person has the permission for it, so numbers never leak. */
export function dashboard(can: (p: Permission) => boolean): DashboardData {
  const db = getDb();
  const today = todayLocal();
  const showSales = can("reports") || can("bills.view");
  const day30 = todayLocal(new Date(Date.now() - 29 * 86_400_000));
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    today: showSales ? totalSince(today) : null,
    month: showSales ? totalSince(today.slice(0, 7) + "-01") : null,
    receivable: can("payments") ? r2(duesList().reduce((s, d) => s + d.balance, 0)) : null,
    low_stock: can("stock.view") ? count("select count(*) as n from products where active = 1 and is_service = 0 and qty <= min_stock") : null,
    open_repairs: can("repairs") ? count("select count(*) as n from repairs where status not in ('Delivered','Cancelled')") : null,
    ready_repairs: can("repairs") ? count("select count(*) as n from repairs where status = 'Ready'") : null,
    last_days: can("reports") ? salesDaily(day30, today).reverse() : null,
    top_products: can("reports")
      ? (db
          .prepare(
            `select si.name, sum(${NET_Q}) as qty from sales s join sale_items si on si.sale_id = s.id
             where s.bill_date >= ? and si.product_id is not null group by si.name having qty > 0 order by qty desc limit 5`
          )
          .all(day30) as { name: string; qty: number }[])
      : null,
  };
}
