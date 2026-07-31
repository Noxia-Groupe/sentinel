import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { NvrCredential } from "@/generated/prisma/client";
import { encrypt, decrypt } from "@/lib/crypto";

// GET /api/nvrs/[id] — Détail NVR + déchiffrement des mots de passe
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  const nvr = await prisma.nvr.findUnique({
    where: { id },
    include: { credentials: true, events: { orderBy: { receivedAt: "desc" }, take: 50 } },
  });

  if (!nvr) {
    return NextResponse.json({ error: "NVR non trouvé" }, { status: 404 });
  }

  // Déchiffrer les mots de passe
  const decryptedCredentials = nvr.credentials.map((cred) => ({
    ...cred,
    password: decrypt(cred.encryptedPassword),
    encryptedPassword: undefined,
  }));

  return NextResponse.json({
    ...nvr,
    credentials: decryptedCredentials,
  });
}

// PUT /api/nvrs/[id] — Met à jour un NVR
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, ip, port, serialNumber, model, location, notes, status } = body;

  const nvr = await prisma.nvr.update({
    where: { id },
    data: { name, ip, port, serialNumber, model, location, notes, status },
  });

  return NextResponse.json(nvr);
}

// DELETE /api/nvrs/[id] — Supprime un NVR
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;

  await prisma.nvr.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
