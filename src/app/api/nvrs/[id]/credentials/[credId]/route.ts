import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

type Params = { params: Promise<{ id: string; credId: string }> };

// PUT /api/nvrs/[id]/credentials/[credId] — Met à jour un compte (rotation de mot de passe)
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id, credId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const credential = await prisma.nvrCredential.findFirst({ where: { id: credId, nvrId: id } });
  if (!credential) {
    return NextResponse.json({ error: "Compte non trouvé" }, { status: 404 });
  }

  const password = typeof body.password === "string" && body.password ? body.password : undefined;

  const updated = await prisma.nvrCredential.update({
    where: { id: credId },
    data: {
      ...(typeof body.username === "string" && body.username.trim()
        ? { username: body.username.trim() }
        : {}),
      ...(typeof body.type === "string" && body.type.trim() ? { type: body.type.trim() } : {}),
      ...(body.label !== undefined
        ? { label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null }
        : {}),
      ...(password
        ? {
            encryptedPassword: encrypt(password),
            // Le résultat du dernier test ne vaut plus rien après rotation.
            lastTestOk: null,
            lastTestedAt: null,
          }
        : {}),
    },
    select: { id: true, type: true, username: true, label: true, lastTestOk: true, lastTestedAt: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: password ? "credential.rotate" : "credential.update",
    targetType: "credential",
    targetId: credId,
    metadata: { nvrId: id, username: updated.username },
  });

  return NextResponse.json(updated);
}

// DELETE /api/nvrs/[id]/credentials/[credId] — Supprime un compte
export async function DELETE(req: NextRequest, { params }: Params) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id, credId } = await params;

  const credential = await prisma.nvrCredential.findFirst({ where: { id: credId, nvrId: id } });
  if (!credential) {
    return NextResponse.json({ error: "Compte non trouvé" }, { status: 404 });
  }

  await prisma.nvrCredential.delete({ where: { id: credId } });

  await recordAudit({
    actor: guard.actor,
    action: "credential.delete",
    targetType: "credential",
    targetId: credId,
    metadata: { nvrId: id, username: credential.username },
  });

  return NextResponse.json({ success: true });
}
