"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccessRole } from "@/lib/access";

/**
 * Rôle de l'utilisateur connecté, fourni par le layout du tableau de bord.
 *
 * Ne sert qu'à masquer dans l'interface ce que l'API refuserait de toute
 * façon : la décision reste côté serveur (src/lib/session.ts).
 */
const RANK: Record<AccessRole, number> = { viewer: 0, operator: 1, admin: 2, superadmin: 3 };

const RoleContext = createContext<AccessRole>("viewer");

export function RoleProvider({ role, children }: { role: AccessRole; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): AccessRole {
  return useContext(RoleContext);
}

/** Vrai si le rôle courant accorde au moins `minimum`. */
export function useCan(minimum: AccessRole): boolean {
  return RANK[useRole()] >= RANK[minimum];
}
