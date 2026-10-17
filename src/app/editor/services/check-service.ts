/**
 * The map check: its findings (map-validation), where towers may stand
 * (build areas, judged in a worker after the map rests), and the map played
 * in the game, by the player from a chosen wave or by the bot for its check.
 */
import { computed, signal, type Signal } from '@angular/core';
import type { CustomMapDocument, MapMeta } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import { spawnRoutes } from '../../map-ops/path-graph';
import { assetCosts } from '../../map-ops/validation/map-budget';
import { validateMap, type MapIssue } from '../../map-ops/validation/map-validation';
import { buildAreaInput, buildAreasOffThread, type BuildAreas } from '../../map-ops/validation/build-areas';
import type { MapTrialResult } from '../../world/map-trial';
import type { AppScreen } from '../../world/app-screen.service';
import type { WorldSession } from '../../world/world-session.service';
import { PLAIN_START } from '../../world/world-start';
import type { EditorDocument } from '../model/editor-document';
import { patch, type EditorSettings } from '../tools/tool';
import type { ViewHost } from './view-host';

/** The build areas are judged again this long after the last change (a large map takes a worker a few hundred ms) */
export const BUILD_AREA_DELAY_MS = 600;
/** Milliseconds after the last change an open check runs again; never while a stroke or drag goes on */
export const CHECK_DELAY_MS = 300;
/** Waves the bot plays for the map check */
const BOT_CHECK_WAVES = 5;

export interface CheckHost {
  readonly editor: EditorDocument | null;
  catalog(): CatalogIndex;
  /** The open map's meta (the bot's result belongs to it) */
  meta: Signal<MapMeta | null>;
  /** Whether the map `id` is the one open (or the one it was opened for) */
  isOpen(id: string): boolean;
  blocked(what: string): boolean;
  save(manual: boolean): Promise<boolean>;
}

export class CheckService {
  readonly issues = signal<MapIssue[] | null>(null);
  /** Where towers may stand (map-ops/validation/build-areas.ts), for the overlay and the check; null before the first judgement */
  readonly buildAreas = signal<BuildAreas | null>(null);
  /** The wave "Test map" starts at (1 a normal run): the run gets the gold and research of the waves before */
  readonly testFromWave = signal(1);
  /** The bot's check of the open map: running (no result yet) or done; it plays in this window (AppScreen.trial) */
  readonly botTrial = computed<{ waves: number; result: MapTrialResult | null } | null>(() => {
    const trial = this.screens.trial();
    this.host.meta();
    return trial?.bot != null && this.host.isOpen(trial.mapId) ? { waves: trial.bot, result: trial.result } : null;
  });
  /** The map and document state the build areas were judged on */
  private judgedOf = { map: 0, state: -1 };
  /** Counts the maps opened: a judgement of the map before is dropped */
  private map = 0;
  private buildAreaTimer: ReturnType<typeof setTimeout> | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private judging = false;
  private disposed = false;

  constructor(
    private readonly host: CheckHost,
    private readonly settings: EditorSettings,
    private readonly view: ViewHost,
    private readonly screens: AppScreen,
    private readonly worlds: WorldSession,
  ) {}

  /** Another map is open: its build areas are judged anew, a judgement under way is dropped */
  opened(): void {
    this.issues.set(null);
    this.map++;
    this.judgedOf = { map: -1, state: -1 };
    this.buildAreas.set(null);
    this.show();
    this.scheduleBuildAreas(0);
  }

  /** The map changed: an open check and the build areas follow once it rests */
  changed(): void {
    if (this.issues()) this.scheduleCheck();
    this.scheduleBuildAreas();
  }

  /** A new view: the build areas on its ground */
  show(): void {
    this.view.showBuildAreas(this.settings.view().buildAreas ? this.buildAreas() : null);
  }

  /** The check's findings without showing them (an AI agent's script reports them itself); of `doc` for a dry run */
  checkIssues(doc: CustomMapDocument | null = this.host.editor?.doc ?? null): MapIssue[] {
    if (!doc) return [];
    const catalog = this.host.catalog();
    return validateMap(doc, {
      blocksBuild: (asset) => catalog.object(asset).blocksBuild,
      roadThrough: (asset) => !!catalog.object(asset).roadThrough,
      footingOf: (asset) => catalog.object(asset).footing,
      buildAreas: this.buildAreas(),
      costOf: assetCosts(catalog, doc),
    });
  }

