"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Power,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

type Credential = {
  id: string;
  type: string;
  username: string;
  password?: string;
};

type NvrDetail = {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  notes: string | null;
  status: string;
  lastSeen: string | null;
  webhookToken: string;
  credentials: Credential[];
  events: { id: string; type: string; payload: any; receivedAt: string }[];
  createdAt: string;
  updatedAt: string;
};

export default function NvrDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [nvr, setNvr] = useState<NvrDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [addCredOpen, setAddCredOpen] = useState(false);
  const [newCred, setNewCred] = useState({ type: "telesurveilleur", username: "", password: "" });

  const fetchNvr = useCallback(async () => {
    const res = await fetch(`/api/nvrs/${params.id}`);
    if (res.ok) {
      setNvr(await res.json());
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    fetchNvr();
  }, [fetchNvr]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copié`);
  };

  const togglePassword = (credId: string) => {
    setShowPasswords((prev) => ({ ...prev, [credId]: !prev[credId] }));
  };

  const addCredential = async () => {
    const res = await fetch(`/api/nvrs/${params.id}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCred),
    });
    if (res.ok) {
      setAddCredOpen(false);
      setNewCred({ type: "telesurveilleur", username: "", password: "" });
      toast.success("Compte ajouté");
      fetchNvr();
    } else {
      toast.error("Erreur lors de l'ajout");
    }
  };

  const deleteCredential = async (credId: string) => {
    const res = await fetch(`/api/nvrs/${params.id}/credentials/${credId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Compte supprimé");
      fetchNvr();
    }
  };

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhooks/dahua/${nvr?.webhookToken}`
    : "";

  if (loading) {
    return (
      <div className="p-6 lg:p-8 space-y-6">
        <Skeleton className="h-8 w-48 bg-zinc-800" />
        <Skeleton className="h-64 w-full bg-zinc-800" />
      </div>
    );
  }

  if (!nvr) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-zinc-400">NVR non trouvé.</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/nvrs")}
          className="text-zinc-400 hover:text-zinc-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            {nvr.name}
          </h1>
          <p className="text-zinc-400 text-sm">{nvr.ip}:{nvr.port}</p>
        </div>
        <Badge
          className={
            nvr.status === "online"
              ? "bg-green-500/10 text-green-400"
              : nvr.status === "offline"
              ? "bg-red-500/10 text-red-400"
              : "bg-zinc-500/10 text-zinc-400"
          }
        >
          {nvr.status === "online" ? "En ligne" : nvr.status === "offline" ? "Hors ligne" : "Inconnu"}
        </Badge>
      </div>

      <Tabs defaultValue="info" className="space-y-6">
        <TabsList className="bg-zinc-900 border border-zinc-800">
          <TabsTrigger value="info">Informations</TabsTrigger>
          <TabsTrigger value="credentials">Accès</TabsTrigger>
          <TabsTrigger value="events">Événements</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
        </TabsList>

        {/* Onglet Infos */}
        <TabsContent value="info" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="text-lg">Détails</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-zinc-500 text-xs">Adresse IP</Label>
                    <p className="text-zinc-100 font-mono text-sm">{nvr.ip}</p>
                  </div>
                  <div>
                    <Label className="text-zinc-500 text-xs">Port TCP</Label>
                    <p className="text-zinc-100 font-mono text-sm">{nvr.port}</p>
                  </div>
                  <div>
                    <Label className="text-zinc-500 text-xs">N° de série</Label>
                    <p className="text-zinc-100 font-mono text-sm">
                      {nvr.serialNumber || "—"}
                    </p>
                  </div>
                  <div>
                    <Label className="text-zinc-500 text-xs">Modèle</Label>
                    <p className="text-zinc-100 text-sm">{nvr.model || "—"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-zinc-500 text-xs">Emplacement</Label>
                  <p className="text-zinc-100 text-sm">{nvr.location || "—"}</p>
                </div>
                <div>
                  <Label className="text-zinc-500 text-xs">Notes</Label>
                  <p className="text-zinc-400 text-sm">{nvr.notes || "—"}</p>
                </div>
                <Separator className="bg-zinc-800" />
                <div className="grid grid-cols-2 gap-4 text-xs text-zinc-500">
                  <div>
                    Créé le{" "}
                    {new Date(nvr.createdAt).toLocaleDateString("fr-FR")}
                  </div>
                  <div>
                    Dernière activité:{" "}
                    {nvr.lastSeen
                      ? new Date(nvr.lastSeen).toLocaleString("fr-FR")
                      : "Jamais"}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardHeader>
                <CardTitle className="text-lg">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Redémarrer le NVR
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Configuration distante
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Onglet Accès */}
        <TabsContent value="credentials" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-100">
              Comptes d'accès
            </h2>
            <Dialog open={addCredOpen} onOpenChange={setAddCredOpen}>
              <DialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 h-9 px-4 py-2">
                Ajouter un compte
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm bg-zinc-900 border-zinc-800 text-zinc-100">
                <DialogHeader>
                  <DialogTitle>Ajouter un compte</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select
                      value={newCred.type}
                      onValueChange={(v) => setNewCred({ ...newCred, type: v || "telesurveilleur" })}
                    >
                      <SelectTrigger className="bg-zinc-800 border-zinc-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="admin">Administrateur</SelectItem>
                        <SelectItem value="telesurveilleur">
                          Télésurveilleur
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Utilisateur</Label>
                    <Input
                      value={newCred.username}
                      onChange={(e) =>
                        setNewCred({ ...newCred, username: e.target.value })
                      }
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mot de passe</Label>
                    <Input
                      type="password"
                      value={newCred.password}
                      onChange={(e) =>
                        setNewCred({ ...newCred, password: e.target.value })
                      }
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  <Button
                    onClick={addCredential}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    disabled={!newCred.username || !newCred.password}
                  >
                    Ajouter
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {nvr.credentials.length === 0 ? (
              <p className="text-zinc-500 text-sm py-8 text-center">
                Aucun compte configuré
              </p>
            ) : (
              nvr.credentials.map((cred) => (
                <Card
                  key={cred.id}
                  className="border-zinc-800 bg-zinc-900/50"
                >
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <Badge
                        className={
                          cred.type === "admin"
                            ? "bg-red-500/10 text-red-400 mb-1"
                            : "bg-blue-500/10 text-blue-400 mb-1"
                        }
                      >
                        {cred.type === "admin"
                          ? "Administrateur"
                          : "Télésurveilleur"}
                      </Badge>
                      <p className="text-zinc-100 font-mono text-sm mt-2">
                        {cred.username}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-zinc-400 font-mono text-sm">
                          {showPasswords[cred.id]
                            ? cred.password
                            : "••••••••"}
                        </p>
                        <button
                          onClick={() => togglePassword(cred.id)}
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          {showPasswords[cred.id] ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() =>
                            cred.password &&
                            copyToClipboard(cred.password, "Mot de passe")
                          }
                          className="text-zinc-500 hover:text-zinc-300"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => deleteCredential(cred.id)}
                    >
                      Supprimer
                    </Button>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        {/* Onglet Événements */}
        <TabsContent value="events" className="space-y-6">
          {nvr.events.length === 0 ? (
            <Card className="border-zinc-800 bg-zinc-900/50">
              <CardContent className="py-12 text-center text-zinc-500">
                <p>Aucun événement reçu pour ce NVR</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {nvr.events.map((event) => (
                <Card
                  key={event.id}
                  className="border-zinc-800 bg-zinc-900/50"
                >
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <Badge className="bg-amber-500/10 text-amber-400">
                        {event.type}
                      </Badge>
                      <span className="text-zinc-500 text-xs ml-3">
                        {new Date(event.receivedAt).toLocaleString("fr-FR")}
                      </span>
                    </div>
                    <code className="text-xs text-zinc-400 max-w-xs truncate">
                      {JSON.stringify(event.payload)}
                    </code>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Onglet Webhook */}
        <TabsContent value="webhook" className="space-y-6">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader>
              <CardTitle className="text-lg">Configuration Alarm Center</CardTitle>
              <CardDescription className="text-zinc-400">
                Configurez cette URL dans vos NVR Dahua pour recevoir les
                événements en temps réel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-zinc-500 text-xs">URL du webhook</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-300 font-mono break-all">
                    {webhookUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-zinc-700"
                    onClick={() =>
                      copyToClipboard(webhookUrl, "URL du webhook")
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">
                  Configuration Dahua
                </p>
                <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                  <li>Accédez à l'interface web du NVR</li>
                  <li>
                    Allez dans <strong>Configuration → Réseau → Centre d'alarme</strong>
                  </li>
                  <li>Ajoutez l'URL ci-dessus comme destination</li>
                  <li>
                    Sélectionnez les types d'événements à remonter (alarmes,
                    disque, connexion, etc.)
                  </li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
