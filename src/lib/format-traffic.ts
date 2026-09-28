/**
 * Mise en forme des débits et volumes réseau — en bits par seconde pour les
 * débits (comme les abonnements et les équipements réseau), en octets pour
 * les volumes. Sans dépendance : utilisable côté navigateur.
 */

const nf = (value: number, digits = 1) =>
  value.toLocaleString("fr-FR", { maximumFractionDigits: value >= 100 ? 0 : digits });

/** Débit à partir d'octets par seconde. */
export function formatRate(bytesPerSecond: number): string {
  const bits = bytesPerSecond * 8;
  if (bits < 1_000) return `${nf(bits, 0)} bit/s`;
  if (bits < 1_000_000) return `${nf(bits / 1_000)} kbit/s`;
  return `${nf(bits / 1_000_000)} Mbit/s`;
}

/** Volume à partir d'octets. */
export function formatVolume(bytes: number): string {
  if (bytes < 1_000) return `${nf(bytes, 0)} o`;
  if (bytes < 1_000_000) return `${nf(bytes / 1_000)} ko`;
  if (bytes < 1_000_000_000) return `${nf(bytes / 1_000_000)} Mo`;
  return `${nf(bytes / 1_000_000_000)} Go`;
}
