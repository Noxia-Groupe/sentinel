import type { Prisma } from "@/generated/prisma/client";
import { emitAlarmStatusChanged } from "./outbound-webhooks";
import { prisma } from "./prisma";
import { recordAudit } from "./audit";
import type { Actor } from "./actor";
import { isEventStatus, isSeverity, type EventStatus, type EventSeverity } from "./dahua/events";

/**
 * Traitement des alarmes, partagé par l'interface (routes de session) et par
 * l'API des agents (`/api/v1`) : même logique, même journal d'audit.
 */

export type EventFilters = {
  status?: EventStatus[];
  severity?: EventSeverity[];
  clientId?: string;
  nvrId?: string;
  type?: string;
  /** Bornes sur la date de réception. */
  since?: Date;
  until?: Date;
  /** Recherche libre sur le libellé, le type et le nom du NVR. */
  search?: string;
  limit?: number;
  offset?: number;
};

const MAX_LIMIT = 200;

const EVENT_INCLUDE = {
  nvr: {
    select: {
      id: true,
      name: true,
      ip: true,
      location: true,
      connectionMode: true,
      status: true,
      client: { select: { id: true, name: true, code: true } },
    },
  },
  acknowledgedBy: { select: { id: true, name: true, email: true } },
  resolvedBy: { select: { id: true, name: true, email: true } },
  assignedTo: { select: { id: true, name: true, email: true } },
} satisfies Prisma.NvrEventInclude;

type EventWithRelations = Prisma.NvrEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

export function buildEventWhere(filters: EventFilters): Prisma.NvrEventWhereInput {
  const where: Prisma.NvrEventWhereInput = {};

  if (filters.status?.length) where.status = { in: filters.status };
  if (filters.severity?.length) where.severity = { in: filters.severity };
  if (filters.nvrId) where.nvrId = filters.nvrId;
  if (filters.type) where.type = filters.type;
  if (filters.clientId) where.nvr = { clientId: filters.clientId };

  if (filters.since || filters.until) {
    where.receivedAt = {
      ...(filters.since ? { gte: filters.since } : {}),
      ...(filters.until ? { lte: filters.until } : {}),
    };
  }

  if (filters.search) {
    const search = filters.search;
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { type: { contains: search, mode: "insensitive" } },
      { nvr: { name: { contains: search, mode: "insensitive" } } },
      { nvr: { client: { name: { contains: search, mode: "insensitive" } } } },
    ];
  }

  return where;
}

export async function listEvents(filters: EventFilters) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = buildEventWhere(filters);

  const [events, total] = await Promise.all([
    prisma.nvrEvent.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.nvrEvent.count({ where }),
  ]);

  return { events: events.map(serializeEvent), total, limit, offset };
}

export async function getEvent(id: string) {
  const event = await prisma.nvrEvent.findUnique({
    where: { id },
    include: {
      ...EVENT_INCLUDE,
      comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, email: true } } } },
    },
  });
  if (!event) return null;

  return {
    ...serializeEvent(event),
    comments: event.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author?.name ?? comment.author?.email ?? comment.authorLabel ?? "Système",
      createdAt: comment.createdAt.toISOString(),
    })),
  };
}

export function serializeEvent(event: EventWithRelations) {
  return {
    id: event.id,
    type: event.type,
    code: event.code,
    title: event.title ?? event.type,
    severity: event.severity as EventSeverity,
    status: event.status as EventStatus,
    channel: event.channel,
    source: event.source,
    receivedAt: event.receivedAt.toISOString(),
    acknowledgedAt: event.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy:
      event.acknowledgedBy?.name ?? event.acknowledgedBy?.email ?? event.acknowledgedByKey ?? null,
    resolvedAt: event.resolvedAt?.toISOString() ?? null,
    resolvedBy: event.resolvedBy?.name ?? event.resolvedBy?.email ?? null,
    resolution: event.resolution,
    assignedTo: event.assignedTo?.name ?? event.assignedTo?.email ?? null,
    assignedToId: event.assignedToId,
    payload: event.payload,
    nvr: {
      id: event.nvr.id,
      name: event.nvr.name,
      ip: event.nvr.ip,
      location: event.nvr.location,
      status: event.nvr.status,
      connectionMode: event.nvr.connectionMode,
      client: event.nvr.client,
    },
  };
}

export type EventUpdate = {
  status?: EventStatus;
  resolution?: string;
  assignedToId?: string | null;
  /** Commentaire ajouté à la main courante en même temps que le changement. */
  comment?: string;
};

/**
 * Applique un changement de statut à une alarme.
 *
 * Les horodatages de prise en compte et de clôture sont posés automatiquement
 * en fonction du statut cible, et l'auteur (humain ou clé d'API) est conservé.
 */
