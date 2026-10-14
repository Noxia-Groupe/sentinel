import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";
import { DahuaError } from "./dahua/http";

/**
 * Validation de l'adresse d'un enregistreur.
 *
 * La plateforme se connecte aux adresses déclarées dans l'inventaire : sans
 * contrôle, un utilisateur pourrait la faire sonder ses propres voisins
 * (elle-même, la base de données, l'interface du reverse proxy, les
 * métadonnées d'un hôte cloud). Les réseaux privés restent permis — les NVR y
 * sont, derrière un VPN — mais pas :
 * - la boucle locale, l'adresse nulle, le lien local, le multicast ;
 * - les sous-réseaux auxquels le conteneur est lui-même attaché (réseaux
 *   Docker : la base, le proxy) ;
 * - quelques noms réservés (`localhost`, `sentinel-db`…).
 *
 * `NVR_ALLOWED_CIDRS` (facultatif, IPv4) restreint en plus les adresses aux
 * plages listées. Un nom d'hôte est résolu au moment de la connexion, et c'est
 * l'adresse résolue — vérifiée — qui est contactée : pas de substitution DNS
 * entre le contrôle et la connexion.
 */

const FORBIDDEN_NAMES = new Set([
  "localhost",
  "sentinel-db",
  "sentinel-app",
  "host.docker.internal",
  "gateway.docker.internal",
]);

const FORBIDDEN_V4 = ["0.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4"];

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export type HostCheck = { ok: true } | { ok: false; error: string };

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function inCidr4(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!net.isIPv4(base) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

/** `::ffff:a.b.c.d` → `a.b.c.d`, sinon l'adresse telle quelle. */
function unmap(address: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  return mapped ? mapped[1] : address;
}

let localCidrs: string[] | undefined;

/** Sous-réseaux IPv4 du conteneur lui-même (réseaux Docker). */
function localSubnets(): string[] {
  if (localCidrs) return localCidrs;
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal && entry.cidr) found.push(entry.cidr);
    }
  }
  localCidrs = found;
  return found;
}

function allowedCidrs(): string[] {
  return (process.env.NVR_ALLOWED_CIDRS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Contrôle d'une adresse IP littérale (IPv4, IPv6 ou IPv4 projetée en IPv6). */
export function checkNvrAddress(raw: string): HostCheck {
  const address = unmap(raw.trim());

  if (net.isIPv4(address)) {
    for (const cidr of FORBIDDEN_V4) {
      if (inCidr4(address, cidr)) return { ok: false, error: `Adresse réservée (${cidr}) : non joignable` };
    }
    if (address === "255.255.255.255") return { ok: false, error: "Adresse de diffusion : non joignable" };
    for (const cidr of localSubnets()) {
      if (inCidr4(address, cidr)) {
        return { ok: false, error: "Adresse du réseau interne de la plateforme : non autorisée" };
      }
    }
    const allowed = allowedCidrs();
    if (allowed.length && !allowed.some((cidr) => inCidr4(address, cidr))) {
      return { ok: false, error: "Adresse hors des plages autorisées (NVR_ALLOWED_CIDRS)" };
    }
    return { ok: true };
  }

  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("ff")) {
      return { ok: false, error: "Adresse IPv6 réservée : non joignable" };
    }
    if (allowedCidrs().length) {
      return { ok: false, error: "Adresse hors des plages autorisées (NVR_ALLOWED_CIDRS, IPv4)" };
    }
    return { ok: true };
  }

  return { ok: false, error: "Adresse IP invalide" };
}

/**
 * Contrôle syntaxique et statique d'un hôte saisi dans l'inventaire : adresse
 * littérale (vérifiée) ou nom d'hôte (vérifié à la connexion).
 */
export function checkNvrHost(raw: string): HostCheck {
  const host = raw.trim().replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, error: "Adresse requise" };
  if (net.isIP(host) || /^::ffff:/i.test(host)) return checkNvrAddress(host);
  if (!HOSTNAME_RE.test(host)) return { ok: false, error: "Nom d'hôte invalide" };
  const lower = host.toLowerCase();
  if (FORBIDDEN_NAMES.has(lower) || lower.endsWith(".localhost") || lower.endsWith(".internal")) {
    return { ok: false, error: "Nom d'hôte réservé : non autorisé" };
  }
  return { ok: true };
}

/**
 * Adresse à contacter pour un hôte de l'inventaire : l'adresse elle-même, ou
 * la résolution DNS d'un nom — chaque adresse résolue étant vérifiée. Lève
 * une `DahuaError("invalid")` si l'hôte n'est pas joignable légitimement.
 */
export async function resolveNvrHost(raw: string): Promise<string> {
  const syntax = checkNvrHost(raw);
  if (!syntax.ok) throw new DahuaError("invalid", `Adresse de l'enregistreur refusée : ${syntax.error}`);

  const host = raw.trim().replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return unmap(host);

  let addresses: string[];
  try {
    addresses = (await dns.lookup(host, { all: true })).map((entry) => entry.address);
  } catch {
    throw new DahuaError("unreachable", `Nom d'hôte introuvable : ${host}`);
  }
  if (addresses.length === 0) throw new DahuaError("unreachable", `Nom d'hôte sans adresse : ${host}`);

  for (const address of addresses) {
    const check = checkNvrAddress(address);
    if (!check.ok) {
      throw new DahuaError("invalid", `« ${host} » résout vers une adresse refusée : ${check.error}`);
    }
  }
  // IPv4 d'abord : c'est ce que parlent les enregistreurs.
  return unmap(addresses.find((address) => net.isIPv4(unmap(address))) ?? addresses[0]);
}
