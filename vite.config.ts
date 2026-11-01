import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const shared = { "@shared": path.resolve(__dirname, "shared") };

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main.ts",
        vite: {
          resolve: { alias: shared },
          build: { outDir: "dist-electron", rollupOptions: { external: ["better-sqlite3"] } },
        },
      },
      preload: {
        input: "electron/preload.ts",
        vite: { resolve: { alias: shared }, build: { outDir: "dist-electron" } },
      },
      renderer: {},
    }),
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "src"), ...shared } },
});
