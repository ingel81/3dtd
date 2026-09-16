import { Injectable, inject, signal } from '@angular/core';
import { LOADING_NAME, LocationManagementService, NO_LOCATION_NAME } from '../location/location-management.service';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { CORRIDOR_DEFAULTS, corridorConfig } from '../../utils/route-corridor';
import { corridorTrace } from '../../utils/corridor-trace';
import { downloadBlob } from '../../utils/download';
import { corridorChanges, reportUrl } from './cell-report';
import {
  buildCorridorSnapshot,
  describeLoad,
  snapshotFileName,
  type CorridorSnapshotData,
  type CorridorSnapshotMeta,
} from './corridor-snapshot';

/** What the snapshot reads off the game: CorridorSnapshotReader, while a location is loaded. */
export interface CorridorSnapshotSource {
  /** Why no snapshot can be taken now, null when one can. */
  blocker(): string | null;
  /** Everything of the corridor in use; `progress` hears how many cells are read. Resolves with why it stopped instead. */
  read(progress: (done: number, total: number) => void): Promise<CorridorSnapshotData | string>;
}

/**
 * The corridor snapshot for playtests: one click on the Snapshot tile in
 * the developer options, or `__corridor.snapshot()`, saves everything of the
 * corridor at this place as one JSON download (corridor-snapshot.ts), with
 * how the place was loaded in its name. Taken once after a page load and
 * once after reaching the same place in the game, the two files tell
 * whether both gave the same corridor and where they part. The tile shows
 * how far it is and then the name of the file.
 */
@Injectable({ providedIn: 'root' })
export class CorridorSnapshotService {
  private readonly locationMgmt = inject(LocationManagementService);

  /** A snapshot is being taken; another click waits for it. */
  readonly busy = signal(false);
  /** What the tile says last: how far it is, the file saved, why none was taken. */
  readonly status = signal<string | null>(null);

  private source: CorridorSnapshotSource | null = null;

  /** The game to read the corridor off, VisualizationFacadeService.initialize. */
  connect(source: CorridorSnapshotSource): void {
    this.source = source;
  }

  /** The source goes with its game. Another source's disconnect changes nothing. */
  disconnect(source: CorridorSnapshotSource): void {
    if (this.source === source) this.source = null;
  }

  /**
   * Take a snapshot and save it. Resolves with the line the tile shows last,
   * which goes to the console as well: the file name, or why there is none.
   */
  async take(): Promise<string> {
    if (this.busy()) return 'A snapshot is being taken.';
    const source = this.source;
    if (!source) return this.say('No location loaded.');
    const blocked = source.blocker();
    if (blocked) return this.say(blocked);

    const date = new Date();
    this.busy.set(true);
    this.status.set('Snapshot: screenshot');
    try {
      const data = await source.read((done, total) => {
        this.status.set(`Snapshot: cells ${total > 0 ? Math.round((100 * done) / total) : 100} %`);
      });
      if (typeof data === 'string') return this.say(data);
      const meta = this.meta(date);
      const json = buildCorridorSnapshot(meta, data);
      const name = snapshotFileName(this.place(), meta.load.kind, date);
      downloadBlob(new Blob([json], { type: 'application/json' }), name);
      const size = json.length < 1024 * 1024 ? `${(json.length / 1024).toFixed(0)} kB` : `${(json.length / 1024 / 1024).toFixed(1)} MB`;
      return this.say(`Saved ${name}, ${size}`);
    } catch (error) {
      console.error('[Corridor] snapshot failed', error);
      return this.say(`Snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  /** The head of the snapshot, at the time of the click. Reads nothing of the tile credentials. */
  private meta(date: Date): CorridorSnapshotMeta {
    return {
      time: date.toISOString(),
      version: BUILD_VERSION,
      url: reportUrl(window.location.href),
      location: this.locationMgmt.displayName(),
      load: describeLoad(
        corridorTrace.loads(),
        this.locationMgmt.recents(),
        this.locationMgmt.hq(),
        performance.timeOrigin,
        performance.now() / 1000,
      ),
      corridor: { ...corridorConfig, highwayWidths: { ...corridorConfig.highwayWidths } },
      corridorChanged: corridorChanges(corridorConfig, CORRIDOR_DEFAULTS),
    };
  }

  /** The place in the file name: the town, else the name in the header, else the HQ's coordinates. */
  private place(): string {
    const town = this.locationMgmt.missionInfo()?.city;
    if (town) return town;
    const name = this.locationMgmt.displayName();
    if (name !== NO_LOCATION_NAME && name !== LOADING_NAME) return name;
    const hq = this.locationMgmt.hq();
    return hq ? `${hq.lat.toFixed(4)} ${hq.lon.toFixed(4)}` : '';
  }

  /** The line on the tile, and in the console. */
  private say(line: string): string {
    this.status.set(line);
    console.log(`[Corridor] snapshot: ${line}`);
    return line;
  }
}
