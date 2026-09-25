"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Supervision permanente d'un enregistreur : état courant, anomalies ouvertes,
 * disponibilité et historique des vérifications automatiques.
 */

type Uptime = { total: number; ok: number; ratio: number | null };

type HealthCheck = {
  id: string;
  ok: boolean;
  reachable: boolean;
  latencyMs: number | null;
  issues: string[];
  message: string | null;
  createdAt: string;
};

type Health = {
  nvr: {
    status: string;
    monitored: boolean;
    consecutiveFailures: number;
    lastHealthCheckAt: string | null;
    lastSeen: string | null;
  };
  openIssues: { type: string; title: string; severity: string }[];
  uptime: { last24h: Uptime; last7d: Uptime };
  supervision: { enabled: boolean; intervalMinutes: number; offlineThreshold: number };
  checks: HealthCheck[];
};

const ISSUE_LABELS: Record<string, string> = {
  SupervisionUnreachable: "injoignable",
  SupervisionAuthFailure: "identifiants refusés",
  SupervisionStorageFault: "stockage",
  SupervisionClockDrift: "horloge décalée",
};

function formatRatio(uptime: Uptime): string {
  if (uptime.ratio === null) return "—";
  const pct = uptime.ratio * 100;
  return `${pct.toLocaleString("fr-FR", { maximumFractionDigits: pct >= 99.95 || pct === 0 ? 0 : 1 })} %`;
}

function checkTone(check: HealthCheck): { color: string; label: string } {
  if (check.message?.startsWith("Non vérifié")) return { color: "bg-[#2a3560]", label: "non vérifié" };
  if (!check.reachable) return { color: "bg-red-500", label: "injoignable" };
  if (!check.ok || check.issues.length) return { color: "bg-amber-400", label: "anomalie" };
  return { color: "bg-green-500", label: "OK" };
}