export async function updateEvent(id: string, update: EventUpdate, actor: Actor) {
  const existing = await prisma.nvrEvent.findUnique({ where: { id } });
  if (!existing) return null;

  const data: Prisma.NvrEventUpdateInput = {};
  const now = new Date();
  const isUser = actor.type === "user" && Boolean(actor.id);

  if (update.status) {
    data.status = update.status;

    const entersTreatment = update.status === "acknowledged" || update.status === "in_progress";
    if (entersTreatment && !existing.acknowledgedAt) {
      data.acknowledgedAt = now;
      if (isUser) data.acknowledgedBy = { connect: { id: actor.id! } };
      else data.acknowledgedByKey = actor.label;
    }

    if (update.status === "resolved" || update.status === "ignored") {
      data.resolvedAt = now;
      if (isUser) data.resolvedBy = { connect: { id: actor.id! } };
      // Une alarme clôturée sans avoir été prise en compte l'est implicitement.
      if (!existing.acknowledgedAt) {
        data.acknowledgedAt = now;
        if (isUser) data.acknowledgedBy = { connect: { id: actor.id! } };
        else data.acknowledgedByKey = actor.label;
      }
    }

    // Retour en arrière : on efface la clôture.
    if (update.status === "new" || update.status === "acknowledged") {
      data.resolvedAt = null;
      data.resolvedBy = { disconnect: true };
    }
  }

  if (update.resolution !== undefined) data.resolution = update.resolution;

  if (update.assignedToId !== undefined) {
    data.assignedTo = update.assignedToId
      ? { connect: { id: update.assignedToId } }
      : { disconnect: true };
  }

  const event = await prisma.nvrEvent.update({
    where: { id },
    data,
    include: EVENT_INCLUDE,
  });

  if (update.comment) {
    await addComment(id, update.comment, actor);
  }

  if (update.status && update.status !== existing.status) {
    void emitAlarmStatusChanged(id, existing.status, actor.label);
  }

  await recordAudit({
    actor,
    action: `event.${update.status ?? "update"}`,
    targetType: "event",
    targetId: id,
    metadata: {
      from: existing.status,
      to: update.status,
      resolution: update.resolution,
      nvrId: existing.nvrId,
    },
  });

  return serializeEvent(event);
}

export async function addComment(eventId: string, body: string, actor: Actor) {
  const comment = await prisma.eventComment.create({
    data: {
      eventId,
      body,
      authorId: actor.type === "user" ? (actor.id ?? null) : null,
      authorLabel: actor.type === "user" ? null : actor.label,
    },
  });

  await recordAudit({
    actor,
    action: "event.comment",
    targetType: "event",
    targetId: eventId,
    metadata: { length: body.length },
  });

  return {
    id: comment.id,
    body: comment.body,
    author: actor.label,
    createdAt: comment.createdAt.toISOString(),
  };
}

/** Compteurs affichés sur le tableau de bord et exposés par l'API. */
export async function alarmStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [open, critical, today, unacknowledged, bySeverity] = await Promise.all([
    prisma.nvrEvent.count({ where: { status: { in: ["new", "acknowledged", "in_progress"] } } }),
    prisma.nvrEvent.count({
      where: { severity: "critical", status: { in: ["new", "acknowledged", "in_progress"] } },
    }),
    prisma.nvrEvent.count({ where: { receivedAt: { gte: startOfDay } } }),
    prisma.nvrEvent.count({ where: { status: "new" } }),
    prisma.nvrEvent.groupBy({
      by: ["severity"],
      where: { status: { in: ["new", "acknowledged", "in_progress"] } },
      _count: { _all: true },
    }),
  ]);

  return {
    open,
    critical,
    today,
    unacknowledged,
    bySeverity: Object.fromEntries(bySeverity.map((row) => [row.severity, row._count._all])),
  };
}

/** Analyse les filtres passés en query string, en ignorant les valeurs inconnues. */
export function parseEventFilters(url: URL): EventFilters {
  const list = (name: string) =>
    url.searchParams
      .getAll(name)
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);

  const parseDate = (name: string) => {
    const raw = url.searchParams.get(name);
    if (!raw) return undefined;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };

  return {
    status: list("status").filter(isEventStatus),
    severity: list("severity").filter(isSeverity),
    clientId: url.searchParams.get("clientId") ?? undefined,
    nvrId: url.searchParams.get("nvrId") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    since: parseDate("since"),
    until: parseDate("until"),
    search: url.searchParams.get("search") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
    offset: Number(url.searchParams.get("offset")) || undefined,
  };
}
