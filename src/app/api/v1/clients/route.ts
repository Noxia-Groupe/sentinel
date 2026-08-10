import { NextResponse } from "next/server";
import { requireScope } from "@/lib/api/guard";
import { prisma } from "@/lib/prisma";

// GET /api/v1/clients — Clients et parc rattaché
export async function GET(req: Request) {
  const guard = await requireScope(req, "nvr:read");
  if (!guard.ok) return guard.response;

  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      nvrs: { select: { id: true, name: true, status: true, location: true } },
    },
  });

  return NextResponse.json({
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      code: client.code,
      active: client.active,
      contact: {
        name: client.contactName,
        email: client.contactEmail,
        phone: client.contactPhone,
      },
      address: client.address,
      nvrs: client.nvrs,
    })),
  });
}
