/**
 * The open editor's side of the AI agent's tools (docs/AGENT_MCP.md). The
 * desktop app's MCP server (desktop/src/agent-mcp.js) hands each call over
 * the preload; this answers it against the map open in the editor: reads,
 * the check, a top-down picture, scripts, the editor's map operations
 * (erosion of the whole map, size, detail, heightmap, stamps, versions) and
 * direct edits, and it opens, creates and closes maps as a player would.
 * Every change is one undo step whose label starts with AGENT_LABEL, and
 * shows in the view as it happens. Every change can run as a dry run first:
 * on a copy of the map, answered with what it would change. Other maps are
 * only read or copied, never changed; a shipped map opens as an own copy.
 */
import type { AgentAnswer, AgentCall } from '../../core/desktop-bridge';
import type { CatalogIndex } from '../catalog/asset-catalog';
import { EditorDocument, ObjectsCommand, SnapshotCommand, type EditCommand } from '../model/editor-document';
import type { MapVersion } from '../model/version-store';
import type { SavedStamp, StampKeep } from '../model/stamp-store';
import { ObjectIds, levelForBuildings, rockShape, settled, withGround } from '../ops/object-ops';
import { resizeMap } from '../ops/resize';
import { detailTarget, increaseMapDetail } from '../ops/detail';
import { decodePng, decodeRaw16, imageToHeights } from '../ops/heightmap';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { MAP_TEMPLATES } from '../ops/landscape/templates';
import { TERRAIN_PRESETS, type TerrainPreset } from '../ops/generate';
import { ALL_PARTS, capturePrefab, captureStamp, pasteStamp, type Stamp, type StampParts, type StampRect } from '../ops/stamp';
import { erodeJob, startTerrainJob } from '../workers/terrain-job';
import type { MapIssue } from '../validation/map-validation';
import { validateMapDocument } from '../../world/custom-map/map-file';
import type { MapStore } from '../../world/custom-map/map-store';
import { MAX_MAP_PREFABS, type CustomMapDocument, type MapObject } from '../../world/custom-map/map-document';
import { catalogAsData, contentFingerprint, heightsIn, issuesAsData, mapDiff, mapSummary, objectsIn, type MapRect } from './agent-reads';
import { ASSET_OPS, checkEnvironment, checkRules, scriptReference, type ScriptRunResult } from './map-script';
import { playCommands, type PlayResult } from './script-playback';

/** Every step the agent makes starts with this in the history */
export const AGENT_LABEL = 'Agent: ';

/** Longest side of a top-down picture */
export const MAX_PICTURE = 1024;

/** Extent of a map the agent creates or resizes to, metres (the Map panel's limits) */
export const MAP_SIDE = { min: 64, max: 8192, default: 1024 };

/** What every call says after the player pressed Stop in the agent band */
export const STOPPED = 'The player pressed Stop in the editor; nothing more of this call is kept. Stop working and wait until the player asks you to go on.';

/** A new map as the agent asks for it */
export interface AgentNewMap {
  name: string;
  width: number;
  depth: number;
  /** A map template (MAP_TEMPLATES): biome, terrain and sky at once */
  template?: string;
  /** Otherwise a terrain preset with its seed and strength */
  preset?: TerrainPreset;
  seed: number;
  strength: number;
}

/** What the agent needs of the editor (EditorSession) */
export interface AgentHost {
  readonly editor: EditorDocument | null;
  readonly store: MapStore;
  catalog(): CatalogIndex;
  /** Why the map cannot change now, or null */
  busyReason(): string | null;
  /** The check, shown to the player too */
  runCheck(): MapIssue[];
  /** The check of the open map (or of `doc`) without showing it */
  checkIssues(doc?: CustomMapDocument): MapIssue[];
  execute(command: EditCommand): void;
  undo(): void;
  /** The panels read the document again (after a stroke that landed on its own) */
  refresh(): void;
  /** An edit that plays over a while, as one undo step; the map goes back when `play` throws */
  agentEdit<T>(label: string, play: (editor: EditorDocument, signal: AbortSignal, progress: (share: number) => void) => Promise<T>): Promise<T>;
  /** Erosion of the whole map in the terrain worker as one undo step named `label`; false when it was stopped */
  erodeWholeMap(strength: number, seed: number, label: string): Promise<boolean>;
  /** Stops a job of the agent's that is running (a script playing, the erosion) */
  cancelAgentJob(): void;
  /** The map changed its size: the view frames it anew */
  mapReshaped(): void;
  /** The map from above as a JPEG data URL, or null without a view */
  topDownPicture(size: number): Promise<string | null>;
  flash(message: string): void;
  /** Opens a map as the player would (an own copy of a shipped one); resolves the id that opened */
  openMap(id: string): Promise<string>;
  /** Makes a new own map and opens it; resolves its id */
  createMap(options: AgentNewMap): Promise<string>;
  /** Saves the open map and goes back to the map list; false when it could not be saved (it stays open) */
  closeMap(): Promise<boolean>;
  save(manual: boolean): Promise<boolean>;
  /** The open map's kept versions, newest first, and one of them as a map */
  versions(): MapVersion[];
  versionDoc(version: MapVersion): Promise<CustomMapDocument>;
  savedStamps(): Promise<SavedStamp[]>;
  /** Keeps a piece in the library (every map) or in the open map's file; null when the map keeps no more */
  saveStamp(name: string, stamp: Stamp, region: StampRect | null, keep?: StampKeep): Promise<SavedStamp | null>;
}

