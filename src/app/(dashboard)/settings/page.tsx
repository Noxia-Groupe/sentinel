import { redirect } from "next/navigation";
import { ShieldCheck, User } from "lucide-react";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const isAdmin = session.user.role === "admin";

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Paramètres</h1>
        <p className="text-zinc-400 mt-1">Compte et authentification</p>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50 max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-400">Compte connecté</CardTitle>
          <User className="h-4 w-4 text-zinc-500" />
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-zinc-500">Nom</span>
            <span className="text-zinc-100">{session.user.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-zinc-500">E-mail</span>
            <span className="text-zinc-100">{session.user.email}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-zinc-500">Fournisseur d&apos;identité</span>
            <span className="text-zinc-100">Microsoft Entra ID</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-zinc-500">Rôle</span>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-300">
                <ShieldCheck className="h-3 w-3" />
                Superadmin
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
                Utilisateur
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-zinc-600 max-w-2xl">
        Les rôles sont attribués à la connexion à partir de la variable
        d&apos;environnement <span className="font-mono">ADMIN_EMAILS</span>.
      </p>
    </div>
  );
}
