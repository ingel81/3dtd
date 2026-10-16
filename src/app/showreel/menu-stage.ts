/**
 * The world menu (the globes, `app-worlds-stage`, while no world is open)
 * as a showreel stage: no map and no camera of the director's, only the
 * drawn pointer over its cards and entries.
 */
import type { CameraPose, MapPoint3 } from './camera-path';
import { CAMERA_FLOOR_M } from './camera-floor';
import type { ScreenPoint } from './pointer';
import type { Stage } from './stage';

export class MenuStage implements Stage {
  readonly kind = 'menu';
  cameraFloor = CAMERA_FLOOR_M;

  /** The cards of the worlds stand (the globes draw into their squares) */
  ready(): boolean {
    return !!document.querySelector('app-worlds-stage [data-world]') || !!document.querySelector('app-worlds-stage .ws-world');
  }

  mapSize(): { width: number; depth: number } | null {
    return null;
  }

  groundAt(): number {
    return 0;
  }

  waterAt(): number | null {
    return null;
  }

  surfaceAt(): number {
    return 0;
  }

  rendererState(): string | null {
    // The globes' canvas: its size, so a resize after the first frame still counts as settling
    const canvas = document.querySelector<HTMLCanvasElement>('app-worlds-stage canvas');
    return canvas ? `${canvas.width}x${canvas.height}` : null;
  }

  named(): { x: number; y: number } | null {
    return null;
  }

  setPose(): void {
    // The menu has no camera of the director's
  }

  pose(): CameraPose | null {
    return null;
  }

  toScreen(_p: MapPoint3): ScreenPoint | null {
    return null;
  }

  canvas(): HTMLCanvasElement | null {
    return document.querySelector<HTMLCanvasElement>('app-worlds-stage canvas');
  }

  /** The menu knows only `ui` (its UI is its content: always on) */
  async act(name: string): Promise<void> {
    if (name === 'ui') return;
    throw new Error(`showreel: the menu knows no action ${name}`);
  }

  state(): Record<string, unknown> {
    return { ui: true, view: document.querySelector('app-worlds-stage .ws-world') ? 'world' : 'globes' };
  }
}
