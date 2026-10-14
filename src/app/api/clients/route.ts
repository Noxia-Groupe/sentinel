import { NextRequest, NextResponse } from "next/server";
import { requireOperator, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { LIMITS, clip, clipRequired } from "@/lib/validate";

// GET /api/clients — Liste des clients avec le décompte de leur parc
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      nvrs: {
        select: { id: true, name: true, status: true, ip: true, location: true },
        orderBy: { name: "asc" },
      },
    },
  });

  return NextResponse.json(
    clients.map((client) => ({
      ...client,
      nvrCount: client.nvrs.length,
      onlineCount: client.nvrs.filter((nvr) => nvr.status === "online").length,
    })),
  );
}

// POST /api/clients — Crée une fiche client
export async function POST(req: NextRequest) {
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = clipRequired(body.name, LIMITS.name);

  if (!name) {
    return NextResponse.json({ error: "Le nom du client est requis" }, { status: 400 });
  }

  const code = clip(body.code, LIMITS.code);
  if (code) {
    const duplicate = await prisma.client.findUnique({ where: { code } });
    if (duplicate) {
      return NextResponse.json(
        { error: `La référence « ${code} » est déjà utilisée` },
        { status: 409 },
      );
    }
  }

  const client = await prisma.client.create({
    data: {
      name,
      code,
      contactName: clip(body.contactName, LIMITS.name),
      contactEmail: clip(body.contactEmail, LIMITS.email),
      contactPhone: clip(body.contactPhone, LIMITS.phone),
      address: clip(body.address, LIMITS.address),
      notes: clip(body.notes, LIMITS.notes),
    },
  });

  await recordAudit({
    actor: guard.actor,
    action: "client.create",
    targetType: "client",
    targetId: client.id,
    metadata: { name: client.name },
  });

  return NextResponse.json(client, { status: 201 });
}

