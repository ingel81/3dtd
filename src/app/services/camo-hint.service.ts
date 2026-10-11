import { DestroyRef, Injectable, inject } from '@angular/core';
import { SimClient } from '../sim/client/sim-client.service';
import { UIStore } from '../store/ui.store';
import { BotClientService } from '../bots/bot-client.service';
import { CameraControlService } from './camera-control.service';
import { TowerControlService } from './tower-control.service';
import { BossIntroService } from './boss-intro.service';
import type { EnemyView } from '../sim/client/views';

/** What the player reads when the first camouflaged enemy of a run comes out of its portal */
export const CAMO_HINT = 'Camouflaged enemies! Towers only see them near an Archer with the Scout path.';

/** What keeps the camera where it is for the hint: the player looks through something else */
export interface CamoLookGates {
  botEnabled: boolean;
  viewOnly: boolean;
  menuOpen: boolean;
  towerManned: boolean;
  bossIntro: boolean;
}

/** The camera may turn to the first camouflaged enemy: nobody else holds it */
export function camoLookAllowed(gates: CamoLookGates): boolean {
  return !gates.botEnabled && !gates.viewOnly && !gates.menuOpen && !gates.towerManned && !gates.bossIntro;
}

/**
 * The first camouflaged enemy of a run (TODO E145): a short message that
 * towers need a scout, and a look at it. Once per run, from its portal; the
 * towers still do not see it, only the player does (its shimmer, vat-material).
 *
 * Provided by the game component.
 */
@Injectable()
export class CamoHintService {
  private readonly ui = inject(UIStore);
  private readonly bot = inject(BotClientService);
  private readonly camera = inject(CameraControlService);
  private readonly towerControl = inject(TowerControlService);
  private readonly bossIntro = inject(BossIntroService);
  /** Said this run */
  private said = false;

  constructor() {
    const bus = inject(SimClient).bus;
    const subs = [
      bus.onLive('enemy:spawned', (event) => this.onSpawned(event.enemy, event.viaPortal === true)),
      bus.onLive('game:reset', () => { this.said = false; }),
    ];
    inject(DestroyRef).onDestroy(() => subs.forEach((sub) => sub.dispose()));
  }

  private onSpawned(enemy: EnemyView, viaPortal: boolean): void {
    if (this.said || !viaPortal || !enemy.camo) return;
    this.said = true;
    this.ui.notice.set({ text: CAMO_HINT, tone: 'warn' });
    const look = camoLookAllowed({
      botEnabled: this.bot.botEnabled(),
      viewOnly: this.ui.viewOnly(),
      menuOpen: this.ui.mainMenuOpen(),
      towerManned: this.towerControl.active(),
      bossIntro: this.bossIntro.active(),
    });
    if (look) this.camera.focusGeo(enemy.position.lat, enemy.position.lon);
  }
}
