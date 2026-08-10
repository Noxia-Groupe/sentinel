import { NextResponse } from "next/server";
import { ALL_SCOPES, SCOPES } from "@/lib/api-keys";

/**
 * GET /api/v1 — Point d'entrée de découverte.
 *
 * Volontairement accessible sans clé : un agent doit pouvoir découvrir le
 * contrat de l'API avant d'en posséder une. Aucune donnée d'exploitation n'y
 * est exposée.
 */
export async function GET() {
  return NextResponse.json({
    name: "SENTINEL API",
    version: "1.0.0",
    description:
      "Centre d'alarme des enregistreurs Dahua : consultation et traitement des alarmes, " +
      "test des accès et intervention à distance sur le parc.",
    authentication: {
      scheme: "Bearer",
      header: "Authorization: Bearer sntl_xxxxxxxx_…",
      alternative: "X-Api-Key: sntl_xxxxxxxx_…",
      note: "Les clés se créent depuis Paramètres → Clés d'API (compte administrateur).",
    },
    scopes: ALL_SCOPES.map((scope) => ({ name: scope, description: SCOPES[scope] })),
    openapi: "/api/v1/openapi.json",
    endpoints: [
      { method: "GET", path: "/api/v1/me", scope: "toute clé valide" },
      { method: "GET", path: "/api/v1/stats", scope: "alarms:read" },
      { method: "GET", path: "/api/v1/clients", scope: "nvr:read" },
      { method: "GET", path: "/api/v1/nvrs", scope: "nvr:read" },
      { method: "GET", path: "/api/v1/nvrs/{id}", scope: "nvr:read" },
      { method: "POST", path: "/api/v1/nvrs/{id}/test", scope: "nvr:test" },
      { method: "GET", path: "/api/v1/nvrs/{id}/credentials", scope: "nvr:read" },
      {
        method: "POST",
        path: "/api/v1/nvrs/{id}/credentials/{credentialId}/reveal",
        scope: "credentials:read",
      },
      {
        method: "POST",
        path: "/api/v1/nvrs/{id}/actions",
        scope: "nvr:test (lecture) ou nvr:control (action)",
      },
      { method: "GET", path: "/api/v1/events", scope: "alarms:read" },
      { method: "GET", path: "/api/v1/events/{id}", scope: "alarms:read" },
      { method: "PATCH", path: "/api/v1/events/{id}", scope: "alarms:write" },
      { method: "POST", path: "/api/v1/events/{id}/comments", scope: "alarms:write" },
    ],
  });
}
