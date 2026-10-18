/**
 * Edits of the map as a whole or of one of its small parts, the one place
 * for each: the panels (through the session) and the AI agent call the same
 * function and word their own answer. Each returns the step (not done yet:
 * the caller executes it) with what the player is told about it.
 */
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { CustomMapDocument, MapEnvironment, MapGameplay, MapIntro, MapLife, MapMeta, MapPoint } from '../../world/custom-map/map-document';
import type { EditCommand } from '../model/doc-change';
import type { EditorDocument } from '../model/editor-document';
import { SnapshotCommand } from '../model/commands/snapshot';
import { detailTarget, increaseMapDetail, type DetailTarget } from './detail';
import { imageToHeights, type HeightImage } from './heightmap';
import { LandscapeContext } from './landscape/landscape-context';
import { withLife } from './life';
import { mirrorMap, type MirrorResult } from './mirror-map';
import { resizeMap } from './resize';
import type { SymmetryMode } from './symmetry';

/** A heightmap's lowest and highest height lie at most this far apart, metres (map-file checks every height) */
export const HEIGHTMAP_SPAN = 10000;

/** The map at a new size around its centre; what fell outside */
export function resizeCommand(doc: CustomMapDocument, width: number, depth: number, label = 'Resize map'): { command: EditCommand; dropped: { droppedObjects: number; droppedNodes: number } } {
  let dropped = { droppedObjects: 0, droppedNodes: 0 };
  const command = SnapshotCommand.record(doc, label, ['terrain', 'objects', 'paths', 'spawns', 'hq'], (d) => (dropped = resizeMap(d, width, depth)));
  return { command, dropped };
}

/** Coarse ground refined to the detail of new maps; null when it has it already */
export function detailCommand(doc: CustomMapDocument, label = 'Increase detail'): { command: EditCommand; target: DetailTarget } | null {
  const target = detailTarget(doc.terrain);
  if (!target) return null;
  return { command: SnapshotCommand.record(doc, label, ['terrain', 'paths'], (d) => increaseMapDetail(d, target)), target };
}

/** The whole map made symmetric from the part around `from` (ground, water, objects, spawns, roads, rivers, life) */
export function mirrorCommand(doc: CustomMapDocument, mode: SymmetryMode, from: MapPoint, label = 'Mirror the map'): { command: EditCommand; result: MirrorResult } {
  let result: MirrorResult = { objects: 0, spawns: 0, roads: 0 };
  const command = SnapshotCommand.record(doc, label, ['terrain', 'objects', 'paths', 'spawns', 'life', 'surfaces'], (d) => (result = mirrorMap(d, mode, from)));
  return { command, result };
}

/** Name, author or description */
export function metaCommand(doc: CustomMapDocument, patch: Partial<Pick<MapMeta, 'name' | 'author' | 'description'>>, label = 'Map details'): EditCommand {
  return SnapshotCommand.record(doc, label, ['meta'], (d) => (d.meta = { ...d.meta, ...patch }));
}

/** Sky, sun, fog, weather */
export function environmentCommand(doc: CustomMapDocument, patch: Partial<MapEnvironment>, label = 'Environment'): EditCommand {
  return SnapshotCommand.record(doc, label, ['environment'], (d) => (d.environment = { ...d.environment, ...patch }));
}

/** The map's rules (start credits, HQ health, towers, waves) */
export function rulesCommand(doc: CustomMapDocument, patch: Partial<MapGameplay>, label = 'Rules'): EditCommand {
  return SnapshotCommand.record(doc, label, ['gameplay'], (d) => (d.gameplay = { ...(d.gameplay ?? {}), ...patch }));
}

/** The map's life with `change` made to a copy */
export function lifeCommand(doc: CustomMapDocument, change: (life: MapLife) => void, label: string): EditCommand {
  return SnapshotCommand.record(doc, label, ['life'], (d) => (d.life = withLife(d, change)));
}

/** The intro flight replaced; none for the game's default tour */
export function introCommand(doc: CustomMapDocument, intro: MapIntro | undefined, label = 'Intro flight'): EditCommand {
  return SnapshotCommand.record(doc, label, ['intro'], (d) => (d.intro = intro ? structuredClone(intro) : undefined));
}

/** Whether a heightmap's lowest and highest height can be the ground: numbers, at most HEIGHTMAP_SPAN apart */
export function heightmapRangeOk(low: number, high: number): boolean {
  return Number.isFinite(low) && Number.isFinite(high) && Math.abs(high - low) <= HEIGHTMAP_SPAN;
}

/** A heightmap as the map's ground (black at `low`, white at `high` metres, scaled to the grid), one step */
export function importHeights(editor: EditorDocument, catalog: CatalogIndex, image: HeightImage, low: number, high: number, label = 'Import heightmap'): void {
  const g = editor.doc.terrain.grid;
  const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
  const stroke = new LandscapeContext(editor.begin(label), 1, catalog);
  stroke.tx.touch('heights', all);
  g.heights.set(imageToHeights(image, g.columns, g.rows, low, high));
  stroke.changed({ heights: all });
  stroke.finish();
}
