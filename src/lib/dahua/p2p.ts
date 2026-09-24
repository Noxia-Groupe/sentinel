import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import { DahuaError } from "./http";

/**
 * Accès aux enregistreurs déclarés en P2P.
 *
 * Un NVR derrière du NAT n'a pas d'adresse joignable : il s'enregistre sur le
 * cloud Dahua avec son numéro de série, et les clients (DMSS, SmartPSS) passent
 * par ce cloud pour ouvrir un tunnel jusqu'à lui. Le transport utilisé est
 * PTCP (« PhonyTCP »), un encapsulage de TCP dans de l'UDP propre à Dahua : il
 * n'est pas documenté publiquement et ne s'implémente pas en TypeScript sans
 * une rétro-ingénierie complète.
 *
 * SENTINEL délègue donc uniquement l'établissement du tunnel à un utilitaire
 * externe — SDK Dahua officiel ou implémentation tierce — dont le seul contrat
 * est : « à partir d'un numéro de série, ouvrir un port TCP local qui aboutit
 * sur l'équipement ». Une fois ce port ouvert, tout le reste de la plateforme
 * (test d'accès, droits, interventions, provisionnement du centre d'alarme)
 * fonctionne sans rien changer, puisqu'il ne s'agit plus que d'un hôte et d'un
 * port comme un autre.
 *
 * Le tunnel est mutualisé entre les appels concurrents et refermé après une
 * période d'inactivité, pour ne pas ouvrir une session cloud par requête.
 */

/**
 * Commande à lancer, avec substitution de `{serial}`, `{port}` (port local à
 * ouvrir), `{host}` et `{devicePort}` (port visé sur l'équipement).
 *
 * Défaut : l'utilitaire `dh-p2p` embarqué dans l'image (voir Dockerfile), dont
 * le contrat est `--port [bind:]port:remote_port <serial>`.
 */
const HELPER_COMMAND =
  process.env.DAHUA_P2P_HELPER?.trim() ||
  "/usr/local/bin/dh-p2p --port {host}:{port}:{devicePort} {serial}";

/** Durée d'inactivité au bout de laquelle le tunnel est refermé. */
const IDLE_MS = Number(process.env.DAHUA_P2P_IDLE_MS ?? 120_000);

/** Délai laissé à l'utilitaire pour établir le tunnel. */
const READY_TIMEOUT_MS = Number(process.env.DAHUA_P2P_READY_TIMEOUT_MS ?? 20_000);

/**
 * Nombre de tentatives d'établissement du tunnel.
 *
 * Le cloud Dahua répond depuis plusieurs serveurs en tourniquet DNS, et
 * `dh-p2p` n'en interroge qu'un seul sans réessayer : s'il tombe sur un nœud
 * qui ne répond pas, il s'arrête. Chaque relance refait une résolution DNS et
 * vise donc potentiellement un autre serveur — c'est ce qui rattrape un nœud
 * momentanément indisponible.
 */
const CONNECT_ATTEMPTS = Math.max(1, Number(process.env.DAHUA_P2P_CONNECT_ATTEMPTS ?? 3));

/** Délai entre deux tentatives d'établissement. */
const RETRY_DELAY_MS = Number(process.env.DAHUA_P2P_RETRY_DELAY_MS ?? 800);

/**
 * Motif imprimé par l'utilitaire quand le tunnel est réellement prêt.
 *
 * `dh-p2p` ouvre son port TCP local dès le démarrage, avant même la fin du
 * handshake P2P : se fier au seul port ouvert conclurait « prêt » trop tôt et
 * la première requête resterait bloquée le temps du handshake. On attend donc
 * ce marqueur sur la sortie de l'utilitaire, avec repli sur le test du port
 * quand aucun marqueur n'est configuré (chaîne vide).
 */
const READY_PATTERN =
  process.env.DAHUA_P2P_READY_PATTERN ?? "Ready to connect";

const LOCAL_HOST = "127.0.0.1";

/** true si l'utilitaire est explicitement désactivé (variable vidée). */
function helperConfigured(): boolean {
  // Une variable définie mais vide désactive volontairement le P2P.
  return process.env.DAHUA_P2P_HELPER === undefined
    ? true // défaut embarqué
    : process.env.DAHUA_P2P_HELPER.trim().length > 0;
}

export function isP2pAvailable(): boolean {
  return helperConfigured() && Boolean(HELPER_COMMAND);
}