/** Runs a script in the sandbox (script-sandbox.ts); tests run it in-process */
export type ScriptSandbox = (source: string, doc: CustomMapDocument, catalog: CatalogIndex, seed: number, signal?: AbortSignal) => Promise<ScriptRunResult>;

/** What every call that needs materials or objects says when the catalogue did not load */
const NO_CATALOG =
  'The asset catalogue did not load (maps/assets/catalog.json was not reachable), so no material, object or landscape biome can be used. ' +
  'Shaping the ground, water, roads, spawns, the HQ, sky and rules still work. Ask the player to check the map data download and reopen the editor.';

/** The tools that change the open map; each takes `dry_run` */
export const DRY_RUN_TOOLS: ReadonlySet<string> = new Set([
  'run_script',
  'move_marker',
  'place_object',
  'move_object',
  'delete_objects',
  'set_rules',
  'set_sky',
  'set_map_info',
  'erode_map',
  'resize_map',
  'increase_detail',
  'import_heightmap',
  'paste_stamp',
  'restore_version',
]);

class AgentError extends Error {
  override name = 'AgentError';
}

type Args = Record<string, unknown>;

const num = (args: Args, key: string, fallback?: number): number => {
  const v = args[key] ?? fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AgentError(`${key} must be a number`);
  return v;
};
const optNum = (args: Args, key: string): number | undefined => (args[key] === undefined || args[key] === null ? undefined : num(args, key));
const text = (args: Args, key: string): string => {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new AgentError(`${key} must be text`);
  return v;
};
const optText = (args: Args, key: string): string | undefined => (typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : undefined);
const rectOf = (args: Args): MapRect | undefined =>
  ['x0', 'y0', 'x1', 'y1'].every((k) => typeof args[k] === 'number') ? { x0: num(args, 'x0'), y0: num(args, 'y0'), x1: num(args, 'x1'), y1: num(args, 'y1') } : undefined;

const json = (data: unknown): AgentAnswer => ({ text: JSON.stringify(data) });

export class EditorAgent {
  /** The last other map read, kept for the next read of it */
  private otherMap: { id: string; doc: CustomMapDocument } | null = null;
  /** Ends what runs when the player presses Stop; a new one for the calls after */
  private stopping = new AbortController();

  constructor(
    private readonly host: AgentHost,
    private readonly sandbox: ScriptSandbox,
  ) {}

  /** Answers one call; an error becomes an answer marked as one */
  async handle(call: AgentCall): Promise<AgentAnswer> {
    const signal = this.stopping.signal;
    try {
      const args = call.args ?? {};
      if (args['dry_run'] === true && DRY_RUN_TOOLS.has(call.tool)) return await this.dryRun(call.tool, args);
      const answer = await this.dispatch(call.tool, args, signal);
      if (signal.aborted) return { text: STOPPED, isError: true };
      return answer;
    } catch (e) {
      if (signal.aborted) return { text: STOPPED, isError: true };
      return { text: (e as Error).message || String(e), isError: true };
    }
  }

  /**
   * The player pressed Stop: what runs now ends (a script still in the
   * sandbox, a play, the erosion) and the map goes back to how it was
   * before that call; the main process refuses the calls after
   */
  stop(): void {
    this.stopping.abort();
    this.stopping = new AbortController();
    this.host.cancelAgentJob();
  }

  private async dispatch(tool: string, args: Args, signal: AbortSignal): Promise<AgentAnswer> {
    switch (tool) {
      case 'map_summary':
        return json({ open: true, ...mapSummary(this.doc(), this.host.catalog()), history: this.history() });
      case 'map_heights': {
        const rect = rectOf(args);
        if (!rect) throw new AgentError('x0, y0, x1, y1 must be numbers');
        return json(heightsIn(this.doc(), rect, optNum(args, 'samples')));
      }
      case 'map_objects':
        return json(objectsIn(this.doc(), rectOf(args), typeof args['asset'] === 'string' ? args['asset'] : undefined));
      case 'check_map':
        return json(issuesAsData(this.withMap(() => this.host.runCheck())));
      case 'catalog':
        return json(catalogAsData(this.loadedCatalog(), { category: args['category'] as string | undefined, tag: args['tag'] as string | undefined, search: args['search'] as string | undefined }));
      case 'script_api':
        return { text: scriptReference() };
      case 'top_down_picture':
        return this.picture(args);
      case 'list_maps':
        return this.listMaps();
      case 'read_map':
        return this.readMap(args);
      case 'copy_map':
        return this.copyMap(args);
      case 'open_map':
        return this.openMap(args);
      case 'create_map':
        return this.createMap(args);
      case 'close_map':
        return this.closeMap();
      case 'save_map':
        return this.saveMap();
      case 'run_script':
        return this.runScript(args, signal);
      case 'move_marker':
        return this.moveMarker(args);
      case 'place_object':
        return this.placeObject(args);
      case 'move_object':
        return this.moveObject(args);
      case 'delete_objects':
        return this.deleteObjects(args);
      case 'set_rules':
        return this.setRules(args);
      case 'set_sky':
        return this.setSky(args);
      case 'set_map_info':
        return this.setMapInfo(args);
      case 'erode_map':
        return this.erodeMap(args);
      case 'resize_map':
        return this.resizeMap(args);
      case 'increase_detail':
        return this.increaseDetail();
      case 'import_heightmap':
        return this.importHeightmap(args);
      case 'list_stamps':
        return this.listStamps();
      case 'save_stamp':
        return this.saveStamp(args);
      case 'paste_stamp':
        return this.pasteStamp(args);
      case 'list_versions':
        return this.listVersions();
      case 'restore_version':
        return this.restoreVersion(args);
      case 'undo_last':
        return this.undoLast();
      default:
        throw new AgentError(`The editor knows no tool ${tool}`);
    }
  }

