/**
 * Procédures de maintenance destinées aux agents (Hermes Agent…).
 *
 * Une seule source pour tous les usages : les « prompts » du serveur MCP
 * (que l'agent peut appeler par leur nom), la compétence Hermes téléchargeable
 * depuis Paramètres, les instructions du serveur, les consignes jointes aux
 * webhooks et le bloc de configuration Hermes. Module sans dépendance :
 * importable côté serveur comme côté navigateur.
 */

export const SAFETY_RULES = `Règles d'intervention :
- Toujours lire avant d'agir : maintenance_report ou nvr_action en lecture d'abord.
- Une action qui modifie l'équipement (scope nvr:control) se justifie par un constat précis ; l'expliquer dans la main courante de l'alarme concernée (update_alarm, comment).
- poe-power : vérifier d'abord avec cameras / poe-status que la caméra visée est bien sur ce port ; privilégier mode=cycle (coupure brève) à mode=off ; dryRun=true en cas de doute.
- reboot : dernier recours, jamais pendant les heures d'exploitation du site sans accord humain ; l'enregistrement est interrompu plusieurs minutes.
- Après toute action : revérifier (run_health_check ou maintenance_report) et consigner le résultat.
- Une seule tentative corrective automatique par panne ; au-delà, escalader à un humain avec le diagnostic.`;

export const PREVENTIVE_PROCEDURE = `Maintenance préventive du parc Sentinel

1. fleet_maintenance : repérer les enregistreurs à risque (anomalies ouvertes, disponibilité 7 j dégradée, jamais vérifiés, identifiants refusés).
2. Pour chaque enregistreur à risque (puis, par roulement, pour les autres) : maintenance_report.
3. Traiter ce qui est sûr et réversible :
   - horloge décalée → nvr_action sync-time ;
   - caméra en perte vidéo sur un port PoE identifié → nvr_action poe-power mode=cycle (une fois), puis nvr_action cameras pour confirmer le retour.
4. Planifier ce qui demande un humain : disque en erreur ou absent, lien réseau dégradé, charge processeur/mémoire persistante, firmware ancien, redémarrage préventif.
5. Rédiger un rapport concis : enregistreurs vérifiés, anomalies trouvées, actions faites (et leur résultat), actions à planifier par ordre de priorité.

${SAFETY_RULES}`;

export const CURATIVE_PROCEDURE = `Diagnostic curatif (panne ou alarme)

1. Contexte : get_alarm (si une alarme est en cause) puis get_nvr_health de l'enregistreur (anomalies ouvertes, historique).
2. Joignabilité : test_nvr. Injoignable → vérifier l'historique (coupure de site ? tunnel P2P ?) et escalader : aucune action distante n'est possible.
3. Diagnostic complet : maintenance_report — lire les constats « critical » et « warning » dans l'ordre.
4. Selon le constat :
   - caméra en perte vidéo → nvr_action snapshot sur la voie (confirme l'image figée ou noire), puis poe-power mode=cycle sur le port correspondant, puis cameras pour confirmer ;
   - redémarrage inattendu récent → nvr_action logs (hours=2) pour en trouver la cause ;
   - disque en erreur → pas de correction à distance : escalader, avec le détail du disque ;
   - horloge décalée → sync-time ;
   - charge excessive persistante → proposer un redémarrage planifié (reboot seulement avec accord humain).
5. Vérifier le résultat (run_health_check ou maintenance_report), puis consigner diagnostic, action et résultat dans la main courante (update_alarm comment ; status=resolved si la panne est levée).

${SAFETY_RULES}`;

type PromptArgument = { name: string; description: string; required?: boolean };

export type McpPrompt = {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  build: (args: Record<string, string>) => string;
};

