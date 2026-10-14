/**
 * The open editor's side of the AI agent's tools (docs/AGENT_MCP.md). The
 * desktop app's MCP server (desktop/src/agent-mcp.js) hands each call over
 * the preload; this answers it against the map open in the editor: reads,
 * the check, a top-down picture, scripts and a few direct edits. Every
 * change is one undo step whose label starts with AGENT_LABEL, and shows in
 * the view as it happens. Other maps are only read or copied, never changed.
 */
import type { AgentAnswer, AgentCall } from '../../core/desktop-bridge';
import type { CatalogIndex } from '../catalog/asset-catalog';
import { ObjectsCommand, SnapshotCommand, type EditCommand, type EditorDocument } from '../model/editor-document';
import { ObjectIds, rockShape, settled } from '../ops/object-ops';
import type { MapIssue } from '../validation/map-validation';
import { validateMapDocument } from '../../world/custom-map/map-file';
import type { MapStore } from '../../world/custom-map/map-store';
import type { CustomMapDocument, MapObject } from '../../world/custom-map/map-document';
import { catalogAsData, heightsIn, issuesAsData, mapSummary, objectsIn, type MapRect } from './agent-reads';
import { checkEnvironment, scriptReference, type ScriptRunResult } from './map-script';
import { playCommands, type PlayResult } from './script-playback';

/** Every step the agent makes starts with this in the history */
export const AGENT_LABEL = 'Agent: ';

/** Longest side of a top-down picture */
export const MAX_PICTURE = 1024;

/** What the agent needs of the editor (EditorSession) */
export interface AgentHost {
  readonly editor: EditorDocument | null;
  readonly store: MapStore;
  catalog(): CatalogIndex;
  /** Why the map cannot change now, or null */
  busyReason(): string | null;
  /** The check, shown to the player too */
  runCheck(): MapIssue[];
  /** The check without showing it */
  checkIssues(): MapIssue[];
  execute(command: EditCommand): void;
  undo(): void;
  /** An edit that plays over a while, as one undo step; the map goes back when `play` throws */
  agentEdit<T>(label: string, play: (editor: EditorDocument, signal: AbortSignal, progress: (share: number) => void) => Promise<T>): Promise<T>;
  /** The map from above as a JPEG data URL, or null without a view */
  topDownPicture(size: number): Promise<string | null>;
  flash(message: string): void;
}

/** Runs a script in the sandbox (script-sandbox.ts); tests run it in-process */
export type ScriptSandbox = (source: string, doc: CustomMapDocument, catalog: CatalogIndex, seed: number) => Promise<ScriptRunResult>;

class AgentError extends Error {
  override name = 'AgentError';
}

type Args = Record<string, unknown>;

const num = (args: Args, key: string, fallback?: number): number => {
  const v = args[key] ?? fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new AgentError(`${key} must be a number`);
  return v;
};
const optNum = (args: Args, key: string): number | undefined => (args[key] === undefined ? undefined : num(args, key));
const text = (args: Args, key: string): string => {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) throw new AgentError(`${key} must be text`);
  return v;
};
const rectOf = (args: Args): MapRect | undefined =>
  ['x0', 'y0', 'x1', 'y1'].every((k) => typeof args[k] === 'number') ? { x0: num(args, 'x0'), y0: num(args, 'y0'), x1: num(args, 'x1'), y1: num(args, 'y1') } : undefined;

const json = (data: unknown): AgentAnswer => ({ text: JSON.stringify(data) });

export class EditorAgent {
  /** The last other map read, kept for the next read of it */
  private otherMap: { id: string; doc: CustomMapDocument } | null = null;

  constructor(
    private readonly host: AgentHost,
    private readonly sandbox: ScriptSandbox,
  ) {}

  /** Answers one call; an error becomes an answer marked as one */
  async handle(call: AgentCall): Promise<AgentAnswer> {
    try {
      return await this.dispatch(call.tool, call.args ?? {});
    } catch (e) {
      return { text: (e as Error).message || String(e), isError: true };
    }
  }

