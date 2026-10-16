import { Injectable, computed, inject, signal } from '@angular/core';
import { ConfigService } from '../core/services/config.service';
import { GeocodingService } from '../services/location/geocoding.service';
import { WorldDiceService } from '../services/location/world-dice.service';
import { AUTOSAVE_SLOTS, type SaveSlotInfo } from '../services/save-game/save-game.port';
import { SAVE_SLOT_STORE } from '../services/save-game/save-slot.store';
import { shortPlaceName } from '../services/save-game/slot-name';
import { readJson, writeJson } from '../utils/storage';
import { CUSTOM_MAPS_OPEN } from '../world/custom-maps-open';
import type { MapSummary } from '../world/custom-map/map-store';
import { WorldChoiceService, type MapChoice } from '../world/world-choice.service';
import type { WorldRef } from '../world/world-ref';
import { WorldSession, type ParkedWorld } from '../world/world-session.service';
import { AppScreen } from '../world/app-screen.service';
import type { PathChip } from '../components/world-path/world-path.component';
import { PLAIN_START, WorldStartService, type WorldStart } from '../world/world-start';
import type { OsmFrameRequest } from '../components/osm-frame/osm-frame-request';
import { StageSaves } from './stage-saves';
import { forgetRecentMap, loadRecentMaps, overflowWorlds } from './recent-maps';
import {
  heroWorld,
  runAtRisk,
  samePick,
  worldLock,
  worldOfMap,
  WORLD_NAMES,
  type AutosaveRun,
  type WorldId,
  type WorldPick,
} from './world-rules';
import { whyNot, type WhyNotFacts } from '../world/why-not';
import { placeLabel } from '../services/location/place-label';

/** The lists of the real places' menu */
export type RealList = 'recent' | 'favorites' | 'showcase' | 'search' | 'records' | 'tilesets';

/** What opens over the globes, from anywhere on them */
export type StageOverlay = 'settings' | 'extras' | 'load' | 'coop' | 'key';

/** A question before something ends (a run's autosave), with its answers */
export interface StageConfirm {
  text: string;
  note: string | null;
  answers: { label: string; primary?: boolean; run: () => void }[];
}

/** A map as the worlds list it */
export interface StageMap {
  id: string;
  name: string;
  description: string;
  spawns: number;
  origin: MapSummary['origin'];
  /** The real place an OpenStreetMap map was made of, null for another map */
  osm: { lat: number; lon: number } | null;
  /** Made from OpenStreetMap and unchanged since: OpenStreetMap's, not a Built World (worldOfMap) */
  generated: boolean;
  /** The shipped or coop map this own one is a copy of, by its name; null for another */
  copyOf: string | null;
  updatedAt: string;
  picture: string | null;
}

/**
 * What a world offers to go on with (docs/WORLDS_STATE_PLAN.md, 3.1): its
 * run from the autosave; the one source of the globes' Continue entries,
 * the world menus' first row and the chips
 */
export interface StageContinue {
  world: WorldId;
  /**
   * 'ready': the run is held behind the globes and shows at once; 'back':
   * the place is held with no run yet (Back to); 'saved': the run loads from
   * its autosave
   */
  kind: 'ready' | 'back' | 'saved';
  label: string;
  /** "Heilbronn | wave 12" */
  line: string;
  /** The run behind it, for Discard */
  run: AutosaveRun | null;
}

/** A Continue as a chip or a globe's line says it (the same everywhere, docs/WORLDS_STATE_PLAN.md 3.3) */
export function chipLine(go: StageContinue): string {
  if (go.kind === 'back') return go.label;
  return `${go.line} | ${go.kind === 'ready' ? 'ready' : 'autosave'}`;
}

/** The world last started, for the globes' order of sizes */
const LAST_WORLD_KEY = 'td_last_world_v1';

function readLastWorld(): WorldId | null {
  const value = readJson(LAST_WORLD_KEY);
  return value === 'real' || value === 'osm' || value === 'maps' ? value : null;
}

const NO_PICKS: Readonly<Record<WorldId, WorldPick | null>> = { real: null, osm: null, maps: null };

/** The pick of each world's menu, kept over a reload (decision 9) */
const PICKS_KEY = 'td_world_picks_v1';