export const MCP_PROMPTS: McpPrompt[] = [
  {
    name: "maintenance_preventive",
    title: "Maintenance préventive",
    description:
      "Tournée préventive du parc (ou d'un client / d'un enregistreur) : bilan, corrections sûres, rapport et actions à planifier.",
    arguments: [
      { name: "nvrId", description: "Limiter la tournée à cet enregistreur" },
      { name: "clientId", description: "Limiter la tournée aux enregistreurs de ce client" },
    ],
    build: (args) =>
      [
        PREVENTIVE_PROCEDURE,
        args.nvrId ? `\nPérimètre : l'enregistreur ${args.nvrId} uniquement.` : "",
        args.clientId ? `\nPérimètre : les enregistreurs du client ${args.clientId}.` : "",
      ].join(""),
  },
  {
    name: "diagnostic_curatif",
    title: "Diagnostic curatif",
    description: "Diagnostiquer et, si c'est sûr, corriger une panne signalée par une alarme ou sur un enregistreur.",
    arguments: [
      { name: "alarmId", description: "Alarme à l'origine du diagnostic" },
      { name: "nvrId", description: "Enregistreur en cause (si pas d'alarme)" },
    ],
    build: (args) =>
      [
        CURATIVE_PROCEDURE,
        args.alarmId ? `\nAlarme à traiter : ${args.alarmId}.` : "",
        args.nvrId ? `\nEnregistreur en cause : ${args.nvrId}.` : "",
      ].join(""),
  },
];

/** Compétence Hermes (`~/.hermes/skills/sentinel-maintenance/SKILL.md`). */
export function hermesSkill(origin: string): string {
  return `---
name: sentinel-maintenance
description: Maintenance préventive et curative des enregistreurs vidéo Dahua supervisés par Sentinel (${origin}). À utiliser pour une tournée de contrôle, une alarme ou une panne d'enregistreur ou de caméra.
version: 1.0.0
metadata:
  hermes:
    tags: [sentinel, dahua, nvr, maintenance, vidéosurveillance]
---

# Sentinel — maintenance des enregistreurs

Sentinel (${origin}) est le centre d'alarme et l'outil de maintenance à distance des
enregistreurs Dahua du parc. Il est relié à Hermes par le serveur MCP « sentinel » :
tous les outils cités ci-dessous en viennent. Sentinel se connecte lui-même aux
enregistreurs (IP ou P2P) : aucun mot de passe n'est nécessaire côté agent.

## Outils utiles

- sentinel_overview, fleet_maintenance : état du parc, enregistreurs à risque.
- maintenance_report : bilan complet d'un enregistreur, constats classés
  (critical / warning / info) avec l'action Sentinel recommandée pour chacun.
- get_nvr_health, run_health_check : supervision permanente et vérification immédiate.
- nvr_action en lecture : system-stats, cameras, poe-status, storage, logs,
  snapshot, device-info, capabilities, advanced-read.
- nvr_action en intervention (clé avec « interventions » autorisées) : sync-time,
  poe-power (port, mode on|off|cycle, dryRun), alarm-out, reboot.
- list_alarms, get_alarm, update_alarm : alarmes et main courante.

## ${PREVENTIVE_PROCEDURE}

## ${CURATIVE_PROCEDURE}
`;
}

/**
 * Demande à adresser à Hermes (en conversation) pour qu'il planifie lui-même
 * la tournée préventive avec son planificateur intégré.
 */
export const HERMES_SCHEDULE_REQUEST =
  "Chaque lundi à 7 h, utilise la compétence sentinel-maintenance pour faire la maintenance préventive du parc Sentinel, puis envoie-moi le rapport.";

// ---------------------------------------------------------------------------
// Consignes transmises avec chaque webhook (champ `instructions`)
// ---------------------------------------------------------------------------

