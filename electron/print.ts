import fs from "node:fs";
import path from "node:path";
import type { PaperSize } from "@shared/types";
import { billHtml } from "./billLayout";
import { getCustomer } from "./customers";
import electron from "./electronRequire";
import { getSale } from "./sales";
import { getSettings } from "./settings";

const { BrowserWindow, app, shell } = electron;

type Win = InstanceType<typeof BrowserWindow>;
type PdfSize = "A4" | "A5" | { width: number; height: number }; // an object is in inches

/** A hidden window that carries the page to the printer. It belongs to the app's own window: a window with no owner can fail
 * to show Windows' print dialog, and then the print call never finishes. */
function printWindow(options: { width: number; height: number; javascript?: boolean }): Win {
  const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  return new BrowserWindow({
    show: false,
    width: options.width,
    height: options.height,
    ...(parent ? { parent } : {}),
    webPreferences: { javascript: options.javascript ?? true },
  });
}

/** Sends the loaded page to the printer (system dialog). A printer that does not answer in three minutes is given up on, and
 * when printing fails the page is opened as a PDF so the bill is never lost. */
async function sendToPrinter(win: Win, pdfSize: PdfSize): Promise<{ ok: boolean; error?: string }> {
  const outcome = await new Promise<{ success: boolean; reason: string }>((resolve) => {
    const guard = setTimeout(() => resolve({ success: false, reason: "The printer did not respond" }), 3 * 60_000);
    win.webContents.print({ silent: false, printBackground: true, margins: { marginType: "none" } }, (success, reason) => {
      clearTimeout(guard);
      resolve({ success, reason: reason ?? "" });
    });
  });
  if (outcome.success) return { ok: true };
  if (/cancel/i.test(outcome.reason)) return { ok: false, error: "Printing cancelled" };
  const why = outcome.reason || "Could not reach the printer";
  try {
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: pdfSize, margins: { marginType: "none" } });
    const file = path.join(app.getPath("temp"), `bill-${Date.now()}.pdf`);
    fs.writeFileSync(file, pdf);
    const openError = await shell.openPath(file);
    return { ok: false, error: `${why}. The bill was opened as a PDF instead${openError ? ` (but it could not be opened: ${openError})` : ""}: print it from there.` };
  } catch {
    return { ok: false, error: why };
  }
}

function billPage(saleId: number): { html: string; paper: PaperSize; billNo: string } | null {
  const sale = getSale(saleId);
  if (!sale) return null;
  const s = getSettings();
  const due = sale.total - sale.paid;
  const balance = due > 0 && sale.customer_id ? getCustomer(sale.customer_id)?.balance : undefined;
  return { html: billHtml(sale, s, s.paper, balance), paper: s.paper, billNo: sale.bill_no };
}

export async function printBill(saleId: number): Promise<{ ok: boolean; error?: string }> {
  const page = billPage(saleId);
  if (!page) return { ok: false, error: "Bill not found" };
  const win = printWindow({ width: 700, height: 900 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page.html)}`);
    let pdfSize: PdfSize;
    if (page.paper === "80mm") {
      const px = (await win.webContents.executeJavaScript("document.documentElement.scrollHeight")) as number;
      const mm = Math.ceil((px / 96) * 25.4) + 8;
      await win.webContents.insertCSS(`@page { size: 80mm ${mm}mm; margin: 0; }`);
      pdfSize = { width: 80 / 25.4, height: mm / 25.4 };
    } else {
      pdfSize = page.paper;
      await win.webContents.insertCSS(`@page { size: ${page.paper}; margin: 0; }`);
    }
    return await sendToPrinter(win, pdfSize);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not print" };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/** The bill as a PDF in Documents\Bills, named by its number, shown in Explorer so it can be sent on WhatsApp or e-mail. */
export async function saveBillPdf(saleId: number): Promise<{ ok: boolean; path?: string; error?: string }> {
  const page = billPage(saleId);
  if (!page) return { ok: false, error: "Bill not found" };
  const win = printWindow({ width: 900, height: 1200 });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page.html)}`);
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: page.paper === "80mm" ? "A5" : page.paper, margins: { marginType: "none" } });
    const dir = path.join(app.getPath("documents"), "Bills");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${page.billNo.replace(/[^\w.-]+/g, "_")}.pdf`);
    fs.writeFileSync(file, pdf);
    shell.showItemInFolder(file);
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not make the PDF" };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}

/** Prints a page a screen built (statement, job card) on A4 or A5. */
export async function printHtml(html: string, paper: PaperSize): Promise<{ ok: boolean; error?: string }> {
  const size = paper === "80mm" ? "A5" : paper;
  const win = printWindow({ width: 900, height: 1200, javascript: false });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.insertCSS(`@page { size: ${size}; margin: 10mm; }`);
    return await sendToPrinter(win, size);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not print" };
  } finally {
    if (!win.isDestroyed()) win.close();
  }
}
