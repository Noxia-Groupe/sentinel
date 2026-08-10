"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Server,
  Plug,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type NvrSummary = {
  id: string;
  name: string;
  ip: string | null;
  port: number;
  httpPort: number;
  connectionMode: string;
  p2pSerial: string | null;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  status: string;
  lastSeen: string | null;
  lastCheckOk: boolean | null;
  webhookToken: string;
  openAlarms: number;
  client: { id: string; name: string; code: string | null } | null;
  credentials: { id: string; type: string; username: string }[];
};

type ClientOption = { id: string; name: string };

const statusLabel: Record<string, string> = {
  online: "En ligne",
  offline: "Hors ligne",
  error: "Erreur",
  unknown: "Inconnu",
};

const EMPTY_FORM = {
  name: "",
  clientId: "",
  ip: "",
  port: 37777,
  httpPort: 80,
  useHttps: false,
  serialNumber: "",
  model: "",
  location: "",
  connectionMode: "ip" as "ip" | "p2p",
  p2pSerial: "",
  adminUsername: "",
  adminPassword: "",
};

export function NvrsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [nvrs, setNvrs] = useState<NvrSummary[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string | null>(searchParams.get("clientId"));

  const [form, setForm] = useState(EMPTY_FORM);

  const fetchNvrs = useCallback(async () => {
    const query = clientFilter ? `?clientId=${clientFilter}` : "";
    const res = await fetch(`/api/nvrs${query}`);
    if (res.ok) setNvrs(await res.json());
    setLoading(false);
  }, [clientFilter]);

  useEffect(() => {
    void fetchNvrs();
  }, [fetchNvrs]);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data: { id: string; name: string }[] = await res.json();
        setClients(data.map(({ id, name }) => ({ id, name })));
      }
    })();
  }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/nvrs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        clientId: form.clientId || undefined,
        ip: form.connectionMode === "ip" ? form.ip : undefined,
        port: form.port,
        httpPort: form.httpPort,
        useHttps: form.useHttps,
        serialNumber: form.serialNumber || undefined,
        model: form.model || undefined,
        location: form.location || undefined,
        connectionMode: form.connectionMode,
        p2pSerial: form.connectionMode === "p2p" ? form.p2pSerial : undefined,
        credentials:
          form.adminUsername && form.adminPassword
            ? [{ type: "admin", username: form.adminUsername, password: form.adminPassword }]
            : undefined,
      }),
    });
    if (res.ok) {
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      toast.success("NVR ajouté avec succès");
      void fetchNvrs();
    } else {
      toast.error("Erreur lors de l&apos;ajout");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/nvrs/${deleteId}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteId(null);
      toast.success("NVR supprimé");
      void fetchNvrs();
    }
  };

  const copyWebhookUrl = (token: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/dahua/${token}`);
    toast.success("URL du webhook copiée");
  };

  const term = search.toLowerCase();
  const filtered = nvrs.filter(
    (n) =>
      n.name.toLowerCase().includes(term) ||
      (n.ip ?? "").includes(search) ||
      (n.client?.name ?? "").toLowerCase().includes(term) ||
      (n.location ?? "").toLowerCase().includes(term) ||
      n.serialNumber?.toLowerCase().includes(term)
  );

  const filteredClientName = clientFilter
    ? (clients.find((client) => client.id === clientFilter)?.name ?? "client sélectionné")
    : null;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">Sentinel</p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">Enregistreurs</h1>
          <p className="text-[#8896b4] mt-1 text-sm">Gérez vos NVR Dahua et leurs accès</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-4 py-2.5 transition-all duration-200 hover:shadow-lg hover:shadow-[#0251a1]/25">
            <Plus className="h-4 w-4" />
            Ajouter un NVR
          </DialogTrigger>
          <DialogContent className="sm:max-w-md border-[#132255] bg-[#0d1537] text-[#dde1e4]">
            <DialogHeader>
              <DialogTitle>Nouvel enregistreur</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Nom *</Label>
                <Input
                  placeholder="NVR Entrepôt Lyon"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                />
              </div>
              <div className="space-y-2">
                <Label>Client</Label>
                <Select
                  value={form.clientId}
                  onValueChange={(value) => setForm({ ...form, clientId: value ?? "" })}
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
                {clients.length === 0 && (
                  <p className="text-xs text-[#8896b4]">
                    Aucun client enregistré — créez-en un depuis la page Clients.
                  </p>
                )}
              </div>
              {/* Mode de connexion */}
              <div className="space-y-2">
                <Label>Mode de connexion</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, connectionMode: "ip" })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.connectionMode === "ip"
                        ? "bg-[#0251a1] border-[#0251a1] text-white"
                        : "bg-[#080d24] border-[#132255] text-[#8896b4] hover:border-[#0251a1]/50"
                    }`}
                  >
                    IP Directe
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, connectionMode: "p2p" })}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                      form.connectionMode === "p2p"
                        ? "bg-[#0251a1] border-[#0251a1] text-white"
                        : "bg-[#080d24] border-[#132255] text-[#8896b4] hover:border-[#0251a1]/50"
                    }`}
                  >
                    P2P Dahua
                  </button>
                </div>
              </div>
              {form.connectionMode === "ip" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Adresse IP *</Label>
                    <Input
                      placeholder="192.168.1.100"
                      value={form.ip}
                      onChange={(e) => setForm({ ...form, ip: e.target.value })}
                      className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Port API web</Label>
                    <Input
                      type="number"
                      value={form.httpPort}
                      onChange={(e) => setForm({ ...form, httpPort: Number(e.target.value) })}
                      className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                    />
                    <p className="text-xs text-[#8896b4]">
                      Port de l&apos;interface web (80 par défaut) — c&apos;est celui utilisé pour
                      les tests et les interventions.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Port SDK</Label>
                    <Input
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                      className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-sm text-[#8896b4]">
                      <input
                        type="checkbox"
                        checked={form.useHttps}
                        onChange={(e) => setForm({ ...form, useHttps: e.target.checked })}
                        className="accent-[#0251a1]"
                      />
                      HTTPS
                    </label>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>N° de série P2P *</Label>
                  <Input
                    placeholder="5H02A12PAX00001"
                    value={form.p2pSerial}
                    onChange={(e) => setForm({ ...form, p2pSerial: e.target.value })}
                    className="bg-[#080d24] border-[#132255] focus:border-[#0251a1] font-mono"
                  />
                  <p className="text-xs text-[#8896b4]">
                    Le NVR sera accessible via le cloud P2P Dahua (sans IP)
                  </p>
                </div>
              )}
              <div className="space-y-2">
                <Label>N° de série</Label>
                <Input
                  placeholder="ex: 5H02A12PAX00001"
                  value={form.serialNumber}
                  onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                  className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                />
              </div>
              <div className="space-y-2">
                <Label>Modèle</Label>
                <Input
                  placeholder="ex: DHI-NVR5216-16P-4KS2E"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                />
              </div>
              <div className="space-y-2">
                <Label>Emplacement</Label>
                <Input
                  placeholder="ex: Local technique RDC"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                />
              </div>
              <div className="border-t border-[#132255] pt-4">
                <p className="text-sm font-medium mb-3">Compte administrateur</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Utilisateur</Label>
                    <Input
                      placeholder="admin"
                      value={form.adminUsername}
                      onChange={(e) => setForm({ ...form, adminUsername: e.target.value })}
                      className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mot de passe</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={form.adminPassword}
                      onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                      className="bg-[#080d24] border-[#132255] focus:border-[#0251a1]"
                    />
                  </div>
                </div>
              </div>
              <Button
                onClick={handleCreate}
                className="w-full bg-[#0251a1] hover:bg-[#0363c2]"
                disabled={!form.name || (form.connectionMode === "ip" ? !form.ip : !form.p2pSerial)}
              >
                Créer l&apos;enregistreur
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8896b4]" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-[#0a1130] border-[#132255] focus:border-[#0251a1] text-[#dde1e4]"
          />
        </div>
        {clientFilter && (
          <button
            type="button"
            onClick={() => setClientFilter(null)}
            className="inline-flex items-center gap-1 rounded-full border border-[#0251a1]/40 bg-[#0251a1]/10 px-3 py-1.5 text-xs text-[#4d9fe8]"
          >
            Parc de {filteredClientName}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Table */}
      <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-[#132255] hover:bg-transparent">
                <TableHead className="text-[#8896b4] font-medium">Nom</TableHead>
                <TableHead className="text-[#8896b4] font-medium">Client</TableHead>
                <TableHead className="text-[#8896b4] font-medium">Adresse</TableHead>
                <TableHead className="text-[#8896b4] font-medium">Alarmes</TableHead>
                <TableHead className="text-[#8896b4] font-medium">Statut</TableHead>
                <TableHead className="text-[#8896b4] font-medium w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="border-[#132255]">
                    <TableCell><Skeleton className="h-5 w-32 bg-[#132255]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 bg-[#132255]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24 bg-[#132255]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-10 bg-[#132255]" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 bg-[#132255]" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-8 bg-[#132255]" /></TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="border-[#132255]">
                  <TableCell colSpan={6} className="text-center py-16 text-[#8896b4]">
                    <Server className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">{search ? "Aucun résultat" : "Aucun enregistreur"}</p>
                    <p className="text-xs mt-1 text-[#8896b4]/60">
                      {search ? "Essayez un autre terme" : "Ajoutez votre premier NVR"}
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((nvr) => (
                  <TableRow
                    key={nvr.id}
                    className="border-[#132255] cursor-pointer hover:bg-[#132255]/50 transition-colors"
                    onClick={() => router.push(`/nvrs/${nvr.id}`)}
                  >
                    <TableCell className="font-medium text-[#dde1e4]">
                      {nvr.name}
                      {nvr.location && (
                        <span className="block text-xs text-[#8896b4] font-normal">
                          {nvr.location}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[#8896b4]">{nvr.client?.name ?? "—"}</TableCell>
                    <TableCell className="text-[#8896b4] font-mono text-sm">
                      {nvr.ip ? `${nvr.ip}:${nvr.httpPort}` : `P2P · ${nvr.p2pSerial ?? nvr.serialNumber ?? "—"}`}
                    </TableCell>
                    <TableCell>
                      {nvr.openAlarms > 0 ? (
                        <Badge className="bg-red-500/10 text-red-400 border-red-500/25">
                          {nvr.openAlarms}
                        </Badge>
                      ) : (
                        <span className="text-[#8896b4] text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          nvr.status === "online"
                            ? "bg-green-500/10 text-green-400 border-green-500/20"
                            : nvr.status === "offline"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-[#8896b4]/10 text-[#8896b4] border-[#8896b4]/20"
                        }
                      >
                        {statusLabel[nvr.status] || nvr.status}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-[#132255] text-[#8896b4]">
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="border-[#132255] bg-[#0d1537]">
                          <DropdownMenuItem onClick={() => router.push(`/nvrs/${nvr.id}`)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Détails
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void testConnection(nvr.id, fetchNvrs)}>
                            <Plug className="mr-2 h-4 w-4" />
                            Tester la connexion
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => copyWebhookUrl(nvr.webhookToken)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copier URL webhook
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-[#132255]" />
                          <DropdownMenuItem className="text-red-400" onClick={() => setDeleteId(nvr.id)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm border-[#132255] bg-[#0d1537] text-[#dde1e4]">
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
          </DialogHeader>
          <p className="text-[#8896b4] text-sm">
            Cette action est irréversible. Toutes les données associées seront supprimées.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" onClick={() => setDeleteId(null)} className="bg-[#132255] hover:bg-[#1a2d66]">
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Lance un test de connexion depuis la liste et rafraîchit le statut affiché. */
async function testConnection(nvrId: string, refresh: () => Promise<void>) {
  const pending = toast.loading("Test de connexion…");
  try {
    const res = await fetch(`/api/nvrs/${nvrId}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const result: { ok: boolean; message: string } = await res.json();
    toast.dismiss(pending);
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
    await refresh();
  } catch {
    toast.dismiss(pending);
    toast.error("Le test n'a pas pu être lancé");
  }
}
