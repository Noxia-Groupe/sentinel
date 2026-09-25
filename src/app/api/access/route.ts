import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  bootstrapSuperadmins,
  isAccessRole,
  isBootstrapSuperadmin,
  normalizeEmail,
} from "@/lib/access";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /api/access — Liste d'accès (superadmin)
export async function GET(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const entries = await prisma.accessEntry.findMany({
    orderBy: [{ status: "asc" }, { email: "asc" }],
  });

  return NextResponse.json({
    // Superadmins de la configuration serveur : affichés, jamais modifiables.
    bootstrap: bootstrapSuperadmins(),
    entries: entries.map((entry) => ({
      ...entry,
      locked: isBootstrapSuperadmin(entry.email),
    })),
  });
}

// POST /api/access — Déclare et autorise une adresse (superadmin)
export async function POST(req: NextRequest) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Adresse e-mail invalide" }, { status: 400 });
  }
  if (isBootstrapSuperadmin(email)) {
    return NextResponse.json(
      { error: "Cette adresse est déjà superadmin par la configuration serveur (ADMIN_EMAILS)" },
      { status: 409 },
    );
  }

  const role = isAccessRole(body.role) ? body.role : "user";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;

  // Une adresse déjà présente (tentative en attente, ou bannie) est autorisée
  // explicitement : c'est l'intention du superadmin qui la déclare.
  const entry = await prisma.accessEntry.upsert({
    where: { email },
    create: { email, role, name, note, status: "authorized", addedBy: guard.email },
    update: { role, status: "authorized", ...(name ? { name } : {}), ...(note ? { note } : {}) },
  });

  await recordAudit({
    actor: guard.actor,
    action: "access.grant",
    targetType: "access",
    targetId: entry.id,
    metadata: { email, role },
  });

  return NextResponse.json(entry, { status: 201 });
}