export type P2pStatus = {
  available: boolean;
  helper: string | null;
  activeTunnels: number;
};

export function p2pStatus(): P2pStatus {
  return {
    available: isP2pAvailable(),
    // La commande peut contenir des identifiants : on n'expose que le binaire.
    helper: HELPER_COMMAND ? (tokenize(HELPER_COMMAND)[0] ?? null) : null,
    activeTunnels: tunnels.size,
  };
}

export type TunnelHandle = {
  host: string;
  port: number;
  /** À appeler dès que l'appel est terminé — libère le tunnel mutualisé. */
  release: () => void;
};

type Tunnel = {
  serial: string;
  port: number;
  child: ChildProcess;
  ready: Promise<void>;
  refs: number;
  idleTimer?: NodeJS.Timeout;
  /** Dernières lignes de sortie de l'utilitaire, pour le diagnostic. */
  output: string[];
  /** Passé à true dès que le marqueur de disponibilité est vu sur la sortie. */
  readySeen: boolean;
};

const tunnels = new Map<string, Tunnel>();

/**
 * Découpe une commande en arguments, en respectant les guillemets.
 * On ne passe jamais par un shell : les valeurs substituées (numéro de série,
 * identifiants) ne peuvent donc pas injecter d'arguments supplémentaires.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return tokens;
}

function substitute(token: string, values: Record<string, string>): string {
  return token.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);
}

/** Réserve un port libre en le faisant attribuer par le noyau. */
function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, LOCAL_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Port indisponible"))));
    });
  });
}

function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: LOCAL_HOST, port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

/**
 * Attend que le tunnel soit réellement établi.
 *
 * Quand un marqueur de disponibilité est configuré (cas par défaut avec
 * `dh-p2p`), on l'attend : le port local est ouvert dès le lancement, bien
 * avant la fin du handshake, donc le seul fait qu'il réponde ne prouve rien.
 * Sans marqueur, on retombe sur le test du port.
 */
async function waitForReady(port: number, timeoutMs: number, tunnel: Tunnel): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const usesMarker = READY_PATTERN.length > 0;

  while (Date.now() < deadline) {
    if (tunnel.child.exitCode !== null || tunnel.child.signalCode !== null) {
      throw new DahuaError(
        "unreachable",
        `L'utilitaire P2P s'est arrêté avant d'établir le tunnel${describeOutput(tunnel)}`,
      );
    }

    if (usesMarker) {
      if (tunnel.readySeen) return;
    } else if (await portAccepts(port)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, usesMarker ? 100 : 250));
  }

  throw new DahuaError(
    "unreachable",
    `Tunnel P2P non établi après ${Math.round(timeoutMs / 1000)} s — ` +
      `l'enregistreur est peut-être hors ligne sur le cloud Dahua, ` +
      `ou exige une authentification sur le canal P2P${describeOutput(tunnel)}`,
  );
}

function describeOutput(tunnel: Tunnel): string {
  const parts: string[] = [];
  const code = tunnel.child.exitCode;
  const signal = tunnel.child.signalCode;
  if (code !== null && code !== 0) parts.push(`arrêt code ${code}`);
  if (signal) parts.push(`signal ${signal}`);

  const output = tunnel.output.join(" ").trim();
  // La cause utile (panic, erreur socket) est en FIN de sortie : on garde donc
  // la queue plutôt que la tête, et suffisamment large pour ne pas la couper.
  if (output) parts.push(output.length > 700 ? `…${output.slice(-700)}` : output);

  return parts.length ? ` : ${parts.join(" — ")}` : "";
}

/**
 * Ouvre (ou réutilise) un tunnel vers un enregistreur P2P.
 *
 * Les identifiants sont transmis à l'utilitaire par variables
 * d'environnement — jamais en arguments, qui seraient lisibles dans la liste
 * des processus.
 */
