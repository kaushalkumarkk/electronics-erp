import type { Api } from "@shared/types";

declare global {
  interface Window {
    medApi: { call: (name: string, ...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: string; code?: string }> };
  }
}

/** `await api.saleCreate(...)` — runs in the app's back end. A refused call throws an Error with a message fit to show. */
export const api = new Proxy({} as Api, {
  get: (_t, name: string) =>
    async (...args: unknown[]) => {
      const res = await window.medApi.call(name, ...args);
      // the licence ended while the app was open: the app shows its lock screen
      if (res.code === "licence") window.dispatchEvent(new Event("licence-locked"));
      if (!res.ok) throw new Error(res.error || "Something went wrong");
      return res.value;
    },
});
