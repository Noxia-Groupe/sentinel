import NextAuth from "next-auth";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { recordLoginAttempt, resolveAccess } from "./access";
import { envInt } from "./rate-limit";

// Entra ID publie son issuer SANS slash final
// (ex: https://login.microsoftonline.com/<tenant>/v2.0). oauth4webapi compare la
// valeur du document de découverte à celle configurée, caractère par caractère :
// un slash final fait échouer la connexion. On normalise donc ici.
const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim().replace(/\/+$/, "");

/**
 * Tenant Entra attendu : le GUID de l'issuer. Sans lui, le fournisseur
 * basculerait sur le tenant `common` et n'importe quel compte Microsoft
 * pourrait tenter une connexion (et remplir la liste des demandes). La
 * plateforme refuse alors toute connexion, et `instrumentation.ts` le signale
 * au démarrage.
 */
export const EXPECTED_TENANT =
  /login\.microsoftonline\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/|$)/i
    .exec(issuer ?? "")?.[1]
    ?.toLowerCase() ?? null;

/** Page affichée à un compte Microsoft valide mais non autorisé sur la plateforme. */
export const ACCESS_DENIED_PATH = "/auth/denied";

/** Durée de vie d'une session inactive (heures) ; une session active est prolongée. */
const SESSION_MAX_AGE_HOURS = envInt("SESSION_MAX_AGE_HOURS", 12);

const baseAdapter = PrismaAdapter(prisma);

/**
 * Les jetons OAuth (access, refresh, id) ne servent à rien une fois la
 * connexion établie — la plateforme n'appelle pas Microsoft Graph ensuite. On
 * ne les conserve donc pas en base : une fuite de la base n'offre aucun accès
 * au compte Microsoft de l'utilisateur.
 */
const adapter: Adapter = {
  ...baseAdapter,
  linkAccount: (account: AdapterAccount) =>
    baseAdapter.linkAccount!({
      ...account,
      access_token: undefined,
      refresh_token: undefined,
      id_token: undefined,
      expires_at: undefined,
      session_state: undefined,
    } as AdapterAccount),
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      ...(issuer ? { issuer } : {}),
    }),
  ],
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_HOURS * 3600,
    updateAge: 3600,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    // S'exécute AVANT la création de l'utilisateur en base : une adresse hors
    // liste (ou bannie) n'obtient ni compte ni session.
    async signIn({ user, profile }) {
      if (!EXPECTED_TENANT) {
        console.error(
          "[auth] AUTH_MICROSOFT_ENTRA_ID_ISSUER doit désigner le tenant (https://login.microsoftonline.com/<GUID>/v2.0) : connexion refusée",
        );
        return "/auth/error?error=Configuration";
      }
      // Ceinture et bretelles : le jeton d'identité doit venir de ce tenant.
      const tenant = typeof profile?.tid === "string" ? profile.tid.toLowerCase() : null;
      if (tenant !== EXPECTED_TENANT) {
        console.warn(`[auth] Jeton d'un autre tenant refusé (${tenant ?? "absent"})`);
        return ACCESS_DENIED_PATH;
      }

      const email = user.email ?? (typeof profile?.email === "string" ? profile.email : null);
      const decision = await resolveAccess(email);
      await recordLoginAttempt(email, user.name, decision);
      return decision.allowed ? true : ACCESS_DENIED_PATH;
    },

    // Réévalué à chaque requête : un bannissement ou un changement de rôle
    // s'applique sans attendre l'expiration de la session.
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        const decision = await resolveAccess(session.user.email);
        session.user.role = decision.allowed ? decision.role : "viewer";
        session.user.denied = !decision.allowed;
      }
      return session;
    },
  },
});
