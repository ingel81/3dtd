import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';
import {
  ABILITY_IMPACT_SHAKE,
  ABILITY_LAUNCH_SHAKE,
  SCREEN_SHAKE_CONFIG,
  type ScreenShakePreset,
} from '../configs/visual-effects.config';
import { loadDisplayOptions } from '../utils/display-options.storage';

/**
 * Share of full strength an impact keeps at `distance` metres from the
 * camera: 1 up to `near`, then linearly down to 0 at `far`.
 */
export function shakeFalloff(distance: number, near: number, far: number): number {
  if (distance <= near) return 1;
  if (distance >= far) return 0;
  return (far - distance) / (far - near);
}

/**
 * ScreenShakeService
 *
 * Listens to impact and game events on the EventBus and triggers the
 * screen shake via ThreeTilesEngine.triggerScreenShake(). Presets and
 * distances live in SCREEN_SHAKE_CONFIG:
 *   cannon < rocket impacts, only near the camera
 *   HQ damage and boss deaths, wherever they happen
 *
 * Toggleable via enable()/disable() for motion-sensitive players. The
 * choice lives in the display options (DebugFacadeService persists it);
 * the service starts from it, a new game state included.
 */
export class ScreenShakeService {
  private readonly subs = new SubscriptionBag();
  private readonly impactPos = new Vector3();
  private _enabled: boolean;
  /** The last HQ damage shake: wall clock (ms) and HP lost */
  private lastHqShakeMs = Number.NEGATIVE_INFINITY;
  private lastHqShakeHp = 0;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly engine: ThreeTilesEngine,
  ) {
    this._enabled = loadDisplayOptions().screenShake !== false;
    this.setupEventHandlers();
  }

  // ========================================
  // PUBLIC API
  // ========================================

  /** Whether screen shake is currently enabled */
  get enabled(): boolean {
    return this._enabled;
  }

  /** Enable screen shake */
  enable(): void {
    this._enabled = true;
  }

  /** Disable screen shake (for motion-sensitive players) */
  disable(): void {
    this._enabled = false;
  }

  /** Toggle screen shake on/off */
  toggle(): boolean {
    this._enabled = !this._enabled;
    return this._enabled;
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  private setupEventHandlers(): void {
    const { presets } = SCREEN_SHAKE_CONFIG;

    // Projectile impact → shake by projectile type, weaker with distance
    this.subs.add(
      this.eventBus.onShow('vfx:projectile-impact', (event) => {
        const preset = this.getPresetForProjectile(event.projectileType);
        if (preset) {
          this.shakeAt(preset, event.lat, event.lon, event.height);
        }
      }),
    );

    // HQ taking damage → shake scales with the damage, not with distance. At
    // most once per hqDamageMinIntervalMs, unless a hit costing more HP comes
    // in: compared by the HP, since the factor is 0.5 for 1 HP and 5 HP alike
    this.subs.add(
      this.eventBus.onShow('health:changed', (event) => {
        if (event.delta >= 0 || !this._enabled) return;
        const hpLost = Math.abs(event.delta);
        const now = performance.now();
        const recent = now - this.lastHqShakeMs < SCREEN_SHAKE_CONFIG.hqDamageMinIntervalMs;
        if (recent && hpLost <= this.lastHqShakeHp) return;
        this.lastHqShakeMs = now;
        this.lastHqShakeHp = hpLost;
        const damageFactor = Math.max(0.5, Math.min(hpLost / 10, 2.0));
        this.shake(presets.hqDamage.amplitude * damageFactor, presets.hqDamage.duration);
      }),
    );

    // Strike fired from a building → a low rumble where it lifts off
    // (ABILITY_LAUNCH_SHAKE: the nuclear strike's missile off its silo)
    this.subs.add(
      this.eventBus.onShow('ability:used', ({ abilityId, launch }) => {
        const shake = ABILITY_LAUNCH_SHAKE[abilityId];
        if (!shake || !launch) return;
        const { lat, lon, height } = launch.position;
        this.shakeAt(shake.preset, lat, lon, height ?? 0, shake.nearDistance, shake.farDistance);
      }),
    );

    // Ability impact → the ability's own shake (ABILITY_IMPACT_SHAKE), fading
    // over a range of its own; the nuclear strike's is the biggest and longest
    this.subs.add(
      this.eventBus.onShow('ability:impact', ({ abilityId, target }) => {
        const shake = ABILITY_IMPACT_SHAKE[abilityId];
        if (!shake) return;
        this.shakeAt(shake.preset, target.lat, target.lon, target.height ?? 0, shake.nearDistance, shake.farDistance);
      }),
    );

    // Enemy died → extra shake for bosses; a worm shakes once, with its last segment
    this.subs.add(
      this.eventBus.onShow('enemy:footstep', ({ enemy }) => {
        if (!enemy.typeConfig.footstep?.shake) return;
        const { lat, lon, height } = enemy.position;
        this.shakeAt(presets.footstep, lat, lon, height ?? 0);
      }),
    );

    this.subs.add(
      this.eventBus.onShow('enemy:died', (event) => {
        const worm = event.enemy?.worm;
        if (event.enemy?.typeConfig?.isBoss && (!worm || worm.group.remaining === 0)) {
          this.shake(presets.bossDeath.amplitude, presets.bossDeath.duration);
        }
      }),
    );
  }

  /**
   * Map projectile type string to shake preset
   */
  private getPresetForProjectile(projectileType: string): ScreenShakePreset | null {
    if (projectileType === 'rocket' || projectileType.includes('homing')) {
      return SCREEN_SHAKE_CONFIG.presets.rocket;
    }
    if (projectileType === 'cannonball') {
      return SCREEN_SHAKE_CONFIG.presets.cannon;
    }
    // Bullets, arrows, ice, poison, arcane: no shake (too frequent / too small)
    return null;
  }

  /** Shake for an impact, full up to `near` metres from the camera and none from `far` on. */
  private shakeAt(
    preset: ScreenShakePreset,
    lat: number,
    lon: number,
    height: number,
    near: number = SCREEN_SHAKE_CONFIG.nearDistance,
    far: number = SCREEN_SHAKE_CONFIG.farDistance,
  ): void {
    if (!this._enabled) return;
    const impact = this.engine.sync.geoToLocalSimpleInto(lat, lon, height, this.impactPos);
    const strength = shakeFalloff(impact.distanceTo(this.engine.getCamera().position), near, far);
    if (strength > 0) {
      this.shake(preset.amplitude * strength, preset.duration);
    }
  }

  /**
   * Trigger shake if enabled. Max-wins: a weaker shake that comes in while
   * a stronger one still runs is dropped (ScreenShake in three-engine).
   */
  private shake(amplitude: number, duration: number): void {
    if (!this._enabled) return;
    this.engine.triggerScreenShake(amplitude, duration);
  }

  // ========================================
  // CLEANUP
  // ========================================

  destroy(): void {
    this.subs.disposeAll();
  }
}