export function SupervisionPanel({ nvrId, onChange }: { nvrId: string; onChange?: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/nvrs/${nvrId}/health`);
    if (res.ok) setHealth(await res.json());
    setLoading(false);
  }, [nvrId]);

  useEffect(() => {
    void load();
  }, [load]);

  const checkNow = async () => {
    setChecking(true);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/health`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Vérification impossible");
        return;
      }
      if (data.skipped) toast.warning(data.message);
      else if (data.ok && data.openIssues.length === 0) toast.success(`Enregistreur sain — ${data.latencyMs} ms`);
      else toast.error(data.message);
      await load();
      onChange?.();
    } finally {
      setChecking(false);
    }
  };

  const setMonitored = async (monitored: boolean) => {
    setToggling(true);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/health`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitored }),
      });
      if (!res.ok) {
        toast.error("Modification impossible");
        return;
      }
      toast.success(monitored ? "Supervision activée pour cet enregistreur" : "Supervision désactivée pour cet enregistreur");
      await load();
    } finally {
      setToggling(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full bg-[#132255]" />;
  if (!health) return <p className="text-sm text-[#8896b4]">Supervision indisponible.</p>;

  // Frise : de la plus ancienne à la plus récente vérification.
  const timeline = [...health.checks].reverse();

  return (
    <div className="space-y-6">
      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="text-lg text-[#dde1e4] flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#0251a1]" />
              Supervision permanente
            </CardTitle>
            <CardDescription className="text-[#8896b4] max-w-2xl">
              {health.supervision.enabled
                ? `Vérification automatique toutes les ${health.supervision.intervalMinutes} min : joignabilité, compte, disques et horloge. Injoignable déclaré après ${health.supervision.offlineThreshold} échec(s) consécutif(s).`
                : "La supervision automatique est suspendue dans les paramètres ; la vérification manuelle reste possible."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void setMonitored(!health.nvr.monitored)}
              disabled={toggling}
              className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
            >
              {health.nvr.monitored ? "Exclure de la supervision" : "Inclure dans la supervision"}
            </Button>
            <Button onClick={() => void checkNow()} disabled={checking} className="bg-[#0251a1] hover:bg-[#0363c2] text-white">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Vérifier maintenant
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="État">
              {!health.nvr.monitored ? (
                <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">non surveillé</Badge>
              ) : health.openIssues.length === 0 ? (
                <Badge className="bg-green-500/10 text-green-400 border-green-500/25">sain</Badge>
              ) : (
                <Badge className="bg-red-500/10 text-red-400 border-red-500/25">
                  {health.openIssues.length} anomalie{health.openIssues.length > 1 ? "s" : ""}
                </Badge>
              )}
            </Stat>
            <Stat label="Disponibilité 24 h">
              <span className="text-lg font-semibold text-[#dde1e4]">{formatRatio(health.uptime.last24h)}</span>
              <span className="block text-[11px] text-[#8896b4]">{health.uptime.last24h.total} vérifications</span>
            </Stat>
            <Stat label="Disponibilité 7 j">
              <span className="text-lg font-semibold text-[#dde1e4]">{formatRatio(health.uptime.last7d)}</span>
              <span className="block text-[11px] text-[#8896b4]">{health.uptime.last7d.total} vérifications</span>
            </Stat>
            <Stat label="Dernière vérification">
              <span className="text-sm text-[#dde1e4]">
                {health.nvr.lastHealthCheckAt
                  ? new Date(health.nvr.lastHealthCheckAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
                  : "jamais"}
              </span>
              {health.nvr.consecutiveFailures > 0 && (
                <span className="block text-[11px] text-amber-300">{health.nvr.consecutiveFailures} échec(s) consécutif(s)</span>
              )}
            </Stat>
          </div>

          {health.openIssues.length > 0 && (
            <ul className="space-y-1.5">
              {health.openIssues.map((issue) => (
                <li
                  key={issue.type}
                  className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {issue.title}
                  <span className="text-[11px] text-red-300/70">— alarme ouverte dans le centre d&apos;alarme</span>
                </li>
              ))}
            </ul>
          )}

          {timeline.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-[#8896b4]">
                {timeline.length} dernières vérifications (la plus récente à droite)
              </p>
              <div className="flex h-7 items-end gap-[3px]">
                {timeline.map((check) => {
                  const tone = checkTone(check);
                  return (
                    <span
                      key={check.id}
                      title={`${new Date(check.createdAt).toLocaleString("fr-FR")} — ${tone.label}${check.message ? ` : ${check.message}` : ""}`}
                      className={`h-full flex-1 max-w-3 rounded-sm ${tone.color}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-base text-[#dde1e4]">Historique des vérifications</CardTitle>
          <CardDescription className="text-[#8896b4]">
            Conservé 30 jours. Chaque ligne est une vérification automatique ou manuelle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.checks.length === 0 ? (
            <p className="py-6 text-center text-sm text-[#8896b4]">
              Aucune vérification pour l&apos;instant — la première tournée aura lieu sous peu.
            </p>
          ) : (
            <ul className="divide-y divide-[#132255]">
              {health.checks.map((check) => {
                const tone = checkTone(check);
                return (
                  <li key={check.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {tone.label === "OK" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                      ) : tone.label === "injoignable" ? (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                      ) : (
                        <AlertTriangle
                          className={`mt-0.5 h-4 w-4 shrink-0 ${tone.label === "non vérifié" ? "text-[#8896b4]" : "text-amber-300"}`}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-[#dde1e4] break-words">{check.message ?? tone.label}</p>
                        {check.issues.length > 0 && (
                          <p className="text-[11px] text-[#8896b4]">
                            {check.issues.map((issue) => ISSUE_LABELS[issue] ?? issue).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="shrink-0 text-right text-[11px] text-[#8896b4]">
                      {new Date(check.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}
                      {check.latencyMs !== null && <span className="block">{check.latencyMs} ms</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#132255] bg-[#080d24] p-3">
      <p className="mb-1 text-[11px] uppercase tracking-wider text-[#8896b4]">{label}</p>
      {children}
    </div>
  );
}
