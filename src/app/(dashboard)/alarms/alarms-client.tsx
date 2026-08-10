"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { SeverityBadge, SeverityDot, StatusBadge } from "@/components/alarm-badges";
import {
  EVENT_STATUSES,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUS_LABELS,
  type EventSeverity,
  type EventStatus,
} from "@/lib/dahua/events";

type AlarmClient = { id: string; name: string; code: string | null } | null;

type Alarm = {
  id: string;
  type: string;
  title: string;
  severity: string;
  status: string;
  channel: number | null;
  receivedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
  payload: unknown;
  nvr: {
    id: string;
    name: string;
    ip: string | null;
    location: string | null;
    status: string;
    client: AlarmClient;
  };
};

type AlarmDetail = Alarm & {
  comments: { id: string; body: string; author: string; createdAt: string }[];
};

type Stats = {
  open: number;
  critical: number;
  today: number;
  unacknowledged: number;
};

const REFRESH_INTERVAL_MS = 20_000;

export function AlarmsClient() {
  const searchParams = useSearchParams();

  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [statuses, setStatuses] = useState<EventStatus[]>(["new", "acknowledged", "in_progress"]);
  const [severities, setSeverities] = useState<EventSeverity[]>([]);
  const [search, setSearch] = useState("");
  const [nvrId, setNvrId] = useState<string | null>(searchParams.get("nvrId"));
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AlarmDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // `search` est débattu manuellement : recharger à chaque frappe ferait
  // clignoter la liste sous les yeux de l'opérateur.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    statuses.forEach((status) => params.append("status", status));
    severities.forEach((severity) => params.append("severity", severity));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (nvrId) params.set("nvrId", nvrId);
    params.set("limit", "100");
    return params.toString();
  }, [statuses, severities, debouncedSearch, nvrId]);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (options.silent) setRefreshing(true);
      else setLoading(true);

      try {
        const res = await fetch(`/api/events?${query}`);
        if (!res.ok) throw new Error("Chargement impossible");
        const data = await res.json();
        setAlarms(data.events);
        setTotal(data.total);
        setStats(data.stats);
      } catch {
        if (!options.silent) toast.error("Impossible de charger les alarmes");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Rafraîchissement périodique : une alarme qui arrive doit apparaître sans
  // que l'opérateur ait à recharger la page.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => void loadRef.current({ silent: true }), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/events/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const applyStatus = async (id: string, status: EventStatus, extra: Record<string, unknown> = {}) => {
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    });

    if (!res.ok) {
      toast.error("Le traitement a échoué");
      return;
    }

    toast.success(`Alarme ${STATUS_LABELS[status].toLowerCase()}`);
    await Promise.all([load({ silent: true }), openDetail(id)]);
  };

  const toggle = <T,>(list: T[], value: T, setter: (next: T[]) => void) => {
    setter(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">
            Sentinel
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">Centre d&apos;alarme</h1>
          <p className="text-[#8896b4] mt-1 text-sm">
            Réception et traitement des événements remontés par le parc
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh((value) => !value)}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              autoRefresh
                ? "border-[#0251a1]/40 bg-[#0251a1]/10 text-[#4d9fe8]"
                : "border-[#132255] bg-[#0a1130] text-[#8896b4]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${autoRefresh ? "bg-[#4d9fe8] animate-pulse" : "bg-[#8896b4]"}`}
            />
            Temps réel
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ silent: true })}
            className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Alarmes ouvertes"
          value={stats?.open}
          icon={<Bell className="h-4 w-4 text-[#0251a1]" />}
          tone="text-[#dde1e4]"
        />
        <StatCard
          label="Non prises en compte"
          value={stats?.unacknowledged}
          icon={<AlertTriangle className="h-4 w-4 text-red-400" />}
          tone="text-red-400"
        />
        <StatCard
          label="Critiques en cours"
          value={stats?.critical}
          icon={<ShieldCheck className="h-4 w-4 text-amber-400" />}
          tone="text-amber-400"
        />
        <StatCard
          label="Reçues aujourd'hui"
          value={stats?.today}
          icon={<Clock className="h-4 w-4 text-[#8896b4]" />}
          tone="text-[#dde1e4]"
        />
      </div>

      {/* Filtres */}
      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
        <CardContent className="flex flex-wrap items-center gap-4 py-4">
          <div className="flex items-center gap-2 text-[#8896b4] text-xs font-medium uppercase tracking-wider">
            <Filter className="h-3.5 w-3.5" />
            Filtres
          </div>

          <div className="flex flex-wrap gap-1.5">
            {EVENT_STATUSES.map((status) => (
              <FilterChip
                key={status}
                active={statuses.includes(status)}
                onClick={() => toggle(statuses, status, setStatuses)}
              >
                {STATUS_LABELS[status]}
              </FilterChip>
            ))}
          </div>

          <div className="h-5 w-px bg-[#132255]" />

          <div className="flex flex-wrap gap-1.5">
            {SEVERITIES.map((severity) => (
              <FilterChip
                key={severity}
                active={severities.includes(severity)}
                onClick={() => toggle(severities, severity, setSeverities)}
              >
                <SeverityDot severity={severity} />
                {SEVERITY_LABELS[severity]}
              </FilterChip>
            ))}
          </div>

          <div className="relative ml-auto min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8896b4]" />
            <Input
              placeholder="Rechercher…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9 bg-[#080d24] border-[#132255] text-[#dde1e4]"
            />
          </div>

          {nvrId && (
            <button
              type="button"
              onClick={() => setNvrId(null)}
              className="inline-flex items-center gap-1 rounded-full border border-[#0251a1]/40 bg-[#0251a1]/10 px-3 py-1 text-xs text-[#4d9fe8]"
            >
              Filtré sur un enregistreur
              <X className="h-3 w-3" />
            </button>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* Liste */}
        <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-14 w-full bg-[#132255]" />
                ))}
              </div>
            ) : alarms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#8896b4]">
                <CheckCircle2 className="h-10 w-10 mb-3 text-green-500/30" />
                <p className="text-sm font-medium">Aucune alarme pour ces filtres</p>
                <p className="text-xs mt-1 text-[#8896b4]/70">
                  Les événements arrivent par le webhook Alarm Center de chaque enregistreur
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#132255]">
                {alarms.map((alarm) => (
                  <li key={alarm.id}>
                    <button
                      type="button"
                      onClick={() => void openDetail(alarm.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors hover:bg-[#132255]/40 ${
                        selectedId === alarm.id ? "bg-[#132255]/60" : ""
                      }`}
                    >
                      <SeverityDot severity={alarm.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[#dde1e4] text-sm font-medium truncate">
                            {alarm.title}
                          </span>
                          {alarm.channel !== null && (
                            <span className="text-[#8896b4] text-xs shrink-0">
                              canal {alarm.channel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#8896b4] truncate">
                          {alarm.nvr.client?.name ? `${alarm.nvr.client.name} · ` : ""}
                          {alarm.nvr.name}
                          {alarm.nvr.location ? ` — ${alarm.nvr.location}` : ""}
                        </p>
                      </div>
                      <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge status={alarm.status} />
                        <span className="text-[11px] text-[#8896b4]">
                          {formatDateTime(alarm.receivedAt)}
                        </span>
                      </div>
                      <ChevronRight className="h-4 w-4 text-[#8896b4] shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Détail */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          {detail ? (
            <AlarmDetailPanel
              detail={detail}
              loading={detailLoading}
              onApplyStatus={applyStatus}
              onCommentAdded={() => void openDetail(detail.id)}
              onClose={() => {
                setDetail(null);
                setSelectedId(null);
              }}
            />
          ) : (
            <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
              <CardContent className="py-16 text-center text-[#8896b4]">
                <Bell className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Sélectionnez une alarme pour la traiter</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {!loading && total > alarms.length && (
        <p className="text-xs text-[#8896b4] text-center">
          {alarms.length} alarmes affichées sur {total} — affinez les filtres pour réduire la liste.
        </p>
      )}
    </div>
  );
}

function AlarmDetailPanel({
  detail,
  loading,
  onApplyStatus,
  onCommentAdded,
  onClose,
}: {
  detail: AlarmDetail;
  loading: boolean;
  onApplyStatus: (id: string, status: EventStatus, extra?: Record<string, unknown>) => Promise<void>;
  onCommentAdded: () => void;
  onClose: () => void;
}) {
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setComment("");
    setResolution("");
  }, [detail.id]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const submitComment = async () => {
    const body = comment.trim();
    if (!body) return;

    const res = await fetch(`/api/events/${detail.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });

    if (res.ok) {
      setComment("");
      onCommentAdded();
    } else {
      toast.error("Commentaire non enregistré");
    }
  };

  const closed = detail.status === "resolved" || detail.status === "ignored";

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardContent className="space-y-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <SeverityBadge severity={detail.severity} />
              <StatusBadge status={detail.status} />
            </div>
            <h2 className="text-lg font-semibold text-[#dde1e4] leading-tight">{detail.title}</h2>
            <p className="text-xs text-[#8896b4] font-mono mt-0.5">{detail.type}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8896b4] hover:text-[#dde1e4] shrink-0"
            aria-label="Fermer le détail"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2 text-sm">
          <DetailRow label="Reçue le" value={formatDateTime(detail.receivedAt)} />
          <DetailRow
            label="Enregistreur"
            value={
              <Link
                href={`/nvrs/${detail.nvr.id}`}
                className="text-[#4d9fe8] hover:underline inline-flex items-center gap-1"
              >
                <Server className="h-3.5 w-3.5" />
                {detail.nvr.name}
              </Link>
            }
          />
          {detail.nvr.client && <DetailRow label="Client" value={detail.nvr.client.name} />}
          {detail.channel !== null && <DetailRow label="Canal" value={String(detail.channel)} />}
          {detail.acknowledgedAt && (
            <DetailRow
              label="Prise en compte"
              value={`${formatDateTime(detail.acknowledgedAt)}${detail.acknowledgedBy ? ` — ${detail.acknowledgedBy}` : ""}`}
            />
          )}
          {detail.resolvedAt && (
            <DetailRow
              label="Clôturée"
              value={`${formatDateTime(detail.resolvedAt)}${detail.resolvedBy ? ` — ${detail.resolvedBy}` : ""}`}
            />
          )}
          {detail.resolution && <DetailRow label="Motif" value={detail.resolution} />}
        </div>

        {/* Traitement */}
        <div className="space-y-3 border-t border-[#132255] pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || detail.status === "acknowledged"}
              onClick={() => void run(() => onApplyStatus(detail.id, "acknowledged"))}
              className="bg-[#0251a1] hover:bg-[#0363c2]"
            >
              Prendre en compte
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || detail.status === "in_progress"}
              onClick={() => void run(() => onApplyStatus(detail.id, "in_progress"))}
              className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
            >
              En traitement
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => onApplyStatus(detail.id, "ignored"))}
              className="border-[#132255] bg-[#080d24] text-[#8896b4] hover:bg-[#132255]"
            >
              Ignorer
            </Button>
          </div>

          {!closed && (
            <div className="space-y-2">
              <Label className="text-[#8896b4] text-xs">Motif de clôture</Label>
              <Input
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
                placeholder="Levée de doute, intervention, fausse alarme…"
                className="bg-[#080d24] border-[#132255] text-[#dde1e4]"
              />
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    onApplyStatus(detail.id, "resolved", {
                      resolution: resolution.trim() || undefined,
                    }),
                  )
                }
                className="w-full bg-green-600/80 hover:bg-green-600 text-white"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Clôturer l&apos;alarme
              </Button>
            </div>
          )}
        </div>

        {/* Main courante */}
        <div className="space-y-3 border-t border-[#132255] pt-4">
          <div className="flex items-center gap-2 text-[#8896b4] text-xs font-medium uppercase tracking-wider">
            <MessageSquare className="h-3.5 w-3.5" />
            Main courante
          </div>

          {loading ? (
            <Skeleton className="h-16 w-full bg-[#132255]" />
          ) : detail.comments.length === 0 ? (
            <p className="text-xs text-[#8896b4]/70">Aucune entrée pour le moment.</p>
          ) : (
            <ul className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {detail.comments.map((entry) => (
                <li key={entry.id} className="rounded-lg bg-[#080d24] border border-[#132255] p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium text-[#dde1e4]">{entry.author}</span>
                    <span className="text-[11px] text-[#8896b4]">
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm text-[#8896b4] whitespace-pre-wrap">{entry.body}</p>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Input
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submitComment();
              }}
              placeholder="Ajouter une observation…"
              className="bg-[#080d24] border-[#132255] text-[#dde1e4]"
            />
            <Button
              size="sm"
              onClick={() => void submitComment()}
              disabled={!comment.trim()}
              className="bg-[#0251a1] hover:bg-[#0363c2] shrink-0"
            >
              Ajouter
            </Button>
          </div>
        </div>

        {/* Charge utile brute — indispensable pour lever un doute technique */}
        <details className="border-t border-[#132255] pt-4">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-[#8896b4]">
            Données brutes
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#080d24] border border-[#132255] p-3 text-[11px] text-[#8896b4]">
            {JSON.stringify(detail.payload, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[#8896b4] text-xs shrink-0 pt-0.5">{label}</span>
      <span className="text-[#dde1e4] text-sm text-right">{value}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number | undefined;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardContent className="flex items-center justify-between py-4">
        <div>
          <p className="text-xs text-[#8896b4]">{label}</p>
          <p className={`text-2xl font-bold ${tone}`}>{value ?? "—"}</p>
        </div>
        <div className="h-9 w-9 rounded-lg bg-[#080d24] flex items-center justify-center">{icon}</div>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-[#0251a1] bg-[#0251a1]/20 text-[#dde1e4]"
          : "border-[#132255] bg-[#080d24] text-[#8896b4] hover:border-[#0251a1]/40"
      }`}
    >
      {children}
    </button>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