  /**
   * A changing call on a copy of the open map: the same code as the real
   * call, against a host whose editor holds the copy (DryHost). Answers
   * what the call would have answered, what it would change and the check
   * of the copy; the open map, its history and the view stay as they are
   */
  private async dryRun(tool: string, args: Args): Promise<AgentAnswer> {
    const editor = this.editorOrThrow();
    const busy = this.host.busyReason();
    if (busy) throw new AgentError(`The map cannot change now: ${busy}`);
    const dry = new DryHost(this.host, editor.doc);
    const answer = await new EditorAgent(dry, this.sandbox).dispatch(tool, { ...args, dry_run: false, animate: false }, this.stopping.signal);
    let would: unknown = answer.text;
    try {
      would = JSON.parse(answer.text);
    } catch {
      // A plain sentence stays one
    }
    const issues = issuesAsData(dry.checkIssues());
    return {
      text: JSON.stringify({
        dryRun: true,
        ok: !answer.isError,
        note: 'Ran on a copy of the map; the map, its history and the view are unchanged',
        answer: would,
        ...(answer.isError ? {} : { changes: mapDiff(editor.doc, dry.editor.doc), check: { errors: issues.errors, warnings: issues.warnings, first: issues.issues.slice(0, 5) } }),
      }),
      ...(answer.isError ? { isError: true } : {}),
    };
  }

  // ------------------------------------------------------------------ reading

  private editorOrThrow(): EditorDocument {
    const editor = this.host.editor;
    if (!editor) throw new AgentError('No map is open in the editor. Open one with open_map (list_maps lists them) or make one with create_map.');
    return editor;
  }

  private doc(): CustomMapDocument {
    return this.editorOrThrow().doc;
  }

  private withMap<T>(read: () => T): T {
    this.editorOrThrow();
    return read();
  }

  /** The asset catalogue, or an error saying it did not load (an unreachable one is empty) */
  private loadedCatalog(): CatalogIndex {
    const catalog = this.host.catalog();
    if (!catalog.loaded) throw new AgentError(NO_CATALOG);
    return catalog;
  }

  private history(): { steps: number; last: string | null } {
    const editor = this.editorOrThrow();
    return { steps: editor.historySteps, last: editor.undoLabel };
  }

  private async picture(args: Args): Promise<AgentAnswer> {
    this.editorOrThrow();
    const size = Math.round(Math.min(MAX_PICTURE, Math.max(128, optNum(args, 'size') ?? 512)));
    const url = await this.host.topDownPicture(size);
    if (!url) throw new AgentError('The editor shows no view right now; nothing to picture');
    const [head, data] = url.split(',');
    const mimeType = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
    const t = this.doc().terrain;
    return {
      text: JSON.stringify({
        size,
        covers: { x0: -t.width / 2, y0: -t.depth / 2, x1: t.width / 2, y1: t.depth / 2 },
        north: 'up',
        shows: 'the ground with roads, spawns and the HQ drawn over it; relief shaded, light from the north-west',
      }),
      image: { mimeType, data },
    };
  }

  private async listMaps(): Promise<AgentAnswer> {
    const [own, shipped] = await Promise.all([this.host.store.listOwn(), this.host.store.listShipped()]);
    const open = this.host.editor?.doc.meta.id ?? null;
    const row = (m: (typeof own)[number]) => ({ id: m.id, name: m.name, origin: m.origin, width: m.width, depth: m.depth, spawns: m.spawns, objects: m.objects, ...(m.id === open ? { open: true } : {}) });
    return json({
      open,
      maps: [...own.map(row), ...shipped.map(row)],
      note: 'Only the open map can be changed. open_map opens an own map, or a shipped one as a new own copy; any map can be read (read_map) or copied (copy_map).',
    });
  }

  private async otherDoc(id: string): Promise<CustomMapDocument> {
    if (this.host.editor?.doc.meta.id === id) return this.host.editor.doc;
    if (this.otherMap?.id === id) return this.otherMap.doc;
    const loaded = await this.host.store.load(id);
    this.otherMap = { id, doc: loaded.doc };
    return loaded.doc;
  }

  private async readMap(args: Args): Promise<AgentAnswer> {
    const doc = await this.otherDoc(text(args, 'id'));
    const what = args['what'] ?? 'summary';
    if (what === 'summary') return json(mapSummary(doc, this.host.catalog()));
    if (what === 'heights') {
      const rect = rectOf(args) ?? { x0: -doc.terrain.width / 2, y0: -doc.terrain.depth / 2, x1: doc.terrain.width / 2, y1: doc.terrain.depth / 2 };
      return json(heightsIn(doc, rect, optNum(args, 'samples')));
    }
    if (what === 'objects') return json(objectsIn(doc, rectOf(args), typeof args['asset'] === 'string' ? args['asset'] : undefined));
    throw new AgentError('what must be summary, heights or objects');
  }

