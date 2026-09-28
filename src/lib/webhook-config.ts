import { EVENT_CATEGORIES, SEVERITIES, isEventCategory, isSeverity } from "./dahua/events";

/**
 * Lecture et validation des réglages d'un webhook sortant envoyés par
 * l'interface des paramètres (création comme modification partielle).
 */
export type WebhookSettings = {
  name?: string;
  url?: string;
  enabled?: boolean;
  severities?: string[];
  categories?: string[];
  clientIds?: string[];
  notifyStatusChanges?: boolean;
  notifyNvrStatus?: boolean;
  alarmInstructions?: string | null;
  outageInstructions?: string | null;
};

/** Longueur maximale d'une consigne envoyée à l'agent. */
const MAX_INSTRUCTIONS = 4000;

/** Chaîne vide = retour aux consignes par défaut. */
function instructions(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MAX_INSTRUCTIONS);
  return trimmed || null;
}

function stringList(value: unknown, accept: (item: unknown) => boolean): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter(accept).map(String))];
}

export function parseWebhookSettings(body: Record<string, unknown>): WebhookSettings {
  const settings: WebhookSettings = {};
  if (typeof body.name === "string") settings.name = body.name.trim();
  if (typeof body.url === "string") settings.url = body.url.trim();
  if (typeof body.enabled === "boolean") settings.enabled = body.enabled;
  if (typeof body.notifyStatusChanges === "boolean") settings.notifyStatusChanges = body.notifyStatusChanges;
  if (typeof body.notifyNvrStatus === "boolean") settings.notifyNvrStatus = body.notifyNvrStatus;
  const severities = stringList(body.severities, isSeverity);
  if (severities) settings.severities = severities;
  const categories = stringList(body.categories, isEventCategory);
  if (categories) settings.categories = categories;
  const clientIds = stringList(body.clientIds, (item) => typeof item === "string" && item.length > 0);
  if (clientIds) settings.clientIds = clientIds;
  const alarm = instructions(body.alarmInstructions);
  if (alarm !== undefined) settings.alarmInstructions = alarm;
  const outage = instructions(body.outageInstructions);
  if (outage !== undefined) settings.outageInstructions = outage;
  return settings;
}

export const WEBHOOK_OPTIONS = { severities: SEVERITIES, categories: EVENT_CATEGORIES };

/** Réglages publiés d'un webhook — jamais le secret. */
export function publicEndpoint(endpoint: {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  severities: string[];
  categories: string[];
  clientIds: string[];
  notifyStatusChanges: boolean;
  notifyNvrStatus: boolean;
  alarmInstructions: string | null;
  outageInstructions: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: endpoint.id,
    name: endpoint.name,
    url: endpoint.url,
    enabled: endpoint.enabled,
    severities: endpoint.severities,
    categories: endpoint.categories,
    clientIds: endpoint.clientIds,
    notifyStatusChanges: endpoint.notifyStatusChanges,
    notifyNvrStatus: endpoint.notifyNvrStatus,
    alarmInstructions: endpoint.alarmInstructions,
    outageInstructions: endpoint.outageInstructions,
    createdBy: endpoint.createdBy,
    createdAt: endpoint.createdAt,
    updatedAt: endpoint.updatedAt,
  };
}
