import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";

// GET /api/clients/[id] — Fiche client et parc rattaché
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const client = await prisma.client.findUnique({
    where: { id: (await params).id },
    include: {
      nvrs: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          ip: true,
          status: true,
          location: true,
          lastSeen: true,
          lastCheckOk: true,
          connectionMode: true,
        },
      },
    },
  });

  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  return NextResponse.json(client);
}

// PUT /api/clients/[id] — Met à jour une fiche client
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const client = await prisma.client.update({
    where: { id },
    data: {
      ...(typeof body.name === "string" && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(body.code !== undefined ? { code: asString(body.code) } : {}),
      ...(body.contactName !== undefined ? { contactName: asString(body.contactName) } : {}),
      ...(body.contactEmail !== undefined ? { contactEmail: asString(body.contactEmail) } : {}),
      ...(body.contactPhone !== undefined ? { contactPhone: asString(body.contactPhone) } : {}),
      ...(body.address !== undefined ? { address: asString(body.address) } : {}),
      ...(body.notes !== undefined ? { notes: asString(body.notes) } : {}),
      ...(typeof body.active === "boolean" ? { active: body.active } : {}),
    },
  });

  await recordAudit({
    actor: guard.actor,
    action: "client.update",
    targetType: "client",
    targetId: id,
  });

  return NextResponse.json(client);
}

// DELETE /api/clients/[id] — Supprime la fiche (les NVR sont conservés, détachés)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  await prisma.client.delete({ where: { id } });

  await recordAudit({
    actor: guard.actor,
    action: "client.delete",
    targetType: "client",
    targetId: id,
  });

  return NextResponse.json({ success: true });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
