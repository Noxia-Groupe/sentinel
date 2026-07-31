import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** "admin" | "user" — alimenté depuis la table User */
      role: string;
    } & DefaultSession["user"];
  }
}