  private async copyMap(args: Args): Promise<AgentAnswer> {
    const id = text(args, 'id');
    const name = optText(args, 'name')?.slice(0, 80);
    if (args['open'] === true) this.leavable();
    const copy = await this.host.store.duplicate(id, name);
    this.host.flash(`${AGENT_LABEL}copied ${id} as ${copy.doc.meta.name}`);
    if (args['open'] === true) {
      const opened = await this.host.openMap(copy.doc.meta.id);
      return json({ id: opened, name: copy.doc.meta.name, open: true, note: 'A new own map, open in the editor now' });
    }
    return json({ id: copy.doc.meta.id, name: copy.doc.meta.name, note: 'A new own map. The open map stays open; open_map opens the copy.' });
  }

  // ------------------------------------------------------------------ maps

  /** The open map may be left (saved and closed) now, or why not */
  private leavable(): void {
    if (!this.host.editor) return;
    const busy = this.host.busyReason();
    if (busy) throw new AgentError(`The open map cannot be left now: ${busy}`);
  }

  private async openMap(args: Args): Promise<AgentAnswer> {
    const id = text(args, 'id');
    if (this.host.editor?.doc.meta.id === id) return json({ id, open: true, note: 'This map is open already' });
    this.leavable();
    // The map must exist before the open one is left for it
    const shipped = (await this.host.store.listShipped()).some((m) => m.id === id);
    if (!shipped && !(await this.host.store.listOwn()).some((m) => m.id === id)) throw new AgentError(`There is no map ${id}; list_maps lists them`);
    const opened = await this.host.openMap(id);
    const doc = this.doc();
    return json({
      id: opened,
      name: doc.meta.name,
      open: true,
      ...(opened !== id ? { note: `${id} is a shipped map: it opened as your own copy ${opened}; the original stays as it is` } : {}),
    });
  }

  private async createMap(args: Args): Promise<AgentAnswer> {
    const name = text(args, 'name').trim().slice(0, 80);
    const side = (key: string) => {
      const v = Math.round(optNum(args, key) ?? MAP_SIDE.default);
      if (v < MAP_SIDE.min || v > MAP_SIDE.max) throw new AgentError(`${key} must lie in ${MAP_SIDE.min}..${MAP_SIDE.max} metres`);
      return v;
    };
    const template = optText(args, 'template');
    if (template && !MAP_TEMPLATES.some((t) => t.id === template)) throw new AgentError(`There is no template ${template}; templates: ${MAP_TEMPLATES.map((t) => t.id).join(', ')}`);
    const preset = optText(args, 'preset') as TerrainPreset | undefined;
    if (preset && !TERRAIN_PRESETS.some((p) => p.id === preset)) throw new AgentError(`There is no preset ${preset}; presets: ${TERRAIN_PRESETS.map((p) => p.id).join(', ')}`);
    const strength = optNum(args, 'strength') ?? 0.5;
    if (strength < 0 || strength > 1) throw new AgentError('strength must lie in 0..1');
    const options: AgentNewMap = { name, width: side('width'), depth: side('depth'), template, preset: template ? undefined : (preset ?? 'flat'), seed: Math.trunc(optNum(args, 'seed') ?? 1), strength };
    this.leavable();
    const id = await this.host.createMap(options);
    const doc = this.doc();
    return json({ id, name: doc.meta.name, open: true, width: doc.terrain.width, depth: doc.terrain.depth, note: 'A new own map, open in the editor; map_summary shows what it holds (a starter road, a spawn and the HQ)' });
  }

  private async closeMap(): Promise<AgentAnswer> {
    if (!this.host.editor) return json({ ok: true, note: 'No map was open' });
    this.leavable();
    const id = this.doc().meta.id;
    if (!(await this.host.closeMap())) throw new AgentError('The map could not be saved, so it stays open');
    return json({ ok: true, closed: id, note: 'Saved and back at the map list' });
  }

  private async saveMap(): Promise<AgentAnswer> {
    const id = this.doc().meta.id;
    if (!(await this.host.save(true))) throw new AgentError(`Not saved: ${this.host.busyReason() ?? 'the save failed (the editor shows why)'}`);
    return json({ ok: true, saved: id });
  }

  // ------------------------------------------------------------------ changing

  private changeableEditor(): EditorDocument {
    const editor = this.editorOrThrow();
    const busy = this.host.busyReason();
    if (busy) throw new AgentError(`The map cannot change now: ${busy}`);
    return editor;
  }

