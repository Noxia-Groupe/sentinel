"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Diagnostic de l'accès P2P : pour chaque cloud Dahua (SmartPSS, DMSS),
 * présence de l'enregistreur puis tentative réelle de tunnel, avec le journal
 * complet — à copier pour le support.
 */

type Attempt = { auth: string; label: string; ok: boolean; durationMs: number; error: string | null; output: string };

type ProfileReport = {
  profile: string;
  label: string;
  cloud: { known: boolean | null; devP2PVersion: string | null; deviceVersion: string | null; output: string };
  attempts: Attempt[];
};

type Report = {
  serial: string;
  working: { profile: string; auth: string; label: string } | null;
  profiles: ProfileReport[];
  nvr: { name: string; model: string | null };
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function reportText(report: Report): string {
  const lines = [
    `Diagnostic P2P Sentinel — ${report.nvr.name} (${report.nvr.model ?? "modèle ?"}) — ${report.serial}`,
    `Date : ${new Date().toLocaleString("fr-FR")}`,
    `Accès fonctionnel : ${report.working?.label ?? "aucun"}`,
  ];
  for (const p of report.profiles) {
    lines.push(
      "",
      `=== ${p.label}`,
      `Cloud : ${p.cloud.known === true ? "équipement connu" : p.cloud.known === false ? "inconnu / hors ligne" : "indéterminé"}` +
        (p.cloud.devP2PVersion ? ` · P2P ${p.cloud.devP2PVersion}` : "") +
        (p.cloud.deviceVersion ? ` · firmware ${p.cloud.deviceVersion}` : ""),
      p.cloud.output,
    );
    for (const a of p.attempts) {
      lines.push(
        "",
        `--- Tunnel, ${a.label} : ${a.ok ? "établi" : "échec"} en ${seconds(a.durationMs)}${a.error ? ` — ${a.error}` : ""}`,
        a.output,
      );
    }
  }
  return lines.join("\n");
}

export function P2pDiagnosticButton({ nvrId }: { nvrId: string }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [copied, setCopied] = useState(false);

  const [progress, setProgress] = useState<string | null>(null);

  const run = async () => {
    setOpen(true);
    setRunning(true);
    setReport(null);
    setProgress(null);
    try {
      const res = await fetch(`/api/nvrs/${nvrId}/p2p-diagnostic`, { method: "POST" });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Diagnostic impossible");
        setOpen(false);
        return;
      }
      // Réponse diffusée ligne par ligne : étapes, puis résultat.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as { progress?: string; result?: Report; error?: string };
          if (message.progress) setProgress(message.progress);
          if (message.result) setReport(message.result);
          if (message.error) {
            toast.error(message.error);
            setOpen(false);
          }
        }
      }
    } catch {
      toast.error("Diagnostic interrompu");
      setOpen(false);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void run()}
        disabled={running}
        className="border-[#132255] bg-[#0a1130] text-[#dde1e4] hover:bg-[#132255]"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
        Diagnostic P2P
      </Button>
      <Dialog open={open} onOpenChange={(value) => !running && setOpen(value)}>
        <DialogContent className="border-[#132255] bg-[#0d1537] text-[#dde1e4] sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Diagnostic de l&apos;accès P2P</DialogTitle>
          </DialogHeader>
          {running ? (
            <div className="flex items-center gap-3 py-8 text-sm text-[#8896b4]">
              <Loader2 className="h-5 w-5 animate-spin text-[#4d9fe8]" />
              <span>
                {progress ?? "Préparation…"}
                <span className="block text-[11px]">
                  Les deux clouds Dahua (SmartPSS puis DMSS) sont testés : jusqu&apos;à 2 minutes.
                </span>
              </span>
            </div>
          ) : report ? (
            <div className="space-y-4">
              <p className="text-sm">
                {report.working ? (
                  <>
                    <Badge className="bg-green-500/10 text-green-400 border-green-500/25 mr-2">Accès rétabli</Badge>
                    Le tunnel s&apos;établit via <strong>{report.working.label}</strong> ; Sentinel l&apos;utilisera
                    désormais pour cet enregistreur.
                  </>
                ) : (
                  <>
                    <Badge className="bg-red-500/10 text-red-400 border-red-500/25 mr-2">Aucun accès</Badge>
                    Aucune combinaison ne permet d&apos;ouvrir le tunnel. Copiez le rapport ci-dessous pour analyse.
                  </>
                )}
              </p>
              {report.profiles.map((p) => (
                <div key={p.profile} className="space-y-2 rounded-lg border border-[#132255] bg-[#080d24] p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <strong className="text-[#dde1e4]">{p.label}</strong>
                    {p.cloud.known === true ? (
                      <Badge className="bg-green-500/10 text-green-400 border-green-500/25">connu du cloud</Badge>
                    ) : p.cloud.known === false ? (
                      <Badge className="bg-[#132255] text-[#8896b4] border-[#1a2d66]">inconnu / hors ligne</Badge>
                    ) : (
                      <Badge className="bg-amber-400/10 text-amber-300 border-amber-400/25">indéterminé</Badge>
                    )}
                    {p.cloud.devP2PVersion && <span className="text-[11px] text-[#8896b4]">P2P {p.cloud.devP2PVersion}</span>}
                    {p.cloud.deviceVersion && (
                      <span className="text-[11px] text-[#8896b4]">firmware {p.cloud.deviceVersion}</span>
                    )}
                  </div>
                  {p.attempts.map((a) => (
                    <div key={a.auth} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-[#8896b4]">{a.label} :</span>
                      {a.ok ? (
                        <Badge className="bg-green-500/10 text-green-400 border-green-500/25">
                          tunnel établi ({seconds(a.durationMs)})
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/10 text-red-400 border-red-500/25">
                          échec ({seconds(a.durationMs)})
                        </Badge>
                      )}
                      {a.error && <span className="text-red-300">{a.error}</span>}
                    </div>
                  ))}
                  <details>
                    <summary className="cursor-pointer text-[11px] text-[#8896b4] hover:text-[#dde1e4]">Journal</summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-[10px] text-[#8896b4]">
                      {p.cloud.output}
                      {p.attempts.map((a) => `\n\n--- ${a.label}\n${a.output}`).join("")}
                    </pre>
                  </details>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(reportText(report));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                Copier le rapport
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
