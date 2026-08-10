import { DahuaError, dahuaRequestText, type DahuaTarget } from "./http";
import { parseKeyValue, type DahuaObject, type DahuaValue } from "./parse";

/**
 * Provisionnement à distance du centre d'alarme d'un enregistreur.
 *
 * Plutôt que de saisir l'URL de SENTINEL à la main dans chaque NVR
 * (Configuration → Réseau → Centre d'alarme), on écrit la destination
 * directement dans la configuration de l'équipement par l'API `configManager`.
 *
 * Les noms des champs varient d'une famille de firmware à l'autre : on ne
 * devine donc jamais. On lit d'abord la section telle qu'elle existe sur
 * l'équipement, puis on ne réécrit que les clés qu'il expose réellement.
 */

/** Sections de configuration susceptibles de porter la destination d'alarme. */
export const CANDIDATE_SECTIONS = [
  "AlarmServer",
  "AlarmCenter",
  "HttpNotifyServer",
  "EventNotification",
  "NetworkAlarmCenter",
] as const;

export type AlarmScheme = "https" | "http";

export type AlarmDestination = {
  /** URL complète du webhook propre à cet enregistreur. */
  url: string;
  host: string;
  port: number;
  scheme: AlarmScheme;
  /** Chemin seul, pour les firmwares qui séparent hôte, port et chemin. */
  path: string;
};

/**
 * Adresse que les enregistreurs doivent appeler.
 *
 * `ALARM_CENTER_URL` permet de pointer une adresse différente de l'URL
 * publique — utile quand les NVR joignent la plateforme par un VPN plutôt que
 * par son nom d'hôte public.
 */
export function alarmDestination(
  webhookToken: string,
  scheme?: AlarmScheme,
): AlarmDestination {
  const base = (process.env.ALARM_CENTER_URL || process.env.NEXTAUTH_URL || "").trim();
  if (!base) {
    throw new DahuaError(
      "invalid",
      "Adresse publique de la plateforme inconnue — renseigner NEXTAUTH_URL (ou ALARM_CENTER_URL).",
    );
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new DahuaError("invalid", `Adresse de plateforme invalide : « ${base} »`);
  }

  // HTTPS par défaut : c'est le protocole de l'URL publique. Le repli en HTTP
  // n'a de sens que pour un firmware ancien incapable de négocier TLS.
  const resolved: AlarmScheme = scheme ?? (url.protocol === "http:" ? "http" : "https");
  const explicitPort = url.port ? Number(url.port) : undefined;
  const port = explicitPort ?? (resolved === "https" ? 443 : 80);
  const path = `/api/webhooks/dahua/${webhookToken}`;
  const authority = explicitPort ? `${url.hostname}:${explicitPort}` : url.hostname;

  return {
    url: `${resolved}://${authority}${path}`,
    host: url.hostname,
    port,
    scheme: resolved,
    path,
  };
}

export type AlarmCenterConfig = {
  section: string;
  /** Configuration telle que renvoyée par l'équipement. */
  config: DahuaObject;
};

/** Lit la section de configuration du centre d'alarme présente sur l'équipement. */
export async function readAlarmCenter(
  target: DahuaTarget,
  section?: string,
): Promise<AlarmCenterConfig | null> {
  const sections = section ? [section] : CANDIDATE_SECTIONS;

  for (const name of sections) {
    let parsed: DahuaObject;
    try {
      parsed = parseKeyValue(
        await dahuaRequestText(
          target,
          `/cgi-bin/configManager.cgi?action=getConfig&name=${encodeURIComponent(name)}`,
        ),
      );
    } catch (error) {
      // Une section absente répond en 400/error : on passe à la suivante.
      // En revanche un refus d'authentification doit remonter tel quel.
      if (error instanceof DahuaError && (error.reason === "auth" || error.reason === "unreachable")) {
        throw error;
      }
      continue;
    }

    const table = parsed.table;
    const found =
      (typeof table === "object" && table !== null && !Array.isArray(table)
        ? (table as DahuaObject)[name]
        : undefined) ?? parsed[name];

    if (found !== undefined && typeof found === "object") {
      return { section: name, config: { [name]: found } };
    }
  }

  return null;
}

type Leaf = { path: string; value: DahuaValue };

