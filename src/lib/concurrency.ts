/**
 * Garde-fous d'exécution pour les opérations longues (diagnostic P2P, tests
 * de connexion) : une seule à la fois par clé, un nombre maximal en parallèle
 * sur l'instance, et un délai minimal entre deux lancements d'une même clé.
 * En mémoire : l'application tourne dans un conteneur unique.
 */
export type GateDenied = { ok: false; reason: "busy" | "cooldown" | "saturated"; retryAfter: number; message: string };
export type GateGranted = { ok: true; release: () => void };

export class Gate {
  private readonly inFlight = new Set<string>();
  private readonly lastFinished = new Map<string, number>();

  constructor(
    private readonly label: string,
    private readonly max: number,
    private readonly cooldownMs: number,
  ) {}

  acquire(key: string): GateGranted | GateDenied {
    if (this.inFlight.has(key)) {
      return { ok: false, reason: "busy", retryAfter: 5, message: `${this.label} déjà en cours pour cet enregistreur` };
    }
    const since = Date.now() - (this.lastFinished.get(key) ?? 0);
    if (since < this.cooldownMs) {
      const retryAfter = Math.ceil((this.cooldownMs - since) / 1000);
      return {
        ok: false,
        reason: "cooldown",
        retryAfter,
        message: `${this.label} vient de se terminer : réessayer dans ${retryAfter} s`,
      };
    }
    if (this.inFlight.size >= this.max) {
      return {
        ok: false,
        reason: "saturated",
        retryAfter: 15,
        message: `${this.label} : ${this.max} opérations déjà en cours sur la plateforme, réessayer dans un instant`,
      };
    }
    this.inFlight.add(key);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.inFlight.delete(key);
        this.lastFinished.set(key, Date.now());
        if (this.lastFinished.size > 1000) {
          const horizon = Date.now() - this.cooldownMs;
          for (const [name, at] of this.lastFinished) if (at < horizon) this.lastFinished.delete(name);
        }
      },
    };
  }
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim() || "");
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Diagnostics P2P : longs (deux profils × tunnels), coûteux pour le cloud Dahua. */
export const p2pDiagnosticGate = new Gate(
  "Diagnostic P2P",
  envInt("P2P_DIAGNOSTIC_MAX_CONCURRENT", 2),
  envInt("P2P_DIAGNOSTIC_COOLDOWN_SECONDS", 30) * 1000,
);

/** Tests de connexion : un par enregistreur à la fois, plafond global. */
export const connectionTestGate = new Gate("Test de connexion", envInt("NVR_TEST_MAX_CONCURRENT", 8), 0);
