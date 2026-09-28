"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  Copy,
  Download,
  KeyRound,
  ListChecks,
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
import {
  DEFAULT_ALARM_INSTRUCTIONS,
  DEFAULT_OUTAGE_INSTRUCTIONS,
  HERMES_SCHEDULE_REQUEST,
  MCP_PROMPTS,
  hermesConfigBlock,
  hermesSkill,
} from "@/lib/mcp/playbooks";

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
// 1. Connexion en une étape
// ---------------------------------------------------------------------------

/** Rafraîchit les blocs de la section après une connexion ou un test. */
const HERMES_CHANGED = "sentinel:hermes-changed";

const DELIVER_OPTIONS = ["telegram", "discord", "slack", "whatsapp", "signal", "email"];

type ConnectResult = {
  key: { secret: string; scopes: string[] };
  webhook: { id: string; url: string; secret: string } | null;
};

function HermesConnect() {
  const origin = useOrigin();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [deliver, setDeliver] = useState("telegram");
  const [allowControl, setAllowControl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);
  const [testing, setTesting] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/hermes/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl, allowControl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Connexion impossible");
        return;
      }
      setResult(data);
      window.dispatchEvent(new Event(HERMES_CHANGED));
      window.dispatchEvent(new Event("sentinel:api-keys-changed"));
    } finally {
      setBusy(false);
    }
  };

  const test = async (endpointId: string) => {
    setTesting(true);
    try {
      const res = await fetch(`/api/outbound-webhooks/${endpointId}/test`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        toast.success("Hermes a bien reçu le test : il doit vous répondre sur votre messagerie");
      } else {
        toast.error(`Hermes n'a pas reçu le test : ${data.status ? `HTTP ${data.status} — ` : ""}${data.error ?? ""}`);
      }
      window.dispatchEvent(new Event(HERMES_CHANGED));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[#4d9fe8]" />
          Connecter Hermes
        </h3>
        <p className="text-xs text-[#8896b4] leading-relaxed">
          Une seule étape : Sentinel prépare l&apos;accès de Hermes (outils MCP) et le webhook qui le réveille en cas
          d&apos;alarme ou de panne, puis vous donne <strong className="text-[#dde1e4]">un seul bloc</strong> à coller
          dans la configuration de Hermes. Ce que Hermes doit faire à chaque alarme se règle ensuite ici, dans
          « Consignes », sans retoucher Hermes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div className="space-y-1.5">
          <Label className="text-[#8896b4] text-xs">Adresse du webhook de Hermes</Label>
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="http://serveur-hermes:8644/webhooks/sentinel"
            className="bg-[#080d24] border-[#132255] font-mono text-sm"
          />
          <p className="text-[11px] text-[#8896b4]">
            Laisser vide si Hermes ne doit pas être réveillé par Sentinel (il pourra quand même l&apos;interroger).
          </p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[#8896b4] text-xs">Hermes vous répond sur</Label>
          <select
            value={deliver}
            onChange={(e) => setDeliver(e.target.value)}
            className="w-full rounded-md border border-[#132255] bg-[#080d24] px-3 py-2 text-sm text-[#dde1e4]"
          >
            {DELIVER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
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
            redémarrage (scope <span className="font-mono">nvr:control</span>). Sans cette case, Hermes observe,
            diagnostique et traite les alarmes, mais ne modifie pas les équipements.
          </span>
        </span>
      </label>

      <Button onClick={() => void connect()} disabled={busy} className="bg-[#0251a1] hover:bg-[#0363c2] text-white">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
        Connecter Hermes
      </Button>
      <p className="text-[11px] text-[#8896b4]">
        Relancer la connexion remplace la précédente : l&apos;ancienne clé est révoquée, le webhook garde ses filtres
        et ses consignes.
      </p>

      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Plus qu&apos;à coller ce bloc dans Hermes</DialogTitle>
          </DialogHeader>
          {result && (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-[#dde1e4]">
                <li>
                  Coller le bloc dans <span className="font-mono">~/.hermes/config.yaml</span>{" "}sur le serveur Hermes
                  (s&apos;il contient déjà <span className="font-mono">mcp_servers</span> ou{" "}
                  <span className="font-mono">platforms</span>, y ajouter les entrées « sentinel »).
                </li>
                <li>Redémarrer Hermes.</li>
                {result.webhook ? (
                  <li>
                    Cliquer sur « Tester la liaison » : Hermes interroge Sentinel et vous répond sur {deliver}.
                  </li>
                ) : (
                  <li>Demander à Hermes : « Donne-moi l&apos;état de Sentinel ».</li>
                )}
              </ol>
              <p className="text-xs text-amber-300">
                Ce bloc contient les secrets de connexion : il ne sera plus affiché. En cas de perte, relancez
                « Connecter Hermes ».
              </p>
              <CopyBlock
                label="Configuration Hermes (un seul bloc)"
                value={hermesConfigBlock({
                  origin,
                  mcpKey: result.key.secret,
                  webhookSecret: result.webhook?.secret,
                  deliver,
                })}
              />
              {result.webhook && (
                <Button
                  onClick={() => void test(result.webhook!.id)}
                  disabled={testing}
                  className="bg-[#0251a1] hover:bg-[#0363c2] text-white"
                >
                  {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Tester la liaison
                </Button>
              )}
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

type HermesWebhook = {
  id: string;
  url: string;
  enabled: boolean;
  lastDelivery: {
    eventType: string;
    status: "pending" | "success" | "failed";
    lastStatus: number | null;
    lastError: string | null;
    createdAt: string;
  } | null;
};

function HermesStatus() {
  const [data, setData] = useState<{
    keys: HermesKey[];
    activity: HermesActivity[];
    webhook: HermesWebhook | null;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/hermes/status");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("sentinel:api-keys-changed", refresh);
    window.addEventListener(HERMES_CHANGED, refresh);
    return () => {
      window.removeEventListener("sentinel:api-keys-changed", refresh);
      window.removeEventListener(HERMES_CHANGED, refresh);
    };
  }, [load]);

  const test = async (endpointId: string) => {
    setTesting(true);
    try {
      const res = await fetch(`/api/outbound-webhooks/${endpointId}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) toast.success("Test reçu par Hermes : il doit vous répondre sur votre messagerie");
      else toast.error(`Hermes n'a pas reçu le test : ${body.status ? `HTTP ${body.status} — ` : ""}${body.error ?? ""}`);
      await load();
    } finally {
      setTesting(false);
    }
  };

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
      {data?.webhook && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#132255] bg-[#080d24] px-3 py-2">
          <span className="text-sm text-[#dde1e4]">
            Sentinel → Hermes{" "}
            <span className="font-mono text-[11px] text-[#8896b4] break-all">{data.webhook.url}</span>
          </span>
          <span className="flex items-center gap-2 text-[11px] text-[#8896b4]">
            {!data.webhook.enabled ? (
              <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">désactivé</Badge>
            ) : !data.webhook.lastDelivery ? (
              <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/25">jamais testé</Badge>
            ) : data.webhook.lastDelivery.status === "success" ? (
              <Badge className="bg-green-500/10 text-green-400 border-green-500/25">reçu par Hermes</Badge>
            ) : data.webhook.lastDelivery.status === "failed" ? (
              <Badge className="bg-red-500/10 text-red-400 border-red-500/25">échec</Badge>
            ) : (
              <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">en cours</Badge>
            )}
            {data.webhook.lastDelivery && (
              <>
                dernier envoi {formatWhen(data.webhook.lastDelivery.createdAt)}
                {data.webhook.lastDelivery.status === "failed" && data.webhook.lastDelivery.lastError
                  ? ` — ${data.webhook.lastDelivery.lastError.slice(0, 80)}`
                  : ""}
              </>
            )}
            <SmallButton
              title="Envoyer un test à Hermes"
              icon={testing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              onClick={() => void test(data.webhook!.id)}
              disabled={testing}
            >
              Tester la liaison
            </SmallButton>
          </span>
        </div>
      )}
      {!data ? (
        <Skeleton className="h-16 w-full" />
      ) : data.keys.length === 0 ? (
        <p className="text-xs text-[#8896b4]">
          Hermes n&apos;est pas encore connecté : utilisez « Connecter Hermes » ci-dessus.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#132255] bg-[#080d24] px-3 py-2"
            >
              <span className="text-sm text-[#dde1e4]">
                Hermes → Sentinel{" "}
                <span className="font-mono text-[11px] text-[#8896b4]">
                  {key.name.replace(/^Hermes Agent\s*/, "")} {key.prefix}…
                </span>
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
// Consignes envoyées à Hermes
// ---------------------------------------------------------------------------

type InstructionsEndpoint = {
  id: string;
  name: string;
  alarmInstructions: string | null;
  outageInstructions: string | null;
};

function HermesInstructions() {
  const [endpoint, setEndpoint] = useState<InstructionsEndpoint | null | undefined>(undefined);
  const [alarm, setAlarm] = useState("");
  const [outage, setOutage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/outbound-webhooks");
    if (!res.ok) return;
    const data = (await res.json()) as { endpoints: InstructionsEndpoint[] };
    const hermes = data.endpoints.find((e) => e.name === "Hermes Agent") ?? null;
    setEndpoint(hermes);
    setAlarm(hermes?.alarmInstructions ?? DEFAULT_ALARM_INSTRUCTIONS);
    setOutage(hermes?.outageInstructions ?? DEFAULT_OUTAGE_INSTRUCTIONS);
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener(HERMES_CHANGED, refresh);
    return () => window.removeEventListener(HERMES_CHANGED, refresh);
  }, [load]);

  const save = async () => {
    if (!endpoint) return;
    setSaving(true);
    try {
      // Texte identique aux consignes par défaut : on n'enregistre rien, les
      // futures améliorations des consignes par défaut s'appliqueront.
      const res = await fetch(`/api/outbound-webhooks/${endpoint.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alarmInstructions: alarm.trim() === DEFAULT_ALARM_INSTRUCTIONS ? null : alarm,
          outageInstructions: outage.trim() === DEFAULT_OUTAGE_INSTRUCTIONS ? null : outage,
        }),
      });
      if (res.ok) toast.success("Consignes enregistrées : elles s'appliquent dès le prochain envoi");
      else toast.error((await res.json().catch(() => ({}))).error ?? "Enregistrement impossible");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[#dde1e4] flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[#4d9fe8]" />
          Consignes envoyées à Hermes
        </h3>
        <p className="text-xs text-[#8896b4] leading-relaxed">
          Jointes à chaque webhook : c&apos;est ce que Hermes fait en le recevant. Écrivez-les comme à un technicien ;
          elles s&apos;appliquent dès le prochain envoi, sans toucher à Hermes.
        </p>
      </div>
      {endpoint === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : endpoint === null ? (
        <p className="text-xs text-[#8896b4]">
          Disponible une fois Hermes connecté avec une adresse de webhook (« Connecter Hermes » ci-dessus).
        </p>
      ) : (
        <>
          <InstructionField
            label="À la réception d'une alarme"
            value={alarm}
            onChange={setAlarm}
            onReset={() => setAlarm(DEFAULT_ALARM_INSTRUCTIONS)}
          />
          <InstructionField
            label="Quand un enregistreur tombe en panne ou revient"
            value={outage}
            onChange={setOutage}
            onReset={() => setOutage(DEFAULT_OUTAGE_INSTRUCTIONS)}
          />
          <Button
            onClick={() => void save()}
            disabled={saving}
            className="bg-[#0251a1] hover:bg-[#0363c2] text-white"
          >
            <Check className="h-4 w-4" />
            Enregistrer les consignes
          </Button>
          <p className="text-[11px] text-[#8896b4]">
            Quelles alarmes réveillent Hermes (criticité, catégories, clients) : bouton « Modifier » du webhook « Hermes
            Agent » ci-dessous.
          </p>
        </>
      )}
    </div>
  );
}

function InstructionField({
  label,
  value,
  onChange,
  onReset,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-[#8896b4] text-xs">{label}</Label>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 text-[11px] text-[#4d9fe8] hover:text-[#dde1e4]"
        >
          <RotateCcw className="h-3 w-3" />
          Consignes par défaut
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={7}
        maxLength={4000}
        className="w-full rounded-md border border-[#132255] bg-[#080d24] px-3 py-2 text-sm leading-relaxed text-[#dde1e4]"
      />
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
          Pour aller plus loin (facultatif) : maintenance préventive
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
          . Les consignes ci-dessus suffisent pour réagir aux alarmes ; la compétence ci-dessous sert aux tournées
          préventives planifiées. La déposer dans{" "}
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

function hermesRouteSnippet(secret: string) {
  return `# ~/.hermes/config.yaml — sur le serveur Hermes
platforms:
  webhook:
    enabled: true
    extra:
      routes:
        sentinel:
          secret: "${secret}"
          prompt: |
            {instructions}

            Événement : {summary}
            Données complètes : {__raw__}
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
              <CopyBlock label="Route à ajouter côté Hermes" value={hermesRouteSnippet(revealed.secret)} />
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
          Relier un agent Hermes à Sentinel en une étape : Sentinel le réveille à chaque alarme ou panne choisie, avec
          les consignes à suivre, et Hermes interroge ou agit à travers Sentinel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <HermesConnect />
        <HermesStatus />
        <div className="border-t border-[#132255]" />
        <HermesInstructions />
        <div className="border-t border-[#132255]" />
        <OutboundWebhooksManager />
        <div className="border-t border-[#132255]" />
        <HermesSkill />
      </CardContent>
    </Card>
  );
}
