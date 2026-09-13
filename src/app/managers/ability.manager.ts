/**
 * AbilityManager: player abilities (PLAYER_AGENCY_CONCEPT.md, sections 5
 * and 7).
 *
 * Holds the charges of every ability, gives one back per `rechargeWaves`
 * completed waves and schedules strikes: `use()` validates, spends the charge
 * and queues the impact; `update()` counts its warning down in game time, one
 * sub-step at a time, and resolves it in the sub-step where the countdown
 * runs out. Nothing here draws a random number, so the same command at the
 * same sub-step gives the same strike at every timescale.
 *
 * Framework-agnostic like the other managers. The route grid and the damage
 * path come in through `AbilityWorld`, so the manager runs without a grid or
 * the combat services.
 *
 * Emits `ability:used` and `ability:rejected` for every use, `ability:impact`
 * when a strike lands, `ability:resolved` with its hits and kills when it is
 * over, and an `ability:state-changed` snapshot after every mutation, like
 * the ResearchManager's `research:state-changed`.
 */

import { GameEventBus, IGameManager, SubscriptionBag } from '../game-engine';
import {
  ABILITIES,
  ABILITY_IDS,
  AbilityHaltStatus,
  AbilityId,
  AbilityRejectReason,
  AbilityStatus,
  abilityDamageFraction,
  abilityFreezeMs,
  abilitySourceId,
  abilityStunMs,
  lockedAbilityStatus,
} from '../configs/abilities.config';
import type { ResearchEffect } from '../configs/research/research.types';
import type { GeoPosition, GamePhase } from '../models/game.types';
import type { Enemy } from '../entities/enemy.entity';

/** What the manager needs from the world: route grid and damage path. */
export interface AbilityWorld {
  /** Centre of the nearest route cell within `maxDistanceM` of `target`, or null */
  snapToRoute(target: GeoPosition, maxDistanceM: number): GeoPosition | null;
  /** Alive enemies within `radiusM` (2D) of `center`, ground and air, written into `out` */
  enemiesInRadius(center: GeoPosition, radiusM: number, out: Enemy[]): Enemy[];
  /** Every target loses `fractionOf(enemy)` of its max HP; returns the kills */
  strike(targets: readonly Enemy[], fractionOf: (enemy: Enemy) => number): number;
  /** Every target halts with `status` for `durationMsOf(enemy)` game ms, the effect kept under `sourceId` */
  halt(targets: readonly Enemy[], status: AbilityHaltStatus, durationMsOf: (enemy: Enemy) => number, sourceId: string): void;
}

/** A strike between command and impact. */
export interface PendingStrike {
  readonly id: number;
  readonly abilityId: AbilityId;
  /** Impact point, already snapped to the route */
  readonly target: GeoPosition;
  /** Game time left until the impact, ms */
  remainingMs: number;
}

export type AbilityUseResult =
  | { ok: true; strike: PendingStrike }
  | { ok: false; reason: AbilityRejectReason };

interface ChargeState {
  unlocked: boolean;
  charges: number;
  /** Completed waves since the last charge came back, while not full */
  wavesTowardCharge: number;
}

export class AbilityManager implements IGameManager {
  private readonly states = new Map<AbilityId, ChargeState>();
  private readonly pending: PendingStrike[] = [];
  private nextStrikeId = 1;
  private getPhase: () => GamePhase = () => 'setup';

  // Reused per resolution, see update()
  private readonly dueScratch: PendingStrike[] = [];
  private readonly targetScratch: Enemy[] = [];

