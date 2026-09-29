import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { RouteWaypoint } from '../models/game.types';
import { RouteBody, routeBodyStations, type RouteBodyContact } from '../utils/route-body';
import {
  OF_BURNING,
  OF_FROZEN,
  OF_POISONED,
  OF_SLOWED,
  OF_STUNNED,
  O_FLAGS,
  O_HP,
  O_ID,
  O_TAIL,
  O_TIP,
  OOZE_STRIDE,
  type SimTable,
} from '../sim/protocol/packet';
import { OozeSounds } from './ooze-sounds';

/** Ground of the route grid in local coordinates (GlobalRouteGridService) */
export interface PresentationGround {
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

export type OozeEngine = Pick<ThreeTilesEngine, 'oozes' | 'sync' | 'spatialAudio'>;

interface OozeEntry {
  readonly id: string;
  /** Its stretch as the last frame had it, for where it is heard */
  readonly body: RouteBody;
  /** Geo height of the ground under its tip (E_TERRAIN), where the grid has none */
  terrain: number;
  /** Removed by an op; kept to the end of the frame (a collapse may follow in the same packet) */
  gone: boolean;
}

/**
 * The oozes on the main thread: the simulation adds a body with its path
 * (op `oozes.add`), sends each body's stretch, HP and status bits in the
 * ooze table, and collapses, removes or discards it with ops. Here the
 * stations are built from the path on the main thread's frame and ground,
 * the table goes to the band renderer once per frame, and each ooze is
 * heard where its body is nearest the listener (OozeSounds): the bubbling
 * loop, and the splat when it collapses.
 */
export class OozePresenter {
  private readonly oozes = new Map<number, OozeEntry>();
  private readonly sounds = new OozeSounds();
  private readonly groundAt = (x: number, z: number): number | null => this.ground.getGroundLocalYAt(x, z);
  private readonly listener = new Vector3();
  private readonly contact: RouteBodyContact = { station: 0, offset: 0, distance: 0 };
  private readonly heard = new Vector3();

  constructor(private readonly ground: PresentationGround) {}

  /** Op `oozes.add`(id, path): its stations on this thread, the band renderer takes them with the grid's ground. */
  add(engine: OozeEngine, id: string, path: readonly RouteWaypoint[]): void {
    const stations = routeBodyStations(path, engine.sync, engine.sync.getOrigin().height);
    const num = Number(id.slice(id.lastIndexOf('-') + 1));
    this.oozes.set(num, { id, body: new RouteBody(stations), terrain: 0, gone: false });
    engine.oozes.add(id, stations, this.groundAt);
    if (engine.spatialAudio) this.sounds.register(engine.spatialAudio);
  }

  /** The ground under ooze `num` this frame (its enemy row) */
  noteTerrain(num: number, terrain: number): void {
    const entry = this.oozes.get(num);
    if (entry !== undefined) entry.terrain = terrain;
  }

  /** Once per frame: each body's stretch, HP and status to its band, its loop to the point nearest the listener. */
  present(table: SimTable, engine: OozeEngine): void {
    const audio = engine.spatialAudio ?? null;
    const d = table.data;
    let listening = false;
    for (let r = 0; r < table.count; r++) {
      const o = r * OOZE_STRIDE;
      const entry = this.oozes.get(d[o + O_ID]);
      if (entry === undefined || entry.gone) continue;
      const flags = d[o + O_FLAGS];
      entry.body.tailM = d[o + O_TAIL];
      entry.body.tipM = d[o + O_TIP];
      engine.oozes.setFrame(
        entry.id,
        entry.body.tailM,
        entry.body.tipM,
        d[o + O_HP],
        (flags & OF_SLOWED) !== 0,
        (flags & OF_POISONED) !== 0,
        (flags & OF_BURNING) !== 0,
        (flags & OF_FROZEN) !== 0,
        (flags & OF_STUNNED) !== 0,
      );
      if (audio === null) continue;
      if (!listening) {
        audio.getListener().getWorldPosition(this.listener);
        listening = true;
      }
      this.hear(entry);
      this.sounds.follow(entry.id, audio, this.heard.x, this.heard.y, this.heard.z);
    }
  }

  /** After the frame's events: the oozes removed by its ops go. Every packet, presented or not. */
  endFrame(): void {
    for (const [num, entry] of this.oozes) {
      if (entry.gone) this.oozes.delete(num);
    }
  }

  /**
   * Op `oozes.collapse`(id, tailM, tipM): a killed ooze breaks up. Its band
   * gets the stretch it had, with nothing left, and collapses
   * (OozeBandRenderer.collapse); its loop ends in a splat at the body point
   * nearest the listener.
   */
  collapse(engine: OozeEngine, id: string, tailM: number, tipM: number): void {
    engine.oozes.setFrame(id, tailM, tipM, 0, false, false, false, false, false);
    engine.oozes.collapse(id);
    const entry = this.oozes.get(Number(id.slice(id.lastIndexOf('-') + 1)));
    const audio = engine.spatialAudio ?? null;
    if (entry === undefined || audio === null) return;
    entry.body.tailM = tailM;
    entry.body.tipM = tipM;
    this.sounds.stop(entry.id, audio);
    audio.getListener().getWorldPosition(this.listener);
    const k = this.hear(entry);
    const st = entry.body.stations;
    const offset = this.contact.offset;
    this.sounds.splat(
      audio,
      st.lat[k] + st.latPerRight[k] * offset,
      st.lon[k] + st.lonPerRight[k] * offset,
      this.heard.y + st.originHeight,
    );
  }

  /** Op `oozes.remove` / `oozes.discard`: the ooze left, its loop ends; the entry goes at endFrame(). */
  forget(id: string, engine: OozeEngine | null): void {
    const entry = this.oozes.get(Number(id.slice(id.lastIndexOf('-') + 1)));
    if (entry === undefined) return;
    entry.gone = true;
    this.sounds.stop(id, engine?.spatialAudio ?? null);
  }

  /** Every ooze gone at once (op `oozes.clear`, a new run). */
  clear(engine: OozeEngine | null): void {
    this.oozes.clear();
    this.sounds.clear(engine?.spatialAudio ?? null);
  }

  get size(): number {
    return this.oozes.size;
  }

  /** The body point nearest `listener`: its station, returned, the contact in `contact`, the local point in `heard`. */
  private hear(entry: OozeEntry): number {
    const body = entry.body;
    const c = body.nearest(this.listener.x, this.listener.z, this.contact);
    const st = body.stations;
    const k = c.station;
    const x = st.x[k] + st.rightX[k] * c.offset;
    const z = st.z[k] + st.rightZ[k] * c.offset;
    const groundY = this.ground.getGroundLocalYAt(x, z);
    this.heard.set(x, groundY ?? entry.terrain - st.originHeight, z);
    return k;
  }
}
