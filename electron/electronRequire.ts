import { createRequire } from "node:module";

// Node's ESM loader can't statically analyze the "electron" package's exports
// (it isn't a normal CJS file — Electron injects the module via a native hook),
// so any `import ... from "electron"` crashes at link time with
// "Cannot read properties of undefined (reading 'exports')". Loading it through
// require() instead sidesteps that static analysis entirely.
type ElectronModule = typeof import("electron");

const nodeRequire = typeof require !== "undefined" ? require : createRequire(import.meta.url);
const electron = nodeRequire("electron") as ElectronModule;

export default electron;
