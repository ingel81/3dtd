import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, inject, signal } from '@angular/core';
import { Vector3 } from 'three';
import { GameStateManager } from '../../managers/game-state.manager';
import { GameStore } from '../../store/game.store';
import type { Enemy } from '../../entities/enemy.entity';
import {
  isArrowBoss,
  isOffscreenThreat,
  OffscreenArrow,
  OffscreenClusterer,
  sameArrows,
} from '../../utils/offscreen-indicators';
import { TdIconComponent } from '../icon/icon.component';
import { ABILITY_BAR_EDGE_PX } from '../ability-bar/ability-button';

/** Update interval; arrows need no more than 8 Hz */
const TICK_MS = 125;
/** Directions the view edge is split into */
const SECTORS = 8;
/** Arrows at most */
const MAX_ARROWS = 6;
/** Distance of an arrow from the view edge, px */
const EDGE_MARGIN_PX = 26;

/**
 * Arrows at the edge of the canvas toward bosses and toward enemies on the
 * last 15% of their route, while the camera does not show them. At most six,
 * one per direction, with a count.
 *
 * Runs on its own 8 Hz timer outside Angular, not per frame and not per
 * enemy: a scan over the living enemies picks the threats (no allocation per
 * enemy), a pass projects them through the camera, and the signal changes
 * only when an arrow does. Paused, nothing moves, so the scan is skipped and
 * the last threats are re-projected: the arrows still follow the camera.
 */
@Component({
  selector: 'app-offscreen-indicators',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './offscreen-indicators.component.html',
  styleUrl: './offscreen-indicators.component.scss',
})
export class OffscreenIndicatorsComponent {
  private readonly gameState = inject(GameStateManager);
  private readonly gameStore = inject(GameStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly arrows = signal<OffscreenArrow[]>([]);

  private readonly clusterer = new OffscreenClusterer(SECTORS);
  /** Threats of the last scan, reused while the game is paused */
  private readonly threats: Enemy[] = [];
  private readonly point = new Vector3();

  constructor() {
    const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.tick(), TICK_MS));
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private tick(): void {
    const engine = this.gameState.tilesEngine;
    if (!engine || this.gameStore.phase() !== 'wave' || !this.gameStore.renderingEnabled()) {
      this.threats.length = 0;
      this.publish([]);
      return;
    }
    if (!this.gameStore.paused()) this.scan();

    const view = this.host.nativeElement;
    // On the left edge the arrows keep clear of the ability bar
    this.clusterer.begin(view.clientWidth, view.clientHeight, EDGE_MARGIN_PX, ABILITY_BAR_EDGE_PX);
    const camera = engine.getCamera();
    const p = this.point;
    for (const enemy of this.threats) {
      if (!enemy.alive) continue;
      engine.sync.geoToLocalSimpleInto(enemy.position.lat, enemy.position.lon, enemy.transform.terrainHeight, p);
      p.applyMatrix4(camera.matrixWorldInverse);
      // The camera looks down -z; in front of it z is negative
      const behind = p.z > 0;
      p.applyMatrix4(camera.projectionMatrix);
      // Behind the camera the perspective divide mirrors the point, undo that
      this.clusterer.add(behind ? -p.x : p.x, behind ? -p.y : p.y, behind, isArrowBoss(enemy.typeConfig.isBoss === true, enemy.worm));
    }
    this.publish(this.clusterer.build(MAX_ARROWS));
  }

  /** Living enemies that deserve an arrow, into the reused list. */
  private scan(): void {
    const threats = this.threats;
    threats.length = 0;
    for (const enemy of this.gameState.enemyManager.getAlive()) {
      if (isOffscreenThreat(isArrowBoss(enemy.typeConfig.isBoss === true, enemy.worm), enemy.movement.getPathProgress())) {
        threats.push(enemy);
      }
    }
  }

  private publish(arrows: OffscreenArrow[]): void {
    if (!sameArrows(this.arrows(), arrows)) this.arrows.set(arrows);
  }
}
