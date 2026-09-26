import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, inject, signal } from '@angular/core';
import { Vector3 } from 'three';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { GameStateManager } from '../../managers/game-state.manager';
import { CameraControlService } from '../../services/camera-control.service';
import { CoopService, type CoopPing } from '../../services/coop.service';
import { OffscreenClusterer } from '../../utils/offscreen-indicators';
import { ABILITY_BAR_EDGE_PX } from '../ability-bar/ability-button';
import { TdIconComponent } from '../icon/icon.component';

/** Update interval, as the enemy arrows */
const TICK_MS = 125;
/** Distance of an arrow from the view edge, px; a little further in than the enemy arrows */
const EDGE_MARGIN_PX = 40;

interface PingArrow {
  id: number;
  x: number;
  y: number;
  angle: number;
  name: string;
  color: string;
}

/**
 * Coop (review R13, PLAYTEST T40): an arrow at the edge of the view toward
 * each map mark the camera does not show, in the marker's lane colour with
 * their name, like the arrows toward enemies (OffscreenIndicatorsComponent).
 * A click takes the camera there. On its own timer outside Angular.
 */
@Component({
  selector: 'app-coop-ping-arrows',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (arrow of arrows(); track arrow.id) {
      <button type="button" class="arrow" [style.left.px]="arrow.x" [style.top.px]="arrow.y"
              [style.--ping-color]="arrow.color" [attr.aria-label]="'Camera to ' + arrow.name + '’s mark'"
              (click)="goTo(arrow.id)">
        <span class="chip">
          <td-icon name="caretR" [size]="16" [strokeWidth]="2.5"
                   [style.transform]="'rotate(' + arrow.angle + 'deg)'"></td-icon>
        </span>
        <span class="name">{{ arrow.name }}</span>
      </button>
    }
  `,
  styles: `
    :host {
      position: absolute;
      inset: 0;
      pointer-events: none;
      ${TD_CSS_VARS}
      z-index: var(--td-z-marks);
    }
    .arrow {
      position: absolute;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      pointer-events: auto;
      animation: ping-in 0.9s ease-out 2;
    }
    .chip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--td-glass-tint);
      border: 2px solid var(--ping-color);
      color: var(--ping-color);
      box-shadow: 0 0 10px var(--ping-color);
    }
    .name {
      font: 700 10px/1 var(--td-font-body);
      color: var(--ping-color);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
      white-space: nowrap;
    }
    @keyframes ping-in {
      0% { transform: translate(-50%, -50%) scale(1.6); }
      100% { transform: translate(-50%, -50%) scale(1); }
    }
  `,
})
export class CoopPingArrowsComponent {
  private readonly coop = inject(CoopService);
  private readonly gameState = inject(GameStateManager);
  private readonly cameraControl = inject(CameraControlService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly arrows = signal<PingArrow[]>([]);
  private readonly clusterer = new OffscreenClusterer(16);
  private readonly point = new Vector3();

  constructor() {
    const zone = inject(NgZone);
    const timer = zone.runOutsideAngular(() => setInterval(() => this.tick(), TICK_MS));
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private tick(): void {
    const engine = this.gameState.tilesEngine;
    const pings = this.coop.pings();
    if (!engine || pings.length === 0) {
      if (this.arrows().length > 0) this.arrows.set([]);
      return;
    }
    const view = this.host.nativeElement;
    const camera = engine.getCamera();
    const next: PingArrow[] = [];
    for (const ping of pings) {
      const arrow = this.arrowFor(ping, engine, camera, view.clientWidth, view.clientHeight);
      if (arrow) next.push(arrow);
    }
    const now = this.arrows();
    const same = now.length === next.length
      && now.every((a, i) => a.id === next[i].id && a.x === next[i].x && a.y === next[i].y && a.angle === next[i].angle);
    if (!same) this.arrows.set(next);
  }

  /** The arrow toward `ping`, null while the camera shows it */
  private arrowFor(
    ping: CoopPing,
    engine: NonNullable<GameStateManager['tilesEngine']>,
    camera: ReturnType<NonNullable<GameStateManager['tilesEngine']>['getCamera']>,
    width: number,
    height: number,
  ): PingArrow | null {
    const p = this.point;
    engine.sync.geoToLocalSimpleInto(ping.lat, ping.lon, ping.height, p);
    p.applyMatrix4(camera.matrixWorldInverse);
    // The camera looks down -z; behind it the perspective divide mirrors the point
    const behind = p.z > 0;
    p.applyMatrix4(camera.projectionMatrix);
    this.clusterer.begin(width, height, EDGE_MARGIN_PX, ABILITY_BAR_EDGE_PX);
    if (!this.clusterer.add(behind ? -p.x : p.x, behind ? -p.y : p.y, behind, false)) return null;
    const [edge] = this.clusterer.build(1);
    return edge ? { id: ping.id, x: edge.x, y: edge.y, angle: edge.angle, name: ping.name, color: ping.color } : null;
  }

  goTo(id: number): void {
    const ping = this.coop.pings().find((p) => p.id === id);
    if (ping) this.cameraControl.focusGeo(ping.lat, ping.lon);
  }
}
