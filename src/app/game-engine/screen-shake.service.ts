import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';
import { SCREEN_SHAKE_CONFIG, type ScreenShakePreset } from '../configs/visual-effects.config';

const STORAGE_KEY = 'td_screen_shake_enabled';

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
 * Toggleable via enable()/disable(), persisted in localStorage
 * so motion-sensitive players can disable it permanently.
 */
export class ScreenShakeService {
  private readonly subs = new SubscriptionBag();
  private readonly impactPos = new Vector3();
  private _enabled: boolean;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly engine: ThreeTilesEngine,
  ) {
    // Load preference from localStorage (default: enabled, overridden by applyDisplayOptions)
    this._enabled = this.loadPreference();
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
    this.savePreference(true);
  }

  /** Disable screen shake (for motion-sensitive players) */
  disable(): void {
    this._enabled = false;
    this.savePreference(false);
  }

  /** Toggle screen shake on/off */
  toggle(): boolean {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this._enabled;
  }

  // ========================================
  // EVENT HANDLERS
  // ========================================

  private setupEventHandlers(): void {
    const { presets } = SCREEN_SHAKE_CONFIG;

    // Projectile impact → shake by projectile type, weaker with distance
    this.subs.add(
      this.eventBus.on('vfx:projectile-impact', (event) => {
        const preset = this.getPresetForProjectile(event.projectileType);
        if (preset) {
          this.shakeAt(preset, event.lat, event.lon, event.height);
        }
      }),
    );

    // HQ taking damage → shake scales with the damage, not with distance
    this.subs.add(
      this.eventBus.on('health:changed', (event) => {
        if (event.delta < 0) {
          const damageFactor = Math.max(0.5, Math.min(Math.abs(event.delta) / 10, 2.0));
          this.shake(presets.hqDamage.amplitude * damageFactor, presets.hqDamage.duration);
        }
      }),
    );

    // Enemy died → extra shake for bosses
    this.subs.add(
      this.eventBus.on('enemy:died', (event) => {
        if (event.enemy?.typeConfig?.bossName) {
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

  /** Shake for an impact, fading with its distance from the camera. */
  private shakeAt(preset: ScreenShakePreset, lat: number, lon: number, height: number): void {
    if (!this._enabled) return;
    const impact = this.engine.sync.geoToLocalSimpleInto(lat, lon, height, this.impactPos);
    const strength = shakeFalloff(
      impact.distanceTo(this.engine.getCamera().position),
      SCREEN_SHAKE_CONFIG.nearDistance,
      SCREEN_SHAKE_CONFIG.farDistance,
    );
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
  // PERSISTENCE
  // ========================================

  private loadPreference(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true; // Default: enabled
    } catch {
      return true;
    }
  }

  private savePreference(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      /* ignore */
    }
  }

  // ========================================
  // CLEANUP
  // ========================================

  destroy(): void {
    this.subs.disposeAll();
  }
}
