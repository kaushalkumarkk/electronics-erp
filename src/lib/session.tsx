import { createContext, useContext } from "react";
import type { Permission, Session } from "@shared/types";

/** The signed-in person, available to every screen. `can()` only decides what to show — the back end checks again. */
export interface SessionCtx {
  session: Session;
  can: (p: Permission) => boolean;
  isSuperadmin: boolean;
  signOut: () => void;
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<SessionCtx | null>(null);

export function useSession(): SessionCtx {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside the signed-in app");
  return ctx;
}
