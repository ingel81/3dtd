import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import { CombatComponent, MovementComponent, TransformComponent } from '../game-components';
import { GeoPosition } from '../models/game.types';
import { HERO } from '../configs/hero.config';

/**
 * The hero entity: where he stands and faces (Transform), the path he walks
 * (Movement, on the route's centre line with its corners sharp) and his
 * fire cooldown, stats and kills (Combat). What he does with them is the
 * HeroManager's.
 */
export class Hero extends GameObject {
  private readonly _transform: TransformComponent;
  private readonly _movement: MovementComponent;
  private readonly _combat: CombatComponent;

  constructor(position: GeoPosition) {
    super('hero');
    this._transform = this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
    this._movement = this.addComponent(new MovementComponent(this, false), ComponentType.MOVEMENT);
    this._combat = this.addComponent(
      new CombatComponent(this, { damage: 0, range: HERO.rangeM, fireRate: 0 }),
      ComponentType.COMBAT,
    );
    this._movement.speedMps = HERO.speedMps;
    this._transform.setPosition(position.lat, position.lon, position.height);
  }

  get transform(): TransformComponent {
    return this._transform;
  }
  get movement(): MovementComponent {
    return this._movement;
  }
  get combat(): CombatComponent {
    return this._combat;
  }
  get position(): GeoPosition {
    return this._transform.position;
  }
}
