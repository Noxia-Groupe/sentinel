import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

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
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Le nom du client est requis" }, { status: 400 });
  }

  const code = typeof body.code === "string" && body.code.trim() ? body.code.trim() : null;
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
      contactName: asString(body.contactName),
      contactEmail: asString(body.contactEmail),
      contactPhone: asString(body.contactPhone),
      address: asString(body.address),
      notes: asString(body.notes),
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
