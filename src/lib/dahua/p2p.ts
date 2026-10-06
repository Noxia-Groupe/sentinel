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
 * ouvrir sur 127.0.0.1) et `{devicePort}` (port visé sur l'équipement).
 *
 * Défaut : l'utilitaire `dh-fwd` embarqué dans l'image (voir Dockerfile et
 * vendor/dh-fwd/VENDOR.md), dont le contrat est `<serial> -p local:remote`.
 * Les identifiants, le profil applicatif (`DAHUA_P2P_PROFILE`) et le mode
 * relais (`DAHUA_P2P_RELAY`) lui sont transmis par l'environnement — jamais en
 * arguments (argv est lisible dans la liste des processus).
 */
const HELPER_COMMAND =
  process.env.DAHUA_P2P_HELPER?.trim() ||
  "/usr/local/bin/dh-fwd {serial} -p {port}:{devicePort}";

/** Durée d'inactivité au bout de laquelle le tunnel est refermé. */
const IDLE_MS = Number(process.env.DAHUA_P2P_IDLE_MS ?? 120_000);

/**
 * Délai laissé à l'utilitaire pour établir le tunnel, par profil.
 *
 * Une tentative `dh-fwd` dure jusqu'à ~18 s quand l'enregistreur tarde à
 * répondre (15 s d'attente de son accusé de réception). Deux profils × 25 s
 * restent sous les 60 s qu'accorde par défaut un reverse proxy (Nginx Proxy
 * Manager) à une requête.
 */
const READY_TIMEOUT_MS = Number(process.env.DAHUA_P2P_READY_TIMEOUT_MS ?? 25_000);

/**
 * Nombre de tentatives d'établissement du tunnel.
 *
 * Le cloud Dahua répond depuis plusieurs serveurs en tourniquet DNS : si
 * l'utilitaire tombe sur un nœud qui ne répond pas, il s'arrête. Chaque relance
 * refait une résolution DNS et vise donc potentiellement un autre serveur —
 * c'est ce qui rattrape un nœud momentanément indisponible.
 */
const CONNECT_ATTEMPTS = Math.max(1, Number(process.env.DAHUA_P2P_CONNECT_ATTEMPTS ?? 3));

/** Délai entre deux tentatives d'établissement. */
const RETRY_DELAY_MS = Number(process.env.DAHUA_P2P_RETRY_DELAY_MS ?? 800);

/**
 * Motif imprimé par l'utilitaire quand le tunnel est réellement prêt.
 *
 * L'utilitaire ouvre son port TCP local dès le démarrage, avant même la fin du
 * handshake P2P : se fier au seul port ouvert conclurait « prêt » trop tôt et
 * la première requête resterait bloquée le temps du handshake. On attend donc
 * ce marqueur sur la sortie de l'utilitaire, avec repli sur le test du port
 * quand aucun marqueur n'est configuré (chaîne vide).
 *
 * `dh-fwd` imprime « Listening on :<port> -> :<remote> » une fois le tunnel
 * établi.
 */
const READY_PATTERN =
  process.env.DAHUA_P2P_READY_PATTERN ?? "Listening on";

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
  /** Clé de mutualisation : un tunnel par couple numéro de série + port visé. */
  key: string;
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
 * Un enregistreur peut avoir plusieurs tunnels à la fois (API web sur le port
 * HTTP, vidéo en direct sur le port RTSP) : la mutualisation se fait par port.
 */
function tunnelKey(serial: string, devicePort: number): string {
  return `${serial}:${devicePort}`;
}

/**
 * Profils applicatifs de `dh-fwd` : chaque cloud Dahua ne connaît que les
 * équipements enrôlés par son application — SmartPSS (easy4ip) ou DMSS
 * (Dolynk). Interroger le mauvais cloud se solde par un 404 ; pire, un
 * équipement associé à DMSS peut être trouvé par le cloud SmartPSS mais
 * ignorer silencieusement sa demande de canal (il ne répond qu'à l'identité
 * DMSS) : d'où l'essai de l'autre profil sur tout échec de négociation.
 */
export const P2P_PROFILES = ["smartpss", "dmss"] as const;

export const PROFILE_LABELS: Record<string, string> = { smartpss: "SmartPSS", dmss: "DMSS" };

/** Profil qui a réussi pour chaque numéro de série, pour ne pas re-tâtonner. */
const workingProfile = new Map<string, string>();

/**
 * Ordre d'essai des profils : celui qui a déjà marché pour ce NVR, sinon
 * `DAHUA_P2P_PROFILE` (défaut `smartpss`), puis l'autre en repli.
 */
function profileOrder(serial: string): string[] {
  const configured = process.env.DAHUA_P2P_PROFILE?.trim().toLowerCase() || "smartpss";
  const first = workingProfile.get(serial) ?? configured;
  const known = (P2P_PROFILES as readonly string[]).includes(first);
  return known ? [first, ...P2P_PROFILES.filter((p) => p !== first)] : [first];
}

/** Erreur de configuration locale : inutile d'essayer un autre profil. */
function isLocalFailure(error: unknown): boolean {
  return error instanceof DahuaError && error.reason === "invalid";
}

/**
 * Établit le tunnel en essayant l'autre profil sur tout échec de négociation
 * (cloud qui ne connaît pas l'équipement, équipement muet, accès refusé).
 * Le message final récapitule l'échec de chaque profil.
 */
async function establishWithProfiles(options: {
  serial: string;
  devicePort: number;
  username: string;
  password: string;
}): Promise<TunnelHandle> {
  const failures: { profile: string; error: unknown }[] = [];
  for (const profile of profileOrder(options.serial)) {
    try {
      const handle = await establishTunnel(options, profile);
      workingProfile.set(options.serial, profile);
      return handle;
    } catch (error) {
      if (isLocalFailure(error)) throw error;
      failures.push({ profile, error });
    }
  }
  if (failures.length === 1) throw failures[0].error;
  // Tous les profils refusent l'accès : c'est bien une affaire d'identifiants.
  const allAuth = failures.every((f) => f.error instanceof DahuaError && f.error.reason === "auth");
  throw new DahuaError(
    allAuth ? "auth" : "unreachable",
    failures
      .map(({ profile, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        return `[${PROFILE_LABELS[profile] ?? profile}] ${message}`;
      })
      .join(" ⟶ "),
  );
}

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
 * `dh-fwd`), on l'attend : le port local est ouvert dès le lancement, bien
 * avant la fin du handshake, donc le seul fait qu'il réponde ne prouve rien.
 * Sans marqueur, on retombe sur le test du port.
 */
async function waitForReady(port: number, timeoutMs: number, tunnel: Tunnel): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const usesMarker = READY_PATTERN.length > 0;

  while (Date.now() < deadline) {
    if (tunnel.child.exitCode !== null || tunnel.child.signalCode !== null) {
      const authRefused = /authentication failed|requires authentication/i.test(tunnel.output.join(" "));
      throw new DahuaError(
        authRefused ? "auth" : "unreachable",
        authRefused
          ? `Accès refusé par l'enregistreur sur le canal P2P (identifiants ou sel d'authentification)${describeOutput(tunnel)}`
          : `L'utilitaire P2P s'est arrêté avant d'établir le tunnel${describeOutput(tunnel)}`,
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
    `Tunnel P2P non établi après ${Math.round(timeoutMs / 1000)} s` +
      (/ack timeout|read device response/i.test(tunnel.output.join(" "))
        ? " — le cloud a relayé la demande mais l'enregistreur n'a pas répondu"
        : " — l'enregistreur est peut-être hors ligne sur le cloud Dahua") +
      describeOutput(tunnel),
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

  const existing = tunnels.get(tunnelKey(options.serial, options.devicePort));
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

  // Plusieurs tentatives : chaque relance refait une résolution DNS et peut
  // viser un autre serveur du cloud Dahua. On ne réessaie pas une erreur de
  // configuration (binaire introuvable) ni une authentification refusée.
  let lastError: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    try {
      return await establishWithProfiles(options);
    } catch (error) {
      lastError = error;
      const reason = error instanceof DahuaError ? error.reason : undefined;
      if (reason === "invalid" || reason === "auth" || reason === "forbidden") break;
      // Un tour qui a épuisé le délai d'attente (équipement muet) ne se
      // rattrape pas en recommençant aussitôt : on ne relance qu'après des
      // échecs rapides (nœud du cloud indisponible, utilitaire arrêté).
      if (Date.now() - startedAt >= READY_TIMEOUT_MS) break;
      if (attempt < CONNECT_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

/** Une tentative unique : lance l'utilitaire et attend l'établissement du tunnel. */
async function establishTunnel(
  options: {
    serial: string;
    devicePort: number;
    username: string;
    password: string;
  },
  profile: string,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<TunnelHandle> {
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
      // Profil applicatif dh-fwd de cette tentative (voir profileOrder).
      DAHUA_P2P_PROFILE: profile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tunnel: Tunnel = {
    key: tunnelKey(options.serial, options.devicePort),
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
    if (tunnels.get(tunnel.key) === tunnel) tunnels.delete(tunnel.key);
  });

  tunnel.ready = waitForReady(port, timeoutMs, tunnel);
  tunnels.set(tunnel.key, tunnel);

  try {
    await tunnel.ready;
  } catch (error) {
    closeTunnel(tunnel);
    // Journal complet de l'utilitaire, pour le diagnostic P2P.
    if (error instanceof DahuaError) (error as DahuaError & { p2pOutput?: string }).p2pOutput = tunnel.output.join("\n");
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
  if (tunnels.get(tunnel.key) === tunnel) tunnels.delete(tunnel.key);
  if (tunnel.child.exitCode === null) tunnel.child.kill();
}

/** Referme tous les tunnels — appelé à l'arrêt du serveur. */
export function closeAllTunnels(): void {
  for (const tunnel of [...tunnels.values()]) closeTunnel(tunnel);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => closeAllTunnels());
}

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

/** Le diagnostic laisse à l'utilitaire le temps de sa deuxième tentative interne. */
const DIAGNOSTIC_TIMEOUT_MS = 45_000;

export type P2pProfileDiagnostic = {
  profile: string;
  label: string;
  /** Le cloud de ce profil connaît-il l'équipement (et le dit en ligne) ? */
  cloud: { known: boolean | null; devP2PVersion: string | null; deviceVersion: string | null; output: string };
  tunnel: { ok: boolean; durationMs: number; error: string | null; output: string } | null;
};

/** Masque les valeurs sensibles d'une sortie de l'utilitaire (sel, jetons). */
function redact(text: string): string {
  return text
    .replace(/(randsalt\s*[:=]\s*)\S+/gi, "$1[masqué]")
    .replace(/("?(?:token|nonce|password|pwd)"?\s*[:=]\s*)"?[^\s",}]+/gi, "$1[masqué]");
}

/** `dh-fwd <SN> --info --app <profil>` : présence de l'équipement sur un cloud, sans identifiants. */
function probeCloud(serial: string, profile: string): Promise<P2pProfileDiagnostic["cloud"]> {
  const binary = tokenize(HELPER_COMMAND)[0];
  return new Promise((resolve) => {
    if (!binary) {
      resolve({ known: null, devP2PVersion: null, deviceVersion: null, output: "utilitaire P2P non configuré" });
      return;
    }
    // Aucun identifiant dans l'environnement : la requête d'information n'en a pas besoin.
    const env = { ...process.env };
    delete env.DAHUA_P2P_USERNAME;
    delete env.DAHUA_P2P_PASSWORD;
    const child = spawn(binary, [serial, "--info", "--app", profile], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => child.kill(), 40_000);
    const finish = () => {
      clearTimeout(timer);
      const text = redact(output.trim());
      const missing = /doesn't exist or turned off/i.test(text);
      resolve({
        known: missing ? false : /devP2PVersion|DevVersion|Info field/i.test(text) ? true : null,
        devP2PVersion: /devP2PVersion\s*:\s*(\S+)/i.exec(text)?.[1] ?? null,
        deviceVersion: /DevVersion\s*:\s*(\S+)/i.exec(text)?.[1] ?? null,
        output: text || "(aucune sortie)",
      });
    };
    child.once("error", (error) => {
      output += `échec du lancement : ${error.message}`;
      finish();
    });
    child.once("close", finish);
  });
}

/**
 * Diagnostic complet d'un accès P2P : pour chaque profil (SmartPSS, DMSS),
 * présence de l'équipement sur le cloud, puis tentative réelle de tunnel avec
 * le journal complet de l'utilitaire. Ne réutilise ni ne garde aucun tunnel.
 */
export async function diagnoseP2p(
  options: {
    serial: string;
    devicePort: number;
    username: string;
    password: string;
  },
  onProgress: (message: string) => void = () => {},
): Promise<{ serial: string; profiles: P2pProfileDiagnostic[]; workingProfile: string | null }> {
  if (!isP2pAvailable()) {
    throw new DahuaError("unsupported", "Accès P2P désactivé sur cette instance (DAHUA_P2P_HELPER vidé).");
  }
  const profiles: P2pProfileDiagnostic[] = [];
  for (const profile of P2P_PROFILES) {
    const label = PROFILE_LABELS[profile] ?? profile;
    onProgress(`${label} : recherche de l'enregistreur sur le cloud…`);
    const cloud = await probeCloud(options.serial, profile);
    let tunnel: P2pProfileDiagnostic["tunnel"] = null;
    if (cloud.known !== false) {
      onProgress(`${label} : ouverture du tunnel…`);
      const startedAt = Date.now();
      try {
        const handle = await establishTunnel(options, profile, Math.max(READY_TIMEOUT_MS, DIAGNOSTIC_TIMEOUT_MS));
        // Tunnel établi : on le referme aussitôt (diagnostic seulement).
        const opened = tunnels.get(tunnelKey(options.serial, options.devicePort));
        const output = redact(opened?.output.join("\n") ?? "");
        handle.release();
        if (opened) closeTunnel(opened);
        workingProfile.set(options.serial, profile);
        tunnel = { ok: true, durationMs: Date.now() - startedAt, error: null, output };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        tunnel = {
          ok: false,
          durationMs: Date.now() - startedAt,
          // Message sans la queue de journal (rendue en entier ci-dessous).
          error: redact(message.split(" : ")[0]),
          output: redact((error as { p2pOutput?: string }).p2pOutput ?? message),
        };
      }
    }
    profiles.push({ profile, label: PROFILE_LABELS[profile] ?? profile, cloud, tunnel });
  }
  return {
    serial: options.serial,
    profiles,
    workingProfile: profiles.find((p) => p.tunnel?.ok)?.profile ?? null,
  };
}
