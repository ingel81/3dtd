/**
 * What the director needs of a page: the map, the camera and the page's own
 * actions. The game (`?world=map:<id>`) and the editor (`/editor`) each have
 * one.
 */
import type { CameraPose, MapPoint3 } from './camera-path';
import type { ScreenPoint } from './pointer';

export interface Stage {
  readonly kind: 'game' | 'editor';
  /** Whether the map shows and takes input */
  ready(): boolean;
  /** The open map's extent (m), null while none is open */
  mapSize(): { width: number; depth: number } | null;
  groundAt(x: number, y: number): number;
  /** A named spot of the map: `hq`, `center`, `spawn:<index>` */
  named(name: string): { x: number; y: number } | null;
  /** Take the camera to a pose every frame; null gives it back to the player's controls where it is */
  setPose(pose: CameraPose | null): void;
  /** The camera's pose now */
  pose(): CameraPose | null;
  /** Where a map point shows on the screen (client px), null behind the camera */
  toScreen(p: MapPoint3): ScreenPoint | null;
  /** An action of this page by name; throws for one it does not know */
  act(name: string, args: Record<string, unknown>): Promise<void>;
}
