import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Screen Shake Intensity Presets
 *
 * Defines shake strength (meters of camera offset) and duration
 * for different explosion/impact types.
 */
const SHAKE_PRESETS = {
  /** Bullet impact - barely noticeable */
  bullet:    { intensity: 0.1,  duration: 80 },
  /** Cannon impact - moderate punch */
  cannon:    { intensity: 0.4,  duration: 150 },
  /** Rocket/homing explosion - heavy shake */
  rocket:    { intensity: 0.8,  duration: 200 },
  /** HQ taking damage - dramatic rumble */
  hqDamage:  { intensity: 1.2,  duration: 300 },
  /** Boss death - massive screen shake */
  bossDeath: { intensity: 2.0,  duration: 400 },
  /** Generic explosion - scales with radius */
  explosion: { intensity: 0.5,  duration: 200 },
} as const;

const STORAGE_KEY = 'td_screen_shake_enabled';

/**
 * ScreenShakeService
 *
 * Listens to explosion/impact events on the EventBus and triggers
 * camera screen shake via ThreeTilesEngine.triggerScreenShake().
 *
 * Shake intensity scales with explosion type:
 *   bullet < cannon < rocket < HQ damage < boss death
 *
 * Toggleable via enable()/disable() — persisted in localStorage
 * so motion-sensitive players can disable it permanently.
 */
export class ScreenShakeService {
  private readonly subs = new SubscriptionBag();
  private _enabled: boolean;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly engine: ThreeTilesEngine,
  ) {
    // Load preference from localStorage (default: enabled)
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
    // Projectile impact → shake based on projectile type
    this.subs.add(
      this.eventBus.on('vfx:projectile-impact', (event) => {
        const preset = this.getPresetForProjectile(event.projectileType);
        if (preset) {
          this.shake(preset.intensity, preset.duration);
        }
      }),
    );

    // Generic explosion → shake scales with radius
    this.subs.add(
      this.eventBus.on('vfx:explosion', (event) => {
        // Scale intensity linearly with radius, clamped
        const radiusFactor = Math.min(event.radius / 10, 2.0);
        const intensity = SHAKE_PRESETS.explosion.intensity * radiusFactor;
        this.shake(intensity, SHAKE_PRESETS.explosion.duration);
      }),
    );

    // HQ taking damage → dramatic shake
    this.subs.add(
      this.eventBus.on('health:changed', (event) => {
        if (event.delta < 0) {
          // Scale with damage amount (more damage = stronger shake)
          const damageFactor = Math.min(Math.abs(event.delta) / 10, 2.0);
          const intensity = SHAKE_PRESETS.hqDamage.intensity * Math.max(0.5, damageFactor);
          this.shake(intensity, SHAKE_PRESETS.hqDamage.duration);
        }
      }),
    );

    // Enemy died → extra shake for bosses
    this.subs.add(
      this.eventBus.on('enemy:died', (event) => {
        if (event.enemy?.typeConfig?.bossName) {
          this.shake(SHAKE_PRESETS.bossDeath.intensity, SHAKE_PRESETS.bossDeath.duration);
        }
      }),
    );
  }

  /**
   * Map projectile type string to shake preset
   */
  private getPresetForProjectile(
    projectileType: string,
  ): { intensity: number; duration: number } | null {
    if (projectileType === 'rocket' || projectileType.includes('homing')) {
      return SHAKE_PRESETS.rocket;
    }
    if (projectileType === 'cannonball') {
      return SHAKE_PRESETS.cannon;
    }
    // Bullets, arrows, ice — no shake (too frequent / too small)
    return null;
  }

  /**
   * Trigger shake if enabled. Uses max-wins policy:
   * if a stronger shake is already active, the new one is ignored.
   */
  private shake(intensity: number, duration: number): void {
    if (!this._enabled) return;
    this.engine.triggerScreenShake(intensity, duration);
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