  private async runScript(args: Args, signal: AbortSignal): Promise<AgentAnswer> {
    const source = text(args, 'source');
    const label = `${AGENT_LABEL}${optText(args, 'label')?.slice(0, 60) ?? 'script'}`;
    const seed = Math.trunc(optNum(args, 'seed') ?? 1);
    const editor = this.changeableEditor();
    const opened = editor.doc;
    const catalog = this.host.catalog();
    const result = await this.sandbox(source, structuredClone(opened), catalog, seed, signal);
    if (signal.aborted) throw new AgentError(STOPPED);
    if (!result.ok) return { text: JSON.stringify({ ok: false, error: result.error, logs: result.logs }), isError: true };
    const needsAssets = [...new Set(result.commands.filter((c) => ASSET_OPS.has(c.op)).map((c) => c.op))];
    if (needsAssets.length && !catalog.loaded) return { text: JSON.stringify({ ok: false, error: `${NO_CATALOG} The script calls ${needsAssets.map((op) => `map.${op}`).join(', ')}.`, logs: result.logs }), isError: true };
    // Commands that end where the map was (a removal of nothing, a stroke undone) make no undo step
    if (!result.commands.length || result.fingerprint === contentFingerprint(opened)) {
      return json({ ok: true, changed: false, commands: result.commands.length, logs: result.logs, value: result.value });
    }
    // The map may have changed while the script ran (the player): play on what is there now
    if (this.host.editor !== editor || editor.doc !== opened) throw new AgentError('The editor opened another map while the script ran; nothing changed');
    this.host.flash(`${label}: ${result.commands.length} commands`);
    const played: PlayResult = await this.host.agentEdit(label, (ed, stop, progress) =>
      playCommands(ed, catalog, result.commands, seed, { animate: args['animate'] !== false, signal: stop, onProgress: progress }),
    );
    const issues = issuesAsData(this.host.checkIssues());
    return json({
      ok: true,
      changed: true,
      step: label,
      commands: result.commands.length,
      playedSteps: played.steps,
      sandboxMs: result.ms,
      // The kit plays the same code with the same seed; a different map would mean the player changed it meanwhile
      sameAsSandbox: played.fingerprint === result.fingerprint,
      check: { errors: issues.errors, warnings: issues.warnings, first: issues.issues.slice(0, 5) },
      logs: result.logs,
      value: result.value,
    });
  }

  /** The map file must still take what an edit made of it; otherwise the edit is undone */
  private keepIfSavable(editor: EditorDocument): void {
    const problems = validateMapDocument(editor.doc);
    if (problems.length) {
      this.host.undo();
      throw new AgentError(`Not done, the map would not save: ${problems.slice(0, 3).join('; ')}`);
    }
  }

  /** One direct edit as one undo step; the map file must still take it */
  private commit(command: EditCommand, done: string): AgentAnswer {
    const editor = this.changeableEditor();
    this.host.execute(command);
    this.keepIfSavable(editor);
    return json({ ok: true, step: command.label, done });
  }

  /** A landscape stroke as one undo step (heightmap, paste): what `edit` changes through it */
  private stroke(label: string, edit: (s: LandscapeStroke) => void): EditorDocument {
    const editor = this.changeableEditor();
    const steps = editor.historySteps;
    const s = new LandscapeStroke(editor, label, 0, this.host.catalog());
    edit(s);
    s.finish();
    this.host.refresh();
    if (editor.historySteps !== steps) this.keepIfSavable(editor);
    return editor;
  }

