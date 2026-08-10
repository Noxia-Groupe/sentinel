/**
 * Les CGI Dahua répondent en texte plat, une paire `chemin=valeur` par ligne :
 *
 *   deviceType=NVR4208-8P-4KS2
 *   users[0].Name=admin
 *   users[0].AuthorityList[0]=Monitor_01
 *   table.Network.eth0.IPAddress=192.168.1.108
 *
 * Ce module reconstruit l'objet imbriqué correspondant.
 */

export type DahuaValue = string | number | boolean | DahuaObject | DahuaValue[];
export type DahuaObject = { [key: string]: DahuaValue };

type Segment = { key: string; index?: number };

function splitPath(path: string): Segment[] {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    // `AuthorityList[0]` → clé `AuthorityList`, index 0. Les indices multiples
    // (`a[0][1]`) sont aplatis en sous-tableaux successifs.
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!match) {
      segments.push({ key: part });
      continue;
    }
    const [, key, indexes] = match;
    if (!indexes) {
      segments.push({ key });
      continue;
    }
    const parsed = [...indexes.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    segments.push({ key, index: parsed[0] });
    for (const extra of parsed.slice(1)) {
      segments.push({ key: "", index: extra });
    }
  }
  return segments;
}

function coerce(raw: string): DahuaValue {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  // `007` ou `1.2.3` doivent rester des chaînes : on ne convertit que les
  // nombres canoniques.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Analyse une réponse `key=value` en objet imbriqué. */
export function parseKeyValue(text: string): DahuaObject {
  const root: DahuaObject = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const path = trimmed.slice(0, eq).trim();
    const value = coerce(trimmed.slice(eq + 1));
    const segments = splitPath(path);
    if (segments.length === 0) continue;

    // Conteneur courant : soit un objet, soit un tableau quand le segment
    // précédent portait un index.
    let cursor: DahuaObject | DahuaValue[] = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      // Résout le conteneur ciblé par la clé du segment.
      let container: DahuaObject | DahuaValue[] = cursor;
      if (segment.key) {
        const parent = cursor as DahuaObject;
        if (segment.index === undefined) {
          if (isLast) {
            parent[segment.key] = value;
            break;
          }
          if (typeof parent[segment.key] !== "object" || parent[segment.key] === null) {
            parent[segment.key] = {};
          }
          cursor = parent[segment.key] as DahuaObject;
          continue;
        }
        if (!Array.isArray(parent[segment.key])) parent[segment.key] = [];
        container = parent[segment.key] as DahuaValue[];
      }

      const list = container as DahuaValue[];
      const index = segment.index as number;

      if (isLast) {
        list[index] = value;
        break;
      }
      if (typeof list[index] !== "object" || list[index] === null) {
        list[index] = {};
      }
      cursor = list[index] as DahuaObject;
    }
  }

  return compact(root);
}

/**
 * Les indices Dahua sont parfois lacunaires (`users[0]`, `users[2]`) : on
 * supprime les trous pour ne pas exposer de `null` dans le JSON de l'API.
 */
function compact(value: DahuaObject): DahuaObject {
  const out: DahuaObject = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = compactValue(item);
  }
  return out;
}

function compactValue(value: DahuaValue): DahuaValue {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined).map(compactValue);
  }
  if (typeof value === "object" && value !== null) return compact(value);
  return value;
}

/** Accès typé et tolérant à une valeur imbriquée. */
export function getString(obj: DahuaObject, path: string): string | undefined {
  const value = getValue(obj, path);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "object") return undefined;
  return String(value);
}

export function getValue(obj: DahuaObject, path: string): DahuaValue | undefined {
  let cursor: DahuaValue | undefined = obj;
  for (const segment of splitPath(path)) {
    if (cursor === undefined || typeof cursor !== "object") return undefined;
    if (segment.key) {
      cursor = (cursor as DahuaObject)[segment.key];
    }
    if (segment.index !== undefined) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment.index];
    }
  }
  return cursor;
}
