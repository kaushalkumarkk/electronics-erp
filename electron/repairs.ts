import { REPAIR_STATUSES, type PriceTier, type Repair, type RepairInput, type RepairStatus, type SaleLineInput } from "@shared/types";
import { getCustomer, partyPrices } from "./customers";
import { getDb } from "./db";
import { createSale } from "./sales";
import { UserError, nowLocal, r2 } from "./util";

type RRow = Omit<Repair, "parts"> & { tier: PriceTier };

function loadParts(row: RRow) {
  const db = getDb();
  const parts = db
    .prepare("select rp.product_id, p.name, rp.qty from repair_parts rp join products p on p.id = rp.product_id where rp.repair_id = ? order by rp.id")
    .all(row.id) as { product_id: number; name: string; qty: number }[];
  // parts are priced at the repair's tier (a technician's job uses technician prices) unless the party has an agreed rate
  const prices = partyPrices(row.customer_id, row.tier, parts.map((p) => p.product_id));
  return parts.map((p) => ({ ...p, unit_price: prices[p.product_id]?.price ?? 0 }));
}

export function listRepairs(status: string, q: string): Repair[] {
  const like = `%${q.trim()}%`;
  const rows = getDb()
    .prepare(
      `select * from repairs where (@status = '' or status = @status) and (@status != '' or @all = 1 or status not in ('Delivered','Cancelled'))
       and (job_no like @q or customer_name like @q or phone like @q or device like @q or serial_no like @q)
       order by id desc limit 500`
    )
    .all({ status, all: status === "" && q.trim() ? 1 : 0, q: like }) as RRow[];
  return rows.map((r) => ({ ...r, parts: loadParts(r) }));
}

export function getRepair(id: number): Repair | null {
  const r = getDb().prepare("select * from repairs where id = ?").get(id) as RRow | undefined;
  return r ? { ...r, parts: loadParts(r) } : null;
}

export function saveRepair(r: RepairInput): number {
  const db = getDb();
  if (!r.device.trim()) throw new UserError("Enter the device being repaired");
  if (!r.customer_name.trim() && !r.customer_id) throw new UserError("Enter the customer's name");
  if (r.tier !== "customer" && r.tier !== "technician") throw new UserError("Choose customer or technician price");
  if (r.estimate < 0 || r.advance < 0 || r.labour < 0) throw new UserError("Amounts cannot be negative");
  for (const p of r.parts) if (!Number.isInteger(p.qty) || p.qty <= 0) throw new UserError("Part quantity must be a whole number above 0");
  return db.transaction(() => {
    const party = r.customer_id ? getCustomer(r.customer_id) : null;
    if (r.customer_id && !party) throw new UserError("Customer not found");
    for (const p of r.parts) {
      const prod = db.prepare("select name, track_serial, is_service from products where id = ?").get(p.product_id) as { name: string; track_serial: number; is_service: number } | undefined;
      if (!prod) throw new UserError("A part no longer exists");
      if (prod.track_serial) throw new UserError(`${prod.name} is tracked by serial number. Sell it on a normal bill.`);
    }
    const f = {
      customer_id: party?.id ?? null, customer_name: party ? party.name : r.customer_name.trim(), phone: party ? party.phone : r.phone.trim(), tier: r.tier,
      device: r.device.trim(), serial_no: r.serial_no.trim(), issue: r.issue.trim(), accessories: r.accessories.trim(), estimate: r2(r.estimate),
      advance: r2(r.advance), labour: r2(r.labour), assigned_to: r.assigned_to.trim(), promised_date: r.promised_date, notes: r.notes.trim(),
    };
    let id = r.id ?? 0;
    if (id) {
      const before = db.prepare("select status from repairs where id = ?").get(id) as { status: string } | undefined;
      if (!before) throw new UserError("Job not found");
      if (before.status === "Delivered") throw new UserError("A delivered job can't be changed");
      db.prepare(
        `update repairs set customer_id=@customer_id, customer_name=@customer_name, phone=@phone, tier=@tier, device=@device, serial_no=@serial_no, issue=@issue,
         accessories=@accessories, estimate=@estimate, advance=@advance, labour=@labour, assigned_to=@assigned_to, promised_date=@promised_date, notes=@notes where id=@id`
      ).run({ ...f, id });
      db.prepare("delete from repair_parts where repair_id = ?").run(id);
    } else {
      const next = ((db.prepare("select coalesce(max(id), 0) as n from repairs").get() as { n: number }).n) + 1;
      id = Number(
        db.prepare(
          `insert into repairs (job_no, customer_id, customer_name, phone, tier, device, serial_no, issue, accessories, status, estimate, advance, labour, assigned_to, received_at, promised_date, notes)
           values (@job_no, @customer_id, @customer_name, @phone, @tier, @device, @serial_no, @issue, @accessories, 'Received', @estimate, @advance, @labour, @assigned_to, @received_at, @promised_date, @notes)`
        ).run({ ...f, job_no: `JOB-${String(next).padStart(4, "0")}`, received_at: nowLocal() }).lastInsertRowid
      );
    }
    const put = db.prepare("insert into repair_parts (repair_id, product_id, qty) values (?, ?, ?)");
    for (const p of r.parts) put.run(id, p.product_id, p.qty);
    return id;
  })();
}

export function setRepairStatus(id: number, status: RepairStatus): void {
  if (!REPAIR_STATUSES.includes(status)) throw new UserError("Unknown status");
  if (status === "Delivered") throw new UserError("Use Deliver and bill to hand the device back");
  const row = getDb().prepare("select status from repairs where id = ?").get(id) as { status: string } | undefined;
  if (!row) throw new UserError("Job not found");
  if (row.status === "Delivered") throw new UserError("A delivered job can't be changed");
  getDb().prepare("update repairs set status = ? where id = ?").run(status, id);
}

/** Hands the device back: bills the parts used (stock goes down) and the labour, counts the advance as already paid. */
export function deliverRepair(id: number, pay: { mode: string; paid: number }, userId: number): { id: number; bill_no: string; total: number } {
  const rep = getRepair(id);
  if (!rep) throw new UserError("Job not found");
  if (rep.status === "Delivered") throw new UserError("This job was already delivered");
  if (rep.status === "Cancelled") throw new UserError("This job was cancelled");
  const lines: SaleLineInput[] = rep.parts.map((p) => ({ product_id: p.product_id, qty: p.qty, unit_price: p.unit_price, disc_pct: 0 }));
  if (rep.labour > 0) {
    lines.push({ product_id: null, name: `Repair labour – ${rep.device}`, qty: 1, unit_price: rep.labour, disc_pct: 0 });
  }
  if (!lines.length) throw new UserError("Add the labour charge or the parts used before billing");
  const note = `Job ${rep.job_no}${rep.advance > 0 ? `, advance ₹${rep.advance} received earlier` : ""}`;
  return createSale(
    {
      customer_id: rep.customer_id, walkin_name: rep.customer_name, walkin_phone: rep.phone, tier: rep.tier, lines, bill_flat: 0,
      payment_mode: pay.mode || "cash", paid: r2(rep.advance + Math.max(0, pay.paid)), notes: note, repair_id: rep.id,
    },
    userId,
    { changeDiscount: true, changeTier: true, exceedCreditLimit: false }
  );
}
