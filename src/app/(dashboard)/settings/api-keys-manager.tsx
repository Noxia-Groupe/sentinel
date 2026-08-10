"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
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
import { toast } from "sonner";

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: { name: string | null; email: string } | null;
};

type ScopeInfo = { name: string; description: string };

export function ApiKeysManager() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [scopes, setScopes] = useState<ScopeInfo[]>([]);
  const [defaultScopes, setDefaultScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  // Le secret n'existe qu'une fois, à la création : on le garde à l'écran
  // jusqu'à ce que l'administrateur ferme la fenêtre.
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const res = await fetch("/api/api-keys");
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys);
      setScopes(data.scopes);
      setDefaultScopes(data.defaultScopes);
      setSelectedScopes((current) => (current.length ? current : data.defaultScopes));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const res = await fetch("/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scopes: selectedScopes }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error ?? "Création impossible");
      return;
    }

    const data = await res.json();
    setFreshSecret(data.secret);
    setName("");
    setSelectedScopes(defaultScopes);
    setCreateOpen(false);
    void load();
  };

  const revoke = async (id: string) => {
    const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Clé révoquée");
      void load();
    }
  };

  const copySecret = () => {
    if (!freshSecret) return;
    void navigator.clipboard.writeText(freshSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    );
  };

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-[#dde1e4] flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#0251a1]" />
            Clés d&apos;API
          </CardTitle>
          <CardDescription className="text-[#8896b4]">
            Accès programmatique à <span className="font-mono">/api/v1</span> pour les intégrations
            et les agents IA. Le contrat est publié sur{" "}
            <a href="/api/v1/openapi.json" className="text-[#4d9fe8] hover:underline">
              /api/v1/openapi.json
            </a>
            .
          </CardDescription>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger className="inline-flex items-center gap-2 rounded-lg bg-[#0251a1] hover:bg-[#0363c2] text-white font-medium text-sm px-3 py-2 transition-all shrink-0">
            <Plus className="h-4 w-4" />
            Nouvelle clé
          </DialogTrigger>
          <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
            <DialogHeader>
              <DialogTitle>Nouvelle clé d&apos;API</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Nom</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Agent de levée de doute"
                  className="bg-[#080d24] border-[#132255]"
                />
              </div>

              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {scopes.map((scope) => (
                    <label
                      key={scope.name}
                      className="flex items-start gap-3 rounded-lg border border-[#132255] bg-[#080d24] p-3 cursor-pointer hover:border-[#0251a1]/40"
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.name)}
                        onChange={() => toggleScope(scope.name)}
                        className="mt-0.5 accent-[#0251a1]"
                      />
                      <div>
                        <p className="text-sm font-mono text-[#dde1e4]">{scope.name}</p>
                        <p className="text-xs text-[#8896b4]">{scope.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
                {selectedScopes.includes("credentials:read") && (
                  <p className="text-xs text-amber-400">
                    Cette clé pourra lire les mots de passe des enregistreurs en clair. Chaque
                    lecture sera tracée dans le journal d&apos;audit.
                  </p>
                )}
              </div>

              <Button
                onClick={() => void create()}
                disabled={!name.trim() || selectedScopes.length === 0}
                className="w-full bg-[#0251a1] hover:bg-[#0363c2]"
              >
                Créer la clé
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent className="space-y-4">
        {freshSecret && (
          <div className="rounded-lg border border-green-500/25 bg-green-500/5 p-4 space-y-3">
            <p className="text-sm text-green-300 font-medium">
              Clé créée — copiez-la maintenant, elle ne sera plus jamais affichée.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-[#080d24] border border-[#132255] px-3 py-2 text-xs font-mono text-[#dde1e4] break-all">
                {freshSecret}
              </code>
              <Button
                size="icon"
                variant="outline"
                onClick={copySecret}
                className="border-[#132255] text-[#8896b4] shrink-0"
                aria-label="Copier la clé"
              >
                {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFreshSecret(null)}
              className="text-[#8896b4]"
            >
              J&apos;ai copié la clé
            </Button>
          </div>
        )}

        {loading ? (
          <Skeleton className="h-24 w-full bg-[#132255]" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-[#8896b4] py-6 text-center">
            Aucune clé d&apos;API. Créez-en une pour connecter un agent ou une intégration.
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => (
              <li
                key={key.id}
                className={`rounded-lg border border-[#132255] bg-[#080d24] p-4 ${
                  key.revokedAt ? "opacity-50" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-[#dde1e4]">{key.name}</span>
                      <code className="text-xs font-mono text-[#8896b4]">{key.prefix}…</code>
                      {key.revokedAt && (
                        <Badge className="bg-red-500/10 text-red-400 border-red-500/25">
                          Révoquée
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className="rounded-full border border-[#132255] bg-[#0a1130] px-2 py-0.5 text-[11px] font-mono text-[#8896b4]"
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-[#8896b4] mt-2">
                      Créée le {new Date(key.createdAt).toLocaleDateString("fr-FR")}
                      {key.createdBy ? ` par ${key.createdBy.name ?? key.createdBy.email}` : ""} ·{" "}
                      {key.lastUsedAt
                        ? `dernière utilisation le ${new Date(key.lastUsedAt).toLocaleString("fr-FR")}`
                        : "jamais utilisée"}
                    </p>
                  </div>

                  {!key.revokedAt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void revoke(key.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                      Révoquer
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
