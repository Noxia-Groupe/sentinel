import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";

// GET /api/nvrs — Liste tous les NVR
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const nvrs = await prisma.nvr.findMany({
    include: {
      credentials: {
        select: {
          id: true,
          type: true,
          username: true,
          // Mot de passe chiffré — on ne le déchiffre pas dans la liste
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(nvrs);
}

// POST /api/nvrs — Crée un NVR
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await req.json();
  const { name, ip, port, serialNumber, model, location, notes, credentials } = body;

  if (!name || !ip) {
    return NextResponse.json(
      { error: "Nom et IP sont requis" },
      { status: 400 }
    );
  }

  const nvr = await prisma.nvr.create({
    data: {
      name,
      ip,
      port: port || 37777,
      serialNumber,
      model,
      location,
      notes,
      credentials: credentials
        ? {
            create: credentials.map(
              (cred: { type: string; username: string; password: string }) => ({
                type: cred.type,
                username: cred.username,
                encryptedPassword: encrypt(cred.password),
              })
            ),
          }
        : undefined,
    },
    include: {
      credentials: {
        select: { id: true, type: true, username: true },
      },
    },
  });

  return NextResponse.json(nvr, { status: 201 });
}
