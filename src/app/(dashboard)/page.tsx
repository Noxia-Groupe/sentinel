import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Server, CheckCircle, AlertTriangle, Shield, Activity } from "lucide-react";
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">
            Sentinel
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">
            Bienvenue, {session?.user?.name?.split(" ")[0]}
          </h1>
          <p className="text-[#8896b4] mt-1 text-sm">
            Centre opérationnel de vidéosurveillance
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#0251a1]/10 border border-[#0251a1]/20">
          <Activity className="h-3.5 w-3.5 text-[#0251a1]" />
          <span className="text-xs font-medium text-[#0251a1]">Système opérationnel</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm hover:border-[#0251a1]/30 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#8896b4]">
              Enregistreurs
            </CardTitle>
            <div className="h-9 w-9 rounded-lg bg-[#0251a1]/10 flex items-center justify-center">
              <Server className="h-4 w-4 text-[#0251a1]" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#dde1e4]">{nvrCount}</div>
            <p className="text-xs text-[#8896b4] mt-1">NVR enregistrés</p>
          </CardContent>
        </Card>

        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm hover:border-green-500/30 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#8896b4]">
              En ligne
            </CardTitle>
            <div className="h-9 w-9 rounded-lg bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="h-4 w-4 text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">{onlineCount}</div>
            <p className="text-xs text-[#8896b4] mt-1">
              {nvrCount > 0
                ? `${Math.round((onlineCount / nvrCount) * 100)}% de disponibilité`
                : "Aucun NVR"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm hover:border-amber-500/30 transition-all duration-300">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-[#8896b4]">
              Événements
            </CardTitle>
            <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-400">
              {eventsToday}
            </div>
            <p className="text-xs text-[#8896b4] mt-1">Aujourd&apos;hui</p>
          </CardContent>
        </Card>
      </div>

      {/* Activité récente */}
      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-medium text-[#dde1e4] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#0251a1]" />
            Activité récente
          </CardTitle>
        </CardHeader>
        <CardContent>
          {nvrCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#8896b4]">
              <div className="h-20 w-20 rounded-full bg-[#0251a1]/5 flex items-center justify-center mb-4">
                <Shield className="h-10 w-10 text-[#0251a1]/20" />
              </div>
              <p className="text-sm font-medium">Aucun enregistreur configuré</p>
              <p className="text-xs mt-1 text-[#8896b4]/70">
                Ajoutez votre premier NVR pour commencer la surveillance
              </p>
            </div>
          ) : (
            <p className="text-sm text-[#8896b4]">
              {nvrCount} enregistreur{nvrCount > 1 ? "s" : ""} configuré
              {nvrCount > 1 ? "s" : ""} — {onlineCount} en ligne
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
