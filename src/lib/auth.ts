import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Entra ID publie son issuer SANS slash final
// (ex: https://login.microsoftonline.com/<tenant>/v2.0). oauth4webapi compare la
// valeur du document de découverte à celle configurée, caractère par caractère :
// un slash final fait échouer la connexion. On normalise donc ici.
const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.trim().replace(/\/+$/, "");

async function promoteAdmin(email?: string | null) {
  if (!email || !ADMIN_EMAILS.includes(email.toLowerCase())) return;
  // updateMany : ne lève pas si l'utilisateur n'existe pas encore.
  await prisma.user.updateMany({
    where: { email },
    data: { role: "admin" },
  });
}

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
  events: {
    // Déclenché APRÈS la création/récupération de l'utilisateur en base, à la
    // différence du callback `signIn` qui s'exécute avant : c'est le seul
    // endroit où l'on peut écrire sur l'utilisateur dès la première connexion.
    async signIn({ user }) {
      try {
        await promoteAdmin(user.email);
      } catch (error) {
        // Ne jamais faire échouer une connexion valide sur l'attribution du rôle.
        console.error("[auth] Échec de l'attribution du rôle admin", error);
      }
    },
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
        session.user.role = dbUser?.role ?? "user";
      }
      return session;
    },
  },
});