function isPick(value: unknown): value is WorldPick {
  const p = value as Partial<WorldPick> | null;
  if (!p || typeof p.name !== 'string') return false;
  if (p.kind === 'map' || p.kind === 'tileset') return typeof (p as { id?: unknown }).id === 'string';
  if (p.kind !== 'place') return false;
  const place = p as Partial<Extract<WorldPick, { kind: 'place' }>>;
  return !!place.hq && Number.isFinite(place.hq.lat) && Number.isFinite(place.hq.lon) && Array.isArray(place.spawns);
}

function readPicks(): Readonly<Record<WorldId, WorldPick | null>> {
  const stored = readJson(PICKS_KEY) as Partial<Record<WorldId, unknown>> | null;
  if (!stored || typeof stored !== 'object') return NO_PICKS;
  const of = (world: WorldId) => (isPick(stored[world]) ? (stored[world] as WorldPick) : null);
  return { real: of('real'), osm: of('osm'), maps: of('maps') };
}

/**
 * The globes and the world menus (docs/WORLDS_NAVIGATION_PLAN.md, 3.1 and
 * phase 6): which view shows, what each world has picked, what is open over
 * it, and the ways out: Start, Continue, Edit, the OpenStreetMap frame.
 * Root, so a pick stays while a game runs in between: "World menu" in the
 * pause menu comes back to the place it left.
 *
 * Nothing here loads a world but Start and Continue (WorldSession.open);
 * picking, browsing and a link only choose. A link's place or map is
 * picked when the page starts on the globes.
 */
@Injectable({ providedIn: 'root' })
export class WorldsStageService {
  private readonly session = inject(WorldSession);
  private readonly screens = inject(AppScreen);
  private readonly config = inject(ConfigService);
  private readonly worlds = inject(WorldChoiceService);
  private readonly dice = inject(WorldDiceService);
  private readonly geocoding = inject(GeocodingService);
  readonly mapsOpen = inject(CUSTOM_MAPS_OPEN);

