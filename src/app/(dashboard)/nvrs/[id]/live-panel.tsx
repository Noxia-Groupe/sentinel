"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Square, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Direct : une seule caméra à la fois, flux secondaire uniquement. Le flux
 * s'arrête dès qu'on change d'onglet, de caméra ou de page.
 */

type Camera = { channel: number; title: string | null; online: boolean | null };

export function LivePanel({ nvrId, disabled }: { nvrId: string; disabled: boolean }) {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [channel, setChannel] = useState<number>(1);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const loadCameras = useCallback(async () => {
    const res = await fetch(`/api/nvrs/${nvrId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cameras" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setListError(data.error ?? "Liste des caméras indisponible");
      // Repli : voies 1 à 8, sans titres.
      setCameras(Array.from({ length: 8 }, (_, i) => ({ channel: i + 1, title: null, online: null })));
      return;
    }
    const list = (data.data?.cameras ?? []) as Camera[];
    setCameras(list);
    const firstOnline = list.find((camera) => camera.online !== false);
    if (firstOnline) setChannel(firstOnline.channel);
  }, [nvrId]);

  useEffect(() => {
    if (!disabled) void loadCameras();
  }, [disabled, loadCameras]);

  // Quitter l'onglet ou la page coupe la connexion, donc le flux côté serveur.
  useEffect(() => () => setSrc(null), []);

  const start = (target: number) => {
    setError(null);
    setLoading(true);
    setSrc(`/api/nvrs/${nvrId}/live?channel=${target}&t=${Date.now()}`);
  };

  const stop = () => {
    if (imgRef.current) imgRef.current.src = "";
    setSrc(null);
    setLoading(false);
  };

  const onImageError = async () => {
    if (!src) return;
    setLoading(false);
    // Récupère le motif (identifiants, voie, port RTSP…) sans relancer de flux.
    const controller = new AbortController();
    try {
      const res = await fetch(src, { signal: controller.signal });
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        const data = await res.json();
        setError(data.error ?? "Direct indisponible");
      } else {
        setError("Le flux s'est interrompu.");
      }
    } catch {
      setError("Direct indisponible");
    } finally {
      controller.abort();
      setSrc(null);
    }
  };

  const label = (camera: Camera) =>
    `Voie ${camera.channel}${camera.title ? ` — ${camera.title}` : ""}${camera.online === false ? " (perte vidéo)" : ""}`;

  return (
    <Card className="border-[#132255] bg-[#0a1130]/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg text-[#dde1e4] flex items-center gap-2">
          <Video className="h-4 w-4 text-[#0251a1]" />
          Direct
        </CardTitle>
        <CardDescription className="text-[#8896b4]">
          Une caméra à la fois, en flux secondaire, pour ménager la liaison du site. Le direct se coupe
          automatiquement en quittant cet onglet et au bout de 10 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <p className="text-sm text-[#8896b4]">Enregistreur injoignable : direct indisponible.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 min-w-64 flex-1 max-w-md">
                <label className="text-xs text-[#8896b4]">Caméra</label>
                <select
                  value={channel}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setChannel(next);
                    if (src) start(next);
                  }}
                  disabled={!cameras}
                  className="w-full rounded-md border border-[#132255] bg-[#080d24] px-3 py-2 text-sm text-[#dde1e4]"
                >
                  {(cameras ?? []).map((camera) => (
                    <option key={camera.channel} value={camera.channel}>
                      {label(camera)}
                    </option>
                  ))}
                </select>
              </div>
              {src ? (
                <Button onClick={stop} variant="outline" className="border-[#132255] bg-[#080d24] text-[#dde1e4] hover:bg-[#132255]">
                  <Square className="h-4 w-4" />
                  Arrêter
                </Button>
              ) : (
                <Button onClick={() => start(channel)} disabled={!cameras} className="bg-[#0251a1] hover:bg-[#0363c2] text-white">
                  <Play className="h-4 w-4" />
                  Démarrer le direct
                </Button>
              )}
            </div>
            {listError && <p className="text-[11px] text-amber-300/80">{listError} — voies proposées par défaut.</p>}

            <div className="relative flex aspect-video w-full max-w-4xl items-center justify-center overflow-hidden rounded-lg border border-[#132255] bg-black">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- flux MJPEG continu, hors optimisation d'image
                <img
                  ref={imgRef}
                  src={src}
                  alt={`Direct voie ${channel}`}
                  className="h-full w-full object-contain"
                  onLoad={() => setLoading(false)}
                  onError={() => void onImageError()}
                />
              ) : (
                <p className="text-sm text-[#8896b4]">{error ?? "Choisir une caméra puis démarrer le direct."}</p>
              )}
              {loading && src && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 className="h-6 w-6 animate-spin text-[#dde1e4]" />
                </div>
              )}
            </div>
            {error && src === null && <p className="text-sm text-red-400">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
