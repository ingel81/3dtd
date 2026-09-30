import type { ThreeTilesEngine } from '../three-engine';
import type { GeoPosition } from '../models/game.types';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { GAME_SOUNDS } from '../configs/audio.config';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import type { MainEventBus } from '../sim/client/view-events';

/** The number over the HQ when a leak costs health (TODO E49): --td-health-red */
const HQ_LEAK_TEXT = { color: '#B14436', durationMs: 1400, floatSpeed: 2.5, scale: 1.1, lift: 12 } as const;

/** Cooldown between HQ damage sounds, so many enemies hitting at once do not overload the audio (ms) */
const DAMAGE_SOUND_COOLDOWN_MS = 150;

type HqEngine = Pick<ThreeTilesEngine, 'effects' | 'spatialAudio' | 'sync' | 'getTerrainHeightAtGeo'>;

/**
 * What the HQ shows of its health (main bus): the fire that grows as it
 * loses health, the damage sound and the leak's number over it on
 * `health:changed`, the explosion and inferno on `game:over`. The game over
 * screen is the store's (GameStateSync).
 */
export class HqDamagePresenter {
  private readonly subs = new SubscriptionBag();
  private basePosition: GeoPosition | null = null;
  private activeFireId: string | null = null;
  private hqTerrainHeight: number | null = null;
  private lastDamageSoundTime = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly engine: HqEngine,
    bus: MainEventBus,
  ) {
    const audio = engine.spatialAudio;
    if (audio) {
      const { id, url, refDistance, rolloffFactor, volume, audibleDistance } = GAME_SOUNDS.hqDamage;
      audio.registerSound(id, url, { refDistance, rolloffFactor, volume, audibleDistance });
    }
    this.subs.add(bus.on('health:changed', (event) => {
      this.updateFireIntensity(event.health);
      if (event.delta < 0) {
        this.playDamageSound();
        // What the leak cost, over the HQ (TODO E49); a cheat is not a leak
        if (event.cause !== 'cheat') this.showLeak(-event.delta);
      }
    }));
    this.subs.add(bus.on('game:over', () => this.triggerGameOverEffects()));
    this.subs.add(bus.on('game:reset', () => this.reset()));
  }

  /** The HQ of the place; its ground is looked up anew. */
  setBase(position: GeoPosition | null): void {
    this.reset();
    this.basePosition = position;
    this.hqTerrainHeight = null;
  }

  /** The tiles are in: the ground under the HQ is kept from now on. */
  onTilesLoaded(): void {
    const base = this.basePosition;
    if (!base) return;
    const terrainHeight = this.engine.getTerrainHeightAtGeo(base.lat, base.lon);
    if (terrainHeight !== null) this.hqTerrainHeight = terrainHeight;
  }

  /**
   * The fire of `currentHealth`: none at full health, a brief flash above
   * GAME_BALANCE.fire.permanentThreshold, below it a lasting fire that
   * grows with the damage.
   */
  updateFireIntensity(currentHealth: number): void {
    const base = this.basePosition;
    if (!base) return;
    const effects = this.engine.effects;

    if (currentHealth >= GAME_BALANCE.player.startHealth) {
      if (this.activeFireId) {
        effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      return;
    }

    const fireY = this.groundY(base);
    if (currentHealth > GAME_BALANCE.fire.permanentThreshold) {
      if (this.activeFireId) {
        effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      effects.spawnFireFlash(base.lat, base.lon, fireY);
      return;
    }

    if (this.activeFireId) effects.stopFireImmediate(this.activeFireId);
    const scale = 1 - currentHealth / GAME_BALANCE.fire.permanentThreshold;
    this.activeFireId = effects.spawnScaledFire(base.lat, base.lon, fireY, scale);
  }

  /** The HQ explodes and burns at full size. */
  triggerGameOverEffects(): void {
    const base = this.basePosition;
    const effects = this.engine.effects;
    if (base) {
      if (this.activeFireId) effects.stopFireImmediate(this.activeFireId);
      const localY = this.groundY(base);
      effects.spawnHQExplosion(base.lat, base.lon, localY);
      this.activeFireId = effects.spawnScaledFire(base.lat, base.lon, localY, 1.0);
    }
  }

  /** A new game: fires out. */
  reset(): void {
    this.engine.effects.stopAllFires();
    this.activeFireId = null;
  }

  destroy(): void {
    this.subs.disposeAll();
  }

  /**
   * The damage sound on the ground under the HQ, where its fire burns. The
   * base position carries no height; at height 0 the sound sat on the
   * ellipsoid, and the audible distance culled it.
   */
  private playDamageSound(): void {
    const base = this.basePosition;
    const audio = this.engine.spatialAudio;
    if (!base || !audio) return;
    const now = performance.now();
    if (now - this.lastDamageSoundTime < DAMAGE_SOUND_COOLDOWN_MS) return;
    this.lastDamageSoundTime = now;
    // Geo height: local y plus the height of the local frame's origin
    const height = this.groundY(base) + this.engine.sync.getOrigin().height;
    audio.playAtGeo(GAME_SOUNDS.hqDamage.id, base.lat, base.lon, height).catch(() => undefined);
  }

  /** "−4" rising over the HQ, in the colour of lost health */
  private showLeak(hp: number): void {
    const base = this.basePosition;
    if (!base) return;
    const text = `−${Number.isInteger(hp) ? hp : hp.toFixed(1)}`;
    const height = this.groundY(base) + this.engine.sync.getOrigin().height + HQ_LEAK_TEXT.lift;
    this.engine.effects.spawnFloatingText(text, base.lat, base.lon, height, {
      color: HQ_LEAK_TEXT.color,
      duration: HQ_LEAK_TEXT.durationMs,
      floatSpeed: HQ_LEAK_TEXT.floatSpeed,
      scale: HQ_LEAK_TEXT.scale,
    });
  }

  /** Local y of the ground under the HQ: the cached height, else a raycast, else 0 without tiles. */
  private groundY(base: GeoPosition): number {
    return this.hqTerrainHeight ?? this.engine.getTerrainHeightAtGeo(base.lat, base.lon) ?? 0;
  }
}