  private moveMarker(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const target = text(args, 'target');
    const x = num(args, 'x');
    const y = num(args, 'y');
    const half = { x: doc.terrain.width / 2, y: doc.terrain.depth / 2 };
    if (Math.abs(x) > half.x || Math.abs(y) > half.y) throw new AgentError(`(${x}, ${y}) lies outside the map (±${half.x}, ±${half.y})`);
    const at = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
    if (target === 'hq') return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}move HQ`, ['hq'], (d) => (d.hq = at)), `HQ at (${at.x}, ${at.y})`);
    const spawn = doc.spawns.find((s) => s.id === target || s.name === target);
    if (!spawn) throw new AgentError(`There is no spawn ${target}; spawns: ${doc.spawns.map((s) => `${s.id} (${s.name})`).join(', ') || 'none'}`);
    return this.commit(
      SnapshotCommand.record(doc, `${AGENT_LABEL}move ${spawn.name}`, ['spawns'], (d) => (d.spawns = d.spawns.map((s) => (s.id === spawn.id ? { ...s, ...at } : s)))),
      `${spawn.name} at (${at.x}, ${at.y})`,
    );
  }

  private placement(args: Args): Partial<MapObject> {
    const out: Partial<MapObject> = {};
    for (const key of ['x', 'y', 'z', 'rotation', 'scale', 'pitch', 'roll'] as const) {
      const v = optNum(args, key);
      if (v !== undefined) out[key] = Math.round(v * 1000) / 1000;
    }
    if (out.scale !== undefined && out.scale <= 0) throw new AgentError('scale must be above 0');
    for (const key of ['blocksBuild', 'blocksLos'] as const) if (typeof args[key] === 'boolean') out[key] = args[key] as boolean;
    if (typeof args['tint'] === 'string') out.tint = args['tint'];
    return out;
  }

  private placeObject(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const catalog = this.host.catalog();
    const asset = text(args, 'asset');
    if (!catalog.loaded) throw new AgentError(NO_CATALOG);
    if (!catalog.objects.has(asset)) throw new AgentError(`There is ${catalog.unknown('asset', asset)}`);
    num(args, 'x');
    num(args, 'y');
    let object: MapObject = { id: new ObjectIds(doc.objects).take(), asset, x: 0, y: 0, z: 0, rotation: 0, scale: 1, ...this.placement(args) };
    const rock = rockShape(catalog.object(asset));
    const label = `${AGENT_LABEL}place ${asset}`;
    // A building levels its ground first, in the same step, as in the editor
    const ground = levelForBuildings(doc, label, [object], catalog.object(asset));
    if (rock) object = settled(doc.terrain, object, rock);
    return this.commit(withGround(label, ground, ObjectsCommand.add(label, doc, [object])), `${object.id} placed`);
  }

  private moveObject(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const id = text(args, 'id');
    const object = doc.objects.find((o) => o.id === id);
    if (!object) throw new AgentError(`There is no object ${id}`);
    const patch = this.placement(args);
    return this.commit(ObjectsCommand.change(`${AGENT_LABEL}move ${object.asset}`, doc, [id], (o) => ({ ...o, ...patch })), `${id} changed`);
  }

  private deleteObjects(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const ids = args['ids'];
    if (!Array.isArray(ids) || !ids.length || ids.some((i) => typeof i !== 'string')) throw new AgentError('ids must be a list of object ids');
    const known = new Set(doc.objects.map((o) => o.id));
    const missing = (ids as string[]).filter((i) => !known.has(i));
    if (missing.length) {
      const roads = missing.filter((i) => doc.paths.edges.some((e) => e.id === i));
      const hint = roads.length ? `; ${roads.join(', ')} ${roads.length > 1 ? 'are roads' : 'is a road'}: run_script with map.removeRoads([...]) deletes roads` : '; map_objects lists them';
      throw new AgentError(`There are no objects ${missing.slice(0, 10).join(', ')}${hint}`);
    }
    return this.commit(ObjectsCommand.remove(`${AGENT_LABEL}delete ${ids.length} objects`, doc, ids as string[]), `${ids.length} deleted`);
  }

  private setRules(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const rules = args['rules'];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new AgentError('rules must be an object');
    const checked = checkRules(rules as Record<string, unknown>);
    return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}rules`, ['gameplay'], (d) => (d.gameplay = { ...(d.gameplay ?? {}), ...checked })), 'rules set');
  }

  private setSky(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const patch = args['environment'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AgentError('environment must be an object');
    const checked = checkEnvironment(patch as Record<string, unknown>);
    return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}sky`, ['environment'], (d) => (d.environment = { ...d.environment, ...checked })), 'environment set');
  }

  private setMapInfo(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const patch: { name?: string; description?: string } = {};
    if (args['name'] !== undefined) patch.name = text(args, 'name').trim().slice(0, 80);
    if (typeof args['description'] === 'string') patch.description = args['description'].trim().slice(0, 500);
    if (!Object.keys(patch).length) throw new AgentError('Give a name, a description or both');
    return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}map details`, ['meta'], (d) => (d.meta = { ...d.meta, ...patch })), `map details set (id ${doc.meta.id} stays)`);
  }

  private async erodeMap(args: Args): Promise<AgentAnswer> {
    const strength = num(args, 'strength', 0.5);
    if (strength < 0 || strength > 1) throw new AgentError('strength must lie in 0..1');
    const seed = Math.trunc(optNum(args, 'seed') ?? 1);
    this.changeableEditor();
    const label = `${AGENT_LABEL}erode the map`;
    if (!(await this.host.erodeWholeMap(strength, seed, label))) throw new AgentError('The erosion was stopped; the map is as it was');
    return json({ ok: true, step: label, done: `the whole map eroded at strength ${strength}, seed ${seed}` });
  }

  private resizeMap(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const side = (key: string) => {
      const v = Math.round(num(args, key));
      if (v < MAP_SIDE.min || v > MAP_SIDE.max) throw new AgentError(`${key} must lie in ${MAP_SIDE.min}..${MAP_SIDE.max} metres`);
      return v;
    };
    const width = side('width');
    const depth = side('depth');
    let dropped = { droppedObjects: 0, droppedNodes: 0 };
    const answer = this.commit(
      SnapshotCommand.record(doc, `${AGENT_LABEL}resize the map`, ['terrain', 'objects', 'paths', 'spawns', 'hq'], (d) => (dropped = resizeMap(d, width, depth))),
      `${doc.terrain.width} x ${doc.terrain.depth} m around the centre; ${dropped.droppedObjects} objects and ${dropped.droppedNodes} road nodes fell outside`,
    );
    this.host.mapReshaped();
    return answer;
  }

  private increaseDetail(): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const target = detailTarget(doc.terrain);
    if (!target) throw new AgentError(`The ground has the detail of new maps already (height points every ${doc.terrain.grid.cellSize} m)`);
    return this.commit(
      SnapshotCommand.record(doc, `${AGENT_LABEL}increase detail`, ['terrain', 'paths'], (d) => increaseMapDetail(d, target)),
      `height points every ${+target.cellSize.toFixed(2)} m, ground paint ${target.splatResolution} px`,
    );
  }

  private importHeightmap(args: Args): AgentAnswer {
    const data = text(args, 'data').replace(/^data:[^,]*,/, '');
    const format = args['format'] === 'raw' ? 'raw' : 'png';
    const low = num(args, 'low');
    const high = num(args, 'high');
    if (Math.abs(high - low) > 10000) throw new AgentError('low and high may lie at most 10 km apart');
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      throw new AgentError('data must be the file in base64');
    }
    let image: ReturnType<typeof decodePng>;
    try {
      image = format === 'png' ? decodePng(bytes) : decodeRaw16(bytes);
    } catch (e) {
      throw new AgentError(`Not a heightmap: ${(e as Error).message}`);
    }
    const label = `${AGENT_LABEL}import heightmap`;
    const editor = this.stroke(label, (s) => {
      const g = s.doc.terrain.grid;
      const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
      s.touchHeights(all);
      g.heights.set(imageToHeights(image, g.columns, g.rows, low, high));
      s.changed({ heights: all });
    });
    const g = editor.doc.terrain.grid;
    return json({ ok: true, step: label, done: `${image.width} x ${image.height} on the ${g.columns} x ${g.rows} grid, black ${low} m, white ${high} m` });
  }

  /** The library's stamps and prefabs and those the open map keeps, the map's first */
  private async stampList(): Promise<{ saved: SavedStamp; keep: StampKeep }[]> {
    const own = (this.host.editor?.doc.prefabs ?? []).map((saved) => ({ saved, keep: 'map' as const }));
    const library = (await this.host.savedStamps()).map((saved) => ({ saved, keep: 'library' as const }));
    return [...own, ...library];
  }

  private async listStamps(): Promise<AgentAnswer> {
    const list = await this.stampList();
    return json({
      stamps: list.map(({ saved: s, keep }) => ({
        id: s.id,
        name: s.name,
        keep,
        prefab: !!s.stamp.prefab,
        createdAt: s.createdAt,
        width: Math.round(s.stamp.width),
        depth: Math.round(s.stamp.depth),
        objects: s.stamp.objects.length,
        roads: s.stamp.roads.edges.length,
        water: !!s.stamp.water,
        ground: (s.stamp.parts ?? ALL_PARTS).heights,
      })),
      note: "paste_stamp places one by id or name; save_stamp keeps a rectangle of any map as a stamp, or objects of the open map by ids as a prefab; keep 'map' keeps it in the open map's file, 'library' for every map",
    });
  }

  private async saveStamp(args: Args): Promise<AgentAnswer> {
    const name = text(args, 'name').trim().slice(0, 60);
    const keep: StampKeep = args['keep'] === 'map' ? 'map' : 'library';
    const ids = Array.isArray(args['ids']) ? (args['ids'] as unknown[]).filter((id): id is string => typeof id === 'string') : null;
    if (ids) {
      // A prefab of objects of the open map, with the ground under them when asked
      const doc = this.doc();
      const missing = ids.filter((id) => !doc.objects.some((o) => o.id === id));
      if (!ids.length || missing.length) throw new AgentError(missing.length ? `There are no objects ${missing.slice(0, 10).join(', ')}; map_objects lists them` : 'ids names no object');
      const catalog = this.host.catalog();
      const taken = capturePrefab(doc, ids, args['ground'] === true, (asset) => catalog.object(asset).radius)!;
      if (!(await this.host.saveStamp(name, taken.stamp, taken.rect, keep))) throw new AgentError(`The map keeps ${MAX_MAP_PREFABS} prefabs at most`);
      return json({ ok: true, saved: name, keep, prefab: true, objects: taken.stamp.objects.length, size: { width: Math.round(taken.stamp.width), depth: Math.round(taken.stamp.depth) } });
    }
    const rect = rectOf(args);
    if (!rect) throw new AgentError('x0, y0, x1, y1 must be numbers (or ids for a prefab of objects)');
    if (Math.abs(rect.x1 - rect.x0) < 4 || Math.abs(rect.y1 - rect.y0) < 4) throw new AgentError('A stamp is at least 4 m a side');
    const from = optText(args, 'from_map');
    const doc = from ? await this.otherDoc(from) : this.doc();
    const onOpenMap = doc === this.host.editor?.doc;
    if (keep === 'map' && !onOpenMap) throw new AgentError("keep 'map' keeps a piece of the open map; a piece of another map goes into the library");
    if (!(await this.host.saveStamp(name, captureStamp(doc, rect), onOpenMap ? rect : null, keep))) throw new AgentError(`The map keeps ${MAX_MAP_PREFABS} prefabs at most`);
    return json({ ok: true, saved: name, keep, from: doc.meta.id, size: { width: Math.round(Math.abs(rect.x1 - rect.x0)), depth: Math.round(Math.abs(rect.y1 - rect.y0)) } });
  }

  private async pasteStamp(args: Args): Promise<AgentAnswer> {
    const x = num(args, 'x');
    const y = num(args, 'y');
    let stamp: Stamp;
    let what: string;
    const from = optText(args, 'from_map');
    const rect = rectOf(args);
    if (from || rect) {
      if (!rect) throw new AgentError('Copying from a map takes x0, y0, x1, y1');
      const doc = from ? await this.otherDoc(from) : this.doc();
      stamp = captureStamp(doc, rect);
      what = `a piece of ${doc.meta.id}`;
    } else {
      const key = text(args, 'stamp');
      const list = (await this.stampList()).map((e) => e.saved);
      const saved = list.find((s) => s.id === key) ?? list.find((s) => s.name === key);
      if (!saved) throw new AgentError(`There is no stamp ${key}; stamps: ${list.map((s) => `${s.id} (${s.name})`).join(', ') || 'none'}`);
      stamp = saved.stamp;
      what = `stamp ${saved.name}`;
    }
    const parts: StampParts = { ...ALL_PARTS };
    const given = args['parts'];
    if (given && typeof given === 'object' && !Array.isArray(given)) {
      for (const [k, v] of Object.entries(given)) {
        if (!(k in ALL_PARTS)) throw new AgentError(`parts knows no ${k}; it has ${Object.keys(ALL_PARTS).join(', ')}`);
        parts[k as keyof StampParts] = v === true;
      }
    }
    const rotation = optNum(args, 'rotation') ?? 0;
    const feather = Math.min(1, Math.max(0, optNum(args, 'feather') ?? 0.25));
    const label = `${AGENT_LABEL}paste`;
    this.stroke(label, (s) => pasteStamp(s, stamp, { x, y }, { parts, rotation, feather }));
    return json({ ok: true, step: label, done: `${what} (${Math.round(stamp.width)} x ${Math.round(stamp.depth)} m) centred on (${x}, ${y})` });
  }

  private listVersions(): AgentAnswer {
    this.editorOrThrow();
    return json({
      versions: this.host.versions().map((v) => ({ id: v.savedAt, savedAt: v.savedAt, manual: v.manual, pinned: !!v.pinned, size: v.size })),
      note: 'Kept saves of the open map, newest first; restore_version puts one back as one undo step',
    });
  }

  private async restoreVersion(args: Args): Promise<AgentAnswer> {
    const id = text(args, 'id');
    const version = this.host.versions().find((v) => v.savedAt === id || v.key === id);
    if (!version) throw new AgentError(`There is no version ${id}; list_versions lists them`);
    const old = await this.host.versionDoc(version);
    const doc = this.changeableEditor().doc;
    const parts = ['terrain', 'objects', 'paths', 'spawns', 'hq', 'environment', 'gameplay'] as const;
    const answer = this.commit(
      SnapshotCommand.record(doc, `${AGENT_LABEL}restore version`, parts, (d) => {
        for (const k of parts) (d as unknown as Record<string, unknown>)[k] = structuredClone(old[k]);
      }),
      `back to the version of ${version.savedAt}`,
    );
    this.host.mapReshaped();
    return answer;
  }

  private undoLast(): AgentAnswer {
    const editor = this.changeableEditor();
    const last = editor.undoLabel;
    if (!last?.startsWith(AGENT_LABEL)) throw new AgentError(`The last step is not the agent's (${last ?? 'none'}); only the player undoes it`);
    this.host.undo();
    return json({ ok: true, undone: last });
  }
}

