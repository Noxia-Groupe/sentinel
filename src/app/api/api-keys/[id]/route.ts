import { NextRequest, NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { isScope } from "@/lib/api-keys";

type Params = { params: Promise<{ id: string }> };

// PATCH /api/api-keys/[id] — Modifie les scopes ou réactive une clé
export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const scopes = Array.isArray(body.scopes) ? body.scopes.filter(isScope) : undefined;

  const key = await prisma.apiKey.update({
    where: { id },
    data: {
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(scopes ? { scopes: [...new Set(scopes)] } : {}),
      ...(body.revoked === false ? { revokedAt: null } : {}),
      ...(body.revoked === true ? { revokedAt: new Date() } : {}),
    },
    select: { id: true, name: true, prefix: true, scopes: true, revokedAt: true, expiresAt: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: "apikey.update",
    targetType: "apikey",
    targetId: id,
    metadata: { scopes: key.scopes, revoked: Boolean(key.revokedAt) },
  });

  return NextResponse.json(key);
}

// DELETE /api/api-keys/[id] — Révoque définitivement une clé
//
// La ligne est conservée : le journal d'audit doit rester lisible après coup.
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireSuperadmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const key = await prisma.apiKey.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: { id: true, name: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: "apikey.revoke",
    targetType: "apikey",
    targetId: id,
    metadata: { name: key.name },
  });

  return NextResponse.json({ success: true });
}
