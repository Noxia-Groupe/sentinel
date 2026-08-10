"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Mail, MapPin, Phone, Plus, Search, Server, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type ClientRow = {
  id: string;
  name: string;
  code: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  nvrCount: number;
  onlineCount: number;
  nvrs: { id: string; name: string; status: string; location: string | null }[];
};

const EMPTY_FORM = {
  name: "",
  code: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  address: "",
  notes: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);

  const load = async () => {
    const res = await fetch("/api/clients");
    if (res.ok) setClients(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (res.ok) {
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      toast.success("Client créé");
      void load();
      return;
    }

    const data = await res.json().catch(() => ({}));
    toast.error(data.error ?? "Création impossible");
  };

  const remove = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/clients/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Client supprimé");
      setDeleteTarget(null);
      void load();
    } else {
      toast.error("Suppression impossible");
    }
  };

  const term = search.toLowerCase();
  const filtered = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(term) ||
      (client.code ?? "").toLowerCase().includes(term) ||
      (client.address ?? "").toLowerCase().includes(term),
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#0251a1] uppercase mb-1">
            Sentinel
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-[#dde1e4]">Clients</h1>
          <p className="text-[#8896b4] mt-1 text-sm">
            Chaque enregistreur est rattaché au client dont il protège le site
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-4 py-2.5 transition-all">
            <Plus className="h-4 w-4" />
            Ajouter un client
          </DialogTrigger>
          <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
            <DialogHeader>
              <DialogTitle>Nouveau client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <Field label="Nom *">
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Groupe Martin"
                  className="bg-[#080d24] border-[#132255]"
                />
              </Field>
              <Field label="Référence interne">
                <Input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="CLI-0042"
                  className="bg-[#080d24] border-[#132255] font-mono"
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contact">
                  <Input
                    value={form.contactName}
                    onChange={(event) => setForm({ ...form, contactName: event.target.value })}
                    className="bg-[#080d24] border-[#132255]"
                  />
                </Field>
                <Field label="Téléphone">
                  <Input
                    value={form.contactPhone}
                    onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
                    className="bg-[#080d24] border-[#132255]"
                  />
                </Field>
              </div>
              <Field label="E-mail">
                <Input
                  type="email"
                  value={form.contactEmail}
                  onChange={(event) => setForm({ ...form, contactEmail: event.target.value })}
                  className="bg-[#080d24] border-[#132255]"
                />
              </Field>
              <Field label="Adresse du site">
                <Input
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                  className="bg-[#080d24] border-[#132255]"
                />
              </Field>
              <Button
                onClick={() => void create()}
                disabled={!form.name.trim()}
                className="w-full bg-[#0251a1] hover:bg-[#0363c2]"
              >
                Créer le client
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8896b4]" />
        <Input
          placeholder="Rechercher un client…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pl-9 bg-[#0a1130] border-[#132255] text-[#dde1e4]"
        />
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full bg-[#132255]" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-[#132255] bg-[#0a1130]/60">
          <CardContent className="py-16 text-center text-[#8896b4]">
            <Building2 className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">
              {search ? "Aucun client ne correspond" : "Aucun client enregistré"}
            </p>
            <p className="text-xs mt-1 text-[#8896b4]/70">
              Créez une fiche client, puis rattachez-lui ses enregistreurs
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((client) => (
            <Card
              key={client.id}
              className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm hover:border-[#0251a1]/30 transition-colors"
            >
              <CardContent className="space-y-4 py-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[#dde1e4] font-semibold truncate">{client.name}</h2>
                    {client.code && (
                      <p className="text-xs text-[#8896b4] font-mono mt-0.5">{client.code}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(client)}
                    className="text-[#8896b4] hover:text-red-400 shrink-0"
                    aria-label={`Supprimer ${client.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-1.5 text-xs text-[#8896b4]">
                  {client.contactName && (
                    <p className="flex items-center gap-2">
                      <Building2 className="h-3.5 w-3.5" />
                      {client.contactName}
                    </p>
                  )}
                  {client.contactPhone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5" />
                      {client.contactPhone}
                    </p>
                  )}
                  {client.contactEmail && (
                    <p className="flex items-center gap-2 truncate">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      {client.contactEmail}
                    </p>
                  )}
                  {client.address && (
                    <p className="flex items-center gap-2 truncate">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {client.address}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-[#132255] pt-3">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-[#0251a1]/10 text-[#4d9fe8] border-[#0251a1]/25">
                      <Server className="h-3 w-3 mr-1" />
                      {client.nvrCount} NVR
                    </Badge>
                    {client.nvrCount > 0 && (
                      <span className="text-xs text-[#8896b4]">
                        {client.onlineCount} en ligne
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/nvrs?clientId=${client.id}`}
                    className="text-xs text-[#4d9fe8] hover:underline"
                  >
                    Voir le parc
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
          <DialogHeader>
            <DialogTitle>Supprimer {deleteTarget?.name} ?</DialogTitle>
          </DialogHeader>
          <p className="text-[#8896b4] text-sm">
            Les {deleteTarget?.nvrCount ?? 0} enregistreur(s) rattachés sont conservés : ils
            deviennent simplement non affectés.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              className="bg-[#132255] hover:bg-[#1a2d66]"
            >
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              Supprimer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[#8896b4]">{label}</Label>
      {children}
    </div>
  );
}