export async function openTunnel(options: {
  serial: string;
  devicePort: number;
  username: string;
  password: string;
}): Promise<TunnelHandle> {
  if (!isP2pAvailable()) {
    throw new DahuaError(
      "unsupported",
      "Accès P2P désactivé sur cette instance (DAHUA_P2P_HELPER vidé).",
    );
  }
  if (!options.serial) {
    throw new DahuaError(
      "invalid",
      "Aucun numéro de série P2P renseigné pour cet enregistreur",
    );
  }

  const existing = tunnels.get(options.serial);
  if (existing && existing.child.exitCode === null) {
    existing.refs += 1;
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = undefined;
    }
    try {
      await existing.ready;
    } catch (error) {
      release(existing);
      throw error;
    }
    return handleFor(existing);
  }

  // Plusieurs tentatives : chaque relance de `dh-p2p` refait une résolution DNS
  // et peut viser un autre serveur du cloud Dahua. On ne réessaie pas une erreur
  // de configuration (binaire introuvable) ni une authentification refusée.
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      return await establishTunnel(options);
    } catch (error) {
      lastError = error;
      const reason = error instanceof DahuaError ? error.reason : undefined;
      if (reason === "invalid" || reason === "auth" || reason === "forbidden") break;
      if (attempt < CONNECT_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

/** Une tentative unique : lance l'utilitaire et attend l'établissement du tunnel. */
async function establishTunnel(options: {
  serial: string;
  devicePort: number;
  username: string;
  password: string;
}): Promise<TunnelHandle> {
  const port = await allocatePort();
  const values = {
    serial: options.serial,
    port: String(port),
    host: LOCAL_HOST,
    devicePort: String(options.devicePort),
  };

  const [command, ...args] = tokenize(HELPER_COMMAND).map((token) => substitute(token, values));
  if (!command) {
    throw new DahuaError("invalid", "DAHUA_P2P_HELPER est vide");
  }

  const child = spawn(command, args, {
    env: {
      ...process.env,
      DAHUA_P2P_SERIAL: options.serial,
      DAHUA_P2P_USERNAME: options.username,
      DAHUA_P2P_PASSWORD: options.password,
      DAHUA_P2P_LOCAL_PORT: String(port),
      DAHUA_P2P_DEVICE_PORT: String(options.devicePort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tunnel: Tunnel = {
    serial: options.serial,
    port,
    child,
    refs: 1,
    output: [],
    ready: Promise.resolve(),
    readySeen: false,
  };

  const collect = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    // Le marqueur peut arriver au milieu d'un flux de lignes de log.
    if (READY_PATTERN.length > 0 && !tunnel.readySeen && text.includes(READY_PATTERN)) {
      tunnel.readySeen = true;
    }
    tunnel.output.push(text.trim());
    // On ne garde que les dernières lignes : un utilitaire bavard ne doit pas
    // faire enfler la mémoire du conteneur.
    if (tunnel.output.length > 20) tunnel.output.splice(0, tunnel.output.length - 20);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  child.once("error", (error) => {
    tunnel.output.push(`échec du lancement : ${error.message}`);
  });
  child.once("exit", () => {
    if (tunnels.get(options.serial) === tunnel) tunnels.delete(options.serial);
  });

  tunnel.ready = waitForReady(port, READY_TIMEOUT_MS, tunnel);
  tunnels.set(options.serial, tunnel);

  try {
    await tunnel.ready;
  } catch (error) {
    closeTunnel(tunnel);
    throw error;
  }

  return handleFor(tunnel);
}

function handleFor(tunnel: Tunnel): TunnelHandle {
  let released = false;
  return {
    host: LOCAL_HOST,
    port: tunnel.port,
    release: () => {
      // Un `release()` appelé deux fois ne doit pas décrémenter deux fois.
      if (released) return;
      released = true;
      release(tunnel);
    },
  };
}

function release(tunnel: Tunnel): void {
  tunnel.refs = Math.max(tunnel.refs - 1, 0);
  if (tunnel.refs > 0 || tunnel.idleTimer) return;

  tunnel.idleTimer = setTimeout(() => {
    if (tunnel.refs === 0) closeTunnel(tunnel);
  }, IDLE_MS);
  // Le minuteur ne doit pas retenir le processus au moment de l'arrêt.
  tunnel.idleTimer.unref?.();
}

function closeTunnel(tunnel: Tunnel): void {
  if (tunnel.idleTimer) clearTimeout(tunnel.idleTimer);
  if (tunnels.get(tunnel.serial) === tunnel) tunnels.delete(tunnel.serial);
  if (tunnel.child.exitCode === null) tunnel.child.kill();
}

/** Referme tous les tunnels — appelé à l'arrêt du serveur. */
export function closeAllTunnels(): void {
  for (const tunnel of [...tunnels.values()]) closeTunnel(tunnel);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => closeAllTunnels());
}
