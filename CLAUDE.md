# CLAUDE.md

Offline Windows desktop app (Electron + React + SQLite) for billing, stock and repairs at an electronics shop. Same architecture as `E:\medical-erp` (see its CLAUDE.md for the long version).

## Commands

```
npm run dev        # Vite + Electron
npm run typecheck  # tsc -b (tsconfig.web.json for src/, tsconfig.node.json for electron/)
npm run build      # typecheck + vite build + electron-builder
```

`better-sqlite3` must be the Electron binary. If `npm install` tries to compile it, copy `node_modules` from `E:\medical-erp` or run `node ..\prebuild-install\bin.js --runtime=electron --target=32.3.3 --arch=x64 --platform=win32` inside `node_modules\better-sqlite3`.

## Architecture

- `shared/types.ts` is the contract: domain types, `PERMISSIONS`, and the `Api` interface. `shared/pricing.ts` holds price resolution and bill maths, used by both the bill screen and `createSale`.
- All UI to backend calls go through one IPC channel (`src/api.ts` Proxy -> `electron/main.ts` `handlers`). To add a call: add it to `Api`, implement it in `electron/*.ts`, register it in `handlers`. Permissions are enforced in `main.ts` with `may(...)`.
- Schema changes: append to `MIGRATIONS` in `electron/db.ts`; never edit a shipped entry.
- Throw `UserError` for messages meant for the user.

## Two prices (the core rule)

- Every product stores `customer_price` and `technician_price` (per unit, GST included). A technician price of 0 falls back to the customer price.
- A saved party has `type` (`customer` | `technician`) that sets the bill's tier. Walk-ins use `Settings.default_tier`. Changing the tier on a bill needs `billing.tier`.
- Price order (`resolvePrice`, `partyPrices` in `electron/customers.ts`): the party's agreed rate (`customer_prices`) -> the tier's price. `createSale` recomputes this and rejects a different unit price or any discount unless the user has `billing.discount`.
- Each `sale_items` row keeps the price used, both list prices as they were that day, and `price_source` (`customer`, `technician`, `agreed`, `manual`, `service`). Reports split sales by `sales.tier`.
- Repairs (`electron/repairs.ts`) price their parts by the job's tier; delivering creates a normal bill (parts + labour line) and counts the advance as paid.

## Conventions

- Money in rupees, `r2()`; bill totals round to the nearest rupee. Prices include GST (GST is extracted, never added).
- Stock is `products.qty`; serial/IMEI products also have `serials` rows (a bill must name each serial; warranty end is stored per serial). Average cost (`purchase_rate`) is updated by each purchase; `sale_items.cost` snapshots it.
- Balance = opening + unpaid part of bills - returns set against the account - payments. Interstate parties (state differs from the shop's) get IGST.
