/**
 * Gehen/Rennen-Wechsel eines Gegners (Config `animationVariation`), als
 * Simulationszustand.
 *
 * Der Gegner startet gehend und wechselt nach jeweils 3-8 s Spielzeit zwischen
 * Gehen und Rennen. Der Zustand lebt in der Simulation: EnemyManager tickt ihn
 * im Sub-Step vor `move()`, der Multiplikator wirkt also im selben Sub-Step.
 * Der Renderer zeigt nur den passenden Clip (EnemyManager.presentFrame).
 *
 * Deterministisch: Die Intervalle kommen aus einem Mulberry32-Strom (derselbe
 * Algorithmus wie devworld/utils/seeded-random.ts), geseedet aus der Enemy-ID.
 * Gleiche ID, gleiche Spielzeit, gleicher Zustand, unabhängig von Framerate
 * und Timescale. Es gibt noch keinen Simulations-RNG pro Match
 * (MULTIPLAYER_CONCEPT.md 2.3); kommt er, ersetzt sein Seed den ID-Hash.
 */

/** Kürzeste Phase (Gehen oder Rennen) in Spielzeit-ms. */
export const RUSH_MIN_INTERVAL_MS = 3000;
/** Längste Phase (exklusiv) in Spielzeit-ms. */
export const RUSH_MAX_INTERVAL_MS = 8000;

/** FNV-1a über die ID: stabiler 32-Bit-Seed ohne Allokation. */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class EnemyRush {
  /** true = rennt (Run-Clip, runSpeedMultiplier), false = geht. */
  running = false;

  private remainingMs: number;
  private rngState: number;

  constructor(
    id: string,
    private readonly runSpeedMultiplier: number,
  ) {
    this.rngState = hashId(id);
    this.remainingMs = this.nextInterval();
  }

  /**
   * Einen Sub-Step weiterschalten. Liefert den Geschwindigkeits-Multiplikator
   * für genau diesen Sub-Step.
   */
  tick(deltaMs: number): number {
    this.remainingMs -= deltaMs;
    while (this.remainingMs <= 0) {
      this.running = !this.running;
      this.remainingMs += this.nextInterval();
    }
    return this.running ? this.runSpeedMultiplier : 1;
  }

  /** Debug: Zustand setzen, die nächste Phase beginnt von vorn. */
  force(running: boolean): void {
    this.running = running;
    this.remainingMs = this.nextInterval();
  }

  /** Nächste Phasenlänge in [RUSH_MIN_INTERVAL_MS, RUSH_MAX_INTERVAL_MS). */
  private nextInterval(): number {
    // Mulberry32-Schritt auf dem gespeicherten Zustand.
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return RUSH_MIN_INTERVAL_MS + r * (RUSH_MAX_INTERVAL_MS - RUSH_MIN_INTERVAL_MS);
  }
}
