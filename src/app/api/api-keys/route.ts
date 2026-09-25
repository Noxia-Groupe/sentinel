import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { ALL_SCOPES, DEFAULT_SCOPES, SCOPES, generateApiKey, isScope } from "@/lib/api-keys";

// GET /api/api-keys — Liste des clés (jamais le secret) et catalogue des scopes
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
    },
  });

  return NextResponse.json({
    keys,
    scopes: ALL_SCOPES.map((scope) => ({ name: scope, description: SCOPES[scope] })),
    defaultScopes: DEFAULT_SCOPES,
  });
}

// POST /api/api-keys — Crée une clé ; le secret n'est renvoyé qu'ici, une fois
export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Le nom de la clé est requis" }, { status: 400 });
  }

  const requested = Array.isArray(body.scopes) ? body.scopes.filter(isScope) : [];
  const scopes = requested.length > 0 ? [...new Set(requested)] : DEFAULT_SCOPES;

  let expiresAt: Date | null = null;
  if (typeof body.expiresAt === "string" && body.expiresAt) {
    const parsed = new Date(body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Date d'expiration invalide" }, { status: 400 });
    }
    expiresAt = parsed;
  }

  const generated = generateApiKey();

  const key = await prisma.apiKey.create({
    data: {
      name,
      prefix: generated.prefix,
      hash: generated.hash,
      scopes,
      expiresAt,
      createdById: guard.actor.id ?? null,
    },
    select: { id: true, name: true, prefix: true, scopes: true, expiresAt: true, createdAt: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: "apikey.create",
    targetType: "apikey",
    targetId: key.id,
    metadata: { name, scopes },
  });

  return NextResponse.json(
    {
      ...key,
      // Unique occasion de récupérer le secret : il n'est pas stocké en clair.
      secret: generated.secret,
    },
    { status: 201 },
  );
}
