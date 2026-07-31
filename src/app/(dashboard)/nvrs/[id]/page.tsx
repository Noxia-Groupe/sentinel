"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Settings,
  Shield,
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
  events: { id: string; type: string; payload: Record<string, unknown>; receivedAt: string }[];
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
    if (res.ok) setNvr(await res.json());
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    void fetchNvr();
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
    }
  };

  const deleteCredential = async (credId: string) => {
    const res = await fetch(`/api/nvrs/${params.id}/credentials/${credId}`, { method: "DELETE" });
    if (res.ok) { toast.success("Compte supprimé"); fetchNvr(); }
  };

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhooks/dahua/${nvr?.webhookToken}`
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

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/nvrs")}
          className="text-[#8896b4] hover:text-[#dde1e4] hover:bg-[#132255]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">NVR</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">{nvr.name}</h1>
          <p className="text-[#8896b4] text-sm font-mono">{nvr.ip}:{nvr.port}</p>
        </div>
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
      </div>

      <Tabs defaultValue="info" className="space-y-6">
        <TabsList className="bg-[#0a1130] border border-[#132255] p-1">
          <TabsTrigger value="info" className="data-[state=active]:bg-[#0251a1] data-[state=active]:text-white">Informations</TabsTrigger>
          <TabsTrigger value="credentials" className="data-[state=active]:bg-[#0251a1] data-[state=active]:text-white">Accès</TabsTrigger>
          <TabsTrigger value="events" className="data-[state=active]:bg-[#0251a1] data-[state=active]:text-white">Événements</TabsTrigger>
          <TabsTrigger value="webhook" className="data-[state=active]:bg-[#0251a1] data-[state=active]:text-white">Webhook</TabsTrigger>
        </TabsList>

        {/* Onglet Infos */}
        <TabsContent value="info" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-[#dde1e4]">Détails</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-[#8896b4] text-xs">Adresse IP</Label>
                    <p className="text-[#dde1e4] font-mono text-sm">{nvr.ip}</p>
                  </div>
                  <div>
                    <Label className="text-[#8896b4] text-xs">Port TCP</Label>
                    <p className="text-[#dde1e4] font-mono text-sm">{nvr.port}</p>
                  </div>
                  <div>
                    <Label className="text-[#8896b4] text-xs">N° de série</Label>
                    <p className="text-[#dde1e4] font-mono text-sm">{nvr.serialNumber || "—"}</p>
                  </div>
                  <div>
                    <Label className="text-[#8896b4] text-xs">Modèle</Label>
                    <p className="text-[#dde1e4] text-sm">{nvr.model || "—"}</p>
                  </div>
                </div>
                <div>
                  <Label className="text-[#8896b4] text-xs">Emplacement</Label>
                  <p className="text-[#dde1e4] text-sm">{nvr.location || "—"}</p>
                </div>
                <Separator className="bg-[#132255]" />
                <div className="grid grid-cols-2 gap-4 text-xs text-[#8896b4]">
                  <div>Créé le {new Date(nvr.createdAt).toLocaleDateString("fr-FR")}</div>
                  <div>Dernière activité: {nvr.lastSeen ? new Date(nvr.lastSeen).toLocaleString("fr-FR") : "Jamais"}</div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="text-lg text-[#dde1e4]">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full justify-start border-[#132255] text-[#dde1e4] hover:bg-[#132255] hover:text-white">
                  <RefreshCw className="mr-2 h-4 w-4" /> Redémarrer le NVR
                </Button>
                <Button variant="outline" className="w-full justify-start border-[#132255] text-[#dde1e4] hover:bg-[#132255] hover:text-white">
                  <Settings className="mr-2 h-4 w-4" /> Configuration distante
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Onglet Accès */}
        <TabsContent value="credentials" className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-[#dde1e4]">Comptes d&apos;accès</h2>
            <Dialog open={addCredOpen} onOpenChange={setAddCredOpen}>
              <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-4 py-2 transition-all">
                Ajouter un compte
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm border-[#132255] bg-[#0d1537] text-[#dde1e4]">
                <DialogHeader><DialogTitle>Ajouter un compte</DialogTitle></DialogHeader>
                <div className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Type</Label>
                    <Select value={newCred.type} onValueChange={(v) => setNewCred({ ...newCred, type: v || "telesurveilleur" })}>
                      <SelectTrigger className="bg-[#080d24] border-[#132255]"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-[#080d24] border-[#132255]">
                        <SelectItem value="admin">Administrateur</SelectItem>
                        <SelectItem value="telesurveilleur">Télésurveilleur</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Utilisateur</Label>
                    <Input value={newCred.username} onChange={(e) => setNewCred({ ...newCred, username: e.target.value })} className="bg-[#080d24] border-[#132255]" />
                  </div>
                  <div className="space-y-2">
                    <Label>Mot de passe</Label>
                    <Input type="password" value={newCred.password} onChange={(e) => setNewCred({ ...newCred, password: e.target.value })} className="bg-[#080d24] border-[#132255]" />
                  </div>
                  <Button onClick={addCredential} className="w-full bg-[#0251a1] hover:bg-[#0363c2]" disabled={!newCred.username || !newCred.password}>
                    Ajouter
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {nvr.credentials.length === 0 ? (
              <p className="text-[#8896b4] text-sm py-8 text-center">Aucun compte configuré</p>
            ) : (
              nvr.credentials.map((cred) => (
                <Card key={cred.id} className="border-[#132255] bg-[#0a1130]/60">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <Badge className={cred.type === "admin" ? "bg-red-500/10 text-red-400 mb-1" : "bg-[#0251a1]/10 text-[#0251a1] mb-1"}>
                        {cred.type === "admin" ? "Administrateur" : "Télésurveilleur"}
                      </Badge>
                      <p className="text-[#dde1e4] font-mono text-sm mt-2">{cred.username}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[#8896b4] font-mono text-sm">
                          {showPasswords[cred.id] ? cred.password : "••••••••"}
                        </p>
                        <button onClick={() => togglePassword(cred.id)} className="text-[#8896b4] hover:text-[#dde1e4]">
                          {showPasswords[cred.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button onClick={() => cred.password && copyToClipboard(cred.password, "Mot de passe")} className="text-[#8896b4] hover:text-[#dde1e4]">
                          <Copy className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => deleteCredential(cred.id)}>
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
            <Card className="border-[#132255] bg-[#0a1130]/60">
              <CardContent className="py-12 text-center text-[#8896b4]">
                <Shield className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p>Aucun événement reçu pour ce NVR</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {nvr.events.map((event) => (
                <Card key={event.id} className="border-[#132255] bg-[#0a1130]/60">
                  <CardContent className="flex items-center justify-between py-3">
                    <div>
                      <Badge className="bg-amber-500/10 text-amber-400">{event.type}</Badge>
                      <span className="text-[#8896b4] text-xs ml-3">{new Date(event.receivedAt).toLocaleString("fr-FR")}</span>
                    </div>
                    <code className="text-xs text-[#8896b4] max-w-xs truncate">{JSON.stringify(event.payload)}</code>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Onglet Webhook */}
        <TabsContent value="webhook" className="space-y-6">
          <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-[#dde1e4]">Configuration Alarm Center</CardTitle>
              <CardDescription className="text-[#8896b4]">
                Configurez cette URL dans vos NVR Dahua pour recevoir les événements en temps réel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">URL du webhook</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-[#080d24] border border-[#132255] rounded-md px-3 py-2 text-sm text-[#dde1e4] font-mono break-all">{webhookUrl}</code>
                  <Button variant="outline" size="icon" className="border-[#132255] text-[#8896b4]" onClick={() => copyToClipboard(webhookUrl, "URL du webhook")}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4">
                <p className="text-amber-400 text-sm font-medium mb-2">Configuration Dahua</p>
                <ol className="text-[#8896b4] text-sm space-y-1 list-decimal list-inside">
                  <li>Accédez à l&apos;interface web du NVR</li>
                  <li>Allez dans <strong>Configuration → Réseau → Centre d&apos;alarme</strong></li>
                  <li>Ajoutez l&apos;URL ci-dessus comme destination</li>
                  <li>Sélectionnez les types d&apos;événements à remonter</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
