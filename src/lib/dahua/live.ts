import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import type { Nvr, NvrCredential } from "@/generated/prisma/client";
import { decrypt } from "@/lib/crypto";
import { DahuaError } from "./http";
import { openTunnel } from "./p2p";

/**
 * Vidéo en direct : une seule caméra à la fois, flux SECONDAIRE uniquement
 * (`subtype=1`), pour ménager la liaison du site et celle de la plateforme.
 *
 * Sentinel lit le flux RTSP de la voie choisie (directement, ou à travers un
 * tunnel P2P ouvert sur le port RTSP) et le retransmet au navigateur en MJPEG
 * (`multipart/x-mixed-replace`), que toute balise <img> affiche sans lecteur
 * ni plugin. Le transcodage se fait avec ffmpeg, à cadence et qualité réduites.
 *
 * Les identifiants ne passent JAMAIS en argument de ffmpeg (lisibles dans la
 * liste des processus) : l'URL RTSP est écrite dans un fichier `ffconcat` en
 * 0600, lu par ffmpeg puis supprimé.
 */

/**
 * Exécutable ffmpeg (FFMPEG_PATH, sinon celui du PATH). Le nom par défaut est
 * assemblé à l'exécution : écrit en littéral dans un appel à `spawn`, il
 * conduit le traçage de fichiers du build à embarquer tout le projet.
 */
function ffmpegCommand(): string {
  return process.env.FFMPEG_PATH?.trim() || ["ff", "mpeg"].join("");
}

const MAX_STREAMS = Math.max(1, Number(process.env.LIVE_MAX_STREAMS ?? 3));
const MAX_DURATION_MS = Math.max(1, Number(process.env.LIVE_MAX_MINUTES ?? 10)) * 60_000;
const FPS = Math.min(Math.max(Number(process.env.LIVE_FPS ?? 6), 1), 15);
/** Qualité JPEG ffmpeg (2 = meilleure … 31 = plus légère). */
const QUALITY = Math.min(Math.max(Number(process.env.LIVE_QUALITY ?? 8), 2), 31);
const MAX_WIDTH = 704;
const START_TIMEOUT_MS = 20_000;
/** Données en attente tolérées pour un spectateur lent, au-delà on coupe. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export const LIVE_BOUNDARY = "ffmpeg";

type ActiveStream = { stop: (reason: string) => void; nvrId: string; channel: number; startedAt: number };

/** Directs en cours, un au plus par spectateur. */
const active = new Map<string, ActiveStream>();

export function liveStatus() {
  return { active: active.size, max: MAX_STREAMS, fps: FPS, maxMinutes: MAX_DURATION_MS / 60_000 };
}

