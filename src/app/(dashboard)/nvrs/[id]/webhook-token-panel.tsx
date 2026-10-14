"use client";

import { useState } from "react";
import { AlertTriangle, Copy, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * URL du webhook d'un enregistreur et régénération de son jeton.
 *
 * Le jeton est l'unique secret qui authentifie l'enregistreur : le régénérer
 * invalide l'ancienne URL. Quand l'enregistreur est joignable, la nouvelle
 * adresse y est écrite avant que le jeton ne change ; sinon, il faut la
 * reporter à la main dans sa configuration.
 */

/** cuid v1 : jeton de l'ancienne génération, prévisible (voir src/lib/webhook-token.ts). */
const LEGACY_TOKEN_RE = /^c[a-z0-9]{24}$/;

type Provisioning = {
  applied: boolean;
  warnings: string[];
  destination: { url: string };
} | null;

export function WebhookTokenPanel({
  nvrId,
  token,
  reachable,
  canRotate,
  onRotated,
}: {
  nvrId: string;
  token: string;
  reachable: boolean;
  /** Réservé aux administrateurs : invalide l'URL en service. */
  canRotate: boolean;
  onRotated: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/dahua/${token}` : "";
  const legacy = LEGACY_TOKEN_RE.test(token);

  const copy = () => {
    navigator.clipboard.writeText(url);
    toast.success("URL du webhook copiée");
  };

  const rotate = async (provision: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/webhook-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provision }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Régénération impossible");
        return;
      }
      const provisioning = data.provisioning as Provisioning;
      if (!provisioning) {
        toast.success("Jeton régénéré — reporter la nouvelle URL dans la configuration de l'enregistreur");
      } else if (provisioning.applied) {
        toast.success("Jeton régénéré et nouvelle adresse écrite sur l'enregistreur");
      } else {
        toast.warning(
          "Jeton régénéré, mais aucun champ n'a changé sur l'enregistreur : vérifier sa configuration de notification HTTP",
        );
      }
      provisioning?.warnings?.forEach((warning) => toast.warning(warning));
      setConfirmOpen(false);
      onRotated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-[#8896b4] text-xs">URL du webhook</Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-[#080d24] border border-[#132255] rounded-md px-3 py-2 text-sm text-[#dde1e4] font-mono break-all">
          {url}
        </code>
        <Button variant="outline" size="icon" className="border-[#132255] text-[#8896b4]" onClick={copy}>
          <Copy className="h-4 w-4" />
        </Button>
        {canRotate && (
          <Button
            variant="outline"
            size="icon"
            className="border-[#132255] text-[#8896b4]"
            title="Régénérer le jeton"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        )}
      </div>

      {legacy && (
        <p className="flex items-start gap-2 text-xs text-amber-400 border border-amber-500/20 bg-amber-500/5 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Jeton de l&apos;ancienne génération, en partie prévisible :{" "}
            {canRotate
              ? "le régénérer dès que l'enregistreur est joignable. La nouvelle adresse est écrite automatiquement sur l'équipement."
              : "demander à un administrateur de le régénérer."}
          </span>
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4]">
          <DialogHeader>
            <DialogTitle>Régénérer le jeton du webhook ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[#8896b4]">
            L&apos;URL actuelle cessera d&apos;être acceptée. {reachable
              ? "La nouvelle adresse est d'abord écrite sur l'enregistreur ; si cette écriture échoue, le jeton actuel est conservé."
              : "L'enregistreur est injoignable : la nouvelle URL devra être reportée à la main dans sa configuration (Configuration → Réseau → Centre d'alarme)."}
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              className="bg-[#132255] hover:bg-[#1a2d66]"
              disabled={busy}
            >
              Annuler
            </Button>
            {reachable && (
              <Button
                variant="outline"
                onClick={() => void rotate(false)}
                className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
                disabled={busy}
              >
                Sans écrire sur le NVR
              </Button>
            )}
            <Button
              onClick={() => void rotate(reachable)}
              className="bg-[#0251a1] hover:bg-[#0363c2]"
              disabled={busy}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {reachable ? "Régénérer et écrire sur le NVR" : "Régénérer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
