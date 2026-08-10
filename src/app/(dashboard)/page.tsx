import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle,
  Server,
  Shield,
  WifiOff,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { alarmStats } from "@/lib/alarm-service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityDot, StatusBadge } from "@/components/alarm-badges";

export default async function DashboardPage() {
  const session = await auth();

  const [nvrCount, onlineCount, offlineNvrs, clientCount, alarms, recent] = await Promise.all([
    prisma.nvr.count(),
    prisma.nvr.count({ where: { status: "online" } }),
    prisma.nvr.findMany({
      where: { status: "offline" },
      orderBy: { lastSeen: "desc" },
      take: 5,
      select: { id: true, name: true, lastSeen: true, client: { select: { name: true } } },
    }),
    prisma.client.count(),
    alarmStats(),
    prisma.nvrEvent.findMany({
      where: { status: { in: ["new", "acknowledged", "in_progress"] } },
      orderBy: { receivedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        type: true,
        severity: true,
        status: true,
        channel: true,
        receivedAt: true,
        nvr: { select: { name: true, client: { select: { name: true } } } },
      },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
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

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          href="/alarms"
          title="Alarmes à traiter"
          value={alarms.open}
          hint={`${alarms.unacknowledged} non prises en compte`}
          icon={<Bell className="h-4 w-4 text-red-400" />}
          accent="text-red-400"
          border="hover:border-red-500/30"
        />
        <StatCard
          href="/alarms?severity=critical"
          title="Critiques en cours"
          value={alarms.critical}
          hint={`${alarms.today} événements aujourd'hui`}
          icon={<AlertTriangle className="h-4 w-4 text-amber-400" />}
          accent="text-amber-400"
          border="hover:border-amber-500/30"
        />
        <StatCard
          href="/nvrs"
          title="Enregistreurs"
          value={nvrCount}
          hint={
            nvrCount > 0
              ? `${onlineCount} en ligne — ${Math.round((onlineCount / nvrCount) * 100)}% de disponibilité`
              : "Aucun NVR"
          }
          icon={<Server className="h-4 w-4 text-[#0251a1]" />}
          accent="text-[#dde1e4]"
          border="hover:border-[#0251a1]/30"
        />
        <StatCard
          href="/clients"
          title="Clients"
          value={clientCount}
          hint="Parcs supervisés"
          icon={<Building2 className="h-4 w-4 text-green-400" />}
          accent="text-[#dde1e4]"
          border="hover:border-green-500/30"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-lg font-medium text-[#dde1e4] flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#0251a1]" />
              Alarmes en cours
            </CardTitle>
            <Link href="/alarms" className="text-xs text-[#4d9fe8] hover:underline">
              Tout voir
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#8896b4]">
                <div className="h-20 w-20 rounded-full bg-[#0251a1]/5 flex items-center justify-center mb-4">
                  <Shield className="h-10 w-10 text-[#0251a1]/20" />
                </div>
                <p className="text-sm font-medium">
                  {nvrCount === 0 ? "Aucun enregistreur configuré" : "Aucune alarme en attente"}
                </p>
                <p className="text-xs mt-1 text-[#8896b4]/70">
                  {nvrCount === 0
                    ? "Ajoutez votre premier NVR pour commencer la surveillance"
                    : "Le parc est calme"}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#132255]">
                {recent.map((event) => (
                  <li key={event.id}>
                    <Link
                      href="/alarms"
                      className="flex items-center gap-3 px-6 py-3 hover:bg-[#132255]/40 transition-colors"
                    >
                      <SeverityDot severity={event.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-[#dde1e4] truncate">
                          {event.title ?? event.type}
                          {event.channel !== null ? ` — canal ${event.channel}` : ""}
                        </p>
                        <p className="text-xs text-[#8896b4] truncate">
                          {event.nvr.client?.name ? `${event.nvr.client.name} · ` : ""}
                          {event.nvr.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <StatusBadge status={event.status} />
                        <span className="text-[11px] text-[#8896b4] hidden sm:inline">
                          {event.receivedAt.toLocaleString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-medium text-[#dde1e4] flex items-center gap-2">
              <WifiOff className="h-4 w-4 text-red-400" />
              Enregistreurs hors ligne
            </CardTitle>
          </CardHeader>
          <CardContent>
            {offlineNvrs.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-[#8896b4]">
                <CheckCircle className="h-8 w-8 text-green-500/30 mb-2" />
                <p className="text-sm">Tout le parc répond</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {offlineNvrs.map((nvr) => (
                  <li key={nvr.id}>
                    <Link
                      href={`/nvrs/${nvr.id}`}
                      className="block rounded-lg border border-[#132255] bg-[#080d24] p-3 hover:border-red-500/30 transition-colors"
                    >
                      <p className="text-sm text-[#dde1e4]">{nvr.name}</p>
                      <p className="text-xs text-[#8896b4]">
                        {nvr.client?.name ? `${nvr.client.name} — ` : ""}
                        {nvr.lastSeen
                          ? `vu le ${nvr.lastSeen.toLocaleString("fr-FR")}`
                          : "jamais vu"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  href,
  title,
  value,
  hint,
  icon,
  accent,
  border,
}: {
  href: string;
  title: string;
  value: number;
  hint: string;
  icon: React.ReactNode;
  accent: string;
  border: string;
}) {
  return (
    <Link href={href}>
      <Card
        className={`border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm transition-all duration-300 h-full ${border}`}
      >
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-[#8896b4]">{title}</CardTitle>
          <div className="h-9 w-9 rounded-lg bg-[#080d24] flex items-center justify-center">
            {icon}
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-3xl font-bold ${accent}`}>{value}</div>
          <p className="text-xs text-[#8896b4] mt-1">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
