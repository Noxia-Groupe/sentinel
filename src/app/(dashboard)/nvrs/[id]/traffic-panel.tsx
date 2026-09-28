"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader2, Network, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRate, formatVolume } from "@/lib/format-traffic";

/**
 * Consommation réseau de Sentinel pour un enregistreur : débit en cours,
 * volumes par origine, profil horaire, coût de la supervision automatique,
 * et mesure de son impact sur l'enregistreur (processeur).
 */

type Origin = "supervision" | "interventions" | "agent" | "direct" | "alarmes";
type Totals = { bytesIn: number; bytesOut: number; requests: number };
type Live = { inBps: number; outBps: number; peakBps: number; active: boolean; lastActivity: string | null };

type TrafficData = {
  live: Live;
  last24h: { totalBytes: number; byOrigin: Record<Origin, Totals> };
  last7d: { totalBytes: number; byOrigin: Record<Origin, Totals> };
  hourly: { hour: string; bytesIn: number; bytesOut: number; supervision: number }[];
  supervision: {
    enabled: boolean;
    intervalMinutes: number;
    checks24h: number;
    measuredChecks: number;
    bytesPerCheck: number | null;
    requestsPerCheck: number | null;
    averageLatencyMs: number | null;
    projectedBytesPerDay: number | null;
  };
};

type Impact = {
  cpu: {
    idle: { samples: number[]; average: number | null; max: number | null };
    duringChecks: { samples: number[]; average: number | null; max: number | null };
    deltaPoints: number | null;
  };
  perCheck: { measuredChecks: number; durationMs: number; bytesIn: number; bytesOut: number; requests: number };
  projection: {
    intervalMinutes: number;
    checksPerDay: number;
    bytesPerDay: number;
    bytesPerMonth: number;
    averageBps: number;
    busyPercent: number;
  };
  verdict: { level: "negligeable" | "faible" | "notable"; text: string };
};

const ORIGINS: { key: Origin; label: string }[] = [
  { key: "supervision", label: "Supervision automatique" },
  { key: "interventions", label: "Interventions et tests" },
  { key: "agent", label: "Agent (API / Hermes)" },
  { key: "direct", label: "Direct vidéo" },
  { key: "alarmes", label: "Alarmes reçues" },
];

/** Deux séries validées (daltonisme, contraste) sur la surface sombre. */
const SUPERVISION_COLOR = "#2f86d6";
const OTHER_COLOR = "#c7851a";

const LIVE_REFRESH_MS = 5_000;

/** Débit en cours, pour l'en-tête de la fiche. */
export function LiveTrafficBadge({ nvrId }: { nvrId: string }) {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`/api/nvrs/${nvrId}/traffic?live=1`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && !cancelled) setLive((await res.json()).live);
    };
    void load();
    const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [nvrId]);

  if (!live) return null;
  return (
    <Badge
      title="Trafic échangé par Sentinel avec l'enregistreur (15 dernières secondes)"
      className={
        live.active
          ? "bg-[#2f86d6]/10 text-[#8cc4f5] border-[#2f86d6]/30 font-mono"
          : "bg-[#8896b4]/10 text-[#8896b4] border-[#8896b4]/20"
      }
    >
      {live.active ? `↓ ${formatRate(live.inBps)} · ↑ ${formatRate(live.outBps)}` : "Liaison au repos"}
    </Badge>
  );
}