  private async dispatch(tool: string, args: Args): Promise<AgentAnswer> {
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
        return json(catalogAsData(this.host.catalog(), { category: args['category'] as string | undefined, tag: args['tag'] as string | undefined, search: args['search'] as string | undefined }));
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
      case 'run_script':
        return this.runScript(args);
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
      case 'undo_last':
        return this.undoLast();
      default:
        throw new AgentError(`The editor knows no tool ${tool}`);
    }
  }

  // ------------------------------------------------------------------ reading

  private editorOrThrow(): EditorDocument {
    const editor = this.host.editor;
    if (!editor) throw new AgentError('No map is open in the editor. Ask the player to open one (Map editor, then a map), or copy one with copy_map.');
    return editor;
  }

  private doc(): CustomMapDocument {
    return this.editorOrThrow().doc;
  }

  private withMap<T>(read: () => T): T {
    this.editorOrThrow();
    return read();
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
    return { text: JSON.stringify({ size, covers: { x0: -t.width / 2, y0: -t.depth / 2, x1: t.width / 2, y1: t.depth / 2 }, north: 'up' }), image: { mimeType, data } };
  }

  private async listMaps(): Promise<AgentAnswer> {
    const [own, shipped] = await Promise.all([this.host.store.listOwn(), this.host.store.listShipped()]);
    const open = this.host.editor?.doc.meta.id ?? null;
    const row = (m: (typeof own)[number]) => ({ id: m.id, name: m.name, origin: m.origin, width: m.width, depth: m.depth, spawns: m.spawns, objects: m.objects, ...(m.id === open ? { open: true } : {}) });
    return json({ open, maps: [...own.map(row), ...shipped.map(row)], note: 'Only the open map can be changed; any map can be read (read_map) or copied as a new own map (copy_map).' });
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
    const name = typeof args['name'] === 'string' && args['name'].trim() ? args['name'].trim().slice(0, 80) : undefined;
    const copy = await this.host.store.duplicate(id, name);
    this.host.flash(`${AGENT_LABEL}copied ${id} as ${copy.doc.meta.name}`);
    return json({ id: copy.doc.meta.id, name: copy.doc.meta.name, note: 'A new own map. The editor keeps the open map; the player opens the copy to let you edit it.' });
  }

  // ------------------------------------------------------------------ changing

  private changeableEditor(): EditorDocument {
    const editor = this.editorOrThrow();
    const busy = this.host.busyReason();
    if (busy) throw new AgentError(`The map cannot change now: ${busy}`);
    return editor;
  }

  private async runScript(args: Args): Promise<AgentAnswer> {
    const source = text(args, 'source');
    const label = `${AGENT_LABEL}${typeof args['label'] === 'string' && args['label'].trim() ? args['label'].trim().slice(0, 60) : 'script'}`;
    const seed = Math.trunc(optNum(args, 'seed') ?? 1);
    const editor = this.changeableEditor();
    const opened = editor.doc;
    const catalog = this.host.catalog();
    const result = await this.sandbox(source, structuredClone(opened), catalog, seed);
    if (!result.ok) return { text: JSON.stringify({ ok: false, error: result.error, logs: result.logs }), isError: true };
    if (!result.commands.length) return json({ ok: true, changed: false, logs: result.logs, value: result.value });
    // The map may have changed while the script ran (the player): play on what is there now
    if (this.host.editor !== editor || editor.doc !== opened) throw new AgentError('The editor opened another map while the script ran; nothing changed');
    this.host.flash(`${label}: ${result.commands.length} commands`);
    const played: PlayResult = await this.host.agentEdit(label, (ed, signal, progress) =>
      playCommands(ed, catalog, result.commands, seed, { animate: args['animate'] !== false, signal, onProgress: progress }),
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

  /** One direct edit as one undo step; the map file must still take it */
  private commit(command: EditCommand, done: string): AgentAnswer {
    const editor = this.changeableEditor();
    this.host.execute(command);
    const problems = validateMapDocument(editor.doc);
    if (problems.length) {
      this.host.undo();
      throw new AgentError(`Not done, the map would not save: ${problems.slice(0, 3).join('; ')}`);
    }
    return json({ ok: true, step: command.label, done });
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
    if (!catalog.objects.has(asset)) throw new AgentError(`There is no asset ${asset}; the catalog tool lists them`);
    num(args, 'x');
    num(args, 'y');
    let object: MapObject = { id: new ObjectIds(doc.objects).take(), asset, x: 0, y: 0, z: 0, rotation: 0, scale: 1, ...this.placement(args) };
    const rock = rockShape(catalog.object(asset));
    if (rock) object = settled(doc.terrain, object, rock);
    return this.commit(ObjectsCommand.add(`${AGENT_LABEL}place ${asset}`, doc, [object]), `${object.id} placed`);
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
    if (missing.length) throw new AgentError(`There are no objects ${missing.slice(0, 10).join(', ')}`);
    return this.commit(ObjectsCommand.remove(`${AGENT_LABEL}delete ${ids.length} objects`, doc, ids as string[]), `${ids.length} deleted`);
  }

  private setRules(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const rules = args['rules'];
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw new AgentError('rules must be an object');
    return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}rules`, ['gameplay'], (d) => (d.gameplay = { ...(d.gameplay ?? {}), ...(rules as object) })), 'rules set');
  }

  private setSky(args: Args): AgentAnswer {
    const doc = this.changeableEditor().doc;
    const patch = args['environment'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new AgentError('environment must be an object');
    const checked = checkEnvironment(patch as Record<string, unknown>);
    return this.commit(SnapshotCommand.record(doc, `${AGENT_LABEL}sky`, ['environment'], (d) => (d.environment = { ...d.environment, ...checked })), 'environment set');
  }

  private undoLast(): AgentAnswer {
    const editor = this.changeableEditor();
    const last = editor.undoLabel;
    if (!last?.startsWith(AGENT_LABEL)) throw new AgentError(`The last step is not the agent's (${last ?? 'none'}); only the player undoes it`);
    this.host.undo();
    return json({ ok: true, undone: last });
  }
}