/** Aplatit une section de configuration en chemins « Clé[0].SousClé ». */
function leaves(value: DahuaValue, prefix = ""): Leaf[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => leaves(item, `${prefix}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      leaves(item, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [{ path: prefix, value }];
}

function lastSegment(path: string): string {
  const withoutIndex = path.replace(/\[\d+\]/g, "");
  const parts = withoutIndex.split(".");
  return parts[parts.length - 1] ?? "";
}

function looksLikeUrl(value: DahuaValue): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

export type AlarmCenterPlan = {
  section: string;
  destination: AlarmDestination;
  /** Affectations à écrire : chemin complet → valeur. */
  assignments: Record<string, string>;
  /** Champs laissés en l'état, avec la raison. */
  warnings: string[];
};

/**
 * Calcule les champs à écrire à partir de la configuration réellement exposée
 * par l'équipement. Aucune clé n'est inventée : seules celles déjà présentes
 * sont réécrites, et uniquement si leur valeur change.
 */
export function planAlarmCenter(
  current: AlarmCenterConfig,
  destination: AlarmDestination,
  overrides: Record<string, string> = {},
): AlarmCenterPlan {
  const assignments: Record<string, string> = {};
  const warnings: string[] = [];

  for (const leaf of leaves(current.config)) {
    const key = lastSegment(leaf.path);
    let next: string | undefined;

    if (/^enabled?$/i.test(key)) {
      next = "true";
    } else if (/^(url|uri)$/i.test(key) || looksLikeUrl(leaf.value)) {
      next = destination.url;
    } else if (/^(address|ip|hostip|serverip|host|server|domain)$/i.test(key)) {
      next = destination.host;
    } else if (/^port$/i.test(key)) {
      next = String(destination.port);
    } else if (/^(path|route)$/i.test(key)) {
      next = destination.path;
    } else if (/^(protocol|scheme)$/i.test(key)) {
      const currentValue = String(leaf.value);
      if (/^(https?|none|)$/i.test(currentValue)) {
        next = destination.scheme.toUpperCase();
      } else {
        // TCP/UDP/SIA : la section pilote le protocole propriétaire « centre
        // d'alarme », qui ne sait pas poster sur une URL. On n'y touche pas.
        warnings.push(
          `Le champ « ${leaf.path} » vaut « ${currentValue} » : ce firmware utilise le protocole ` +
            `propriétaire du centre d'alarme, qui ne remonte pas en HTTP. La destination HTTP(S) ` +
            `doit alors être configurée dans le menu de notification HTTP de l'enregistreur.`,
        );
      }
    }

    if (next !== undefined && String(leaf.value) !== next) {
      assignments[leaf.path] = next;
    }
  }

  for (const [path, value] of Object.entries(overrides)) {
    // Un override préfixé par la section est accepté tel quel, sinon on le
    // rattache à la section détectée.
    const fullPath = path.startsWith(`${current.section}`) ? path : `${current.section}.${path}`;
    assignments[fullPath] = value;
  }

  if (Object.keys(assignments).length === 0) {
    warnings.push("La configuration de l'enregistreur pointe déjà sur cette adresse.");
  }

  return { section: current.section, destination, assignments, warnings };
}

export type AlarmCenterResult = AlarmCenterPlan & {
  /** false en simulation (`dryRun`). */
  applied: boolean;
  before: DahuaObject;
  /** Configuration relue après écriture, pour vérification. */
  after: DahuaObject | null;
};

/**
 * Écrit la destination d'alarme sur l'équipement, puis relit la configuration
 * pour que l'appelant constate ce qui a réellement été pris en compte.
 */
export async function configureAlarmCenter(options: {
  target: DahuaTarget;
  webhookToken: string;
  scheme?: AlarmScheme;
  section?: string;
  overrides?: Record<string, string>;
  dryRun?: boolean;
}): Promise<AlarmCenterResult> {
  const { target, webhookToken, scheme, section, overrides, dryRun = false } = options;

  const current = await readAlarmCenter(target, section);
  if (!current) {
    throw new DahuaError(
      "unsupported",
      "Aucune section de centre d'alarme exposée par cet enregistreur " +
        `(sections testées : ${CANDIDATE_SECTIONS.join(", ")}). ` +
        "Configurer la destination à la main depuis Configuration → Réseau → Centre d'alarme.",
    );
  }

  const destination = alarmDestination(webhookToken, scheme);
  const plan = planAlarmCenter(current, destination, overrides);

  if (dryRun || Object.keys(plan.assignments).length === 0) {
    return { ...plan, applied: false, before: current.config, after: null };
  }

  const query = Object.entries(plan.assignments)
    .map(([path, value]) => `${path}=${encodeURIComponent(value)}`)
    .join("&");

  await dahuaRequestText(target, `/cgi-bin/configManager.cgi?action=setConfig&${query}`);

  const after = await readAlarmCenter(target, current.section);

  return {
    ...plan,
    applied: true,
    before: current.config,
    after: after?.config ?? null,
  };
}
