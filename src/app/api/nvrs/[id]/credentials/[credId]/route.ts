import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// DELETE /api/nvrs/[id]/credentials/[credId] — Supprime un credential
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; credId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { id, credId } = await params;

  const cred = await prisma.nvrCredential.findFirst({
    where: { id: credId, nvrId: id },
  });

  if (!cred) {
    return NextResponse.json({ error: "Credential non trouvé" }, { status: 404 });
  }

  await prisma.nvrCredential.delete({ where: { id: credId } });
  return NextResponse.json({ success: true });
}
