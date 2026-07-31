"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type NvrSummary = {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string | null;
  model: string | null;
  location: string | null;
  status: string;
  lastSeen: string | null;
  webhookToken: string;
  credentials: { id: string; type: string; username: string }[];
};

const statusVariant: Record<string, "default" | "success" | "destructive" | "warning"> = {
  online: "success",
  offline: "destructive",
  error: "destructive",
  unknown: "default",
};

const statusLabel: Record<string, string> = {
  online: "En ligne",
  offline: "Hors ligne",
  error: "Erreur",
  unknown: "Inconnu",
};

export default function NvrsPage() {
  const router = useRouter();
  const [nvrs, setNvrs] = useState<NvrSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    ip: "",
    port: 37777,
    serialNumber: "",
    model: "",
    location: "",
    adminUsername: "",
    adminPassword: "",
  });

  const fetchNvrs = async () => {
    const res = await fetch("/api/nvrs");
    if (res.ok) {
      setNvrs(await res.json());
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchNvrs();
  }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/nvrs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        ip: form.ip,
        port: form.port,
        serialNumber: form.serialNumber || undefined,
        model: form.model || undefined,
        location: form.location || undefined,
        credentials:
          form.adminUsername && form.adminPassword
            ? [
                {
                  type: "admin",
                  username: form.adminUsername,
                  password: form.adminPassword,
                },
              ]
            : undefined,
      }),
    });

    if (res.ok) {
      setCreateOpen(false);
      setForm({
        name: "",
        ip: "",
        port: 37777,
        serialNumber: "",
        model: "",
        location: "",
        adminUsername: "",
        adminPassword: "",
      });
      toast.success("NVR ajouté avec succès");
      fetchNvrs();
    } else {
      toast.error("Erreur lors de l'ajout du NVR");
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const res = await fetch(`/api/nvrs/${deleteId}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteId(null);
      toast.success("NVR supprimé");
      fetchNvrs();
    }
  };

  const copyWebhookUrl = (token: string) => {
    const url = `${window.location.origin}/api/webhooks/dahua/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("URL du webhook copiée");
  };

  const filtered = nvrs.filter(
    (n) =>
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.ip.includes(search) ||
      n.serialNumber?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
            Enregistreurs
          </h1>
          <p className="text-zinc-400 mt-1">
            Gérez vos NVR Dahua et leurs accès
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-blue-600 text-white hover:bg-blue-700 h-10 px-4 py-2">
            <Plus className="mr-2 h-4 w-4" />
            Ajouter un NVR
          </DialogTrigger>
          <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-zinc-100">
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
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Adresse IP *</Label>
                  <Input
                    placeholder="192.168.1.100"
                    value={form.ip}
                    onChange={(e) => setForm({ ...form, ip: e.target.value })}
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Port TCP</Label>
                  <Input
                    type="number"
                    value={form.port}
                    onChange={(e) =>
                      setForm({ ...form, port: Number(e.target.value) })
                    }
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>N° de série</Label>
                <Input
                  placeholder="ex: 5H02A12PAX00001"
                  value={form.serialNumber}
                  onChange={(e) =>
                    setForm({ ...form, serialNumber: e.target.value })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>Modèle</Label>
                <Input
                  placeholder="ex: DHI-NVR5216-16P-4KS2E"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="space-y-2">
                <Label>Emplacement</Label>
                <Input
                  placeholder="ex: Local technique RDC"
                  value={form.location}
                  onChange={(e) =>
                    setForm({ ...form, location: e.target.value })
                  }
                  className="bg-zinc-800 border-zinc-700"
                />
              </div>
              <div className="border-t border-zinc-800 pt-4">
                <p className="text-sm font-medium mb-3">
                  Compte administrateur
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Utilisateur</Label>
                    <Input
                      placeholder="admin"
                      value={form.adminUsername}
                      onChange={(e) =>
                        setForm({ ...form, adminUsername: e.target.value })
                      }
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Mot de passe</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={form.adminPassword}
                      onChange={(e) =>
                        setForm({ ...form, adminPassword: e.target.value })
                      }
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                </div>
              </div>
              <Button
                onClick={handleCreate}
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={!form.name || !form.ip}
              >
                Créer l'enregistreur
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-800"
          />
        </div>
      </div>

      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-zinc-800 hover:bg-transparent">
                <TableHead className="text-zinc-400">Nom</TableHead>
                <TableHead className="text-zinc-400">IP</TableHead>
                <TableHead className="text-zinc-400">Modèle</TableHead>
                <TableHead className="text-zinc-400">Statut</TableHead>
                <TableHead className="text-zinc-400 w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i} className="border-zinc-800">
                    <TableCell>
                      <Skeleton className="h-5 w-32 bg-zinc-800" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24 bg-zinc-800" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-40 bg-zinc-800" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16 bg-zinc-800" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-8 bg-zinc-800" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow className="border-zinc-800">
                  <TableCell
                    colSpan={5}
                    className="text-center py-12 text-zinc-500"
                  >
                    {search
                      ? "Aucun résultat"
                      : "Aucun enregistreur. Ajoutez votre premier NVR."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((nvr) => (
                  <TableRow
                    key={nvr.id}
                    className="border-zinc-800 cursor-pointer hover:bg-zinc-800/50"
                    onClick={() => router.push(`/nvrs/${nvr.id}`)}
                  >
                    <TableCell className="font-medium text-zinc-100">
                      {nvr.name}
                    </TableCell>
                    <TableCell className="text-zinc-400 font-mono text-sm">
                      {nvr.ip}:{nvr.port}
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {nvr.model || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          statusVariant[nvr.status] === "success"
                            ? "default"
                            : statusVariant[nvr.status] === "destructive"
                            ? "destructive"
                            : "secondary"
                        }
                        className={
                          nvr.status === "online"
                            ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
                            : nvr.status === "offline"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-zinc-500/10 text-zinc-400"
                        }
                      >
                        {statusLabel[nvr.status] || nvr.status}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-zinc-800">
                          <MoreHorizontal className="h-4 w-4 text-zinc-400" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => router.push(`/nvrs/${nvr.id}`)}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Détails
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => copyWebhookUrl(nvr.webhookToken)}
                          >
                            <Copy className="mr-2 h-4 w-4" />
                            Copier URL webhook
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-400"
                            onClick={() => setDeleteId(nvr.id)}
                          >
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

      {/* Delete Confirmation */}
      <Dialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <DialogContent className="sm:max-w-sm bg-zinc-900 border-zinc-800 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
          </DialogHeader>
          <p className="text-zinc-400 text-sm">
            Cette action est irréversible. Toutes les données associées à ce NVR
            seront supprimées.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button variant="secondary" onClick={() => setDeleteId(null)}>
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
