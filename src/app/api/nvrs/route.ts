import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { recordAudit } from "@/lib/audit";

type CredentialInput = { type?: string; username?: string; password?: string; label?: string };

// GET /api/nvrs — Inventaire des enregistreurs (filtrable par client / statut)
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const status = url.searchParams.get("status");

  const nvrs = await prisma.nvr.findMany({
    where: {
      ...(clientId ? { clientId } : {}),
      ...(status ? { status } : {}),
    },
    include: {
      client: { select: { id: true, name: true, code: true } },
      credentials: {
        // Les mots de passe ne quittent jamais le serveur ici : leur lecture
        // passe par une route dédiée et auditée.
        select: { id: true, type: true, username: true, label: true, lastTestOk: true, lastTestedAt: true },
      },
      _count: {
        select: {
          events: { where: { status: { in: ["new", "acknowledged", "in_progress"] } } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    nvrs.map(({ _count, ...nvr }) => ({ ...nvr, openAlarms: _count.events })),
  );
}

// POST /api/nvrs — Déclare un enregistreur
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const connectionMode = body.connectionMode === "p2p" ? "p2p" : "ip";
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const p2pSerial = typeof body.p2pSerial === "string" ? body.p2pSerial.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Le nom est requis" }, { status: 400 });
  }
  if (connectionMode === "ip" && !ip) {
    return NextResponse.json(
      { error: "L'adresse IP est requise (sauf en mode P2P)" },
      { status: 400 },
    );
  }
  if (connectionMode === "p2p" && !p2pSerial) {
    return NextResponse.json(
      { error: "Le numéro de série P2P est requis en mode P2P" },
      { status: 400 },
    );
  }

  const credentials = Array.isArray(body.credentials)
    ? (body.credentials as CredentialInput[]).filter(
        (cred) => cred?.username && cred?.password && cred?.type,
      )
    : [];

  const nvr = await prisma.nvr.create({
    data: {
      name,
      clientId: typeof body.clientId === "string" && body.clientId ? body.clientId : null,
      ip: connectionMode === "p2p" ? null : ip,
      port: toPort(body.port, 37777),
      httpPort: toPort(body.httpPort, 80),
      rtspPort: toPort(body.rtspPort, 554),
      useHttps: body.useHttps === true,
      serialNumber: asString(body.serialNumber),
      connectionMode,
      p2pSerial: connectionMode === "p2p" ? p2pSerial : null,
      model: asString(body.model),
      location: asString(body.location),
      notes: asString(body.notes),
      credentials: {
        create: credentials.map((cred) => ({
          type: cred.type!,
          username: cred.username!,
          label: cred.label ?? null,
          encryptedPassword: encrypt(cred.password!),
        })),
      },
    },
    include: {
      client: { select: { id: true, name: true, code: true } },
      credentials: { select: { id: true, type: true, username: true, label: true } },
    },
  });

  await recordAudit({
    actor: guard.actor,
    action: "nvr.create",
    targetType: "nvr",
    targetId: nvr.id,
    metadata: { name: nvr.name, connectionMode, credentials: credentials.length },
  });

  return NextResponse.json(nvr, { status: 201 });
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toPort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
