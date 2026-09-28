import type { Vector3 } from 'three';
import type { Enemy } from '../entities/enemy.entity';
import type { ThreeTilesEngine } from '../three-engine';
import { BURST_PALETTES, STUN_SPARKS } from '../configs/visual-effects.config';

/**
 * What the enemies' status effects look like (EnemyManager.presentFrame):
 * frost aura, ice crystals, stun sparks, poison aura and burn tint, each
 * switched on and off against a set of the enemies that show it.
 * Presentation only; the effects themselves live on the enemies' movement.
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
   * Frost / poison / burn visuals are edge-triggered against a Set, so running
   * them once per frame instead of once per sub-step changes nothing but
   * the number of times the same state is re-checked. Each check is
   * skipped when it cannot be true: `.some` over an empty effect list and
   * a lookup in an empty Set both answer false. `at` is the enemy's local
   * position this frame.
   */
  present(enemy: Enemy, engine: ThreeTilesEngine, at: Vector3, gameTimeMs: number): void {
    const isSlowed =
      enemy.movement.hasStatusEffects && enemy.movement.isSlowed(gameTimeMs);
    const hasFrost =
      this.frozen.size !== 0 && this.frozen.has(enemy.id);
    if (isSlowed && !hasFrost) {
      engine.enemies.setFreezeVisual(enemy.id, true);
      engine.effects.spawnFrostAura(enemy.id, at);
      this.frozen.add(enemy.id);
    } else if (isSlowed && hasFrost) {
      engine.effects.updateFrostAuraPosition(enemy.id, at);
    } else if (!isSlowed && hasFrost) {
      engine.enemies.setFreezeVisual(enemy.id, false);
      engine.effects.stopFrostAura(enemy.id);
      this.frozen.delete(enemy.id);
    }

    // Frozen solid: icy tint and ice crystals, over the slow look if both are on
    const isFrozen =
      enemy.movement.hasStatusEffects && enemy.movement.isFrozen(gameTimeMs);
    const hasIce =
      this.iced.size !== 0 && this.iced.has(enemy.id);
    if (isFrozen && !hasIce) {
      engine.enemies.setIcedVisual(enemy.id, true);
      engine.effects.spawnIceCrystals(enemy.id, at);
      this.iced.add(enemy.id);
    } else if (isFrozen && hasIce) {
      engine.effects.updateIceCrystalsPosition(enemy.id, at);
    } else if (!isFrozen && hasIce) {
      engine.enemies.setIcedVisual(enemy.id, false);
      engine.effects.stopIceCrystals(enemy.id);
      this.iced.delete(enemy.id);
    }

    // Stunned: violet-blue tint and a burst of sparks every STUN_SPARKS.intervalMs
    // of game time, at most perFrame bursts per frame
    const isStunned =
      enemy.movement.hasStatusEffects && enemy.movement.isStunned(gameTimeMs);
    const sparkAt = this.stunSparkAt.size !== 0 ? this.stunSparkAt.get(enemy.id) : undefined;
    if (isStunned) {
      if (sparkAt === undefined) engine.enemies.setStunVisual(enemy.id, true);
      if ((sparkAt === undefined || gameTimeMs >= sparkAt) && this.sparkBursts < STUN_SPARKS.perFrame) {
        this.sparkBursts++;
        engine.effects.spawnBurstAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          enemy.transform.terrainHeight + enemy.heightOffset + STUN_SPARKS.height,
          STUN_SPARKS.particles,
          BURST_PALETTES.stun,
        );
        this.stunSparkAt.set(enemy.id, gameTimeMs + STUN_SPARKS.intervalMs);
      } else if (sparkAt === undefined) {
        // Over the frame's budget: sparks from the next frame on
        this.stunSparkAt.set(enemy.id, gameTimeMs);
      }
    } else if (sparkAt !== undefined) {
      engine.enemies.setStunVisual(enemy.id, false);
      this.stunSparkAt.delete(enemy.id);
    }

    const isPoisoned =
      enemy.movement.hasStatusEffects && enemy.movement.isPoisoned(gameTimeMs);
    const hasPoison =
      this.poisoned.size !== 0 && this.poisoned.has(enemy.id);
    if (isPoisoned && !hasPoison) {
      engine.enemies.setPoisonVisual(enemy.id, true);
      engine.effects.spawnPoisonAura(enemy.id, at);
      this.poisoned.add(enemy.id);
    } else if (isPoisoned && hasPoison) {
      engine.effects.updatePoisonAuraPosition(enemy.id, at);
    } else if (!isPoisoned && hasPoison) {
      engine.enemies.setPoisonVisual(enemy.id, false);
      engine.effects.stopPoisonAura(enemy.id);
      this.poisoned.delete(enemy.id);
    }

    const isBurning =
      enemy.movement.hasStatusEffects && enemy.movement.isBurning(gameTimeMs);
    const hasBurn =
      this.burning.size !== 0 && this.burning.has(enemy.id);
    if (isBurning !== hasBurn) {
      engine.enemies.setBurnVisual(enemy.id, isBurning);
      if (isBurning) this.burning.add(enemy.id);
      else this.burning.delete(enemy.id);
    }
  }

  /** The enemy left: its auras and crystals go; the tints go with its render slot */
  forget(enemyId: string, engine: ThreeTilesEngine | null): void {
    // Cleanup frost visual if active
    if (this.frozen.has(enemyId)) {
      engine?.effects.stopFrostAura(enemyId);
      this.frozen.delete(enemyId);
    }
    // Ice crystals of a frozen enemy; its tint goes with the render slot
    if (this.iced.has(enemyId)) {
      engine?.effects.stopIceCrystals(enemyId);
      this.iced.delete(enemyId);
    }
    // Cleanup poison visual if active
    if (this.poisoned.has(enemyId)) {
      engine?.effects.stopPoisonAura(enemyId);
      this.poisoned.delete(enemyId);
    }
    // The burn and stun tints live on the render slot, which goes with the enemy
    this.burning.delete(enemyId);
    this.stunSparkAt.delete(enemyId);
  }

  /** Every enemy gone at once: every aura and crystal stops */
  clear(engine: ThreeTilesEngine | null): void {
    // Stop frost auras before clearing the tracking set
    for (const enemyId of this.frozen) {
      engine?.effects.stopFrostAura(enemyId);
    }
    this.frozen.clear();

    for (const enemyId of this.iced) {
      engine?.effects.stopIceCrystals(enemyId);
    }
    this.iced.clear();

    // Stop poison auras before clearing
    for (const enemyId of this.poisoned) {
      engine?.effects.stopPoisonAura(enemyId);
    }
    this.poisoned.clear();
    this.burning.clear();
    this.stunSparkAt.clear();
  }

  /** Forget what is shown without stopping it (EnemyManager.resetStatusVisuals) */
  reset(): void {
    this.frozen.clear();
    this.iced.clear();
    this.poisoned.clear();
    this.burning.clear();
    this.stunSparkAt.clear();
  }
}
