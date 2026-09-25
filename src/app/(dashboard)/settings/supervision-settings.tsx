"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Check, Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Config = {
  enabled: boolean;
  intervalMinutes: number;
  offlineThreshold: number;
  clockDriftMinutes: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunChecked: number | null;
};

type Overview = {
  config: Config;
  running: boolean;
  nvrs: { total: number; monitored: number };
  issues: { id: string; name: string; client: string | null; issues: string[] }[];
};

const INTERVALS = [1, 2, 5, 10, 15, 30, 60];
const DRIFTS = [0, 2, 5, 10, 30];

function Select({
  label,
  hint,
  value,
  values,
  format,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  values: number[];
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const options = values.includes(value) ? values : [...values, value].sort((a, b) => a - b);
  return (
    <div className="space-y-1.5">
      <Label className="text-[#8896b4] text-xs">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-[#132255] bg-[#080d24] px-3 py-2 text-sm text-[#dde1e4]"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {format(n)}
          </option>
        ))}
      </select>
      <p className="text-[11px] text-[#8896b4]/70">{hint}</p>
    </div>
  );
}

export function SupervisionSettings() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/supervision");
    if (!res.ok) return;
    const data: Overview = await res.json();
    setOverview(data);
    setDraft((current) => current ?? data.config);
  }, []);

  useEffect(() => {
    void load();
    // Rafraîchit l'état de la tournée en cours et des anomalies.
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      const res = await fetch("/api/supervision", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          intervalMinutes: draft.intervalMinutes,
          offlineThreshold: draft.offlineThreshold,
          clockDriftMinutes: draft.clockDriftMinutes,
        }),
      });
      if (!res.ok) {
        toast.error("Enregistrement impossible");
        return;
      }
      setDraft(await res.json());
      toast.success("Réglages de supervision enregistrés");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy("run");
    try {
      const res = await fetch("/api/supervision/run", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error ?? "Lancement impossible");
      else toast.success("Tournée lancée — les résultats arrivent au fil des vérifications");
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!overview || !draft) return <Skeleton className="h-48 w-full bg-[#132255]" />;

  const dirty =
    draft.enabled !== overview.config.enabled ||
    draft.intervalMinutes !== overview.config.intervalMinutes ||
    draft.offlineThreshold !== overview.config.offlineThreshold ||
    draft.clockDriftMinutes !== overview.config.clockDriftMinutes;

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <CardTitle className="text-[#dde1e4] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#0251a1]" />
            Supervision permanente
          </CardTitle>
          <CardDescription className="text-[#8896b4]">
            Sentinel vérifie lui-même chaque enregistreur à intervalle régulier — joignabilité (IP ou P2P), compte,
            disques, horloge — et historise chaque vérification. Une panne ouvre une alarme de supervision (relayée
            aux webhooks), clôturée automatiquement au rétablissement.
          </CardDescription>
        </div>
        <Button
          onClick={() => void runNow()}
          disabled={busy !== null || overview.running}
          className="bg-[#0251a1] hover:bg-[#0363c2] text-white shrink-0"
        >
          {overview.running || busy === "run" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {overview.running ? "Tournée en cours…" : "Lancer une tournée"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <label className="flex items-center gap-2.5 text-sm text-[#dde1e4] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="accent-[#0251a1]"
          />
          Supervision automatique activée
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Intervalle"
            hint="Délai entre deux tournées complètes."
            value={draft.intervalMinutes}
            values={INTERVALS}
            format={(n) => (n < 60 ? `Toutes les ${n} min` : `Toutes les ${n / 60} h`)}
            onChange={(intervalMinutes) => setDraft({ ...draft, intervalMinutes })}
          />
          <Select
            label="Seuil d'injoignabilité"
            hint="Échecs consécutifs avant d'ouvrir l'alarme."
            value={draft.offlineThreshold}
            values={[1, 2, 3, 4, 5]}
            format={(n) => `${n} échec${n > 1 ? "s" : ""} consécutif${n > 1 ? "s" : ""}`}
            onChange={(offlineThreshold) => setDraft({ ...draft, offlineThreshold })}
          />
          <Select
            label="Dérive d'horloge tolérée"
            hint="Au-delà, alarme « horloge décalée »."
            value={draft.clockDriftMinutes}
            values={DRIFTS}
            format={(n) => (n === 0 ? "Contrôle désactivé" : `${n} min`)}
            onChange={(clockDriftMinutes) => setDraft({ ...draft, clockDriftMinutes })}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-[#8896b4]">
            {overview.nvrs.monitored} enregistreur{overview.nvrs.monitored > 1 ? "s" : ""} surveillé
            {overview.nvrs.monitored > 1 ? "s" : ""} sur {overview.nvrs.total}
            {overview.config.lastRunAt
              ? ` · dernière tournée le ${new Date(overview.config.lastRunAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} (${overview.config.lastRunChecked ?? 0} vérifiés en ${Math.round((overview.config.lastRunDurationMs ?? 0) / 1000)} s)`
              : " · aucune tournée pour l'instant"}
          </p>
          <Button
            onClick={() => void save()}
            disabled={!dirty || busy !== null}
            variant="outline"
            className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
          >
            <Check className="h-4 w-4" />
            Enregistrer
          </Button>
        </div>

        {overview.issues.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-red-300">
              Enregistreurs en anomalie ({overview.issues.length})
            </h4>
            <ul className="divide-y divide-red-500/10 rounded-lg border border-red-500/20 bg-red-500/5">
              {overview.issues.map((nvr) => (
                <li key={nvr.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <Link href={`/nvrs/${nvr.id}`} className="text-sm text-[#dde1e4] hover:underline">
                    {nvr.name}
                    {nvr.client ? <span className="text-[#8896b4]"> · {nvr.client}</span> : null}
                  </Link>
                  <span className="flex items-center gap-1.5 text-xs text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {nvr.issues.join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