/** Échappe une URL pour une directive `file '…'` du format ffconcat. */
function ffconcatQuote(value: string): string {
  return value.replace(/'/g, "%27");
}

function describeFfmpegFailure(stderr: string): DahuaError {
  const text = stderr.trim().split("\n").slice(-3).join(" ");
  if (/401|unauthorized/i.test(text)) {
    return new DahuaError("auth", "Flux vidéo refusé : identifiants invalides pour le RTSP");
  }
  if (/404|not found/i.test(text)) {
    return new DahuaError("invalid", "Voie vidéo introuvable sur l'enregistreur");
  }
  if (/refused|unreachable|timed out|timeout/i.test(text)) {
    return new DahuaError("unreachable", "Port RTSP injoignable — vérifier le port RTSP de l'enregistreur");
  }
  if (/ENOENT|not found|spawn/i.test(text)) {
    return new DahuaError("unsupported", "ffmpeg indisponible sur le serveur");
  }
  return new DahuaError("http", `Flux vidéo indisponible${text ? ` : ${text.slice(0, 300)}` : ""}`);
}

export async function openLiveStream(options: {
  nvr: Nvr;
  credential: NvrCredential;
  channel: number;
  viewerId: string;
  signal?: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const { nvr, credential, channel, viewerId, signal } = options;

  // Une seule caméra à la fois par spectateur : un nouveau direct remplace l'ancien.
  active.get(viewerId)?.stop("remplacé par un autre direct");
  if (active.size >= MAX_STREAMS) {
    throw new DahuaError("unsupported", `Trop de directs en cours (${MAX_STREAMS} au maximum) — réessayer plus tard`);
  }

  const username = credential.username;
  const password = decrypt(credential.encryptedPassword);

  // Point d'accès RTSP : direct, ou tunnel P2P ouvert sur le port RTSP.
  let host: string;
  let port: number;
  let release = () => {};
  if (nvr.connectionMode === "p2p") {
    const serial = nvr.p2pSerial ?? nvr.serialNumber;
    if (!serial) throw new DahuaError("invalid", "Aucun numéro de série P2P renseigné");
    const tunnel = await openTunnel({ serial, devicePort: nvr.rtspPort, username, password });
    host = tunnel.host;
    port = tunnel.port;
    release = tunnel.release;
  } else {
    if (!nvr.ip) throw new DahuaError("invalid", "Aucune adresse IP renseignée");
    host = nvr.ip;
    port = nvr.rtspPort;
  }

  const dir = await fs.mkdtemp(`${os.tmpdir()}/sentinel-live-`);
  const source = `${dir}/source.ffconcat`;
  const url =
    `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}` +
    `/cam/realmonitor?channel=${channel}&subtype=1`;
  await fs.writeFile(
    source,
    `ffconcat version 1.0\nfile '${ffconcatQuote(url)}'\noption rtsp_transport tcp\noption timeout 10000000\n`,
    { mode: 0o600 },
  );

  const child = spawn(
    ffmpegCommand(),
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-protocol_whitelist",
      "file,rtsp,tcp,udp,rtp",
      "-i",
      source,
      "-an",
      "-vf",
      `fps=${FPS},scale='min(${MAX_WIDTH},iw)':-2`,
      "-q:v",
      String(QUALITY),
      "-f",
      "mpjpeg",
      "-boundary_tag",
      LIVE_BOUNDARY,
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-2000);
  });

  let stopped = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = true;
    if (active.get(viewerId)?.stop === stop) active.delete(viewerId);
    clearTimeout(maxTimer);
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2000).unref?.();
    }
    release();
    void fs.rm(dir, { recursive: true, force: true });
    try {
      controllerRef?.close();
    } catch {
      // flux déjà fermé côté client
    }
    if (reason !== "fin normale") console.info(`[live] ${nvr.id} voie ${channel} arrêté : ${reason}`);
  };
  const maxTimer = setTimeout(() => stop("durée maximale atteinte"), MAX_DURATION_MS);
  maxTimer.unref?.();
  active.set(viewerId, { stop, nvrId: nvr.id, channel, startedAt: Date.now() });
  signal?.addEventListener("abort", () => stop("spectateur parti"), { once: true });

  // On attend la première image : une erreur (identifiants, voie…) remonte
  // alors proprement au lieu d'une image cassée.
  const first = await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DahuaError("unreachable", "Aucune image reçue en 20 s")), START_TIMEOUT_MS);
    child.stdout.once("data", (chunk: Buffer) => {
      clearTimeout(timer);
      resolve(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(describeFfmpegFailure(`${error.message} spawn`));
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(describeFfmpegFailure(stderr));
    });
  }).catch((error) => {
    stop("échec au démarrage");
    throw error;
  });

  // Le fichier d'URL n'est plus utile une fois le flux ouvert.
  void fs.rm(source, { force: true });

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controllerRef = controller;
        controller.enqueue(new Uint8Array(first));
        child.stdout.on("data", (chunk: Buffer) => {
          if (stopped) return;
          // Client trop lent (liaison saturée) : on coupe plutôt que d'accumuler.
          if ((controller.desiredSize ?? 0) < -MAX_BUFFERED_BYTES) {
            stop("spectateur trop lent");
            return;
          }
          controller.enqueue(new Uint8Array(chunk));
        });
        child.once("exit", () => stop("fin normale"));
      },
      cancel() {
        stop("spectateur parti");
      },
    },
    { highWaterMark: 1 << 20, size: (chunk) => chunk.byteLength },
  );
}
