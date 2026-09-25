import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** "superadmin" | "user" — calculé à chaque requête (src/lib/access.ts) */
      role: string;
      /** Vrai si l'adresse a perdu l'accès (bannie, retirée de la liste). */
      denied?: boolean;
    } & DefaultSession["user"];
  }
}
