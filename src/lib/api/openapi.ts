import { ALL_SCOPES, SCOPES } from "@/lib/api-keys";
import { NVR_ACTIONS } from "@/lib/dahua/actions";
import { EVENT_STATUSES, SEVERITIES } from "@/lib/dahua/events";

/**
 * Spécification OpenAPI de l'API `/api/v1`.
 *
 * Elle est produite à partir des mêmes constantes que le code (scopes, actions,
 * statuts) : la documentation ne peut donc pas diverger de l'implémentation.
 * C'est le document qu'un agent IA lit pour découvrir ce qu'il a le droit de faire.
 */
export function buildOpenApiDocument(baseUrl: string) {
  const errorResponse = {
    description: "Erreur",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };

  const eventSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", description: "Code Dahua de l'événement (VideoMotion, VideoLoss…)" },
      title: { type: "string", description: "Libellé lisible en français" },
      severity: { type: "string", enum: SEVERITIES },
      status: { type: "string", enum: EVENT_STATUSES },
      channel: { type: "integer", nullable: true },
      receivedAt: { type: "string", format: "date-time" },
      acknowledgedAt: { type: "string", format: "date-time", nullable: true },
      acknowledgedBy: { type: "string", nullable: true },
      resolvedAt: { type: "string", format: "date-time", nullable: true },
      resolution: { type: "string", nullable: true },
      payload: { type: "object", description: "Charge utile brute reçue de l'enregistreur" },
      nvr: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          ip: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
          status: { type: "string" },
          client: {
            type: "object",
            nullable: true,
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              code: { type: "string", nullable: true },
            },
          },
        },
      },
    },
  } as const;

  const idParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  } as const;

  return {
    openapi: "3.1.0",
    info: {
      title: "SENTINEL — API centre d'alarme Dahua",
      version: "1.0.0",
      description: [
        "API d'exploitation du parc d'enregistreurs Dahua : consultation et traitement",
        "des alarmes, test des accès enregistrés, vérification des droits des comptes et",
        "intervention à distance sur les équipements.",
        "",
        "Authentification : `Authorization: Bearer <clé>`. Chaque clé porte un jeu de",
        "scopes ; un appel hors périmètre renvoie 403 avec le scope manquant.",
        "",
        "Un test de connexion en échec répond 200 avec `ok: false` et un motif",
        "(`unreachable`, `auth`, `forbidden`, `unsupported`, `invalid`) : c'est un",
        "résultat d'exploitation, pas une erreur d'API.",
      ].join("\n"),
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: `Scopes disponibles :\n${ALL_SCOPES.map((s) => `- \`${s}\` — ${SCOPES[s]}`).join("\n")}`,
        },
      },
      schemas: { Event: eventSchema },
    },
    paths: {
      "/api/v1/me": {
        get: {
          summary: "Identité et scopes de la clé utilisée",
          responses: { "200": { description: "Description de la clé" }, "401": errorResponse },
        },
      },
      "/api/v1/stats": {
        get: {
          summary: "Compteurs du parc et des alarmes en cours",
          description: "Scope requis : `alarms:read`.",
          responses: { "200": { description: "Compteurs" }, "403": errorResponse },
        },
      },
      "/api/v1/clients": {
        get: {
          summary: "Liste des clients et de leur parc",
          description: "Scope requis : `nvr:read`.",
          responses: { "200": { description: "Clients" }, "403": errorResponse },
        },
      },
      "/api/v1/nvrs": {
        get: {
          summary: "Inventaire des enregistreurs",
          description: "Scope requis : `nvr:read`.",
          parameters: [
            { name: "clientId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Enregistreurs" }, "403": errorResponse },
        },
      },
      "/api/v1/nvrs/{id}": {
        get: {
          summary: "Fiche d'un enregistreur",
          description: "Scope requis : `nvr:read`.",
          parameters: [idParam],
          responses: { "200": { description: "Enregistreur" }, "404": errorResponse },
        },
      },
      "/api/v1/nvrs/{id}/test": {
        post: {
          summary: "Tester un accès et relever les droits du compte",
          description: [
            "Scope requis : `nvr:test`.",
            "Utilise un mot de passe enregistré (jamais transmis en clair par l'appelant).",
            "Sans `credentialId`, un compte administrateur est choisi en priorité.",
            "Avec `all: true`, tous les comptes du NVR sont testés l'un après l'autre.",
          ].join(" "),
          parameters: [idParam],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    credentialId: { type: "string" },
                    all: { type: "boolean", default: false },
                    includeRights: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Résultat du test — `ok` indique la réussite",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      ok: { type: "boolean" },
                      reason: {
                        type: "string",
                        enum: ["unreachable", "auth", "forbidden", "http", "unsupported", "invalid"],
                      },
                      message: { type: "string" },
                      latencyMs: { type: "integer" },
                      device: { type: "object" },
                      rights: {
                        type: "object",
                        description:
                          "Droits constatés du compte : groupe, autorités et capacités déduites",
                      },
                    },
                  },
                },
              },
            },
            "403": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/api/v1/nvrs/{id}/credentials": {
        get: {
          summary: "Comptes enregistrés pour un NVR (sans mot de passe)",
          description: "Scope requis : `nvr:read`.",
          parameters: [idParam],
          responses: { "200": { description: "Comptes" }, "404": errorResponse },
        },
      },
      "/api/v1/nvrs/{id}/credentials/{credentialId}/reveal": {
        post: {
          summary: "Lire un mot de passe en clair",
          description:
            "Scope requis : `credentials:read`. Chaque lecture est tracée dans le journal d'audit avec le nom de la clé et le motif fourni.",
          parameters: [
            idParam,
            { name: "credentialId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    reason: { type: "string", description: "Motif consigné dans l'audit" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Identifiants" }, "403": errorResponse },
        },
      },
      "/api/v1/nvrs/{id}/actions": {
        get: {
          summary: "Catalogue des interventions disponibles",
          description: "Scope requis : `nvr:read`.",
          parameters: [idParam],
          responses: { "200": { description: "Actions" } },
        },
        post: {
          summary: "Exécuter une intervention à distance",
          description: [
            "Actions de lecture (scope `nvr:test`) :",
            Object.entries(NVR_ACTIONS)
              .filter(([, def]) => def.kind === "read")
              .map(([name, def]) => `\`${name}\` — ${def.description}`)
              .join(" · "),
            "",
            "Actions agissant sur l'équipement (scope `nvr:control`) :",
            Object.entries(NVR_ACTIONS)
              .filter(([, def]) => def.kind === "control")
              .map(([name, def]) => `\`${name}\` — ${def.description}`)
              .join(" · "),
          ].join("\n"),
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    action: { type: "string", enum: Object.keys(NVR_ACTIONS) },
                    params: {
                      type: "object",
                      description:
                        "Paramètres de l'action : `channel` (snapshot), `code` (event-indexes), `index` et `active` (alarm-out)",
                    },
                    credentialId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Résultat de l'action" },
            "403": errorResponse,
            "409": errorResponse,
            "504": errorResponse,
          },
        },
      },
      "/api/v1/events": {
        get: {
          summary: "Flux d'alarmes",
          description: "Scope requis : `alarms:read`.",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: { type: "string" },
              description: `Valeurs : ${EVENT_STATUSES.join(", ")} (répétable ou séparées par des virgules)`,
            },
            {
              name: "severity",
              in: "query",
              schema: { type: "string" },
              description: `Valeurs : ${SEVERITIES.join(", ")}`,
            },
            { name: "clientId", in: "query", schema: { type: "string" } },
            { name: "nvrId", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "until", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "search", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
            { name: "offset", in: "query", schema: { type: "integer", default: 0 } },
          ],
          responses: {
            "200": {
              description: "Alarmes",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      events: { type: "array", items: { $ref: "#/components/schemas/Event" } },
                      total: { type: "integer" },
                      stats: { type: "object" },
                    },
                  },
                },
              },
            },
            "403": errorResponse,
          },
        },
      },
      "/api/v1/events/{id}": {
        get: {
          summary: "Détail d'une alarme et sa main courante",
          description: "Scope requis : `alarms:read`.",
          parameters: [idParam],
          responses: { "200": { description: "Alarme" }, "404": errorResponse },
        },
        patch: {
          summary: "Traiter une alarme",
          description:
            "Scope requis : `alarms:write`. La prise en compte et la clôture sont horodatées automatiquement et attribuées à la clé utilisée.",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: EVENT_STATUSES },
                    resolution: { type: "string", description: "Motif de clôture" },
                    comment: { type: "string", description: "Entrée ajoutée à la main courante" },
                    assignedToId: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Alarme mise à jour",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Event" } } },
            },
            "400": errorResponse,
            "404": errorResponse,
          },
        },
      },
      "/api/v1/events/{id}/comments": {
        post: {
          summary: "Ajouter une entrée à la main courante",
          description: "Scope requis : `alarms:write`.",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["body"],
                  properties: { body: { type: "string" } },
                },
              },
            },
          },
          responses: { "201": { description: "Commentaire ajouté" }, "404": errorResponse },
        },
      },
    },
  };
}
