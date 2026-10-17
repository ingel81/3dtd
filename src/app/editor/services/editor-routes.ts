/**
 * Each spawn's route to the HQ along the roads, for the overlay, the trial
 * wave and the panels (lane lengths): found in the editor's worker
 * (EditorCore, job `routes`) whenever the roads or the markers changed, at
 * most as often as the panels follow the map (EditorState: every frame for
 * a step, every LIVE_MS while a stroke or a drag goes on).
 */
import { signal } from '@angular/core';
import type { Route } from '../../map-ops/path-graph';
import type { PartVersions } from '../model/doc-mirror';
import type { DocPart } from '../model/doc-change';
import type { EditorCore } from './editor-core';

/** The routes by spawn id, null where a spawn has none */
export type SpawnRoutes = ReadonlyMap<string, Route | null>;

/** What the routes are found from */
const ROUTE_PARTS: readonly DocPart[] = ['paths', 'markers'];

export class EditorRoutes {
  /** The open map's routes; empty before the first are found */
  readonly routes = signal<SpawnRoutes>(new Map());
  /** The parts' versions the newest job asked for was sent with */
  private asked: Readonly<PartVersions> | null = null;
  /** Counts the maps opened: routes of the map before are dropped */
  private map = 0;
  private disposed = false;

  constructor(
    private readonly core: EditorCore,
    /** The view shows them (or not, by its switch) */
    private readonly show: (routes: SpawnRoutes) => void,
  ) {}

  /** Another map is open: its routes are found anew */
  opened(): void {
    this.asked = null;
    this.map++;
    this.routes.set(new Map());
    this.show(this.routes());
    this.changed();
  }

  /** The map changed: the routes follow when the roads or the markers did */
  changed(): void {
    const now = this.core.versions;
    if (!now || this.disposed || (this.asked && this.core.current(this.asked, ROUTE_PARTS))) return;
    this.asked = { ...now };
    const map = this.map;
    void this.core.run('routes', {}).then(
      (found) => {
        // A newer job took its place; or another map opened meanwhile
        if (!found || this.disposed || map !== this.map) return;
        this.routes.set(found.value);
        this.show(found.value);
      },
      (e: unknown) => console.warn('[Editor] routes not found:', e),
    );
  }

  dispose(): void {
    this.disposed = true;
  }
}
