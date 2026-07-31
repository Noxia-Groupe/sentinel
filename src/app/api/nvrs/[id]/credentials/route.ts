import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

// POST /api/nvrs/[id]/credentials — Ajoute un credential
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { type, username, password } = body;

  if (!type || !username || !password) {
    return NextResponse.json(
      { error: "Type, username et password sont requis" },
      { status: 400 }
    );
  }

  const cred = await prisma.nvrCredential.create({
    data: {
      nvrId: id,
      type,
      username,
      encryptedPassword: encrypt(password),
    },
  });

  return NextResponse.json(
    { id: cred.id, type: cred.type, username: cred.username },
    { status: 201 }
  );
}
