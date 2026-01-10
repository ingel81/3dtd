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

/**
 * Enemy entity - combines Transform, Health, Render, Movement, and Audio components
 */
export class Enemy extends GameObject {
  readonly typeConfig: EnemyTypeConfig;

  // Component shortcuts
  private _transform!: TransformComponent;
  private _health!: HealthComponent;
  private _render!: RenderComponent;
  private _movement!: MovementComponent;
  private _audio!: AudioComponent;

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
    this.audio.play('moving', true);
  }

  /**
   * Stop moving and sound
   */
  stopMoving(): void {
    this.movement.pause();
    this.audio.stop('moving');
  }
}