/** Ce que l'agent fait en recevant une nouvelle alarme (modifiable par webhook). */
export const DEFAULT_ALARM_INSTRUCTIONS = `Nouvelle alarme Sentinel. Traite-la ainsi :
1. Lis-la avec get_alarm (identifiant : alarm.id).
2. Vérifie l'enregistreur : test_nvr, puis nvr_action snapshot sur le canal de l'alarme si une image aide à comprendre.
3. Si c'est une panne technique (perte vidéo, disque, horloge, sabotage…), fais un diagnostic : maintenance_report, puis applique l'action recommandée seulement si elle est sûre (remise à l'heure, relance d'une caméra par son port PoE).
4. Note ton analyse dans la main courante (update_alarm avec comment) et passe l'alarme en « acknowledged » ; ne la clôture (resolved) que si le problème est réellement levé.
5. Préviens-moi en 3 lignes : quoi, où (client, site, caméra), ce que tu as fait.
Ne redémarre jamais un enregistreur sans mon accord.`;

/** Ce que l'agent fait quand un enregistreur tombe en panne ou revient. */
export const DEFAULT_OUTAGE_INSTRUCTIONS = `Changement d'état d'un enregistreur supervisé par Sentinel.
- S'il est hors ligne : confirme avec get_nvr_health puis test_nvr ; cherche la cause probable (coupure du site, accès internet, tunnel P2P). Aucune action à distance n'est possible tant qu'il est injoignable : préviens-moi avec le client, le site et depuis quand.
- S'il est revenu en ligne : lance maintenance_report pour vérifier que tout est reparti (disques, caméras, horloge) et résume-moi le résultat.`;

/** Test de liaison : l'agent prouve qu'il sait aussi joindre Sentinel (MCP). */
export const TEST_INSTRUCTIONS = `Test de liaison envoyé depuis Sentinel. Appelle l'outil sentinel_overview du serveur MCP « sentinel » et réponds en une phrase : « Liaison Sentinel OK — N alarme(s) ouverte(s), N enregistreur(s) en ligne sur N ». Si l'outil n'est pas disponible, dis-le clairement.`;

export type InstructionSet = { alarmInstructions?: string | null; outageInstructions?: string | null };

/** Consignes à joindre à un envoi, selon le type d'événement. */
export function instructionsFor(eventType: string, endpoint: InstructionSet): string {
  if (eventType === "sentinel.test") return TEST_INSTRUCTIONS;
  if (eventType === "nvr.offline" || eventType === "nvr.online") {
    return endpoint.outageInstructions?.trim() || DEFAULT_OUTAGE_INSTRUCTIONS;
  }
  return endpoint.alarmInstructions?.trim() || DEFAULT_ALARM_INSTRUCTIONS;
}

// ---------------------------------------------------------------------------
// Configuration Hermes : un seul bloc à coller
// ---------------------------------------------------------------------------

/**
 * Bloc `~/.hermes/config.yaml` complet : serveur MCP (Hermes → Sentinel) et,
 * si un secret de webhook est fourni, la route qui reçoit les alarmes
 * (Sentinel → Hermes). La consigne est fournie par Sentinel dans chaque envoi
 * (`{instructions}`) : on la modifie dans Sentinel, sans retoucher Hermes.
 */
export function hermesConfigBlock(options: {
  origin: string;
  mcpKey: string;
  webhookSecret?: string;
  deliver?: string;
}): string {
  const mcp = `mcp_servers:
  sentinel:
    url: "${options.origin}/api/mcp"
    headers:
      Authorization: "Bearer ${options.mcpKey}"
    timeout: 120          # un test via tunnel P2P peut prendre ~30 s
    connect_timeout: 30`;
  if (!options.webhookSecret) return `# ~/.hermes/config.yaml — sur le serveur Hermes\n${mcp}`;
  return `# ~/.hermes/config.yaml — sur le serveur Hermes
${mcp}

platforms:
  webhook:
    enabled: true
    extra:
      routes:
        sentinel:
          secret: "${options.webhookSecret}"
          prompt: |
            {instructions}

            Événement : {summary}
            Données complètes : {__raw__}
          deliver: "${options.deliver ?? "telegram"}"   # où Hermes vous répond : telegram, discord, slack…`;
}
