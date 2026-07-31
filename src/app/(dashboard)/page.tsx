import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Shield, Server, AlertTriangle, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const session = await auth();
  const [nvrCount, onlineCount, eventsToday] = await Promise.all([
    prisma.nvr.count(),
    prisma.nvr.count({ where: { status: "online" } }),
    prisma.nvrEvent.count({
      where: {
        receivedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          Bienvenue, {session?.user?.name?.split(" ")[0]}
        </h1>
        <p className="text-zinc-400 mt-1">
          Centre de contrôle des enregistreurs Dahua
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Enregistreurs
            </CardTitle>
            <Server className="h-4 w-4 text-zinc-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-zinc-100">{nvrCount}</div>
            <p className="text-xs text-zinc-500 mt-1">NVR enregistrés</p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              En ligne
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">{onlineCount}</div>
            <p className="text-xs text-zinc-500 mt-1">
              {nvrCount > 0
                ? `${Math.round((onlineCount / nvrCount) * 100)}% de disponibilité`
                : "Aucun NVR"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-zinc-400">
              Événements
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-400">
              {eventsToday}
            </div>
            <p className="text-xs text-zinc-500 mt-1">Aujourd'hui</p>
          </CardContent>
        </Card>
      </div>

      {/* Placeholder pour la liste rapide des NVR */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardHeader>
          <CardTitle className="text-lg font-medium text-zinc-100">
            Activité récente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nvrCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
              <Shield className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">Aucun enregistreur configuré</p>
              <p className="text-xs mt-1">
                Ajoutez votre premier NVR pour commencer
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              {nvrCount} enregistreur{nvrCount > 1 ? "s" : ""} configuré
              {nvrCount > 1 ? "s" : ""}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
