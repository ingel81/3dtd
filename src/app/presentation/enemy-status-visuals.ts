import type { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import { BURST_PALETTES, STUN_SPARKS } from '../configs/visual-effects.config';
import { EF_ANY_STATUS, EF_BURNING, EF_FROZEN, EF_POISONED, EF_SLOWED, EF_STUNNED } from '../sim/protocol/packet';

/** The renderers the status looks drive */
export type StatusVisualsEngine = Pick<ThreeTilesEngine, 'enemies' | 'effects'>;

/**
 * What the enemies' status effects look like (FramePresenter): frost aura,
 * ice crystals, stun sparks, poison aura and burn tint, each switched on and
 * off against a set of the enemies that show it. Read from the status bits
 * of the enemy table (E_FLAGS); the effects themselves live in the
 * simulation.
 */
export class EnemyStatusVisuals {
  // Enemies with an active frost visual (for cleanup on status end)
  private readonly frozen = new Set<string>();
  // Enemies frozen solid: ice crystals and the icy tint
  private readonly iced = new Set<string>();
  // Stunned enemies and when their next spark burst is due (game time, ms)
  private readonly stunSparkAt = new Map<string, number>();
  // Enemies with an active poison visual
  private readonly poisoned = new Set<string>();
  // Enemies with the burn tint on
  private readonly burning = new Set<string>();
  /** Spark bursts this frame, at most STUN_SPARKS.perFrame */
  private sparkBursts = 0;

  /** A new frame: its spark budget is full */
  beginFrame(): void {
    this.sparkBursts = 0;
  }

  /**
   * Edge-triggered against the sets: each look goes on when its bit comes
   * up and off when it goes. `at` is the enemy's local position this frame,
   * `sparkHeight` the geo height of its body (ground plus height offset).
   */
  present(
    id: string,
    flags: number,
    lat: number,
    lon: number,
    bodyHeight: number,
    engine: StatusVisualsEngine,
    at: Vector3,
    gameTimeMs: number,
  ): void {
    const any = (flags & EF_ANY_STATUS) !== 0;
    const isSlowed = any && (flags & EF_SLOWED) !== 0;
    const hasFrost = this.frozen.size !== 0 && this.frozen.has(id);
    if (isSlowed && !hasFrost) {
      engine.enemies.setFreezeVisual(id, true);
      engine.effects.spawnFrostAura(id, at);
      this.frozen.add(id);
    } else if (isSlowed && hasFrost) {
      engine.effects.updateFrostAuraPosition(id, at);
    } else if (!isSlowed && hasFrost) {
      engine.enemies.setFreezeVisual(id, false);
      engine.effects.stopFrostAura(id);
      this.frozen.delete(id);
    }

    // Frozen solid: icy tint and ice crystals, over the slow look if both are on
    const isFrozen = any && (flags & EF_FROZEN) !== 0;
    const hasIce = this.iced.size !== 0 && this.iced.has(id);
    if (isFrozen && !hasIce) {
      engine.enemies.setIcedVisual(id, true);
      engine.effects.spawnIceCrystals(id, at);
      this.iced.add(id);
    } else if (isFrozen && hasIce) {
      engine.effects.updateIceCrystalsPosition(id, at);
    } else if (!isFrozen && hasIce) {
      engine.enemies.setIcedVisual(id, false);
      engine.effects.stopIceCrystals(id);
      this.iced.delete(id);
    }

    // Stunned: violet-blue tint and a burst of sparks every STUN_SPARKS.intervalMs
    // of game time, at most perFrame bursts per frame
    const isStunned = any && (flags & EF_STUNNED) !== 0;
    const sparkAt = this.stunSparkAt.size !== 0 ? this.stunSparkAt.get(id) : undefined;
    if (isStunned) {
      if (sparkAt === undefined) engine.enemies.setStunVisual(id, true);
      if ((sparkAt === undefined || gameTimeMs >= sparkAt) && this.sparkBursts < STUN_SPARKS.perFrame) {
        this.sparkBursts++;
        engine.effects.spawnBurstAtGeo(lat, lon, bodyHeight + STUN_SPARKS.height, STUN_SPARKS.particles, BURST_PALETTES.stun);
        this.stunSparkAt.set(id, gameTimeMs + STUN_SPARKS.intervalMs);
      } else if (sparkAt === undefined) {
        // Over the frame's budget: sparks from the next frame on
        this.stunSparkAt.set(id, gameTimeMs);
      }
    } else if (sparkAt !== undefined) {
      engine.enemies.setStunVisual(id, false);
      this.stunSparkAt.delete(id);
    }

    const isPoisoned = any && (flags & EF_POISONED) !== 0;
    const hasPoison = this.poisoned.size !== 0 && this.poisoned.has(id);
    if (isPoisoned && !hasPoison) {
      engine.enemies.setPoisonVisual(id, true);
      engine.effects.spawnPoisonAura(id, at);
      this.poisoned.add(id);
    } else if (isPoisoned && hasPoison) {
      engine.effects.updatePoisonAuraPosition(id, at);
    } else if (!isPoisoned && hasPoison) {
      engine.enemies.setPoisonVisual(id, false);
      engine.effects.stopPoisonAura(id);
      this.poisoned.delete(id);
    }

    const isBurning = any && (flags & EF_BURNING) !== 0;
    const hasBurn = this.burning.size !== 0 && this.burning.has(id);
    if (isBurning !== hasBurn) {
      engine.enemies.setBurnVisual(id, isBurning);
      if (isBurning) this.burning.add(id);
      else this.burning.delete(id);
    }
  }

  /** The enemy left or died: its auras and crystals go; the tints go with its render slot */
  forget(id: string, engine: StatusVisualsEngine | null): void {
    if (this.frozen.delete(id)) engine?.effects.stopFrostAura(id);
    if (this.iced.delete(id)) engine?.effects.stopIceCrystals(id);
    if (this.poisoned.delete(id)) engine?.effects.stopPoisonAura(id);
    this.burning.delete(id);
    this.stunSparkAt.delete(id);
  }

  /** Every enemy gone at once: every aura and crystal stops */
  clear(engine: StatusVisualsEngine | null): void {
    for (const id of this.frozen) engine?.effects.stopFrostAura(id);
    for (const id of this.iced) engine?.effects.stopIceCrystals(id);
    for (const id of this.poisoned) engine?.effects.stopPoisonAura(id);
    this.reset();
  }

  /** Forget what is shown without stopping it: effects.clear() took the particles already (a replay's seek) */
  reset(): void {
    this.frozen.clear();
    this.iced.clear();
    this.poisoned.clear();
    this.burning.clear();
    this.stunSparkAt.clear();
  }
}