export function TrafficPanel({ nvrId, disabled }: { nvrId: string; disabled: boolean }) {
  const [data, setData] = useState<TrafficData | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [measuring, setMeasuring] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/nvrs/${nvrId}/traffic`, { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, [nvrId]);

  useEffect(() => {
    void load();
    // Volumes : toutes les 30 s (le débit en cours a son propre rafraîchissement).
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const measure = async () => {
    setMeasuring(true);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "impact-test" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Mesure impossible");
        return;
      }
      setImpact(body.data as Impact);
      void load();
    } finally {
      setMeasuring(false);
    }
  };

  if (!data) return <Skeleton className="h-64 w-full bg-[#132255]" />;

  const maxHour = Math.max(1, ...data.hourly.map((h) => h.bytesIn + h.bytesOut));
  const originTotal = (totals: Totals | undefined) => (totals ? totals.bytesIn + totals.bytesOut : 0);
  const sup = data.supervision;

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-lg text-[#dde1e4] flex items-center gap-2">
            <Network className="h-4 w-4 text-[#0251a1]" />
            Consommation réseau de Sentinel
          </CardTitle>
          <CardDescription className="text-[#8896b4] max-w-2xl">
            Trafic réellement échangé entre Sentinel et cet enregistreur, par origine. En P2P, l&apos;encapsulation du
            tunnel s&apos;y ajoute.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualiser
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chiffres clés */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Débit en cours"
            value={data.live.active ? formatRate(data.live.inBps + data.live.outBps) : "au repos"}
            detail={data.live.active ? `↓ ${formatRate(data.live.inBps)} · ↑ ${formatRate(data.live.outBps)}` : undefined}
          />
          <Tile label="Pointe (5 min)" value={formatRate(data.live.peakBps)} />
          <Tile label="Volume 24 h" value={formatVolume(data.last24h.totalBytes)} />
          <Tile label="Volume 7 jours" value={formatVolume(data.last7d.totalBytes)} />
        </div>

        {/* Par origine */}
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-[#8896b4]">Par origine</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[#8896b4]">
                <th className="font-normal py-1">Origine</th>
                <th className="font-normal py-1 text-right">24 h</th>
                <th className="font-normal py-1 text-right">7 jours</th>
                <th className="font-normal py-1 text-right">Requêtes 24 h</th>
              </tr>
            </thead>
            <tbody>
              {ORIGINS.map((origin) => (
                <tr key={origin.key} className="border-t border-[#132255]">
                  <td className="py-1.5 text-[#dde1e4]">{origin.label}</td>
                  <td className="py-1.5 text-right font-mono text-[#dde1e4]">
                    {formatVolume(originTotal(data.last24h.byOrigin[origin.key]))}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[#8896b4]">
                    {formatVolume(originTotal(data.last7d.byOrigin[origin.key]))}
                  </td>
                  <td className="py-1.5 text-right font-mono text-[#8896b4]">
                    {data.last24h.byOrigin[origin.key]?.requests ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Profil horaire */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs uppercase tracking-wider text-[#8896b4]">Volume heure par heure (24 h)</h3>
            <div className="flex items-center gap-3 text-[11px] text-[#8896b4]">
              <Legend color={SUPERVISION_COLOR} label="Supervision" />
              <Legend color={OTHER_COLOR} label="Autres usages" />
            </div>
          </div>
          {data.hourly.length === 0 ? (
            <p className="text-xs text-[#8896b4]">Aucun échange enregistré sur les dernières 24 h.</p>
          ) : (
            <div className="flex h-28 items-end gap-0.5 border-b border-[#132255]">
              {data.hourly.map((hour) => {
                const total = hour.bytesIn + hour.bytesOut;
                const other = Math.max(total - hour.supervision, 0);
                const label = new Date(hour.hour).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div
                    key={hour.hour}
                    title={`${label} — total ${formatVolume(total)} · supervision ${formatVolume(hour.supervision)} · autres ${formatVolume(other)}`}
                    className="group flex h-full flex-1 max-w-6 flex-col justify-end gap-[2px] hover:opacity-80"
                  >
                    {other > 0 && (
                      <div
                        className="w-full rounded-t-[4px]"
                        style={{ height: `${(other / maxHour) * 100}%`, background: OTHER_COLOR }}
                      />
                    )}
                    {hour.supervision > 0 && (
                      <div
                        className={`w-full ${other > 0 ? "" : "rounded-t-[4px]"}`}
                        style={{ height: `${(hour.supervision / maxHour) * 100}%`, background: SUPERVISION_COLOR }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Coût de la supervision */}
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wider text-[#8896b4]">Coût de la supervision automatique</h3>
          {!sup.enabled ? (
            <p className="text-xs text-[#8896b4]">Supervision automatique suspendue dans les paramètres.</p>
          ) : (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Tile label="Vérifications (24 h)" value={String(sup.checks24h)} detail={`toutes les ${sup.intervalMinutes} min`} />
              <Tile
                label="Par vérification"
                value={sup.bytesPerCheck !== null ? formatVolume(sup.bytesPerCheck) : "—"}
                detail={sup.requestsPerCheck !== null ? `${sup.requestsPerCheck} requêtes` : "pas encore mesuré"}
              />
              <Tile
                label="Temps de réponse moyen"
                value={sup.averageLatencyMs !== null ? `${sup.averageLatencyMs} ms` : "—"}
              />
              <Tile
                label="Projection par jour"
                value={sup.projectedBytesPerDay !== null ? formatVolume(sup.projectedBytesPerDay) : "—"}
                detail={
                  sup.projectedBytesPerDay !== null
                    ? `soit ${formatRate(sup.projectedBytesPerDay / 86_400)} en moyenne`
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Mesure d'impact */}
        <div className="space-y-3 rounded-lg border border-[#132255] bg-[#080d24] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 max-w-2xl">
              <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[#4d9fe8]" />
                Impact de la supervision sur l&apos;enregistreur
              </h3>
              <p className="text-xs text-[#8896b4]">
                Compare la charge processeur au repos et pendant des vérifications identiques à celles de la
                supervision, mesure leur durée et leur coût réseau. Dure une quinzaine de secondes.
              </p>
            </div>
            <Button
              onClick={() => void measure()}
              disabled={disabled || measuring}
              className="bg-[#0251a1] hover:bg-[#0363c2] text-white"
            >
              {measuring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gauge className="h-4 w-4" />}
              {measuring ? "Mesure en cours…" : "Mesurer l'impact"}
            </Button>
          </div>
          {impact && <ImpactResult impact={impact} />}
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactResult({ impact }: { impact: Impact }) {
  const tone =
    impact.verdict.level === "negligeable"
      ? "bg-green-500/10 text-green-400 border-green-500/25"
      : impact.verdict.level === "faible"
        ? "bg-[#132255] text-[#dde1e4] border-[#1a2d66]"
        : "bg-amber-400/10 text-amber-300 border-amber-400/25";
  const label =
    impact.verdict.level === "negligeable" ? "Négligeable" : impact.verdict.level === "faible" ? "Faible" : "Notable";
  const cpu = (value: number | null) =>
    value !== null ? `${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %` : "—";
  return (
    <div className="space-y-3">
      <p className="text-sm text-[#dde1e4] flex flex-wrap items-center gap-2">
        <Badge className={tone}>{label}</Badge>
        {impact.verdict.text}
      </p>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Processeur au repos"
          value={cpu(impact.cpu.idle.average)}
          detail={impact.cpu.idle.samples.length ? `relevés : ${impact.cpu.idle.samples.join(" · ")}` : undefined}
        />
        <Tile
          label="Pendant les vérifications"
          value={cpu(impact.cpu.duringChecks.average)}
          detail={impact.cpu.duringChecks.max !== null ? `pointe ${impact.cpu.duringChecks.max} %` : undefined}
        />
        <Tile
          label="Une vérification"
          value={
            impact.perCheck.durationMs < 1000
              ? `${impact.perCheck.durationMs} ms`
              : `${(impact.perCheck.durationMs / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} s`
          }
          detail={`${formatVolume(impact.perCheck.bytesIn + impact.perCheck.bytesOut)} · ${impact.perCheck.requests} requêtes · moyenne sur ${impact.perCheck.measuredChecks}`}
        />
        <Tile
          label={`Par jour (toutes les ${impact.projection.intervalMinutes} min)`}
          value={formatVolume(impact.projection.bytesPerDay)}
          detail={`${formatVolume(impact.projection.bytesPerMonth)} / mois · ${formatRate(impact.projection.averageBps)} moyen`}
        />
      </div>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-[#132255] bg-[#080d24] p-3">
      <p className="text-[10px] uppercase tracking-wider text-[#8896b4]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-[#dde1e4]">{value}</p>
      {detail && <p className="text-[11px] text-[#8896b4]">{detail}</p>}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
