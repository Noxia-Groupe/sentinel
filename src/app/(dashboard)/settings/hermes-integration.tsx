"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  Copy,
  Download,
  KeyRound,
  Stethoscope,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HERMES_SCHEDULE_REQUEST, MCP_PROMPTS, hermesSkill } from "@/lib/mcp/playbooks";

/**
 * Intégration Hermes Agent :
 * 1. connexion MCP — Hermes appelle les outils de Sentinel avec une clé d'API ;
 * 2. webhooks sortants — Sentinel pousse les alarmes et pannes choisies vers
 *    Hermes (ou tout autre récepteur), signées HMAC au format Hermes.
 */

type Option = { value: string; label: string };

type Endpoint = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  severities: string[];
  categories: string[];
  clientIds: string[];
  notifyStatusChanges: boolean;
  notifyNvrStatus: boolean;
};

type Delivery = {
  id: string;
  endpointId: string;
  eventType: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
  summary: string | null;
};

type Options = { severities: Option[]; categories: Option[]; clients: { id: string; name: string }[] };

type Draft = Omit<Endpoint, "id" | "enabled">;

const EMPTY_DRAFT: Draft = {
  name: "Hermes Agent",
  url: "",
  severities: ["critical", "major"],
  categories: [],
  clientIds: [],
  notifyStatusChanges: false,
  notifyNvrStatus: true,
};

const HERMES_SCOPES = ["alarms:read", "alarms:write", "nvr:read", "nvr:test"];

