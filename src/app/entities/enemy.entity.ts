import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  HealthComponent,
  RenderComponent,
  AudioComponent,
  MovementComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import { EnemyTypeId, getEnemyType, EnemyTypeConfig } from '../models/enemy-types';
import { ArmorType } from '../configs/combat/combat.types';

/**
 * Enemy entity - combines Transform, Health, Render, Movement, and Audio components
 */
export class Enemy extends GameObject {
  readonly typeConfig: EnemyTypeConfig;

  // Armor type override (e.g., Armor Break sets this to 'unarmored')
  private _armorTypeOverride: ArmorType | null = null;

  // Component shortcuts
  private _transform!: TransformComponent;
  private _health!: HealthComponent;
  private _render!: RenderComponent;
  private _movement!: MovementComponent;
  private _audio!: AudioComponent;

  // Random sound timer
  private randomSoundTimer: ReturnType<typeof setTimeout> | null = null;
  private isMoving = false;

  // Random sounds pool (shuffle ohne Wiederholung)
  private randomSoundsQueue: number[] = [];
  private randomSoundsPlaying = false;

  constructor(typeId: EnemyTypeId, path: GeoPosition[], speedOverride?: number) {
    super('enemy');
    this.typeConfig = getEnemyType(typeId);

    // Add components
    this._transform = this.addComponent(
      new TransformComponent(this),
      ComponentType.TRANSFORM
    );
    this._health = this.addComponent(
      new HealthComponent(this, this.typeConfig.baseHp),
      ComponentType.HEALTH
    );
    this._render = this.addComponent(
      new RenderComponent(this),
      ComponentType.RENDER
    );
    this._movement = this.addComponent(
      new MovementComponent(this),
      ComponentType.MOVEMENT
    );
    this._audio = this.addComponent(
      new AudioComponent(this),
      ComponentType.AUDIO
    );

    // Configure movement
    this._movement.setPath(path);
    this._movement.speedMps = speedOverride ?? this.typeConfig.baseSpeed;

    // Register sounds
    if (this.typeConfig.movingSound) {
      this._audio.registerSound('moving', this.typeConfig.movingSound, {
        volume: this.typeConfig.movingSoundVolume ?? 0.3,
        refDistance: this.typeConfig.movingSoundRefDistance ?? 30,
        loop: true,
        randomStart: this.typeConfig.randomSoundStart ?? false,
      });
    }

    // Register random sound (not looped, played via timer)
    if (this.typeConfig.randomSound) {
      this._audio.registerSound('randomSound', this.typeConfig.randomSound, {
        volume: this.typeConfig.randomSoundVolumeMax ?? 0.5,
        refDistance: this.typeConfig.randomSoundRefDistance ?? 30,
        loop: false,
      });
    }

    // Register spawn sound (once at spawn)
    if (this.typeConfig.spawnSound) {
      this._audio.registerSound('spawn', this.typeConfig.spawnSound, {
        volume: this.typeConfig.spawnSoundVolume ?? 0.5,
        refDistance: this.typeConfig.spawnSoundRefDistance ?? 30,
        loop: false,
      });
    }

    // Register random sounds pool (mehrere Sounds ohne Wiederholung)
    if (this.typeConfig.randomSounds && this.typeConfig.randomSounds.length > 0) {
      const volume = this.typeConfig.randomSoundsVolume ?? 0.5;
      const refDistance = this.typeConfig.randomSoundsRefDistance ?? 30;
      this.typeConfig.randomSounds.forEach((sound, index) => {
        this._audio.registerSound(`randomSounds_${index}`, sound, {
          volume,
          refDistance,
          loop: false,
        });
      });
    }
  }

  /**
   * Play spawn sound (call once when enemy spawns)
   */
  playSpawnSound(): void {
    if (this.typeConfig.spawnSound) {
      this.audio.play('spawn', false);
    }
  }

  /** Get effective armor type (checks for active override like Armor Break, then falls back to config). */
  getEffectiveArmorType(): ArmorType {
    return this._armorTypeOverride ?? this.typeConfig.armorType;
  }

  /** Set armor type override (e.g., Armor Break → 'unarmored'). Pass null to clear. */
  setArmorTypeOverride(armorType: ArmorType | null): void {
    this._armorTypeOverride = armorType;
  }

  // Convenience getters
  get transform(): TransformComponent {
    return this._transform;
  }
  get health(): HealthComponent {
    return this._health;
  }
  get render(): RenderComponent {
    return this._render;
  }
  get movement(): MovementComponent {
    return this._movement;
  }
  get audio(): AudioComponent {
    return this._audio;
  }

