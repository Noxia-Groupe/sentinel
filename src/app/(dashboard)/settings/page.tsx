import { redirect } from "next/navigation";
import { ScrollText, ShieldCheck, User } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeysManager } from "./api-keys-manager";

export default async function SettingsPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const isAdmin = session.user.role === "admin";

  // Le journal n'est lisible que par les superadmins : il contient qui a lu
  // quel mot de passe et qui a agi sur quel équipement.
  const auditEntries = isAdmin
    ? await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 20 })
    : [];

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">
          Sentinel
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">Paramètres</h1>
        <p className="text-[#8896b4] mt-1 text-sm">Compte, accès programmatique et traçabilité</p>
      </div>

      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-[#8896b4]">Compte connecté</CardTitle>
          <User className="h-4 w-4 text-[#8896b4]" />
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Row label="Nom" value={session.user.name ?? "—"} />
          <Row label="E-mail" value={session.user.email ?? "—"} />
          <Row label="Fournisseur d'identité" value="Microsoft Entra ID" />
          <div className="flex items-center justify-between gap-4">
            <span className="text-[#8896b4]">Rôle</span>
            {isAdmin ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#0251a1]/30 bg-[#0251a1]/15 px-2 py-0.5 text-xs font-medium text-[#4d9fe8]">
                <ShieldCheck className="h-3 w-3" />
                Superadmin
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-[#132255] bg-[#080d24] px-2 py-0.5 text-xs font-medium text-[#dde1e4]">
                Utilisateur
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-[#8896b4]/70 max-w-2xl">
        Les rôles sont attribués à la connexion à partir de la variable d&apos;environnement{" "}
        <span className="font-mono">ADMIN_EMAILS</span>.
      </p>

      {isAdmin ? (
        <>
          <ApiKeysManager />

          <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-[#dde1e4] flex items-center gap-2">
                <ScrollText className="h-4 w-4 text-[#0251a1]" />
                Journal d&apos;audit
              </CardTitle>
              <CardDescription className="text-[#8896b4]">
                20 dernières actions sensibles — lectures de mots de passe, tests d&apos;accès,
                interventions à distance et traitements d&apos;alarme.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditEntries.length === 0 ? (
                <p className="text-sm text-[#8896b4] py-6 text-center">Aucune action enregistrée.</p>
              ) : (
                <ul className="divide-y divide-[#132255]">
                  {auditEntries.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-[#dde1e4] font-mono">
                          {entry.action}
                          {entry.success ? "" : " (échec)"}
                        </p>
                        <p className="text-xs text-[#8896b4]">
                          {entry.actorLabel ?? entry.actorType}
                          {entry.targetType ? ` → ${entry.targetType}` : ""}
                          {entry.ip ? ` · ${entry.ip}` : ""}
                        </p>
                      </div>
                      <span className="text-[11px] text-[#8896b4] shrink-0">
                        {entry.createdAt.toLocaleString("fr-FR")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border-[#132255] bg-[#0a1130]/60 max-w-2xl">
          <CardContent className="py-6 text-sm text-[#8896b4]">
            La gestion des clés d&apos;API et le journal d&apos;audit sont réservés aux superadmins.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[#8896b4]">{label}</span>
      <span className="text-[#dde1e4]">{value}</span>
    </div>
  );
}