  readonly view = signal<'globes' | 'world'>('globes');
  readonly world = signal<WorldId>('real');
  readonly picks = signal<Readonly<Record<WorldId, WorldPick | null>>>(readPicks());
  readonly realList = signal<RealList>('recent');
  readonly overlay = signal<StageOverlay | null>(null);
  readonly confirm = signal<StageConfirm | null>(null);
  /** The OpenStreetMap frame open in that world's menu, and the world it came from */
  readonly frame = signal<OsmFrameRequest | null>(null);
  private readonly frameFrom = signal<WorldId>('osm');
  /** Own, received and shipped maps, filled when a world of maps shows */
  readonly maps = signal<readonly StageMap[]>([]);
  /** The Built Worlds' Recent: the maps played lately, newest first (recent-maps.ts) */
  readonly recentMaps = signal<readonly string[]>(loadRecentMaps());
  /** OpenStreetMap's Recent worlds: the maps made there and not changed since, newest first */
  readonly recentWorlds = computed(() =>
    this.maps().filter((m) => m.generated).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));

  /** Why the last Start did not happen, said under its button */
  readonly notice = signal<string | null>(null);
  /** The dice rolls */
  readonly rolling = signal(false);
  readonly lastPlayed = signal<WorldId | null>(readLastWorld());
  /** A map picked before the list said whether it is of OpenStreetMap: placed in its world once it does */
  private pendingMap: Extract<WorldPick, { kind: 'map' }> | null = null;

  /** The slots as the globes see them: Load opens a slot's world with it */
  private readonly slotStore = inject(SAVE_SLOT_STORE);
  readonly saves = new StageSaves(this.slotStore, (slot) => this.continueSlot(slot));

  /** What the ways of the globes hang on: the key and the release; no room, no run, no replay here */
  readonly rules = computed<WhyNotFacts & { hasKey: boolean }>(() => ({
    hasKey: !this.config.needsCredentials(),
    mapsOpen: this.mapsOpen,
    inCoopRoom: false,
    coopGuest: false,
    replay: false,
    runLoaded: false,
  }));

  /** The runs the autosaves hold, one per world at most, newest first */
  readonly autosaves = computed<readonly AutosaveRun[]>(() => {
    const runs: AutosaveRun[] = [];
    for (const slot of this.saves.slots()) {
      if (!AUTOSAVE_SLOTS.includes(slot.id)) continue;
      const run = this.runOf(slot);
      if (run) runs.push(run);
    }
    return runs.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  /** The world that stands large on the globes */
  readonly hero = computed(() => this.session.parked()?.world ?? heroWorld(this.autosaves(), this.lastPlayed()));

  constructor() {
    // The page starts on the globes with a link: its place or map is picked, nothing loads
    if (!this.session.isOpen()) this.pickFromOrder(inject(WorldStartService).current());
    // Read at once and again whenever a slot is written or removed (the game's autosave, a discard)
    void this.saves.refresh();
    this.slotStore.watch?.(() => void this.saves.refresh());
  }

  lock(world: WorldId): string | null {
    return worldLock(world, this.rules());
  }

  whyNot(action: 'play' | 'edit', world: WorldId | null): string | null {
    return whyNot(action, { ...this.rules(), world });
  }

  /** The run an autosave holds for this world and pick: Start continues it */
  runHere(world: WorldId, pick: WorldPick | null): AutosaveRun | null {
    if (!pick) return null;
    return this.autosaves().find((r) => r.world === world && r.pick !== null && samePick(r.pick, pick)) ?? null;
  }

  /** The world held behind the globes is this pick */
  heldHere(world: WorldId, pick: WorldPick | null): boolean {
    const held = this.session.parked();
    return !!pick && !!held && held.world === world && !!held.pick && samePick(held.pick, pick);
  }

  /** What Start says for a pick: Continue of its run, Back to the place held, else `fresh` (Start, Play) */
  playWord(world: WorldId, pick: WorldPick | null, fresh: string): string {
    if (this.heldHere(world, pick)) return this.session.parked()!.run ? 'Continue' : `Back to ${this.session.parked()!.label}`;
    return this.runHere(world, pick) ? 'Continue' : fresh;
  }

  /** The autosave of a world, for its menu's Continue */
  autosaveOf(world: WorldId): AutosaveRun | null {
    return this.autosaves().find((r) => r.world === world) ?? null;
  }

  /** What `world` offers to go on with, null for nothing: the world held first, else its autosave */
  continueOf(world: WorldId): StageContinue | null {
    const held = this.session.parked();
    const run = this.autosaveOf(world);
    if (held && held.world === world) {
      // The autosave of the held run is the one Discard drops with it
      const own = run && held.pick && run.pick && samePick(run.pick, held.pick) ? run : null;
      return held.run
        ? { world, kind: 'ready', label: 'Continue', line: `${held.label} | wave ${held.wave}`, run: own ?? this.heldRun(held) }
        : { world, kind: 'back', label: `Back to ${held.label}`, line: 'Still loaded, no run yet', run: null };
    }
    return run ? { world, kind: 'saved', label: 'Continue', line: `${run.name} | wave ${run.wave}`, run } : null;
  }

  /** A held run with no autosave of its own yet, as Discard and a start elsewhere see it */
  private heldRun(held: ParkedWorld): AutosaveRun | null {
    if (!held.world) return null;
    return { slotId: '', world: held.world, pick: held.pick, name: held.label, wave: held.wave, savedAt: new Date().toISOString() };
  }

  /** Every world's, the one held first, then newest first: the Continue entries of the globes and the chips */
  readonly continues = computed<readonly StageContinue[]>(() => {
    const held = this.session.parked()?.world ?? null;
    const worlds = [...new Set([...(held ? [held] : []), ...this.autosaves().map((run) => run.world)])];
    return worlds.map((world) => this.continueOf(world)).filter((c): c is StageContinue => c !== null);
  });

  /**
   * The chips of the path, the same on the globes, over the game and in the
   * editor (docs/WORLDS_STATE_PLAN.md, 3.3): every world's Continue or Back
   * to but `except` (the world on screen), and the map open in the editor
   * unless the editor shows
   */
  pathChips(except: WorldId | null, editor: boolean): PathChip[] {
    const hints: Record<StageContinue['kind'], string> = {
      ready: 'Back to the run, as you left it',
      back: 'Back to the place, still loaded',
      saved: 'Continue from the autosave',
    };
    const chips: PathChip[] = this.continues()
      .filter((go) => go.world !== except)
      .map((go) => ({ id: `continue-${go.world}`, label: chipLine(go), hint: this.whyNot('play', go.world) ?? hints[go.kind] }));
    const draft = this.screens.draft();
    if (editor && draft) chips.push({ id: 'editor', label: `Editor: ${draft.name}${draft.unsaved ? ' | unsaved' : ''}`, hint: 'Back to the map editor, the map as you left it' });
    return chips;
  }

  /** A chip of pathChips was clicked: its Continue, or the editor on the map open in it */
  goChip(id: string): void {
    if (id === 'editor') {
      this.worlds.editMap(null);
      return;
    }
    const go = this.continues().find((c) => `continue-${c.world}` === id);
    if (go && !this.whyNot('play', go.world)) this.resume(go);
  }

  /** Go on with it: the world held shows at once, a saved run loads */
  resume(item: StageContinue): void {
    if (item.kind !== 'saved') {
      this.confirm.set(null);
      this.overlay.set(null);
      this.session.unpark();
      return;
    }
    if (item.run) this.continueRun(item.run);
  }

  /** Discard its run, asked first */
  discard(item: StageContinue): void {
    if (item.run) this.discardRun(item.run);
  }

  // ---- Views ----

  openWorld(world: WorldId): void {
    this.world.set(world);
    this.view.set('world');
    this.notice.set(null);
    this.recentMaps.set(loadRecentMaps());
    if (world !== 'real') void this.refreshMaps();
  }

  toGlobes(): void {
    this.view.set('globes');
    this.notice.set(null);
    this.frame.set(null);
  }

  pick(world: WorldId, pick: WorldPick | null): void {
    this.picks.update((picks) => ({ ...picks, [world]: pick }));
    writeJson(PICKS_KEY, this.picks());
    this.notice.set(null);
  }

  openOverlay(overlay: StageOverlay): void {
    this.overlay.set(overlay);
    if (overlay === 'key') this.config.setupRequested.set(true);
  }

  closeOverlay(): void {
    if (this.overlay() === 'key') this.config.setupRequested.set(false);
    this.overlay.set(null);
  }

  /**
   * Esc, one step up (plan 3.3): a question, an overlay, the OpenStreetMap
   * frame, a world menu to the globes. On the globes nothing: false.
   */
  back(): boolean {
    if (this.confirm()) {
      this.confirm.set(null);
      return true;
    }
    if (this.overlay()) {
      this.closeOverlay();
      return true;
    }
    if (this.view() === 'world' && this.world() === 'osm' && this.frame()) {
      this.frameBack();
      return true;
    }
    if (this.view() === 'world') {
      this.toGlobes();
      return true;
    }
    return false;
  }

  // ---- Start, Continue, Edit ----

  /**
   * Start the world's pick: it loads, and the game shows once it stands.
   * Locked: the reason under the button. Its own autosave: Continue. Another
   * run in the same autosave: asked first, its next autosave takes that one's place.
   */
  start(world: WorldId = this.world()): void {
    const pick = this.picks()[world];
    if (!pick) return;
    const why = this.whyNot('play', world);
    if (why) {
      this.notice.set(why);
      return;
    }
    // The world held behind the globes is this pick: it shows at once
    if (this.heldHere(world, pick)) {
      this.session.unpark();
      return;
    }
    const here = this.runHere(world, pick);
    if (here) {
      this.continueRun(here);
      return;
    }
    // The run of this world elsewhere: held behind the globes, or in its autosave
    const item = this.continueOf(world);
    const risk = item && item.kind !== 'back' ? item.run : runAtRisk(world, pick, this.autosaves());
    if (!risk || !item) {
      this.go(world, pick);
      return;
    }
    this.confirm.set({
      text: `${item.line} waits in ${WORLD_NAMES[world]}.`,
      note: 'Each world keeps one run. Starting something new here ends it now.',
      answers: [
        { label: 'End it and start', primary: true, run: () => void this.endThenGo(risk, () => this.go(world, pick)) },
        { label: `Continue ${risk.name}`, run: () => this.resume(item) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  }

  /** The run ends: a held one goes without being kept, its autosave goes; then `then` (decision 2) */
  private async endThenGo(run: AutosaveRun, then: () => void): Promise<void> {
    await this.endRun(run);
    then();
  }

  /** A run ends for good: held, it goes without being kept; its autosave goes */
  async endRun(run: AutosaveRun): Promise<void> {
    const held = this.session.parked();
    if (held && held.world === run.world) await this.session.leaveParked(false);
    const slot = run.slotId || this.autosaveOf(run.world)?.slotId;
    if (slot) await this.saves.deleteSlot(slot);
  }

  /** Discard a world's Continue, asked first: its autosave goes for good (docs/WORLDS_STATE_PLAN.md, 3.4) */
  discardRun(run: AutosaveRun): void {
    this.confirm.set({
      text: `Discard ${run.name} | wave ${run.wave}?`,
      note: 'It cannot be continued.',
      answers: [
        { label: 'Discard', primary: true, run: () => void this.endRun(run) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  }

  /** Continue a run from its autosave */
  continueRun(run: AutosaveRun): void {
    const why = this.whyNot('play', run.world);
    if (why) {
      this.notice.set(why);
      return;
    }
    this.open(run.world, {
      ...PLAIN_START,
      world: run.pick?.kind === 'map' ? mapRef(run.pick.id) : null,
      resume: run.slotId,
      play: true,
      label: run.name,
    });
  }

  /** A slot of the Load page: its world opens and loads it; the reason when it cannot */
  continueSlot(slot: SaveSlotInfo): string | null {
    const world: WorldId = slot.world ?? 'real';
    const why = this.whyNot('play', world);
    if (why) return why;
    this.overlay.set(null);
    const load = () => this.open(world, {
      ...PLAIN_START,
      world: slot.map ? mapRef(slot.map.id) : null,
      resume: slot.id,
      play: true,
      label: slot.map?.name ?? shortPlaceName(slot.location),
    });
    const ask = this.loadAsk(slot);
    if (!ask) {
      load();
      return null;
    }
    this.confirm.set({
      text: ask.text,
      note: ask.note,
      answers: [
        { label: 'End it and load', primary: true, run: () => void this.endThenGo(ask.run, load) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
    return null;
  }

  /**
   * What loading `slot` ends, asked first: a save is a start in its world,
   * so that world's run (held, or in its autosave) ends with it, as for
   * Start (docs/WORLDS_STATE_PLAN.md, 3.5). Null when there is none, or it is
   * this very save (its Continue). The one rule for the Load page of the
   * globes and of the game.
   */
  loadAsk(slot: Pick<SaveSlotInfo, 'id' | 'world'>): { text: string; note: string; run: AutosaveRun } | null {
    const world: WorldId = slot.world ?? 'real';
    const item = this.continueOf(world);
    if (!item || item.kind === 'back' || !item.run) return null;
    if (item.kind === 'saved' && item.run.slotId === slot.id) return null;
    return {
      text: `${item.line} waits in ${WORLD_NAMES[world]}.`,
      note: 'Each world keeps one run. Loading this save ends it now.',
      run: item.run,
    };
  }

  /**
   * Edit the pick: a map in the editor (a shipped one opens as an own copy
   * there); a real place becomes a map of OpenStreetMap, its frame opens.
   */
  edit(world: WorldId = this.world()): void {
    const pick = this.picks()[world];
    if (!pick) return;
    const why = this.whyNot('edit', world);
    if (why) {
      this.notice.set(why);
      return;
    }
    if (pick.kind === 'map') this.worlds.editMap(pick.id);
    else if (pick.kind === 'place') this.makeMapOf(pick, world);
  }

  /** The OpenStreetMap frame on a real place, with its spawns */
  makeMapOf(pick: Extract<WorldPick, { kind: 'place' }>, from: WorldId = this.world()): void {
    this.frameFrom.set(from);
    this.frame.set({
      place: { lat: pick.hq.lat, lon: pick.hq.lon, name: placeLabel(pick.name), address: pick.name },
      spawnsAt: pick.spawns.map(({ lat, lon }) => ({ lat, lon })),
    });
    this.openWorld('osm');
  }

  /** The frame made its map: it is picked in OpenStreetMap, then played or opened in the editor */
  frameDone(summary: MapSummary, then: 'play' | 'edit'): void {
    this.frame.set(null);
    const pick: WorldPick = { kind: 'map', id: summary.id, name: summary.name };
    this.pick('osm', pick);
    void this.refreshMaps().then(() => this.pruneWorlds());
    if (then === 'play') this.go('osm', pick);
    else this.worlds.editMap(summary.id);
  }

  /** Recent worlds keep ten: the oldest beyond go to the editor's trash, but none a run plays on (decision 3, 4) */
  private async pruneWorlds(): Promise<void> {
    const playing = new Set(this.autosaves().map((r) => (r.pick?.kind === 'map' ? r.pick.id : '')));
    const out = overflowWorlds(this.recentWorlds(), playing);
    if (out.length === 0) return;
    for (const map of out) await this.worlds.trashMap(map.id);
    await this.refreshMaps();
  }

  /**
   * Remove a map from OpenStreetMap's Recent worlds: asked first, it goes to
   * the editor's trash; not while a run plays on it (its Continue first)
   */
  removeWorld(map: StageMap): void {
    if (this.autosaves().some((r) => r.pick?.kind === 'map' && r.pick.id === map.id)) {
      this.notice.set(`A run plays on ${map.name}: discard its Continue first.`);
      return;
    }
    this.confirm.set({
      text: `Remove ${map.name} from Recent worlds?`,
      note: "The map goes to the editor's trash.",
      answers: [
        { label: 'Remove', primary: true, run: () => void this.trashThen(map.id) },
        { label: 'Cancel', run: () => undefined },
      ],
    });
  }

  private async trashThen(id: string): Promise<void> {
    if (!(await this.worlds.trashMap(id))) return;
    const pick = this.picks().osm;
    if (pick?.kind === 'map' && pick.id === id) this.pick('osm', null);
    await this.refreshMaps();
  }

  /** A map off the Built Worlds' Recent; the map itself stays */
  forgetMap(id: string): void {
    this.recentMaps.set(forgetRecentMap(id));
  }

  /** Out of the frame, back to where it was opened */
  frameBack(): void {
    this.frame.set(null);
    this.openWorld(this.frameFrom());
  }

  /** The world dice: a random city with 3D tiles is picked (Start loads it) */
  async rollDice(): Promise<void> {
    if (this.rolling()) return;
    this.rolling.set(true);
    try {
      const city = await this.dice.rollRandomCity();
      if (!city) {
        this.notice.set('The city list did not load, so there is no random city.');
        return;
      }
      const name = city.country ? `${city.name}, ${city.country}` : city.name;
      this.pick('real', { kind: 'place', hq: { lat: city.lat, lon: city.lon }, spawns: [], name });
    } finally {
      this.rolling.set(false);
    }
  }

  /**
   * The game goes back to the globes (pause menu: All worlds, World menu):
   * the world it played is picked in its menu, or the globes show. With
   * `held` the game stays behind the globes, paused (WorldSession.park:
   * Continue or Back to shows it at once); without, its engine, worker and
   * canvas go with WorldSession.close.
   */
  leaveGame(to: { world: WorldId; pick: WorldPick | null } | null, held: ParkedWorld | null = null): void {
    this.confirm.set(null);
    this.overlay.set(null);
    this.frame.set(null);
    if (to?.pick?.kind === 'map') {
      this.pickMap(to.pick);
    } else if (to) {
      if (to.pick) this.pick(to.world, to.pick);
      this.openWorld(to.world);
    } else {
      this.toGlobes();
    }
    if (held) this.session.park(held);
    else this.session.close();
  }

  /** The world a listed map belongs to (worldOfMap); a map not listed (yet) is a Built World */
  mapWorld(id: string): WorldId {
    return worldOfMap(this.maps().find((m) => m.id === id));
  }

  /** Read the maps again (own ones change in the editor), and put an OpenStreetMap map's pick in its world */
  async refreshMaps(): Promise<void> {
    const choices = await this.worlds.listMaps().catch(() => null);
    if (!choices) return;
    const of = (choice: MapChoice): StageMap => ({
      id: choice.summary.id,
      name: choice.summary.name,
      description: choice.summary.description,
      spawns: choice.summary.spawns,
      origin: choice.summary.origin,
      osm: choice.summary.osm ?? null,
      generated: choice.summary.generated === true,
      copyOf: null,
      updatedAt: choice.summary.updatedAt,
      picture: choice.picture,
    });
    const originals = new Map([...choices.shared, ...choices.shipped].map((c) => [c.summary.id, c.summary.name]));
    const own = choices.own.map((c) => ({ ...of(c), copyOf: c.summary.copyOf ? (originals.get(c.summary.copyOf.id) ?? null) : null }));
    this.maps.set([...own, ...choices.shared.map(of), ...choices.shipped.map(of)]);
    // Picks made before the list (a link names a map by its id, a reload kept one) take the map's name; a map gone, or now of the other world, is no pick
    for (const world of ['osm', 'maps'] as const) {
      const pick = this.picks()[world];
      if (pick?.kind !== 'map' || pick.id === this.pendingMap?.id) continue;
      const map = this.maps().find((m) => m.id === pick.id);
      if (!map || worldOfMap(map) !== world) this.pick(world, null);
      else if (pick.name !== map.name) this.pick(world, { ...pick, name: map.name });
    }
    const pending = this.pendingMap;
    if (pending && this.mapWorld(pending.id) === 'osm') {
      this.pendingMap = null;
      this.pick('osm', { ...pending, name: this.maps().find((m) => m.id === pending.id)?.name ?? pending.name });
      const under = this.picks().maps;
      if (under?.kind === 'map' && under.id === pending.id) this.pick('maps', null);
      if (this.view() === 'world' && this.world() === 'maps') this.world.set('osm');
    }
    this.pendingMap = null;
  }

  /**
   * A map picked from outside the menus (a link, the game left for its menu):
   * under Maps, or under OpenStreetMap once the list says it was made there
   */
  private pickMap(pick: Extract<WorldPick, { kind: 'map' }>): void {
    const known = this.maps().find((m) => m.id === pick.id);
    const world = known ? this.mapWorld(pick.id) : 'maps';
    this.pendingMap = known ? null : pick;
    this.pick(world, known ? { ...pick, name: known.name } : pick);
    this.openWorld(world);
  }

  private go(world: WorldId, pick: WorldPick): void {
    const order: WorldStart = { ...PLAIN_START, play: true, label: shortPlaceName(pick.name) };
    if (pick.kind === 'place') {
      this.open(world, { ...order, place: { hq: pick.hq, spawns: pick.spawns } });
    } else if (pick.kind === 'tileset') {
      const tileset = this.worlds.tilesets().find((t) => t.id === pick.id);
      if (!tileset) return;
      const { lat, lon } = tileset.coverage.center;
      this.open(world, { ...order, world: { kind: 'tileset', id: pick.id }, place: { hq: { lat, lon }, spawns: [] } });
    } else {
      this.open(world, { ...order, world: mapRef(pick.id) });
    }
  }

  private open(world: WorldId, order: WorldStart): void {
    this.confirm.set(null);
    this.notice.set(null);
    this.lastPlayed.set(world);
    writeJson(LAST_WORLD_KEY, world);
    this.session.open(order);
  }

  private runOf(slot: SaveSlotInfo): AutosaveRun | null {
    if (slot.map) {
      const pick: WorldPick = { kind: 'map', id: slot.map.id, name: slot.map.name };
      return { slotId: slot.id, world: slot.world ?? 'maps', pick, name: slot.map.name, wave: slot.wave, savedAt: slot.savedAt };
    }
    const name = shortPlaceName(slot.location);
    const pick: WorldPick | null = slot.hq ? { kind: 'place', hq: slot.hq, spawns: [], name: slot.location } : null;
    return { slotId: slot.id, world: 'real', pick, name, wave: slot.wave, savedAt: slot.savedAt };
  }

  /** A link's start order: its map or place picked in its world's menu */
  private pickFromOrder(order: WorldStart): void {
    const world = order.world;
    if (world?.kind === 'custom-map') {
      this.pickMap({ kind: 'map', id: world.mapId, name: world.name ?? world.mapId });
      return;
    }
    if (world?.kind === 'tileset') {
      const tileset = this.worlds.tilesets().find((t) => t.id === world.id);
      this.pick('real', { kind: 'tileset', id: world.id, name: tileset?.name ?? world.id });
      this.realList.set('tilesets');
      this.openWorld('real');
      return;
    }
    const place = order.place;
    if (!place) return;
    const name = `${place.hq.lat.toFixed(4)}, ${place.hq.lon.toFixed(4)}`;
    this.pick('real', { kind: 'place', hq: place.hq, spawns: place.spawns, name });
    this.openWorld('real');
    // The place's name, once the lookup has it
    void this.geocoding.reverseGeocodeDetailed(place.hq.lat, place.hq.lon).then((result) => {
      const current = this.picks().real;
      if (!result || current?.kind !== 'place' || current.name !== name) return;
      this.pick('real', { ...current, name: result.displayName });
    }).catch(() => undefined);
  }
}

function mapRef(mapId: string): WorldRef {
  return { kind: 'custom-map', mapId, contentHash: '' };
}

