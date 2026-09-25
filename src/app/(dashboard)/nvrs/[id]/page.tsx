"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  Pencil,
  Plug,
  Power,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { SeverityBadge, StatusBadge } from "@/components/alarm-badges";
import { ActionResult } from "./action-result";

type Rights = {
  available: boolean;
  unavailableReason?: string;
  username: string;
  group?: string;
  isAdmin: boolean;
  authorities: string[];
  capabilities: Record<string, boolean>;
  channels: { liveView: number[]; playback: number[]; ptz: number[] };
};

type Credential = {
  id: string;
  type: string;
  label: string | null;
  username: string;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  rights: Rights | null;
};

type NvrEventRow = {
  id: string;
  type: string;
  title: string | null;
  severity: string;
  status: string;
  channel: number | null;
  payload: unknown;
  receivedAt: string;
};

type Check = {
  id: string;
  success: boolean;
  latencyMs: number | null;
  message: string | null;
  actorLabel: string | null;
  createdAt: string;
};

type NvrDetail = {
  id: string;
  name: string;
  client: { id: string; name: string; code: string | null } | null;
  ip: string | null;
  port: number;
  httpPort: number;
  useHttps: boolean;
  serialNumber: string | null;
  model: string | null;
  firmware: string | null;
  location: string | null;
  notes: string | null;
  connectionMode: string;
  p2pSerial: string | null;
  status: string;
  lastSeen: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
  webhookToken: string;
  credentials: Credential[];
  events: NvrEventRow[];
  checks: Check[];
  createdAt: string;
  /** Faux quand ni l'IP ni le tunnel P2P ne permettent d'atteindre l'équipement. */
  reachable: boolean;
  p2p: { available: boolean; helper: string | null; activeTunnels: number };
};

type TestResult = {
  ok: boolean;
  reason?: string;
  message: string;
  latencyMs?: number;
  device?: Record<string, string | number | undefined>;
  rights?: Rights;
  credential?: { id: string; type: string; username: string };
};

const CREDENTIAL_TYPES = [
  { value: "admin", label: "Administrateur" },
  { value: "telesurveilleur", label: "Télésurveilleur" },
  { value: "installateur", label: "Installateur" },
  { value: "technicien", label: "Technicien" },
  { value: "client", label: "Client" },
];

const CAPABILITY_LABELS: Record<string, string> = {
  liveView: "Temps réel",
  playback: "Relecture",
  ptz: "PTZ",
  record: "Enregistrement",
  backup: "Export",
  configure: "Configuration",
  userManagement: "Gestion des comptes",
  reboot: "Redémarrage",
};

