import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";
import { recordLoginAttempt, resolveAccess } from "./access";

// Entra ID publie son issuer SANS slash final
// (ex: https://login.microsoftonline.com/<tenant>/v2.0). oauth4webapi compare la
// valeur du document de découverte à celle configurée, caractère par caractère :
// un slash final fait échouer la connexion. On normalise donc ici.
const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim().replace(/\/+$/, "");

/** Page affichée à un compte Microsoft valide mais non autorisé sur la plateforme. */
export const ACCESS_DENIED_PATH = "/auth/denied";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET!,
      ...(issuer ? { issuer } : {}),
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  callbacks: {
    // S'exécute AVANT la création de l'utilisateur en base : une adresse hors
    // liste (ou bannie) n'obtient ni compte ni session.
    async signIn({ user, profile }) {
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
        session.user.role = decision.allowed ? decision.role : "user";
        session.user.denied = !decision.allowed;
      }
      return session;
    },
  },
});
