import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

// POST /api/nvrs/[id]/credentials — Enregistre un compte d'accès
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const type = typeof body.type === "string" ? body.type.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!type || !username || !password) {
    return NextResponse.json(
      { error: "Type, identifiant et mot de passe sont requis" },
      { status: 400 },
    );
  }

  const nvr = await prisma.nvr.findUnique({ where: { id }, select: { id: true } });
  if (!nvr) return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });

  const duplicate = await prisma.nvrCredential.findFirst({ where: { nvrId: id, type, username } });
  if (duplicate) {
    return NextResponse.json(
      { error: `Le compte « ${username} » est déjà enregistré pour ce type` },
      { status: 409 },
    );
  }

  const credential = await prisma.nvrCredential.create({
    data: {
      nvrId: id,
      type,
      username,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
      encryptedPassword: encrypt(password),
    },
    select: { id: true, type: true, username: true, label: true, createdAt: true },
  });

  await recordAudit({
    actor: guard.actor,
    action: "credential.create",
    targetType: "credential",
    targetId: credential.id,
    metadata: { nvrId: id, type, username },
  });

  return NextResponse.json(credential, { status: 201 });
}