export default function NvrDetailPage() {
  const params = useParams();
  const router = useRouter();
  const nvrId = String(params.id);

  const [nvr, setNvr] = useState<NvrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [addCredOpen, setAddCredOpen] = useState(false);
  const [newCred, setNewCred] = useState({ type: "telesurveilleur", username: "", password: "" });
  const [editOpen, setEditOpen] = useState(false);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);

  const fetchNvr = useCallback(async () => {
    const res = await fetch(`/api/nvrs/${nvrId}`);
    if (res.ok) setNvr(await res.json());
    setLoading(false);
  }, [nvrId]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data: { id: string; name: string }[] = await res.json();
        setClients(data.map(({ id, name }) => ({ id, name })));
      }
    })();
  }, []);

  useEffect(() => {
    void fetchNvr();
  }, [fetchNvr]);

  const copyToClipboard = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copié`);
  };

  const runTest = async (credentialId?: string) => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId }),
      });
      const result: TestResult = await res.json();
      setTestResult(result);

      if (result.ok) toast.success(result.message);
      else toast.error(result.message);

      await fetchNvr();
    } catch {
      toast.error("Le test n'a pas pu être lancé");
    } finally {
      setTesting(false);
    }
  };

  const revealPassword = async (credId: string) => {
    if (revealed[credId]) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[credId];
        return next;
      });
      return;
    }

    const res = await fetch(`/api/nvrs/${nvrId}/credentials/${credId}/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Lecture impossible");
      return;
    }

    const data = await res.json();
    setRevealed((prev) => ({ ...prev, [credId]: data.password }));
  };

  const addCredential = async () => {
    const res = await fetch(`/api/nvrs/${nvrId}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCred),
    });

    if (res.ok) {
      setAddCredOpen(false);
      setNewCred({ type: "telesurveilleur", username: "", password: "" });
      toast.success("Compte ajouté");
      void fetchNvr();
      return;
    }

    const data = await res.json().catch(() => ({}));
    toast.error(data.error ?? "Ajout impossible");
  };

  const deleteCredential = async (credId: string) => {
    const res = await fetch(`/api/nvrs/${nvrId}/credentials/${credId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Compte supprimé");
      void fetchNvr();
    }
  };

  const webhookUrl =
    typeof window !== "undefined" && nvr
      ? `${window.location.origin}/api/webhooks/dahua/${nvr.webhookToken}`
      : "";

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48 bg-[#132255]" />
        <Skeleton className="h-64 w-full bg-[#132255]" />
      </div>
    );
  }

  if (!nvr) {
    return <div className="p-6 lg:p-8 text-[#8896b4]">NVR non trouvé.</div>;
  }

  const isP2p = nvr.connectionMode === "p2p";
  // Le P2P n'est plus un obstacle en soi : ce qui compte est de savoir si un
  // tunnel peut être ouvert sur cette instance.
  const unreachable = !nvr.reachable;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/nvrs")}
          className="text-[#8896b4] hover:text-[#dde1e4] hover:bg-[#132255]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-[200px]">
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">NVR</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">{nvr.name}</h1>
          <p className="text-[#8896b4] text-sm font-mono">
            {isP2p ? `P2P · ${nvr.p2pSerial ?? "—"}` : `${nvr.ip}:${nvr.httpPort}`}
            {nvr.client ? ` · ${nvr.client.name}` : ""}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Badge
            className={
              nvr.status === "online"
                ? "bg-green-500/10 text-green-400 border-green-500/20"
                : nvr.status === "offline"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-[#8896b4]/10 text-[#8896b4] border-[#8896b4]/20"
            }
          >
            {nvr.status === "online" ? "En ligne" : nvr.status === "offline" ? "Hors ligne" : "Inconnu"}
          </Badge>
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
          >
            <Pencil className="h-4 w-4" />
            Modifier
          </Button>
          <Button
            onClick={() => void runTest()}
            disabled={testing || unreachable}
            className="bg-[#0251a1] hover:bg-[#0363c2]"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Tester la connexion
          </Button>
        </div>
      </div>

      <EditNvrDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        nvr={nvr}
        clients={clients}
        onSaved={() => {
          setEditOpen(false);
          void fetchNvr();
        }}
      />

      {isP2p &&
        (nvr.p2p.available ? (
          <Card className="border-[#0251a1]/25 bg-[#0251a1]/5">
            <CardContent className="py-4 text-sm text-[#8fc3f5]">
              Enregistreur en <strong>P2P</strong> : SENTINEL ouvre un tunnel vers l&apos;équipement
              à partir de son numéro de série{" "}
              <span className="font-mono">{nvr.p2pSerial ?? nvr.serialNumber}</span> et des
              identifiants enregistrés ici. Tests d&apos;accès, droits et interventions fonctionnent
              comme sur un enregistreur joignable par IP.
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="py-4 text-sm text-amber-300/90">
              Enregistreur en <strong>P2P</strong>, mais l&apos;accès P2P n&apos;est pas activé sur
              cette instance : renseigner <span className="font-mono">DAHUA_P2P_HELPER</span> pour
              ouvrir des tunnels par numéro de série. En attendant, seule la réception des alarmes
              par webhook fonctionne — les tests et interventions nécessiteraient une adresse IP
              joignable.
            </CardContent>
          </Card>
        ))}

      {testResult && <TestResultCard result={testResult} />}

      <Tabs defaultValue="info" className="space-y-6">
        <TabsList className="bg-[#0a1130] border border-[#132255] p-1 flex-wrap">
          {[
            ["info", "Informations"],
            ["credentials", "Accès"],
            ["actions", "Interventions"],
            ["events", "Alarmes"],
            ["webhook", "Webhook"],
          ].map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              className="data-[state=active]:bg-[#0251a1] data-[state=active]:text-white"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Informations */}
        <TabsContent value="info" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-[#dde1e4]">Détails</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Info label="Adresse IP" value={nvr.ip ?? "—"} mono />
                  <Info
                    label="Port API web"
                    value={`${nvr.httpPort}${nvr.useHttps ? " (HTTPS)" : ""}`}
                    mono
                  />
                  <Info label="Port SDK" value={String(nvr.port)} mono />
                  <Info label="N° de série" value={nvr.serialNumber ?? "—"} mono />
                  <Info label="Modèle" value={nvr.model ?? "—"} />
                  <Info label="Firmware" value={nvr.firmware ?? "—"} mono />
                </div>
                <Info label="Emplacement" value={nvr.location ?? "—"} />
                <Info
                  label="Client"
                  value={
                    nvr.client ? (
                      <Link href="/clients" className="text-[#4d9fe8] hover:underline inline-flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {nvr.client.name}
                      </Link>
                    ) : (
                      "Non affecté"
                    )
                  }
                />
                <Separator className="bg-[#132255]" />
                <div className="grid grid-cols-2 gap-4 text-xs text-[#8896b4]">
                  <div>Créé le {new Date(nvr.createdAt).toLocaleDateString("fr-FR")}</div>
                  <div>
                    Dernière activité :{" "}
                    {nvr.lastSeen ? new Date(nvr.lastSeen).toLocaleString("fr-FR") : "Jamais"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-[#dde1e4]">Derniers tests d&apos;accès</CardTitle>
                <CardDescription className="text-[#8896b4]">
                  {nvr.lastCheckAt
                    ? `Dernier test le ${new Date(nvr.lastCheckAt).toLocaleString("fr-FR")}`
                    : "Aucun test effectué"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {nvr.checks.length === 0 ? (
                  <p className="text-sm text-[#8896b4] py-6 text-center">
                    Lancez un test pour vérifier l&apos;accès à cet enregistreur.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {nvr.checks.map((check) => (
                      <li
                        key={check.id}
                        className="flex items-start gap-3 rounded-lg border border-[#132255] bg-[#080d24] p-3"
                      >
                        {check.success ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[#dde1e4]">{check.message}</p>
                          <p className="text-[11px] text-[#8896b4] mt-0.5">
                            {new Date(check.createdAt).toLocaleString("fr-FR")}
                            {check.latencyMs !== null ? ` · ${check.latencyMs} ms` : ""}
                            {check.actorLabel ? ` · ${check.actorLabel}` : ""}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Accès */}
        <TabsContent value="credentials" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[#dde1e4]">Comptes d&apos;accès</h2>
              <p className="text-xs text-[#8896b4] mt-0.5">
                Mots de passe chiffrés en base — chaque affichage est tracé dans le journal d&apos;audit
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={testing || unreachable || nvr.credentials.length === 0}
                onClick={() => void testAllCredentials(nvrId, setTesting, fetchNvr)}
                className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
              >
                <RefreshCw className={`h-4 w-4 ${testing ? "animate-spin" : ""}`} />
                Tester tous les comptes
              </Button>
              <Dialog open={addCredOpen} onOpenChange={setAddCredOpen}>
                <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-4 py-2 transition-all">
                  Ajouter un compte
                </DialogTrigger>
                <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
                  <DialogHeader>
                    <DialogTitle>Ajouter un compte</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select
                        value={newCred.type}
                        onValueChange={(value) =>
                          setNewCred({ ...newCred, type: value || "telesurveilleur" })
                        }
                      >
                        <SelectTrigger className="bg-[#080d24] border-[#132255]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#080d24] border-[#132255]">
                          {CREDENTIAL_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Utilisateur</Label>
                      <Input
                        value={newCred.username}
                        onChange={(event) =>
                          setNewCred({ ...newCred, username: event.target.value })
                        }
                        className="bg-[#080d24] border-[#132255]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Mot de passe</Label>
                      <Input
                        type="password"
                        value={newCred.password}
                        onChange={(event) =>
                          setNewCred({ ...newCred, password: event.target.value })
                        }
                        className="bg-[#080d24] border-[#132255]"
                      />
                    </div>
                    <Button
                      onClick={() => void addCredential()}
                      className="w-full bg-[#0251a1] hover:bg-[#0363c2]"
                      disabled={!newCred.username || !newCred.password}
                    >
                      Ajouter
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {nvr.credentials.length === 0 ? (
            <Card className="border-[#132255] bg-[#0a1130]/60">
              <CardContent className="py-12 text-center text-[#8896b4]">
                <KeyRound className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Aucun compte enregistré</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {nvr.credentials.map((cred) => (
                <Card key={cred.id} className="border-[#132255] bg-[#0a1130]/60">
                  <CardContent className="py-4 space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            className={
                              cred.type === "admin"
                                ? "bg-red-500/10 text-red-400 border-red-500/25"
                                : "bg-[#0251a1]/10 text-[#4d9fe8] border-[#0251a1]/25"
                            }
                          >
                            {CREDENTIAL_TYPES.find((type) => type.value === cred.type)?.label ??
                              cred.type}
                          </Badge>
                          {cred.lastTestedAt && (
                            <span
                              className={`inline-flex items-center gap-1 text-xs ${
                                cred.lastTestOk ? "text-green-400" : "text-red-400"
                              }`}
                            >
                              {cred.lastTestOk ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <XCircle className="h-3.5 w-3.5" />
                              )}
                              testé le {new Date(cred.lastTestedAt).toLocaleDateString("fr-FR")}
                            </span>
                          )}
                        </div>

                        <p className="text-[#dde1e4] font-mono text-sm mt-2">{cred.username}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[#8896b4] font-mono text-sm">
                            {revealed[cred.id] ?? "••••••••"}
                          </p>
                          <button
                            type="button"
                            onClick={() => void revealPassword(cred.id)}
                            className="text-[#8896b4] hover:text-[#dde1e4]"
                            aria-label="Afficher le mot de passe"
                          >
                            {revealed[cred.id] ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                          {revealed[cred.id] && (
                            <button
                              type="button"
                              onClick={() => copyToClipboard(revealed[cred.id], "Mot de passe")}
                              className="text-[#8896b4] hover:text-[#dde1e4]"
                              aria-label="Copier le mot de passe"
                            >
                              <Copy className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={testing || unreachable}
                          onClick={() => void runTest(cred.id)}
                          className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
                        >
                          <Plug className="h-3.5 w-3.5" />
                          Tester
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => void deleteCredential(cred.id)}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </div>

                    {cred.rights && <RightsPanel rights={cred.rights} />}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Interventions */}
        <TabsContent value="actions">
          <ActionsPanel nvrId={nvrId} disabled={unreachable} credentials={nvr.credentials} />
        </TabsContent>

        {/* Alarmes */}
        <TabsContent value="events" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-[#dde1e4]">50 dernières alarmes</h2>
            <Link
              href={`/alarms?nvrId=${nvr.id}`}
              className="text-sm text-[#4d9fe8] hover:underline"
            >
              Ouvrir dans le centre d&apos;alarme
            </Link>
          </div>

          {nvr.events.length === 0 ? (
            <Card className="border-[#132255] bg-[#0a1130]/60">
              <CardContent className="py-12 text-center text-[#8896b4]">
                <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>Aucune alarme reçue pour cet enregistreur</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {nvr.events.map((event) => (
                <Card key={event.id} className="border-[#132255] bg-[#0a1130]/60">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <SeverityBadge severity={event.severity} />
                      <div className="min-w-0">
                        <p className="text-sm text-[#dde1e4] truncate">
                          {event.title ?? event.type}
                          {event.channel !== null ? ` — canal ${event.channel}` : ""}
                        </p>
                        <p className="text-[11px] text-[#8896b4]">
                          {new Date(event.receivedAt).toLocaleString("fr-FR")}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={event.status} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Webhook */}
        <TabsContent value="webhook" className="space-y-6">
          <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-[#dde1e4]">Configuration Alarm Center</CardTitle>
              <CardDescription className="text-[#8896b4]">
                Configurez cette URL dans le NVR pour recevoir ses événements en temps réel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">URL du webhook</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#080d24] border border-[#132255] rounded-md px-3 py-2 text-sm text-[#dde1e4] font-mono break-all">
                    {webhookUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-[#132255] text-[#8896b4]"
                    onClick={() => copyToClipboard(webhookUrl, "URL du webhook")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <AlarmCenterProvisioning nvrId={nvrId} disabled={unreachable} />

              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">
                  Configuration manuelle (si le provisionnement n&apos;est pas possible)
                </p>
                <ol className="text-[#8896b4] text-sm space-y-1 list-decimal list-inside">
                  <li>Accédez à l&apos;interface web du NVR</li>
                  <li>
                    Allez dans <strong>Configuration → Réseau → Centre d&apos;alarme</strong>
                  </li>
                  <li>Ajoutez l&apos;URL ci-dessus comme destination</li>
                  <li>Sélectionnez les types d&apos;événements à remonter</li>
                </ol>
                <p className="text-xs text-[#8896b4]/70 mt-3">
                  Les requêtes GET et POST sont acceptées (JSON, formulaire ou paramètres d&apos;URL).
                  Les alarmes identiques reçues coup sur coup sont regroupées pour ne pas saturer le flux.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

async function testAllCredentials(
  nvrId: string,
  setTesting: (value: boolean) => void,
  refresh: () => Promise<void>,
) {
  setTesting(true);
  try {
    const res = await fetch(`/api/nvrs/${nvrId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    const data = await res.json();
    const results: TestResult[] = data.results ?? [];
    const working = results.filter((result) => result.ok).length;

    if (results.length === 0) toast.error("Aucun compte à tester");
    else if (working === results.length) toast.success(`${working} compte(s) valides`);
    else toast.warning(`${working}/${results.length} compte(s) valides`);

    await refresh();
  } finally {
    setTesting(false);
  }
}

function TestResultCard({ result }: { result: TestResult }) {
  return (
    <Card
      className={
        result.ok
          ? "border-green-500/25 bg-green-500/5"
          : "border-red-500/25 bg-red-500/5"
      }
    >
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          {result.ok ? (
            <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <p className={`text-sm font-medium ${result.ok ? "text-green-300" : "text-red-300"}`}>
              {result.message}
            </p>
            {result.latencyMs !== undefined && (
              <p className="text-xs text-[#8896b4] mt-0.5">
                Réponse en {result.latencyMs} ms
                {result.credential ? ` · compte ${result.credential.username}` : ""}
              </p>
            )}
          </div>
        </div>

        {result.device && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-[#132255] pt-3">
            <Info label="Modèle" value={result.device.deviceType ?? "—"} />
            <Info label="N° de série" value={result.device.serialNumber ?? "—"} mono />
            <Info label="Firmware" value={result.device.softwareVersion ?? "—"} mono />
            <Info label="Heure NVR" value={result.device.deviceTime ?? "—"} mono />
          </div>
        )}

        {result.rights && <RightsPanel rights={result.rights} />}
      </CardContent>
    </Card>
  );
}

function RightsPanel({ rights }: { rights: Rights }) {
  if (!rights.available) {
    return (
      <p className="text-xs text-[#8896b4] border-t border-[#132255] pt-3">
        {rights.unavailableReason ?? "Droits non consultables avec ce compte."}
      </p>
    );
  }

  return (
    <div className="border-t border-[#132255] pt-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[#8896b4] uppercase tracking-wider">Droits constatés</span>
        {rights.group && (
          <Badge className="bg-[#132255] text-[#dde1e4] border-[#1a2d66]">
            groupe {rights.group}
          </Badge>
        )}
        {rights.isAdmin && (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/25">administrateur</Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(rights.capabilities).map(([capability, granted]) => (
          <span
            key={capability}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
              granted
                ? "border-green-500/25 bg-green-500/10 text-green-400"
                : "border-[#132255] bg-[#080d24] text-[#8896b4]/60 line-through"
            }`}
          >
            {CAPABILITY_LABELS[capability] ?? capability}
          </span>
        ))}
      </div>

      {rights.channels.liveView.length > 0 && (
        <p className="text-[11px] text-[#8896b4]">
          Canaux autorisés — temps réel : {rights.channels.liveView.join(", ")}
          {rights.channels.playback.length > 0
            ? ` · relecture : ${rights.channels.playback.join(", ")}`
            : ""}
        </p>
      )}
    </div>
  );
}

function ActionsPanel({
  nvrId,
  disabled,
  credentials,
}: {
  nvrId: string;
  disabled: boolean;
  credentials: Credential[];
}) {
  const [running, setRunning] = useState<string | null>(null);
  const [output, setOutput] = useState<{ action: string; data: unknown } | null>(null);
  const [credentialId, setCredentialId] = useState<string>("");
  const [confirmReboot, setConfirmReboot] = useState(false);

  const execute = async (action: string, actionParams: Record<string, unknown> = {}) => {
    setRunning(action);
    setOutput(null);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          params: actionParams,
          credentialId: credentialId || undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "L'action a échoué");
        return;
      }

      setOutput({ action, data: data.data });
      toast.success("Action exécutée");
    } finally {
      setRunning(null);
    }
  };

  const snapshot =
    output?.action === "snapshot" && output.data
      ? (output.data as { base64?: string; channel?: number })
      : null;

  const buttons: { action: string; label: string; icon: React.ReactNode; danger?: boolean }[] = [
    { action: "device-info", label: "Informations équipement", icon: <ShieldCheck className="h-4 w-4" /> },
    { action: "users", label: "Comptes de l'enregistreur", icon: <Users className="h-4 w-4" /> },
    { action: "channels", label: "Titres des canaux", icon: <Camera className="h-4 w-4" /> },
    { action: "storage", label: "État des disques", icon: <HardDrive className="h-4 w-4" /> },
    { action: "snapshot", label: "Capture canal 1", icon: <Camera className="h-4 w-4" /> },
    { action: "sync-time", label: "Mettre à l'heure", icon: <Clock className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-lg text-[#dde1e4]">Intervention à distance</CardTitle>
          <CardDescription className="text-[#8896b4]">
            Les actions utilisent un compte enregistré ; chacune est tracée dans le journal
            d&apos;audit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {credentials.length > 1 && (
            <div className="space-y-2 max-w-sm">
              <Label className="text-[#8896b4] text-xs">Compte utilisé</Label>
              <Select value={credentialId} onValueChange={(value) => setCredentialId(value ?? "")}>
                <SelectTrigger className="bg-[#080d24] border-[#132255]">
                  <SelectValue placeholder="Compte administrateur par défaut" />
                </SelectTrigger>
                <SelectContent className="bg-[#080d24] border-[#132255]">
                  {credentials.map((cred) => (
                    <SelectItem key={cred.id} value={cred.id}>
                      {cred.username} ({cred.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {buttons.map((button) => (
              <Button
                key={button.action}
                variant="outline"
                disabled={disabled || running !== null}
                onClick={() =>
                  void execute(button.action, button.action === "snapshot" ? { channel: 1 } : {})
                }
                className="justify-start border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
              >
                {running === button.action ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  button.icon
                )}
                {button.label}
              </Button>
            ))}

            <Button
              variant="outline"
              disabled={disabled || running !== null}
              onClick={() => setConfirmReboot(true)}
              className="justify-start border-red-500/25 bg-red-500/5 text-red-400 hover:bg-red-500/10"
            >
              <Power className="h-4 w-4" />
              Redémarrer le NVR
            </Button>
          </div>

          {disabled && (
            <p className="text-xs text-[#8896b4]">
              Enregistreur injoignable : renseignez une adresse IP, ou activez l&apos;accès P2P
              (DAHUA_P2P_HELPER) s&apos;il est déclaré par numéro de série.
            </p>
          )}
        </CardContent>
      </Card>

      {snapshot?.base64 && (
        <Card className="border-[#132255] bg-[#0a1130]/60">
          <CardHeader>
            <CardTitle className="text-base text-[#dde1e4]">
              Capture — canal {snapshot.channel ?? 1}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Image
              src={`data:image/jpeg;base64,${snapshot.base64}`}
              alt={`Capture du canal ${snapshot.channel ?? 1}`}
              width={960}
              height={540}
              unoptimized
              className="w-full rounded-lg border border-[#132255]"
            />
          </CardContent>
        </Card>
      )}

      {output && output.action !== "snapshot" && (
        <Card className="border-[#132255] bg-[#0a1130]/60">
          <CardHeader>
            <CardTitle className="text-base text-[#dde1e4]">
              {buttons.find((button) => button.action === output.action)?.label ?? output.action}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionResult action={output.action} data={output.data} />
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmReboot} onOpenChange={setConfirmReboot}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
          <DialogHeader>
            <DialogTitle>Redémarrer l&apos;enregistreur ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#8896b4]">
            L&apos;enregistrement est interrompu pendant toute la séquence de redémarrage, soit
            généralement une à deux minutes.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="secondary"
              onClick={() => setConfirmReboot(false)}
              className="bg-[#132255] hover:bg-[#1a2d66]"
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmReboot(false);
                void execute("reboot");
              }}
            >
              Redémarrer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type AlarmCenterOutcome = {
  section: string;
  applied: boolean;
  destination: { url: string; host: string; port: number; scheme: string };
  assignments: Record<string, string>;
  warnings: string[];
  before: unknown;
  after: unknown;
};

/**
 * Déclare SENTINEL comme destination d'alarme directement dans la
 * configuration du NVR, sans passer par son interface web.
 */
function AlarmCenterProvisioning({ nvrId, disabled }: { nvrId: string; disabled: boolean }) {
  const [scheme, setScheme] = useState<"https" | "http">("https");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AlarmCenterOutcome | null>(null);
  const [current, setCurrent] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const call = async (action: string, actionParams: Record<string, unknown>) => {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params: actionParams }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Opération impossible");
        return null;
      }
      return data.data;
    } finally {
      setBusy(null);
    }
  };

  const readCurrent = async () => {
    const data = await call("alarm-center", {});
    if (data) {
      setCurrent(data);
      setOutcome(null);
    }
  };

  const provision = async (dryRun: boolean) => {
    const data = (await call("configure-alarm-center", { scheme, dryRun })) as
      | AlarmCenterOutcome
      | null;
    if (data) {
      setOutcome(data);
      setCurrent(null);
      if (data.applied) toast.success("Centre d'alarme déclaré sur l'enregistreur");
      else toast.info("Simulation — aucune écriture sur l'enregistreur");
    }
  };

  return (
    <div className="rounded-lg border border-[#132255] bg-[#080d24] p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-[#dde1e4]">Provisionnement automatique</p>
        <p className="text-xs text-[#8896b4] mt-1">
          SENTINEL écrit son adresse dans les paramètres d&apos;alarme de l&apos;enregistreur. Rien
          à saisir sur le NVR.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-[#132255] overflow-hidden">
          {(["https", "http"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScheme(value)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scheme === value
                  ? "bg-[#0251a1] text-white"
                  : "bg-[#0a1130] text-[#8896b4] hover:text-[#dde1e4]"
              }`}
            >
              {value.toUpperCase()}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy !== null}
          onClick={() => void readCurrent()}
          className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
        >
          {busy === "alarm-center" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Lire la configuration
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy !== null}
          onClick={() => void provision(true)}
          className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
        >
          Simuler
        </Button>

        <Button
          size="sm"
          disabled={disabled || busy !== null}
          onClick={() => setConfirmOpen(true)}
          className="bg-[#0251a1] hover:bg-[#0363c2]"
        >
          {busy === "configure-alarm-center" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Déclarer SENTINEL
        </Button>
      </div>

      {disabled && (
        <p className="text-xs text-[#8896b4]">
          Enregistreur injoignable : la plateforme doit pouvoir l&apos;atteindre — par IP ou par
          tunnel P2P — pour écrire sa configuration.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-400 border border-red-500/25 bg-red-500/5 rounded-lg p-3">
          {error}
        </p>
      )}

      {outcome && (
        <div className="space-y-3 border-t border-[#132255] pt-3">
          <p className="text-xs text-[#8896b4]">
            Section <span className="font-mono text-[#dde1e4]">{outcome.section}</span> ·{" "}
            {outcome.applied ? "écriture effectuée" : "simulation"} · destination{" "}
            <span className="font-mono text-[#dde1e4]">{outcome.destination.url}</span>
          </p>

          {Object.keys(outcome.assignments).length > 0 ? (
            <ul className="space-y-1">
              {Object.entries(outcome.assignments).map(([path, value]) => (
                <li key={path} className="text-xs font-mono text-[#dde1e4]">
                  <span className="text-[#8896b4]">{path}</span> = {value}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-green-400">
              Aucune modification nécessaire — l&apos;enregistreur pointe déjà ici.
            </p>
          )}

          {outcome.warnings.map((warning) => (
            <p
              key={warning}
              className="text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5 rounded-lg p-3"
            >
              {warning}
            </p>
          ))}

          {outcome.after !== null && (
            <details>
              <summary className="cursor-pointer text-xs text-[#8896b4]">
                Configuration relue sur l&apos;enregistreur
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#0a1130] border border-[#132255] p-3 text-[11px] text-[#8896b4]">
                {JSON.stringify(outcome.after, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {current !== null && (
        <pre className="max-h-48 overflow-auto rounded-lg bg-[#0a1130] border border-[#132255] p-3 text-[11px] text-[#8896b4] border-t">
          {JSON.stringify(current, null, 2)}
        </pre>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
          <DialogHeader>
            <DialogTitle>Modifier la configuration de l&apos;enregistreur ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#8896b4]">
            Les paramètres d&apos;alarme du NVR vont être réécrits pour pointer sur SENTINEL en{" "}
            {scheme.toUpperCase()}. Si une télésurveillance tierce est déclarée à cet endroit, elle
            sera remplacée — utilisez « Simuler » pour voir les champs concernés avant d&apos;écrire.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              className="bg-[#132255] hover:bg-[#1a2d66]"
            >
              Annuler
            </Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                void provision(false);
              }}
              className="bg-[#0251a1] hover:bg-[#0363c2]"
            >
              Écrire la configuration
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Formulaire d'édition des informations d'un enregistreur. */
function EditNvrDialog({
  open,
  onOpenChange,
  nvr,
  clients,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nvr: NvrDetail;
  clients: { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: nvr.name,
    clientId: nvr.client?.id ?? "",
    connectionMode: nvr.connectionMode === "p2p" ? "p2p" : "ip",
    ip: nvr.ip ?? "",
    httpPort: nvr.httpPort,
    port: nvr.port,
    useHttps: nvr.useHttps,
    p2pSerial: nvr.p2pSerial ?? "",
    serialNumber: nvr.serialNumber ?? "",
    model: nvr.model ?? "",
    location: nvr.location ?? "",
    notes: nvr.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  // Réaligner le formulaire quand on rouvre le dialogue ou que le NVR change.
  useEffect(() => {
    if (open) {
      setForm({
        name: nvr.name,
        clientId: nvr.client?.id ?? "",
        connectionMode: nvr.connectionMode === "p2p" ? "p2p" : "ip",
        ip: nvr.ip ?? "",
        httpPort: nvr.httpPort,
        port: nvr.port,
        useHttps: nvr.useHttps,
        p2pSerial: nvr.p2pSerial ?? "",
        serialNumber: nvr.serialNumber ?? "",
        model: nvr.model ?? "",
        location: nvr.location ?? "",
        notes: nvr.notes ?? "",
      });
    }
  }, [open, nvr]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/nvrs/${nvr.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          clientId: form.clientId || null,
          connectionMode: form.connectionMode,
          ip: form.connectionMode === "ip" ? form.ip : null,
          httpPort: form.httpPort,
          port: form.port,
          useHttps: form.useHttps,
          p2pSerial: form.connectionMode === "p2p" ? form.p2pSerial : null,
          serialNumber: form.serialNumber || null,
          model: form.model || null,
          location: form.location || null,
          notes: form.notes || null,
        }),
      });
      if (res.ok) {
        toast.success("Enregistreur mis à jour");
        onSaved();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Mise à jour impossible");
      }
    } finally {
      setSaving(false);
    }
  };

  const valid =
    form.name.trim() && (form.connectionMode === "ip" ? form.ip.trim() : form.p2pSerial.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l&apos;enregistreur</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Nom *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-[#080d24] border-[#132255]"
            />
          </div>

          <div className="space-y-2">
            <Label>Client</Label>
            <Select
              value={form.clientId}
              onValueChange={(v) => setForm({ ...form, clientId: v ?? "" })}
            >
              <SelectTrigger className="bg-[#080d24] border-[#132255]">
                <SelectValue placeholder="Non affecté" />
              </SelectTrigger>
              <SelectContent className="bg-[#080d24] border-[#132255]">
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mode de connexion</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["ip", "p2p"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setForm({ ...form, connectionMode: mode })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    form.connectionMode === mode
                      ? "bg-[#0251a1] border-[#0251a1] text-white"
                      : "bg-[#080d24] border-[#132255] text-[#8896b4] hover:border-[#0251a1]/50"
                  }`}
                >
                  {mode === "ip" ? "IP directe" : "P2P Dahua"}
                </button>
              ))}
            </div>
          </div>

          {form.connectionMode === "ip" ? (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2 col-span-3 sm:col-span-1">
                <Label>Adresse IP *</Label>
                <Input
                  value={form.ip}
                  onChange={(e) => setForm({ ...form, ip: e.target.value })}
                  className="bg-[#080d24] border-[#132255] font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Port API web</Label>
                <Input
                  type="number"
                  value={form.httpPort}
                  onChange={(e) => setForm({ ...form, httpPort: Number(e.target.value) })}
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>
              <div className="space-y-2">
                <Label>Port SDK</Label>
                <Input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[#8896b4] col-span-3">
                <input
                  type="checkbox"
                  checked={form.useHttps}
                  onChange={(e) => setForm({ ...form, useHttps: e.target.checked })}
                  className="accent-[#0251a1]"
                />
                Interface web en HTTPS
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>N° de série P2P *</Label>
              <Input
                value={form.p2pSerial}
                onChange={(e) => setForm({ ...form, p2pSerial: e.target.value })}
                className="bg-[#080d24] border-[#132255] font-mono"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>N° de série</Label>
              <Input
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                className="bg-[#080d24] border-[#132255] font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Modèle</Label>
              <Input
                placeholder="DHI-NVR5208-8P-EI"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="bg-[#080d24] border-[#132255]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Emplacement</Label>
            <Input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="bg-[#080d24] border-[#132255]"
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-[#080d24] border-[#132255]"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              className="bg-[#132255] hover:bg-[#1a2d66]"
            >
              Annuler
            </Button>
            <Button
              onClick={() => void save()}
              disabled={!valid || saving}
              className="bg-[#0251a1] hover:bg-[#0363c2]"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Enregistrer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <Label className="text-[#8896b4] text-xs">{label}</Label>
      <p className={`text-[#dde1e4] text-sm ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
