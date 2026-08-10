import { NextResponse } from "next/server";
import { requireScope, apiError } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";

// GET /api/v1/nvrs/[id]/credentials — Comptes enregistrés (sans les mots de passe)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireScope(req, "nvr:read");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const nvr = await prisma.nvr.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!nvr) return apiError(404, "not_found", "Enregistreur introuvable");

  const credentials = await prisma.nvrCredential.findMany({
    where: { nvrId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      label: true,
      username: true,
      lastTestedAt: true,
      lastTestOk: true,
      rights: true,
    },
  });

  return NextResponse.json({
    nvr,
    credentials,
    note: "Le mot de passe s'obtient via POST /api/v1/nvrs/{id}/credentials/{credentialId}/reveal (scope credentials:read).",
  });
}