  get alive(): boolean {
    return !this.health.isDead;
  }
  get position(): GeoPosition {
    return this.transform.position;
  }

  /**
   * Start moving and play moving sound
   */
  startMoving(): void {
    this.movement.resume();
    this.isMoving = true;

    // Loop sound for normal enemies
    if (this.typeConfig.movingSound) {
      this.audio.play('moving', true);
    }

    // Random sound timer for enemies with randomSound
    if (this.typeConfig.randomSound) {
      this.scheduleNextRandomSound();
    }

    // Random sounds pool (shuffle without repetition)
    if (this.typeConfig.randomSounds && this.typeConfig.randomSounds.length > 0) {
      this.startRandomSoundsPool();
    }
  }

  /**
   * Stop moving and sound
   */
  stopMoving(): void {
    this.movement.pause();
    this.isMoving = false;
    this.audio.stop('moving');
    this.clearRandomSoundTimer();
  }

  /**
   * Schedule next random sound playback
   */
  private scheduleNextRandomSound(): void {
    if (!this.isMoving || !this.active) return;

    // Clear any existing timer first to prevent accumulation
    this.clearRandomSoundTimer();

    const minInterval = this.typeConfig.randomSoundMinInterval ?? 2000;
    const maxInterval = this.typeConfig.randomSoundMaxInterval ?? 5000;
    const delay = minInterval + Math.random() * (maxInterval - minInterval);

    this.randomSoundTimer = setTimeout(() => {
      if (this.isMoving && this.active && this.alive) {
        this.playRandomSound();
        this.scheduleNextRandomSound();
      }
    }, delay);
  }

  /**
   * Play random sound with varying volume
   */
  private playRandomSound(): void {
    const minVol = this.typeConfig.randomSoundVolumeMin ?? 0.2;
    const maxVol = this.typeConfig.randomSoundVolumeMax ?? 0.6;
    const volumeMultiplier = minVol + Math.random() * (maxVol - minVol);

    this.audio.play('randomSound', false, volumeMultiplier);
  }

  /**
   * Clear random sound timer
   */
  private clearRandomSoundTimer(): void {
    if (this.randomSoundTimer) {
      clearTimeout(this.randomSoundTimer);
      this.randomSoundTimer = null;
    }
  }

  /**
   * Start random sounds pool playback (shuffle without repetition)
   */
  private startRandomSoundsPool(): void {
    if (!this.typeConfig.randomSounds || this.randomSoundsPlaying) return;
    this.randomSoundsPlaying = true;
    this.scheduleNextPoolSound();
  }

  /**
   * Shuffle and refill the random sounds queue
   */
  private refillRandomSoundsQueue(): void {
    const count = this.typeConfig.randomSounds?.length ?? 0;
    // Create array [0, 1, 2, ..., count-1]
    this.randomSoundsQueue = Array.from({ length: count }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = this.randomSoundsQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.randomSoundsQueue[i], this.randomSoundsQueue[j]] =
        [this.randomSoundsQueue[j], this.randomSoundsQueue[i]];
    }
  }

  /**
   * Schedule next sound from the pool
   */
  private scheduleNextPoolSound(): void {
    if (!this.isMoving || !this.active || !this.alive) {
      this.randomSoundsPlaying = false;
      return;
    }

    // Refill queue if empty
    if (this.randomSoundsQueue.length === 0) {
      this.refillRandomSoundsQueue();
    }

    const minInterval = this.typeConfig.randomSoundsMinInterval ?? 3000;
    const maxInterval = this.typeConfig.randomSoundsMaxInterval ?? 8000;
    const delay = minInterval + Math.random() * (maxInterval - minInterval);

    this.randomSoundTimer = setTimeout(() => {
      if (this.isMoving && this.active && this.alive) {
        this.playNextPoolSound();
        this.scheduleNextPoolSound();
      } else {
        this.randomSoundsPlaying = false;
      }
    }, delay);
  }

  /**
   * Play next sound from the shuffled queue
   */
  private playNextPoolSound(): void {
    if (this.randomSoundsQueue.length === 0) {
      this.refillRandomSoundsQueue();
    }
    const index = this.randomSoundsQueue.pop()!;
    this.audio.play(`randomSounds_${index}`, false);
  }

  /**
   * Cleanup on destroy
   */
  override destroy(): void {
    // Stop all sound scheduling
    this.clearRandomSoundTimer();
    this.randomSoundsPlaying = false;
    this.isMoving = false;

    super.destroy();
  }
}