/**
 * The host of a dry run: a copy of the open map in an editor of its own,
 * no view, nothing saved; reads, the catalogue and stamps come from the
 * real host. Edits land on the copy exactly as on the map.
 */
class DryHost implements AgentHost {
  readonly editor: EditorDocument;

  constructor(
    private readonly real: AgentHost,
    doc: CustomMapDocument,
  ) {
    this.editor = new EditorDocument(structuredClone(doc));
  }

  get store(): MapStore {
    return this.real.store;
  }

  catalog(): CatalogIndex {
    return this.real.catalog();
  }

  busyReason(): string | null {
    return null;
  }

  runCheck(): MapIssue[] {
    return this.checkIssues();
  }

  checkIssues(): MapIssue[] {
    return this.real.checkIssues(this.editor.doc);
  }

  execute(command: EditCommand): void {
    this.editor.execute(command);
  }

  undo(): void {
    this.editor.undo();
  }

  refresh(): void {
    // No panels read the copy
  }

  async agentEdit<T>(label: string, play: (editor: EditorDocument, signal: AbortSignal, progress: (share: number) => void) => Promise<T>): Promise<T> {
    return play(this.editor, new AbortController().signal, () => undefined);
  }

  /** The erosion job on the copy's heights, in its own worker */
  async erodeWholeMap(strength: number, seed: number): Promise<boolean> {
    const g = this.editor.doc.terrain.grid;
    let latest: Float32Array | null = null;
    await startTerrainJob(erodeJob(g, strength, seed), (m) => {
      if (m.kind === 'heights') latest = m.heights;
    });
    if (latest) g.heights.set(latest);
    return true;
  }

  cancelAgentJob(): void {
    // A dry run runs no job of its own to stop
  }

  mapReshaped(): void {
    // No view frames the copy
  }

  async topDownPicture(): Promise<string | null> {
    return null;
  }

  flash(): void {
    // Nobody watches the copy
  }

  openMap(): Promise<string> {
    throw new AgentError('A dry run does not open maps');
  }

  createMap(): Promise<string> {
    throw new AgentError('A dry run does not create maps');
  }

  closeMap(): Promise<boolean> {
    throw new AgentError('A dry run does not close maps');
  }

  async save(): Promise<boolean> {
    return true;
  }

  versions(): MapVersion[] {
    return this.real.versions();
  }

  versionDoc(version: MapVersion): Promise<CustomMapDocument> {
    return this.real.versionDoc(version);
  }

  savedStamps(): Promise<SavedStamp[]> {
    return this.real.savedStamps();
  }

  async saveStamp(): Promise<SavedStamp | null> {
    throw new AgentError('A dry run does not keep stamps');
  }
}
