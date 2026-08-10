import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/lib/api/openapi";

/**
 * GET /api/v1/openapi.json — Contrat de l'API, lisible par un agent.
 *
 * Public comme le point d'entrée `/api/v1` : la spécification ne contient
 * aucune donnée d'exploitation.
 */
export async function GET(req: Request) {
  const configured = process.env.NEXTAUTH_URL?.replace(/\/+$/, "");
  const baseUrl = configured || new URL(req.url).origin;

  return NextResponse.json(buildOpenApiDocument(baseUrl));
}
