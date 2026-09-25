"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  Check,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Role = "user" | "superadmin";
type Status = "authorized" | "banned" | "pending";

type Entry = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: Status;
  note: string | null;
  addedBy: string | null;
  lastLoginAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
  locked: boolean;
};

const ROLE_LABELS: Record<Role, string> = { user: "Utilisateur", superadmin: "Superadmin" };

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "jamais";
}

export function AccessManager({ currentEmail }: { currentEmail: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [bootstrap, setBootstrap] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState<Role>("user");

  const self = currentEmail.trim().toLowerCase();

  const load = useCallback(async () => {
    const res = await fetch("/api/access");
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries);
      setBootstrap(data.bootstrap);
    } else {
      toast.error("Liste d'accès indisponible");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy("add");
    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, note, role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Ajout impossible");
        return;
      }
      toast.success(`${data.email} est autorisé`);
      setAddOpen(false);
      setEmail("");
      setName("");
      setNote("");
      setRole("user");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const update = async (entry: Entry, patch: Partial<Pick<Entry, "status" | "role">>, done: string) => {
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/access/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Modification impossible");
        return;
      }
      toast.success(done);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: Entry) => {
    if (!window.confirm(`Retirer ${entry.email} de la liste ? Son accès sera coupé immédiatement.`)) {
      return;
    }
    setBusy(entry.id);
    try {
      const res = await fetch(`/api/access/${entry.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Suppression impossible");
        return;
      }
      toast.success(`${entry.email} retiré de la liste`);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const ban = (entry: Entry) => {
    if (!window.confirm(`Bannir ${entry.email} ? Ses sessions ouvertes seront coupées.`)) return;
    void update(entry, { status: "banned" }, `${entry.email} est banni`);
  };

  const pending = entries.filter((e) => e.status === "pending");
  const members = entries.filter((e) => e.status !== "pending" && !e.locked);

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle className="text-[#dde1e4] flex items-center gap-2">
            <Users className="h-4 w-4 text-[#0251a1]" />
            Accès à la plateforme
          </CardTitle>
          <CardDescription className="text-[#8896b4]">
            Seules les adresses autorisées ici peuvent se connecter, même avec un compte
            Microsoft valide. Un utilisateur voit et fait tout, sauf ces paramètres, réservés
            aux superadmins.
          </CardDescription>
        </div>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-3 py-2 transition-all shrink-0">
            <Plus className="h-4 w-4" />
            Autoriser une adresse
          </DialogTrigger>
          <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
            <DialogHeader>
              <DialogTitle>Autoriser une adresse</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">Adresse e-mail du compte Microsoft</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@entreprise.fr"
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">Nom (facultatif)</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">Rôle</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["user", "superadmin"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRole(value)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        role === value
                          ? "border-[#0251a1] bg-[#0251a1]/15 text-[#dde1e4]"
                          : "border-[#132255] bg-[#080d24] text-[#8896b4] hover:text-[#dde1e4]"
                      }`}
                    >
                      <span className="font-medium">{ROLE_LABELS[value]}</span>
                      <span className="block text-[11px] text-[#8896b4]">
                        {value === "user" ? "Tout, sauf les paramètres" : "Tout, paramètres compris"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[#8896b4] text-xs">Note (facultatif)</Label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Société, fonction…"
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>
              <Button
                onClick={() => void add()}
                disabled={!email.trim() || busy === "add"}
                className="w-full bg-[#0251a1] hover:bg-[#0363c2] text-white"
              >
                <Check className="h-4 w-4" />
                Autoriser
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full bg-[#132255]" />
            <Skeleton className="h-12 w-full bg-[#132255]" />
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                  Demandes d&apos;accès ({pending.length})
                </h3>
                <p className="text-xs text-[#8896b4]">
                  Comptes Microsoft qui ont tenté de se connecter sans être autorisés.
                </p>
                <ul className="divide-y divide-[#132255] rounded-lg border border-amber-400/20 bg-amber-400/5">
                  {pending.map((entry) => (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                      <Identity entry={entry} detail={`dernière tentative : ${formatDate(entry.lastAttemptAt)}`} />
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          disabled={busy === entry.id}
                          onClick={() =>
                            void update(entry, { status: "authorized", role: "user" }, `${entry.email} est autorisé`)
                          }
                          icon={<UserCheck className="h-3.5 w-3.5" />}
                          tone="positive"
                        >
                          Autoriser
                        </ActionButton>
                        <ActionButton
                          disabled={busy === entry.id}
                          onClick={() => ban(entry)}
                          icon={<Ban className="h-3.5 w-3.5" />}
                          tone="danger"
                        >
                          Bannir
                        </ActionButton>
                        <ActionButton
                          disabled={busy === entry.id}
                          onClick={() => void remove(entry)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Ignorer
                        </ActionButton>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8896b4]">
                Comptes
              </h3>
              <ul className="divide-y divide-[#132255] rounded-lg border border-[#132255] bg-[#080d24]">
                {bootstrap.map((address) => (
                  <li key={address} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-[#dde1e4] truncate">{address}</p>
                      <p className="text-[11px] text-[#8896b4] flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Défini par la configuration serveur (ADMIN_EMAILS) — non modifiable ici
                      </p>
                    </div>
                    <RoleBadge role="superadmin" />
                  </li>
                ))}

                {members.map((entry) => {
                  const isSelf = entry.email === self;
                  const banned = entry.status === "banned";
                  return (
                    <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                      <Identity
                        entry={entry}
                        detail={
                          banned
                            ? `banni · dernière tentative : ${formatDate(entry.lastAttemptAt)}`
                            : `dernière connexion : ${formatDate(entry.lastLoginAt)}`
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {banned ? (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/25">banni</Badge>
                        ) : (
                          <RoleBadge role={entry.role} />
                        )}
                        {isSelf ? (
                          <span className="text-[11px] text-[#8896b4]">(vous)</span>
                        ) : banned ? (
                          <ActionButton
                            disabled={busy === entry.id}
                            onClick={() =>
                              void update(entry, { status: "authorized" }, `${entry.email} est de nouveau autorisé`)
                            }
                            icon={<UserCheck className="h-3.5 w-3.5" />}
                            tone="positive"
                          >
                            Réautoriser
                          </ActionButton>
                        ) : (
                          <>
                            <ActionButton
                              disabled={busy === entry.id}
                              onClick={() =>
                                void update(
                                  entry,
                                  { role: entry.role === "superadmin" ? "user" : "superadmin" },
                                  entry.role === "superadmin"
                                    ? `${entry.email} passe utilisateur`
                                    : `${entry.email} devient superadmin`,
                                )
                              }
                              icon={<UserCog className="h-3.5 w-3.5" />}
                            >
                              {entry.role === "superadmin" ? "Passer utilisateur" : "Passer superadmin"}
                            </ActionButton>
                            <ActionButton
                              disabled={busy === entry.id}
                              onClick={() => ban(entry)}
                              icon={<Ban className="h-3.5 w-3.5" />}
                              tone="danger"
                            >
                              Bannir
                            </ActionButton>
                          </>
                        )}
                        {!isSelf && (
                          <ActionButton
                            disabled={busy === entry.id}
                            onClick={() => void remove(entry)}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            title="Retirer de la liste"
                          />
                        )}
                      </div>
                    </li>
                  );
                })}

                {bootstrap.length === 0 && members.length === 0 && (
                  <li className="px-3 py-6 text-center text-sm text-[#8896b4]">
                    Aucun compte autorisé pour l&apos;instant.
                  </li>
                )}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Identity({ entry, detail }: { entry: Entry; detail: string }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-[#dde1e4] truncate">
        {entry.name ? (
          <>
            {entry.name} <span className="text-[#8896b4]">· {entry.email}</span>
          </>
        ) : (
          entry.email
        )}
      </p>
      <p className="text-[11px] text-[#8896b4]">
        {detail}
        {entry.note ? ` · ${entry.note}` : ""}
      </p>
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  return role === "superadmin" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-[#0251a1]/30 bg-[#0251a1]/15 px-2 py-0.5 text-xs font-medium text-[#4d9fe8]">
      <ShieldCheck className="h-3 w-3" />
      Superadmin
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-[#132255] bg-[#0a1130] px-2 py-0.5 text-xs font-medium text-[#dde1e4]">
      Utilisateur
    </span>
  );
}

function ActionButton({
  children,
  icon,
  onClick,
  disabled,
  tone,
  title,
}: {
  children?: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "positive" | "danger";
  title?: string;
}) {
  const colors =
    tone === "positive"
      ? "border-green-500/25 text-green-400 hover:bg-green-500/10"
      : tone === "danger"
        ? "border-red-500/25 text-red-400 hover:bg-red-500/10"
        : "border-[#132255] text-[#8896b4] hover:bg-[#132255] hover:text-[#dde1e4]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${colors}`}
    >
      {icon}
      {children}
    </button>
  );
}
