import electron from "./electronRequire";

const { contextBridge, ipcRenderer } = electron;

/** The only door from the screens to the app: one call function. The list of calls lives in shared/types.ts (Api). */
contextBridge.exposeInMainWorld("medApi", {
  call: (name: string, ...args: unknown[]) => ipcRenderer.invoke("api", name, args),
});
