import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireOperator, requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { LIMITS, clip } from "@/lib/validate";

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
  const guard = await requireOperator(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const client = await prisma.client.update({
    where: { id },
    data: {
      ...(clip(body.name, LIMITS.name) ? { name: clip(body.name, LIMITS.name)! } : {}),
      ...(body.code !== undefined ? { code: clip(body.code, LIMITS.code) } : {}),
      ...(body.contactName !== undefined ? { contactName: clip(body.contactName, LIMITS.name) } : {}),
      ...(body.contactEmail !== undefined ? { contactEmail: clip(body.contactEmail, LIMITS.email) } : {}),
      ...(body.contactPhone !== undefined ? { contactPhone: clip(body.contactPhone, LIMITS.phone) } : {}),
      ...(body.address !== undefined ? { address: clip(body.address, LIMITS.address) } : {}),
      ...(body.notes !== undefined ? { notes: clip(body.notes, LIMITS.notes) } : {}),
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
  const guard = await requireAdmin(req);
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

