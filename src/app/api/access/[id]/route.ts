import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  isAccessRole,
  isAccessStatus,
  isBootstrapSuperadmin,
  normalizeEmail,
  revokeSessions,
} from "@/lib/access";

type Params = { params: Promise<{ id: string }> };

/**
 * Garde-fous communs : une adresse de ADMIN_EMAILS n'est pas modifiable ici,
 * et un superadmin ne peut ni se bannir, ni se rétrograder, ni se retirer —
 * de quoi ne jamais perdre l'accès aux paramètres par erreur.
 */
async function loadEditable(id: string, selfEmail: string) {
  const entry = await prisma.accessEntry.findUnique({ where: { id } });
  if (!entry) {
    return { error: NextResponse.json({ error: "Entrée introuvable" }, { status: 404 }) };
  }
  if (isBootstrapSuperadmin(entry.email)) {
    return {
      error: NextResponse.json(
        { error: "Superadmin défini par la configuration serveur (ADMIN_EMAILS) : non modifiable ici" },
        { status: 403 },
      ),
    };
  }
  return { entry, isSelf: normalizeEmail(selfEmail) === entry.email };
}

// PATCH /api/access/[id] — Autoriser, bannir, changer le rôle ou la note
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const loaded = await loadEditable(id, guard.email);
  if ("error" in loaded) return loaded.error;
  const { entry, isSelf } = loaded;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const status = isAccessStatus(body.status) ? body.status : undefined;
  const role = isAccessRole(body.role) ? body.role : undefined;
  const note = typeof body.note === "string" ? body.note.trim() || null : undefined;

  if (isSelf && ((status && status !== "authorized") || (role && role !== "superadmin"))) {
    return NextResponse.json(
      { error: "Vous ne pouvez ni bannir ni rétrograder votre propre compte" },
      { status: 400 },
    );
  }

  const updated = await prisma.accessEntry.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(role ? { role } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  });

  // Accès retiré : les sessions déjà ouvertes sont coupées sur-le-champ.
  const revoked =
    updated.status !== "authorized" && entry.status === "authorized"
      ? await revokeSessions(entry.email)
      : 0;

  await recordAudit({
    actor: guard.actor,
    action: status === "banned" ? "access.ban" : "access.update",
    targetType: "access",
    targetId: id,
    metadata: {
      email: entry.email,
      from: { status: entry.status, role: entry.role },
      to: { status: updated.status, role: updated.role },
      revokedSessions: revoked,
    },
  });

  return NextResponse.json(updated);
}

// DELETE /api/access/[id] — Retire une adresse de la liste (accès perdu)
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const loaded = await loadEditable(id, guard.email);
  if ("error" in loaded) return loaded.error;
  const { entry, isSelf } = loaded;

  if (isSelf) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas retirer votre propre compte" },
      { status: 400 },
    );
  }

  await prisma.accessEntry.delete({ where: { id } });
  const revoked = await revokeSessions(entry.email);

  await recordAudit({
    actor: guard.actor,
    action: "access.remove",
    targetType: "access",
    targetId: id,
    metadata: { email: entry.email, previousStatus: entry.status, revokedSessions: revoked },
  });

  return NextResponse.json({ success: true });
}
