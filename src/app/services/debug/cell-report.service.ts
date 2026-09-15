import { Injectable, inject, signal } from '@angular/core';
import type { Vector3 } from 'three';
import { LocationManagementService } from '../location/location-management.service';
import { DebugFacadeService } from './debug-facade.service';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { CORRIDOR_DEFAULTS, corridorConfig } from '../../utils/route-corridor';
import { matchingVfxPreset } from '../../three-engine/vfx-settings';
import {
  MAX_REPORT_CELLS,
  buildCellReport,
  corridorChanges,
  reportUrl,
  sameSpot,
  type CellProbe,
  type CellReportMeta,
  type CellSpot,
  type ScreenRect,
} from './cell-report';

/** What the report reads off the game: CorridorConsole, while a location is loaded. */
export interface CellReportSource {
  /** The grid spot under a point on the ground (a click's hit); null without a location. */
  spotAt(hit: Vector3): CellSpot | null;
  /** The grid cells whose centre the camera shows inside the rectangle, at most `limit`, nearest to its middle first. */
  cellsInRect(rect: ScreenRect, limit: number): CellSpot[];
  /** Frame the spots over the grid; empty takes the frames down. */
  showSelection(spots: readonly CellSpot[]): void;
  /** The spots the way `__corridor.pick()` sees them. */
  describe(spots: readonly CellSpot[]): CellProbe;
}

/**
 * Cell report for playtests. While it is on, a left click on the map puts
 * the grid cell there into the selection or takes it out, Shift + left drag
 * adds the cells in a box (InputHandlerService), and the panel
 * (CellReportPanelComponent) copies what `__corridor.pick()` knows about
 * every selected cell as one JSON, with a note. Started from the Cells tile
 * in the developer options or with `__corridor.report()`; Esc or Done ends
 * it. Selection and note stay until Clear, a new place or a reload; the
 * frames around the cells show only while it is on.
 */
@Injectable({ providedIn: 'root' })
export class CellReportService {
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly debugFacade = inject(DebugFacadeService);

  /** On: clicks and Shift drags on the map go to the report. */
  readonly active = signal(false);
  /** The selected grid spots, in the order they were picked. */
  readonly spots = signal<readonly CellSpot[]>([]);
  /** Free text for the report ("Auto", "Böschung" ...). */
  readonly note = signal('');
  /** The box of a Shift drag under way, client pixels. */
  readonly box = signal<ScreenRect | null>(null);
  /** What the panel says last: copied, clipboard refused, limit reached. */
  readonly status = signal<string | null>(null);

  private source: CellReportSource | null = null;

  /** Where the HQ stood when the spots were picked. Spots are local metres, another place voids them. */
  private place: string | null = null;

  /** The game to read the cells off, CorridorConsole.install. */
  connect(source: CellReportSource): void {
    this.source = source;
  }

  /** The source goes with its game: the report ends. Another source's disconnect changes nothing. */
  disconnect(source: CellReportSource): void {
    if (this.source !== source) return;
    this.stop();
    this.source = null;
  }

  /** Turn the report on: `__corridor.report()` and the Cells tile. */
  start(): string {
    if (!this.source) return 'No location loaded.';
    this.forgetOtherPlace();
    this.active.set(true);
    this.status.set(null);
    this.show();
    return 'Cell report on: click grid cells, Shift + drag for a box, then Copy JSON in the panel. Esc ends it.';
  }

  /** Turn it off: Done, Esc, the tile again. Selection and note stay. */
  stop(): void {
    this.active.set(false);
    this.box.set(null);
    this.source?.showSelection([]);
  }

  /** The Cells tile: on, or off again. */
  toggle(): void {
    if (this.active()) this.stop();
    else this.start();
  }

  /** A click on the ground: its grid spot into the selection, or out again if it was in. */
  click(hit: Vector3): void {
    const source = this.source;
    if (!this.active() || !source) return;
    const spot = source.spotAt(hit);
    if (!spot) return;
    this.forgetOtherPlace();
    const spots = this.spots();
    if (spots.some((s) => sameSpot(s, spot))) {
      this.spots.set(spots.filter((s) => !sameSpot(s, spot)));
    } else if (spots.length >= MAX_REPORT_CELLS) {
      this.status.set(`Limit: ${MAX_REPORT_CELLS} cells`);
      return;
    } else {
      this.spots.set([...spots, spot]);
    }
    this.status.set(null);
    this.show();
  }

  /** A Shift drag let go: the cells in the box join the selection, up to MAX_REPORT_CELLS. */
  select(rect: ScreenRect): void {
    this.box.set(null);
    const source = this.source;
    if (!this.active() || !source) return;
    this.forgetOtherPlace();
    const spots = this.spots();
    const fresh = source.cellsInRect(rect, MAX_REPORT_CELLS + spots.length)
      .filter((spot) => !spots.some((s) => sameSpot(s, spot)));
    const room = MAX_REPORT_CELLS - spots.length;
    this.spots.set([...spots, ...fresh.slice(0, room)]);
    this.status.set(fresh.length > room ? `Limit: ${MAX_REPORT_CELLS} cells, ${fresh.length - room} left out` : null);
    this.show();
  }

  /** Empty the selection. */
  clear(): void {
    this.spots.set([]);
    this.status.set(null);
    this.show();
  }

  /**
   * The report of the selected cells to the clipboard. Where the browser
   * refuses (no focus, no permission, no secure context) the JSON goes to
   * the console instead, and the panel says so.
   */
  async copy(): Promise<void> {
    const source = this.source;
    const spots = this.spots();
    if (!source) {
      this.status.set('No location loaded.');
      return;
    }
    if (spots.length === 0) {
      this.status.set('Select cells first.');
      return;
    }
    const json = buildCellReport(this.meta(), this.note(), source.describe(spots));
    const size = `${(json.length / 1024).toFixed(1)} kB`;
    try {
      await navigator.clipboard.writeText(json);
      console.log(`[CellReport] ${spots.length} cells copied, ${size}`);
      this.status.set(`Copied ${spots.length} cells, ${size}`);
    } catch (error) {
      console.log(json);
      console.warn('[CellReport] The clipboard refused the report, it is logged above.', error);
      this.status.set('Clipboard refused: JSON logged to the console');
    }
  }

  /** The head of the report. Reads nothing of the tile credentials. */
  private meta(): CellReportMeta {
    return {
      time: new Date().toISOString(),
      url: reportUrl(window.location.href),
      version: BUILD_VERSION,
      location: this.locationMgmt.displayName(),
      effects: matchingVfxPreset(this.debugFacade.vfx()) ?? 'custom',
      corridor: corridorChanges(corridorConfig, CORRIDOR_DEFAULTS),
    };
  }

  /** Frame the selection while the report is on. */
  private show(): void {
    if (this.active()) this.source?.showSelection(this.spots());
  }

  /** Spots picked around another HQ lie in another local frame: drop them. */
  private forgetOtherPlace(): void {
    const hq = this.locationMgmt.hq();
    const place = hq ? `${hq.lat},${hq.lon}` : null;
    if (place === this.place) return;
    this.place = place;
    if (this.spots().length > 0) this.spots.set([]);
  }
}