  runCheck(): MapIssue[] {
    if (!this.host.editor) return [];
    const issues = this.checkIssues();
    this.issues.set(issues);
    // The room for towers comes from a worker: judged once the check is open, the check runs again with it
    this.scheduleBuildAreas(this.buildAreas() ? BUILD_AREA_DELAY_MS : 0);
    return issues;
  }

  /** The overlay "Build areas" (Measure) on or off */
  setBuildAreaOverlay(on: boolean): void {
    patch(this.settings.view, { buildAreas: on });
    this.show();
    this.scheduleBuildAreas(0);
  }

  /**
   * The game's bot plays the first waves of this map at high speed, in this
   * window (WorldStart.trial); its result comes back to AppScreen.trial and
   * shows in the check once the editor is back
   */
  botCheck(waves = BOT_CHECK_WAVES): Promise<void> {
    return this.trial('The bot check', waves);
  }

  /**
   * Saves, then plays this map in the game in this window, from wave
   * `testFromWave` on when that is past 1 (WorldStart.startWave). The editor
   * waits with the map and its history; "Back to the editor" in the game
   * comes back to them. The test is never saved.
   */
  testPlay(): Promise<void> {
    return this.trial('The test', null);
  }

  dispose(): void {
    this.disposed = true;
    if (this.buildAreaTimer) clearTimeout(this.buildAreaTimer);
    if (this.checkTimer) clearTimeout(this.checkTimer);
  }

  private async trial(what: string, bot: number | null): Promise<void> {
    const doc = this.host.editor?.doc;
    if (!doc || this.host.blocked(what)) return;
    if (!(await this.host.save(true))) return;
    const mapId = doc.meta.id;
    this.screens.trial.set({ mapId, bot, result: null });
    // A Start as from the worlds: it loads, the game shows once it stands, Esc there comes back here
    this.worlds.open({
      ...PLAIN_START,
      world: { kind: 'custom-map', mapId, contentHash: '' },
      startWave: bot === null ? this.testFromWave() : 1,
      trial: { bot },
      play: true,
      label: doc.meta.name,
    });
  }

  /**
   * The open check again CHECK_DELAY_MS after the last change and once a
   * stroke or drag is over: it walks the whole map (a big OSM world 120 ms)
   */
  private scheduleCheck(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      if (this.disposed || !this.issues()) return;
      if (this.view.dragging) this.scheduleCheck();
      else this.runCheck();
    }, CHECK_DELAY_MS);
  }

  /**
   * Judge the build areas again BUILD_AREA_DELAY_MS after the last change,
   * while the overlay or the check shows them and the map is not the one
   * judged; one worker at a time, a change meanwhile judges again after it
   */
  private scheduleBuildAreas(delay = BUILD_AREA_DELAY_MS): void {
    const editor = this.host.editor;
    if (!editor || this.disposed || !(this.settings.view().buildAreas || this.issues() !== null)) return;
    if (this.judgedOf.map === this.map && this.judgedOf.state === editor.stateId) return;
    if (this.buildAreaTimer) clearTimeout(this.buildAreaTimer);
    this.buildAreaTimer = setTimeout(() => void this.judgeBuildAreas(), delay);
  }

  private async judgeBuildAreas(): Promise<void> {
    this.buildAreaTimer = null;
    const editor = this.host.editor;
    if (!editor || this.judging) return;
    const of = { map: this.map, state: editor.stateId };
    const doc = editor.doc;
    const routes = spawnRoutes(doc);
    const catalog = this.host.catalog();
    const input = buildAreaInput(doc, (asset) => catalog.object(asset), doc.spawns.map((s) => ({
      spawnId: s.id, name: s.name, points: routes.get(s.id)?.points ?? null,
    })));
    this.judging = true;
    try {
      const areas = await buildAreasOffThread(input);
      if (of.map !== this.map || this.disposed) return;
      this.judgedOf = of;
      this.buildAreas.set(areas);
      this.show();
      if (this.issues()) this.runCheck();
    } catch (e) {
      console.warn('[Editor] build areas not judged:', e);
    } finally {
      this.judging = false;
    }
    this.scheduleBuildAreas();
  }
}