  private readonly subs = new SubscriptionBag();

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly world: AbilityWorld,
  ) {
    this.subs.add(this.eventBus.on('research:completed', (event) => {
      this.onResearchCompleted(event.effects);
    }));
    // Deferred event: delivered in the next sub-step's processQueue, at the
    // same sub-step at every timescale.
    this.subs.add(this.eventBus.on('wave:completed', () => {
      this.advanceWaves(1);
    }));
  }

  /** Phase source (WaveManager); abilities only fire during a wave. */
  setPhaseProvider(provider: () => GamePhase): void {
    this.getPhase = provider;
  }

  // ==================== Queries ====================

  getStatus(id: AbilityId): AbilityStatus {
    const state = this.states.get(id);
    if (!state?.unlocked) return lockedAbilityStatus(id);
    const config = ABILITIES[id];
    const full = state.charges >= config.maxCharges;
    return {
      id,
      unlocked: true,
      charges: state.charges,
      maxCharges: config.maxCharges,
      wavesUntilCharge: full ? 0 : config.rechargeWaves - state.wavesTowardCharge,
      pending: this.pending.some((s) => s.abilityId === id),
    };
  }

  getStatuses(): AbilityStatus[] {
    return ABILITY_IDS.map((id) => this.getStatus(id));
  }

  /** Why `id` cannot fire right now, or null when it can. The target is checked by use(). */
  checkUse(id: AbilityId): AbilityRejectReason | null {
    if (!ABILITIES[id]) return 'unknown';
    const state = this.states.get(id);
    if (!state?.unlocked) return 'locked';
    if (state.charges <= 0) return 'no-charge';
    if (this.getPhase() !== 'wave') return 'no-wave';
    return null;
  }

  /** Where a strike of `id` aimed at `target` would land, or null when no route cell is in reach. */
  resolveTarget(id: AbilityId, target: GeoPosition): GeoPosition | null {
    const config = ABILITIES[id];
    if (!config) return null;
    return this.world.snapToRoute(target, config.snapRadiusM);
  }

  getPendingStrikes(): readonly PendingStrike[] {
    return this.pending;
  }

  /** A strike is counting down. The wave does not end before it lands. */
  hasPendingStrikes(): boolean {
    return this.pending.length > 0;
  }

  // ==================== Actions ====================

  /**
   * Fire `id` at `target`: validate, spend a charge, queue the impact. The
   * impact lands `warningMs` of game time later on the route cell nearest to
   * the target. Announces the outcome as `ability:used` or `ability:rejected`.
   */
  use(id: AbilityId, target: GeoPosition): AbilityUseResult {
    const result = this.tryUse(id, target);
    if (!result.ok) {
      this.eventBus.emit({ type: 'ability:rejected', abilityId: id, reason: result.reason });
      return result;
    }

    const config = ABILITIES[id];
    this.eventBus.emit({
      type: 'ability:used',
      abilityId: id,
      strikeId: result.strike.id,
      target: result.strike.target,
      radiusM: config.radiusM,
      warningMs: config.warningMs,
    });
    this.emitStateSnapshot();
    return result;
  }

  /**
   * Debug: every charge of `id` back, if it is unlocked (the dev cheat,
   * debug:ready-ability, completes the research first, which unlocks it).
   */
  refillCharges(id: AbilityId): void {
    const state = this.states.get(id);
    if (!state?.unlocked) return;
    state.charges = ABILITIES[id].maxCharges;
    state.wavesTowardCharge = 0;
    this.emitStateSnapshot();
  }

  private tryUse(id: AbilityId, target: GeoPosition): AbilityUseResult {
    const reason = this.checkUse(id);
    if (reason) return { ok: false, reason };

    const snapped = this.resolveTarget(id, target);
    if (!snapped) return { ok: false, reason: 'no-route' };

    this.states.get(id)!.charges--;
    const strike: PendingStrike = {
      id: this.nextStrikeId++,
      abilityId: id,
      target: snapped,
      remainingMs: ABILITIES[id].warningMs,
    };
    this.pending.push(strike);
    return { ok: true, strike };
  }

  // ==================== Update Loop ====================

  /**
   * Count every pending strike down by one sub-step of game time and resolve
   * the ones that ran out. Called once per gameplay sub-step, right after the
   * ResearchManager. A warning of 1500 ms lands on the 90th sub-step of
   * 16.667 ms after the command.
   */
  update(stepMs: number): void {
    if (this.pending.length === 0) return;

    // Split first, resolve after: a strike's kills run event handlers, and
    // one that queued another strike must not be dropped by the compaction.
    const due = this.dueScratch;
    due.length = 0;
    let write = 0;
    for (const strike of this.pending) {
      strike.remainingMs -= stepMs;
      if (strike.remainingMs > 0) {
        this.pending[write++] = strike;
      } else {
        due.push(strike);
      }
    }
    this.pending.length = write;

    for (const strike of due) {
      this.resolve(strike);
    }
    due.length = 0;
  }

  private resolve(strike: PendingStrike): void {
    const config = ABILITIES[strike.abilityId];
    const effect = config.effect;
    const targets = this.world.enemiesInRadius(strike.target, config.radiusM, this.targetScratch);
    const hits = targets.length;
    let kills = 0;
    if (hits > 0) {
      switch (effect.kind) {
        case 'max-hp-fraction':
          kills = this.world.strike(targets, (enemy) => abilityDamageFraction(effect, enemy.typeConfig));
          break;
        case 'freeze':
          this.world.halt(targets, 'freeze', (enemy) => abilityFreezeMs(effect, enemy.typeConfig), abilitySourceId(strike.abilityId));
          break;
        case 'stun':
          this.world.halt(targets, 'stun', (enemy) => abilityStunMs(effect, enemy.typeConfig), abilitySourceId(strike.abilityId));
          break;
      }
    }
    this.targetScratch.length = 0;

    this.eventBus.emit({
      type: 'ability:impact',
      abilityId: strike.abilityId,
      strikeId: strike.id,
      target: strike.target,
      radiusM: config.radiusM,
    });
    this.eventBus.emit({ type: 'ability:resolved', abilityId: strike.abilityId, strikeId: strike.id, hits, kills });
    this.emitStateSnapshot();
  }

  private onResearchCompleted(effects: readonly ResearchEffect[]): void {
    let changed = false;
    for (const effect of effects) {
      if (effect.kind !== 'global-perk') continue;
      for (const id of ABILITY_IDS) {
        if (ABILITIES[id].perkId !== effect.perkId) continue;
        const state = this.stateOf(id);
        if (state.unlocked) continue;
        // The research itself grants the first charge
        state.unlocked = true;
        state.charges = ABILITIES[id].maxCharges;
        state.wavesTowardCharge = 0;
        changed = true;
      }
    }
    if (changed) this.emitStateSnapshot();
  }

  /**
   * `waves` completed waves toward the next charge of every ability that is
   * not full: one per `wave:completed`, the skipped ones on a wave jump
   * (GameStateManager.jumpToWave). Full abilities bank nothing, there is no
   * hoarding: after a use the charge needs `rechargeWaves` completed waves,
   * the wave of the use counted.
   */
  advanceWaves(waves: number): void {
    if (waves <= 0) return;
    let changed = false;
    for (const [id, state] of this.states) {
      const config = ABILITIES[id];
      if (!state.unlocked || state.charges >= config.maxCharges) continue;
      const toward = state.wavesTowardCharge + waves;
      state.charges = Math.min(config.maxCharges, state.charges + Math.floor(toward / config.rechargeWaves));
      state.wavesTowardCharge = state.charges >= config.maxCharges ? 0 : toward % config.rechargeWaves;
      changed = true;
    }
    if (changed) this.emitStateSnapshot();
  }

  private emitStateSnapshot(): void {
    this.eventBus.emit({ type: 'ability:state-changed', abilities: this.getStatuses() });
  }

  private stateOf(id: AbilityId): ChargeState {
    let state = this.states.get(id);
    if (!state) {
      state = { unlocked: false, charges: 0, wavesTowardCharge: 0 };
      this.states.set(id, state);
    }
    return state;
  }

  // ==================== Lifecycle (IGameManager) ====================

  /** No-op: the world comes in through the constructor. */
  initialize(): void { /* nothing to do */ }

  reset(): void {
    this.states.clear();
    this.pending.length = 0;
    this.nextStrikeId = 1;
  }

  destroy(): void {
    this.subs.disposeAll();
    this.reset();
  }
}
