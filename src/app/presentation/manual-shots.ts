import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import type { MainEventBus } from '../sim/client/view-events';
import type { SimScalars } from '../sim/protocol/packet';
import type { Tower } from '../entities/tower.entity';

/** What the manual shots read of the mirror: the shadow tower, who sits where */
export interface ManualShotSource {
  tower(id: string): Tower | null;
  readonly scalars: SimScalars;
}

/**
 * The sound and muzzle flash of a manned tower's shot (docs/TOWER_CONTROL.md).
 * The simulation fires it without either and says `tower:manual-shot`;
 * here they go out on the main bus as `vfx:muzzle-flash` and `audio:play`,
 * which VFXService and AudioService play. The shot of the local player's
 * own seat is heard at the listener, without a direction. A shot the
 * player's client showed at the click already (coop, ShotPrediction.take)
 * stays quiet: the prediction is taken once per shot.
 */
export class ManualShots {
  private readonly subs = new SubscriptionBag();
  /** Whether the shot of the tower was shown already; consumes the prediction */
  private take: (towerId: string) => boolean = () => false;

  constructor(
    private readonly bus: MainEventBus,
    private readonly source: ManualShotSource,
  ) {
    this.subs.add(bus.onShow('tower:manual-shot', ({ towerId }) => this.shot(towerId)));
  }

  setPrediction(take: ((towerId: string) => boolean) | null): void {
    this.take = take ?? (() => false);
  }

  destroy(): void {
    this.subs.disposeAll();
  }

  private shot(towerId: string): void {
    if (this.take(towerId)) return;
    const tower = this.source.tower(towerId);
    if (!tower) return;
    const type = tower.typeConfig;
    this.bus.emit({ type: 'vfx:muzzle-flash', towerId, towerTypeId: type.id });
    this.bus.emit({
      type: 'audio:play',
      // A projectile type without a sample of its own sounds as an arrow (ProjectileManager's projectileSoundId)
      sound: type.projectileType in PROJECTILE_SOUNDS ? type.projectileType : 'arrow',
      lat: tower.position.lat,
      lon: tower.position.lon,
      height: (tower.position.height ?? 0) + type.heightOffset,
      atListener: this.ownSeat(towerId),
    });
  }

  /** The local player sits in `towerId` */
  private ownSeat(towerId: string): boolean {
    const { players, localPlayerId, mannedTowers } = this.source.scalars;
    return mannedTowers[players.indexOf(localPlayerId)] === towerId;
  }
}