function useOrigin(): string {
  const [origin, setOrigin] = useState("https://sentinel.example");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[#8896b4] text-xs">{label}</Label>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-[#4d9fe8] hover:text-[#dde1e4]"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto rounded-lg border border-[#132255] bg-[#080d24] p-3 text-[11px] leading-relaxed text-[#dde1e4] whitespace-pre-wrap break-all">
        {value}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Connexion MCP
// ---------------------------------------------------------------------------

function mcpSnippet(origin: string, secret: string): string {
  return `# ~/.hermes/config.yaml — sur le serveur Hermes
mcp_servers:
  sentinel:
    url: "${origin}/api/mcp"
    headers:
      Authorization: "Bearer ${secret}"
    timeout: 120          # un test via tunnel P2P peut prendre ~30 s
    connect_timeout: 30`;
}

function mcpTestCommand(origin: string, secret: string): string {
  return `curl -s ${origin}/api/mcp \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'`;
}

function HermesMcpCard() {
  const origin = useOrigin();
  const [allowControl, setAllowControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: allowControl ? "Hermes Agent (supervision + interventions)" : "Hermes Agent (supervision)",
          scopes: allowControl ? [...HERMES_SCOPES, "nvr:control"] : HERMES_SCOPES,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Création de la clé impossible");
        return;
      }
      setSecret(data.secret);
      window.dispatchEvent(new Event("sentinel:api-keys-changed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#4d9fe8]" />
          Connexion de l&apos;agent (MCP)
        </h3>
        <p className="text-xs text-[#8896b4] leading-relaxed">
          Hermes se connecte au serveur MCP de Sentinel (<span className="font-mono">{origin}/api/mcp</span>) avec
          une clé d&apos;API dédiée. Il y trouve les outils de supervision : vue d&apos;ensemble, alarmes et main
          courante, inventaire, tests d&apos;accès, captures et interventions. Chaque appel est tracé au nom de la
          clé ; les mots de passe ne sont jamais exposés par ce canal.
        </p>
      </div>

      <label className="flex items-start gap-2.5 rounded-lg border border-[#132255] bg-[#080d24] p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={allowControl}
          onChange={(e) => setAllowControl(e.target.checked)}
          className="mt-0.5 accent-[#0251a1]"
        />
        <span className="text-sm text-[#dde1e4]">
          Autoriser les interventions
          <span className="block text-[11px] text-[#8896b4]">
            Maintenance curative : ports PoE (relance d&apos;une caméra figée), mise à l&apos;heure, relais,
            redémarrage, provisionnement du centre d&apos;alarme (scope{" "}
            <span className="font-mono">nvr:control</span>). Sans cette case, Hermes observe, teste et traite les
            alarmes, mais ne modifie pas les équipements.
          </span>
        </span>
      </label>

      <Button onClick={() => void create()} disabled={busy} className="bg-[#0251a1] hover:bg-[#0363c2] text-white">
        <Bot className="h-4 w-4" />
        Générer la clé de connexion Hermes
      </Button>

      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Clé de connexion Hermes</DialogTitle>
          </DialogHeader>
          {secret && (
            <div className="space-y-4">
              <p className="text-xs text-amber-300">
                Cette clé ne sera plus jamais affichée. Copiez la configuration maintenant ; en cas de perte, révoquez
                la clé dans « Clés d&apos;API » et générez-en une nouvelle.
              </p>
              <CopyBlock label="Configuration à ajouter côté Hermes" value={mcpSnippet(origin, secret)} />
              <p className="text-[11px] text-[#8896b4]">
                Puis redémarrer Hermes (ou recharger ses serveurs MCP) : les outils <span className="font-mono">sentinel_overview</span>,{" "}
                <span className="font-mono">fleet_maintenance</span>, <span className="font-mono">maintenance_report</span>,{" "}
                <span className="font-mono">nvr_action</span>… apparaissent. La connexion s&apos;affiche ensuite dans
                « État de la connexion » ci-dessous dès le premier appel.
              </p>
              <CopyBlock label="Test depuis le serveur Hermes (doit répondre « sentinel »)" value={mcpTestCommand(origin, secret)} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// État de la connexion
// ---------------------------------------------------------------------------

type HermesKey = {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expired: boolean;
  /** La clé a servi dans les 15 dernières minutes. */
  connected: boolean;
  canIntervene: boolean;
};
type HermesActivity = {
  id: string;
  action: string;
  targetType: string | null;
  success: boolean;
  createdAt: string;
};

function formatWhen(value: string | null): string {
  if (!value) return "jamais";
  return new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function HermesStatus() {
  const [data, setData] = useState<{ keys: HermesKey[]; activity: HermesActivity[] } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/hermes/status");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("sentinel:api-keys-changed", refresh);
    return () => window.removeEventListener("sentinel:api-keys-changed", refresh);
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
          <Activity className="h-4 w-4 text-[#4d9fe8]" />
          État de la connexion
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[11px] text-[#4d9fe8] hover:text-[#dde1e4]"
        >
          <RefreshCw className="h-3 w-3" />
          Actualiser
        </button>
      </div>
      {!data ? (
        <Skeleton className="h-16 w-full" />
      ) : data.keys.length === 0 ? (
        <p className="text-xs text-[#8896b4]">
          Aucune clé Hermes active : générer la clé de connexion ci-dessus, puis la déclarer côté Hermes.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#132255] bg-[#080d24] px-3 py-2"
            >
              <span className="text-sm text-[#dde1e4]">
                {key.name} <span className="font-mono text-[11px] text-[#8896b4]">{key.prefix}…</span>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-[#8896b4]">
                {key.expired ? (
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/25">expirée</Badge>
                ) : key.connected ? (
                  <Badge className="bg-green-500/10 text-green-400 border-green-500/25">connecté</Badge>
                ) : key.lastUsedAt ? (
                  <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">inactif</Badge>
                ) : (
                  <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/25">jamais connecté</Badge>
                )}
                {key.canIntervene ? "interventions autorisées" : "lecture et tests"} · dernier appel{" "}
                {formatWhen(key.lastUsedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data && data.activity.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-[#8896b4] hover:text-[#dde1e4]">
            Dernières actions de l&apos;agent ({data.activity.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data.activity.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-[11px] text-[#8896b4]">
                <span className="font-mono">{formatWhen(entry.createdAt)}</span>
                <span className={entry.success ? "text-[#dde1e4]" : "text-red-400"}>{entry.action}</span>
                {!entry.success && <span className="text-red-400">(échec)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compétence de maintenance
// ---------------------------------------------------------------------------

function HermesSkill() {
  const origin = useOrigin();
  const download = () => {
    const blob = new Blob([hermesSkill(origin)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "SKILL.md";
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-[#4d9fe8]" />
          Maintenance préventive et curative
        </h3>
        <p className="text-xs text-[#8896b4] leading-relaxed">
          Hermes dispose des outils <span className="font-mono">fleet_maintenance</span> (parc à risque) et{" "}
          <span className="font-mono">maintenance_report</span>{" "}(bilan d&apos;un enregistreur, constats classés et
          action recommandée), ainsi que de deux procédures prêtes à l&apos;emploi :{" "}
          {MCP_PROMPTS.map((prompt, index) => (
            <span key={prompt.name}>
              {index > 0 ? " et " : ""}
              <span className="font-mono">{prompt.name}</span>
            </span>
          ))}
          . La compétence ci-dessous les lui apprend durablement : la déposer dans{" "}
          <span className="font-mono">~/.hermes/skills/sentinel-maintenance/SKILL.md</span> sur le serveur Hermes.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={download}
        className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
      >
        <Download className="h-4 w-4" />
        Télécharger la compétence Hermes
      </Button>
      <CopyBlock label="Pour une tournée préventive automatique, demander à Hermes" value={HERMES_SCHEDULE_REQUEST} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Webhooks sortants
// ---------------------------------------------------------------------------

function hermesRouteSnippet(endpoint: Pick<Endpoint, "notifyStatusChanges" | "notifyNvrStatus">, secret: string) {
  const events = [
    "alarm.created",
    ...(endpoint.notifyStatusChanges ? ["alarm.status_changed"] : []),
    ...(endpoint.notifyNvrStatus ? ["nvr.offline", "nvr.online"] : []),
    "sentinel.test",
  ];
  return `# ~/.hermes/config.yaml — sur le serveur Hermes
platforms:
  webhook:
    enabled: true
    extra:
      routes:
        sentinel:
          secret: "${secret}"
          events: [${events.map((e) => `"${e}"`).join(", ")}]
          prompt: |
            Événement Sentinel : {summary}
            Données complètes : {__raw__}
            Applique la procédure de diagnostic curatif de la compétence sentinel-maintenance
            (outils MCP Sentinel : get_alarm, get_nvr_health, maintenance_report, puis l'action
            recommandée si elle est sûre), et consigne ton analyse dans la main courante de l'alarme.
          deliver: "telegram"   # où Hermes rend compte : telegram, discord, slack…

# URL à renseigner dans Sentinel : http://<serveur-hermes>:8644/webhooks/sentinel`;
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function CheckboxGroup({
  label,
  hint,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint: string;
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <Label className="text-[#8896b4] text-xs">{label}</Label>
        <p className="text-[11px] text-[#8896b4]/70">{hint}</p>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-[#dde1e4] cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onChange(toggle(selected, option.value))}
              className="accent-[#0251a1]"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function WebhookForm({
  draft,
  setDraft,
  options,
}: {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  options: Options;
}) {
  return (
    <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-[#8896b4] text-xs">Nom</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="bg-[#080d24] border-[#132255]"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[#8896b4] text-xs">URL du récepteur</Label>
          <Input
            value={draft.url}
            onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            placeholder="http://hermes:8644/webhooks/sentinel"
            className="bg-[#080d24] border-[#132255] font-mono text-xs"
          />
        </div>
      </div>

      <CheckboxGroup
        label="Criticités envoyées"
        hint="Aucune case cochée = toutes les criticités."
        options={options.severities}
        selected={draft.severities}
        onChange={(severities) => setDraft({ ...draft, severities })}
      />
      <CheckboxGroup
        label="Familles d'alarmes"
        hint="Aucune case cochée = toutes les familles (pannes de stockage, réseau, intrusions…)."
        options={options.categories}
        selected={draft.categories}
        onChange={(categories) => setDraft({ ...draft, categories })}
      />
      {options.clients.length > 0 && (
        <CheckboxGroup
          label="Clients"
          hint="Aucune case cochée = tous les clients."
          options={options.clients.map((c) => ({ value: c.id, label: c.name }))}
          selected={draft.clientIds}
          onChange={(clientIds) => setDraft({ ...draft, clientIds })}
        />
      )}

      <div className="space-y-2">
        <Label className="text-[#8896b4] text-xs">Autres événements</Label>
        <label className="flex items-start gap-2 text-sm text-[#dde1e4] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.notifyNvrStatus}
            onChange={(e) => setDraft({ ...draft, notifyNvrStatus: e.target.checked })}
            className="mt-1 accent-[#0251a1]"
          />
          <span>
            Pannes de liaison : enregistreur hors ligne / rétabli
            <span className="block text-[11px] text-[#8896b4]">
              <span className="font-mono">nvr.offline</span>, <span className="font-mono">nvr.online</span>
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-[#dde1e4] cursor-pointer">
          <input
            type="checkbox"
            checked={draft.notifyStatusChanges}
            onChange={(e) => setDraft({ ...draft, notifyStatusChanges: e.target.checked })}
            className="mt-1 accent-[#0251a1]"
          />
          <span>
            Suivi du traitement des alarmes (prise en compte, clôture)
            <span className="block text-[11px] text-[#8896b4]">
              <span className="font-mono">alarm.status_changed</span>
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

function filterSummary(endpoint: Endpoint, options: Options): string[] {
  const label = (list: Option[], value: string) => list.find((o) => o.value === value)?.label ?? value;
  const parts = [
    endpoint.severities.length
      ? `Criticité : ${endpoint.severities.map((s) => label(options.severities, s)).join(", ")}`
      : "Toutes criticités",
    endpoint.categories.length
      ? `Familles : ${endpoint.categories.map((c) => label(options.categories, c).split(" (")[0]).join(", ")}`
      : "Toutes familles",
    endpoint.clientIds.length
      ? `Clients : ${endpoint.clientIds.map((id) => options.clients.find((c) => c.id === id)?.name ?? "?").join(", ")}`
      : "Tous clients",
  ];
  if (endpoint.notifyNvrStatus) parts.push("Hors ligne / rétabli");
  if (endpoint.notifyStatusChanges) parts.push("Suivi du traitement");
  return parts;
}

function OutboundWebhooksManager() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [options, setOptions] = useState<Options>({ severities: [], categories: [], clients: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [revealed, setRevealed] = useState<{ endpoint: Endpoint; secret: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/outbound-webhooks");
    if (res.ok) {
      const data = await res.json();
      setEndpoints(data.endpoints);
      setDeliveries(data.deliveries);
      setOptions(data.options);
    } else {
      toast.error("Webhooks indisponibles");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (key: string, url: string, init: RequestInit, done?: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Opération impossible");
        return null;
      }
      if (done) toast.success(done);
      return data;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!editing) return;
    const init = {
      method: editing.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing.draft),
    };
    const data = await call(
      "save",
      editing.id ? `/api/outbound-webhooks/${editing.id}` : "/api/outbound-webhooks",
      init,
      editing.id ? "Webhook mis à jour" : undefined,
    );
    if (!data) return;
    setEditing(null);
    if (!editing.id) setRevealed({ endpoint: data, secret: data.secret });
    await load();
  };

  const test = async (endpoint: Endpoint) => {
    const data = await call(`test-${endpoint.id}`, `/api/outbound-webhooks/${endpoint.id}/test`, { method: "POST" });
    if (data) {
      if (data.ok) toast.success(`Test reçu par le destinataire (HTTP ${data.status})`);
      else toast.error(`Échec du test : ${data.status ? `HTTP ${data.status} — ` : ""}${data.error ?? ""}`);
    }
    await load();
  };

  const rotate = async (endpoint: Endpoint) => {
    if (!window.confirm(`Régénérer le secret de « ${endpoint.name} » ? L'ancien cessera immédiatement d'être valide.`)) {
      return;
    }
    const data = await call(`rotate-${endpoint.id}`, `/api/outbound-webhooks/${endpoint.id}/secret`, { method: "POST" });
    if (data) setRevealed({ endpoint, secret: data.secret });
  };

  const remove = async (endpoint: Endpoint) => {
    if (!window.confirm(`Supprimer le webhook « ${endpoint.name} » et son historique ?`)) return;
    if (await call(`del-${endpoint.id}`, `/api/outbound-webhooks/${endpoint.id}`, { method: "DELETE" }, "Webhook supprimé")) {
      await load();
    }
  };

  const setEnabled = async (endpoint: Endpoint, enabled: boolean) => {
    const data = await call(
      `toggle-${endpoint.id}`,
      `/api/outbound-webhooks/${endpoint.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) },
      enabled ? "Webhook activé" : "Webhook désactivé",
    );
    if (data) await load();
  };

  const redeliver = async (delivery: Delivery) => {
    const data = await call(`redo-${delivery.id}`, `/api/outbound-webhooks/deliveries/${delivery.id}`, { method: "POST" });
    if (data) {
      if (data.ok) toast.success("Livraison renvoyée avec succès");
      else toast.error(`Nouvel échec : ${data.error ?? `HTTP ${data.status}`}`);
    }
    await load();
  };

  const nameOf = (id: string) => endpoints.find((e) => e.id === id)?.name ?? "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-2xl">
          <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
            <Webhook className="h-4 w-4 text-[#4d9fe8]" />
            Webhooks sortants (alarmes et pannes)
          </h3>
          <p className="text-xs text-[#8896b4] leading-relaxed">
            Sentinel pousse les événements choisis vers Hermes (ou tout récepteur compatible) : chaque envoi est signé
            HMAC-SHA256 au format Hermes (<span className="font-mono">X-Webhook-Signature-V2</span>, horodatage
            anti-rejeu), identifié par <span className="font-mono">X-Request-ID</span>{" "}
            et retenté automatiquement en cas d&apos;échec.
          </p>
        </div>
        <Button
          onClick={() => setEditing({ id: null, draft: EMPTY_DRAFT })}
          className="bg-[#0251a1] hover:bg-[#0363c2] text-white shrink-0"
        >
          <Plus className="h-4 w-4" />
          Nouveau webhook
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-16 w-full bg-[#132255]" />
      ) : endpoints.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#132255] px-4 py-6 text-center text-sm text-[#8896b4]">
          Aucun webhook. Créez-en un pour que Hermes soit prévenu des alarmes et des pannes.
        </p>
      ) : (
        <ul className="space-y-2">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id} className="rounded-lg border border-[#132255] bg-[#080d24] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[#dde1e4] flex items-center gap-2">
                    {endpoint.name}
                    {endpoint.enabled ? (
                      <Badge className="bg-green-500/10 text-green-400 border-green-500/25">actif</Badge>
                    ) : (
                      <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">désactivé</Badge>
                    )}
                  </p>
                  <p className="text-[11px] font-mono text-[#8896b4] truncate">{endpoint.url}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <SmallButton onClick={() => void test(endpoint)} disabled={busy !== null || !endpoint.enabled} icon={<Send className="h-3.5 w-3.5" />}>
                    Tester
                  </SmallButton>
                  <SmallButton
                    onClick={() =>
                      setEditing({
                        id: endpoint.id,
                        draft: {
                          name: endpoint.name,
                          url: endpoint.url,
                          severities: endpoint.severities,
                          categories: endpoint.categories,
                          clientIds: endpoint.clientIds,
                          notifyStatusChanges: endpoint.notifyStatusChanges,
                          notifyNvrStatus: endpoint.notifyNvrStatus,
                        },
                      })
                    }
                    disabled={busy !== null}
                    icon={<Pencil className="h-3.5 w-3.5" />}
                  >
                    Modifier
                  </SmallButton>
                  <SmallButton onClick={() => void setEnabled(endpoint, !endpoint.enabled)} disabled={busy !== null}>
                    {endpoint.enabled ? "Désactiver" : "Activer"}
                  </SmallButton>
                  <SmallButton onClick={() => void rotate(endpoint)} disabled={busy !== null} icon={<RefreshCw className="h-3.5 w-3.5" />} title="Régénérer le secret" />
                  <SmallButton onClick={() => void remove(endpoint)} disabled={busy !== null} icon={<Trash2 className="h-3.5 w-3.5" />} title="Supprimer" danger />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {filterSummary(endpoint, options).map((part) => (
                  <span key={part} className="rounded-full border border-[#132255] bg-[#0a1130] px-2 py-0.5 text-[11px] text-[#8896b4]">
                    {part}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {deliveries.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#8896b4]">Dernières livraisons</h4>
          <ul className="divide-y divide-[#132255] rounded-lg border border-[#132255] bg-[#080d24]">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-[#dde1e4] truncate">
                    <span className="font-mono text-[#4d9fe8]">{delivery.eventType}</span>
                    {delivery.summary ? ` — ${delivery.summary}` : ""}
                  </p>
                  <p className="text-[11px] text-[#8896b4]">
                    {new Date(delivery.createdAt).toLocaleString("fr-FR")} · {nameOf(delivery.endpointId)} ·{" "}
                    {delivery.attempts} tentative{delivery.attempts > 1 ? "s" : ""}
                    {delivery.lastStatus ? ` · HTTP ${delivery.lastStatus}` : ""}
                    {delivery.lastError ? ` · ${delivery.lastError.slice(0, 120)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DeliveryBadge delivery={delivery} />
                  {delivery.status === "failed" && (
                    <SmallButton onClick={() => void redeliver(delivery)} disabled={busy !== null} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                      Renvoyer
                    </SmallButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Modifier le webhook" : "Nouveau webhook sortant"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <WebhookForm draft={editing.draft} setDraft={(draft) => setEditing({ ...editing, draft })} options={options} />
              <Button
                onClick={() => void save()}
                disabled={busy === "save" || !editing.draft.name.trim() || !editing.draft.url.trim()}
                className="w-full bg-[#0251a1] hover:bg-[#0363c2] text-white"
              >
                <Check className="h-4 w-4" />
                {editing.id ? "Enregistrer" : "Créer le webhook"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Secret de signature — {revealed?.endpoint.name}</DialogTitle>
          </DialogHeader>
          {revealed && (
            <div className="space-y-4">
              <p className="text-xs text-amber-300">
                Ce secret ne sera plus jamais affiché. Reportez-le dans la route Hermes ; en cas de perte, régénérez-le.
              </p>
              <CopyBlock label="Secret" value={revealed.secret} />
              <CopyBlock label="Route à ajouter côté Hermes" value={hermesRouteSnippet(revealed.endpoint, revealed.secret)} />
              <p className="text-[11px] text-[#8896b4]">
                Une fois Hermes redémarré, utilisez « Tester » : l&apos;événement <span className="font-mono">sentinel.test</span>{" "}
                doit être accepté (HTTP 2xx).
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeliveryBadge({ delivery }: { delivery: Delivery }) {
  if (delivery.status === "success") {
    return <Badge className="bg-green-500/10 text-green-400 border-green-500/25">livré</Badge>;
  }
  if (delivery.status === "failed") {
    return <Badge className="bg-red-500/10 text-red-400 border-red-500/25">échec</Badge>;
  }
  return (
    <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/25" title={`Prochain essai : ${new Date(delivery.nextAttemptAt).toLocaleTimeString("fr-FR")}`}>
      en attente
    </Badge>
  );
}

function SmallButton({
  children,
  icon,
  onClick,
  disabled,
  title,
  danger,
}: {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
        danger
          ? "border-red-500/25 text-red-400 hover:bg-red-500/10"
          : "border-[#132255] text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export function HermesIntegration() {
  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-[#dde1e4] flex items-center gap-2">
          <Bot className="h-4 w-4 text-[#0251a1]" />
          Hermes Agent
        </CardTitle>
        <CardDescription className="text-[#8896b4]">
          Relier un agent Hermes à Sentinel : il surveille et agit à travers la plateforme (MCP), et Sentinel le
          prévient des alarmes et pannes que vous choisissez (webhooks).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <HermesMcpCard />
        <HermesStatus />
        <div className="border-t border-[#132255]" />
        <HermesSkill />
        <div className="border-t border-[#132255]" />
        <OutboundWebhooksManager />
      </CardContent>
    </Card>
  );
}
