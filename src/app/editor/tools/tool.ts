/**
 * The editor's tools: each turns pointer and key input over the map into
 * edits of the document. Tools are plain classes without Angular; the
 * viewport feeds them, the panels change their settings. The settings are
 * one signal per part (`EditorSettings`): read `settings.water()`, change
 * with `patch(settings.water, { mode })`, so whoever reads a part follows
 * that part and nothing else.
 */
import { signal, type WritableSignal } from '@angular/core';
import type { GizmoHandle } from '../view/transform-gizmo';
import type { MapLifeKind, MapObject, MapPathKind, MapPoint, MapSurfaceMarkingKind } from '../../world/custom-map/map-document';
import type { MapProblemPart } from '../../world/custom-map/map-file';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { EditorDocument } from '../model/editor-document';
import type { PickResult } from '../model/editor-document';
import type { ToolId } from './tool-defs';
import { DEFAULT_BRUSH, type BrushSettings } from '../../map-ops/brush';
import { DEFAULT_LINE, DEFAULT_SCATTER, type LineOptions, type ScatterOptions } from '../../map-ops/object-ops';
import type { BiomeId } from '../ops/landscape/biomes';
import type { SymmetryMode } from '../ops/symmetry';
import { ALL_PARTS, type Stamp, type StampParts, type StampRect } from '../ops/stamp';
import { randomSeed } from '../../map-ops/landscape-noise';
import { DEFAULT_RIVER, type RiverOptions } from '../ops/landscape/river';
import { DEFAULT_ROAD, type RoadOptions } from '../ops/landscape/road';
import type { ToolOverlay } from '../view/overlay/tool-overlay';
import type { Messages } from '../../i18n/messages/en';

/** The tool that changes each part of the document (a check issue's `part`) */
export const PART_TOOL: Record<MapProblemPart, ToolId> = {
  meta: 'settings',
  terrain: 'terrain',
  objects: 'objects',
  paths: 'paths',
  spawns: 'markers',
  hq: 'markers',
  environment: 'environment',
  gameplay: 'gameplay',
  life: 'life',
  intro: 'settings',
  prefabs: 'stamp',
  surfaces: 'surfaces',
};

export type WaterMode = 'fill' | 'pour' | 'lake' | 'paint' | 'erase' | 'river';

export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'level' | 'noise' | 'erode' | 'terrace' | 'plateau' | 'ramp';

export const TERRAIN_MODES: readonly { id: TerrainMode; label: string; hint: string; group: string }[] = [
  { id: 'raise', label: 'Raise', hint: 'Hold to raise the ground; Shift lowers', group: 'Sculpt' },
  { id: 'lower', label: 'Lower', hint: 'Hold to lower the ground; Shift raises', group: 'Sculpt' },
  { id: 'smooth', label: 'Smooth', hint: 'Hold to even out bumps', group: 'Sculpt' },
  { id: 'noise', label: 'Roughen', hint: 'Hold to add small bumps', group: 'Sculpt' },
  { id: 'erode', label: 'Erode', hint: 'Hold to let steep slopes slide down into scree', group: 'Sculpt' },
  { id: 'flatten', label: 'Flatten', hint: 'Levels to the height where the stroke starts; Ctrl picks a height', group: 'Level out' },
  { id: 'level', label: 'Level', hint: 'Pulls to the height set below; Ctrl click picks it from the ground', group: 'Level out' },
  { id: 'terrace', label: 'Terrace', hint: 'Snaps heights to steps of the height set below', group: 'Level out' },
  { id: 'plateau', label: 'Cliff', hint: 'Builds a cliff level one step above where the stroke starts; Shift one below', group: 'Level out' },
  { id: 'ramp', label: 'Ramp', hint: 'Click the start, then the end: a ramp between the two heights', group: 'Level out' },
];

export type LandscapeMode = 'biome' | 'mountain' | 'valley' | 'plateau' | 'crater' | 'dunes' | 'cracks' | 'cliffRocks' | 'cliff' | 'erode' | 'river' | 'road';

export const LANDSCAPE_MODES: readonly { id: LandscapeMode; label: string; hint: string; group: string; line?: boolean }[] = [
  { id: 'biome', label: 'Biome', hint: 'Hold to paint the chosen landscape: ground, colour and plants together', group: 'Paint a landscape' },
  { id: 'mountain', label: 'Mountain', hint: 'Hold to grow a ridged mountain; size and strength set its height', group: 'Shapes' },
  { id: 'valley', label: 'Valley', hint: 'Hold to sink a valley', group: 'Shapes' },
  { id: 'plateau', label: 'Plateau', hint: 'Hold to raise a table with a steep rim', group: 'Shapes' },
  { id: 'crater', label: 'Crater', hint: 'Click or hold for a crater with a raised rim; size sets its width', group: 'Shapes' },
  { id: 'dunes', label: 'Dunes', hint: 'Hold to heap rounded dunes across the wind', group: 'Shapes' },
  { id: 'erode', label: 'Erode', hint: 'Hold to let rain carve gullies and fans of scree', group: 'Shapes' },
  { id: 'cracks', label: 'Glow cracks', hint: 'Hold to break the ground into glowing lava cracks with a crust', group: 'Shapes' },
  { id: 'cliffRocks', label: 'Cliff rocks', hint: 'Hold over steep slopes: cliff walls stand along the edges, sized to the drop', group: 'Shapes' },
  { id: 'river', label: 'River', hint: 'Drag a line: a river with banks, reeds and bridges over roads', group: 'Draw a line', line: true },
  { id: 'road', label: 'Road', hint: 'Drag a line: a road joined to the network, levelled and lit', group: 'Draw a line', line: true },
  { id: 'cliff', label: 'Cliff edge', hint: 'Drag a line: the ground left of it rises as a cliff', group: 'Draw a line', line: true },
];

export type ObjectMode = 'select' | 'place' | 'scatter' | 'line' | 'erase';
/** Life: draw an outline, draw a line, or pick and change what is there */
export type LifeMode = 'area' | 'route' | 'edit';
/** Surfaces: draw an outline, or pick and change what is there */
export type SurfaceMode = 'draw' | 'edit';
export type GizmoMode = 'move' | 'rotate' | 'scale';
export type PathMode = 'draw' | 'edit';
export type MarkerMode = 'spawn' | 'hq';

/** What the editor's settings hold, part by part */
export interface SettingValues {
  brush: BrushSettings;
  /** Every edit is copied to its symmetric images */
  symmetry: SymmetryMode;
  /** Overlays: height lines every `contourStep` metres, a grid every `gridStep` metres */
  view: {
    contours: boolean;
    contourStep: number;
    grid: boolean;
    gridStep: number;
    /** Object categories the view leaves out (Trees, Plants …); the map keeps them */
    hidden: string[];
    /** Where a tower may stand, green and red on the ground (map-ops/validation/build-areas.ts) */
    buildAreas: boolean;
    /** A still frame: wind, water, lava, waterfalls and particles stand still in the view (the game is not touched) */
    still: boolean;
  };
  /** The points measured so far */
  measure: MapPoint[];
  landscape: {
    mode: LandscapeMode;
    biome: BiomeId;
    /** The seed of the next stroke */
    seed: number;
    /** Roll a new seed after every stroke */
    reroll: boolean;
    river: RiverOptions;
    road: RoadOptions;
    /** Height of a drawn cliff in metres */
    cliffHeight: number;
    /** The cliff model Cliff rocks stands, 'auto' for those of the map's look */
    cliffModel: string;
  };
  terrain: { mode: TerrainMode; level: number; step: number; rampWidth: number };
  paint: { layer: number; erase: boolean };
  water: {
    mode: WaterMode;
    /** What Pour pours */
    pour: 'water' | 'lava';
    /** The body the tool works on: -1 the main water, 0, 1 … the further bodies */
    body: number;
    /** The river being edited and its chosen point, -1 for none */
    river: number;
    riverPoint: number;
    /** Depth of a dug lake bed below the level, metres */
    depth: number;
  };
  objects: {
    mode: ObjectMode;
    gizmo: GizmoMode;
    /** The asset Place puts down */
    asset: string | null;
    scatter: ScatterOptions;
    /** Grid snap in metres, 0 off */
    snap: number;
    /** Turn a placed object at random */
    randomRotation: boolean;
    /** Place: the turn of the next object (radians, counter-clockwise from north), changed with Q E, comma and period or Shift+wheel */
    rotation: number;
    /** Degrees one turn step of Place takes */
    turnStep: number;
    /** Place: a building with a road near turns its front to the road */
    faceRoad: boolean;
    /** Move arrows along the map's axes, or turned with the first selected object */
    space: 'global' | 'local';
    /** Place tilts the object with the ground under it */
    alignToSlope: boolean;
    /** Line: spacing, offset, sides, turn; drawn freely or along a road or river */
    line: LineOptions & { follow: 'free' | 'roads' };
  };
  paths: { mode: PathMode; width: number; kind: MapPathKind; /** Snap radius to nodes and edges, metres */ snap: number; showRoutes: boolean };
  life: {
    mode: LifeMode;
    /** What the next area or route holds */
    kind: MapLifeKind;
    /** The life area being changed (its id), and its chosen point (-1 none) */
    chosen: string | null;
    point: number;
    /** Play the map's ambient sounds in the editor, heard from the middle of the view */
    hear: boolean;
  };
  surfaces: {
    mode: SurfaceMode;
    /** The material and the lines of the next surface */
    material: string;
    marking: MapSurfaceMarkingKind | 'none';
    /** The surface being changed (its id), and its chosen handle (-1 none): corners of its outline, then of its marking */
    chosen: string | null;
    point: number;
  };
  markers: { mode: MarkerMode };
  /** Look: the ground point the last click found nothing on, which the panel describes */
  look: { at: MapPoint | null };
  stamp: {
    mode: 'select' | 'paste';
    parts: StampParts;
    /** Turn of the stamp being placed, radians */
    rotation: number;
    /** Share of the half size over which the stamp's rim fades into the ground */
    feather: number;
    /** The chosen rectangle (select mode) */
    region: StampRect | null;
    /** What a paste puts down: the copy or a stamp from the library */
    current: Stamp | null;
    /** Name of the current piece, for the hint */
    currentName: string;
  };
}

/** The settings as one signal per part; a part is never changed in place, only replaced (patch) */
export type EditorSettings = { readonly [K in keyof SettingValues]: WritableSignal<Setting<K>> };

/** One part of the settings, read only: a change replaces it */
export type Setting<K extends keyof SettingValues> = SettingValues[K] extends readonly unknown[] | string ? SettingValues[K] : Readonly<SettingValues[K]>;

/** A part of the settings with some of its fields replaced */
export function patch<T extends object>(part: WritableSignal<T>, changes: Partial<T>): void {
  part.update((v) => ({ ...v, ...changes }));
}

/** The settings a new editor starts with, each part a signal */
export function defaultSettings(): EditorSettings {
  const values = defaultValues();
  const out = {} as Record<string, WritableSignal<unknown>>;
  for (const key of Object.keys(values) as (keyof SettingValues)[]) out[key] = signal(values[key]);
  return out as unknown as EditorSettings;
}

function defaultValues(): SettingValues {
  return {
    brush: { ...DEFAULT_BRUSH },
    symmetry: 'none',
    view: { contours: false, contourStep: 5, grid: false, gridStep: 25, hidden: [], buildAreas: false, still: false },
    measure: [],
    landscape: {
      mode: 'biome',
      biome: 'forest',
      seed: randomSeed(),
      reroll: true,
      river: { ...DEFAULT_RIVER },
      road: { ...DEFAULT_ROAD },
      cliffHeight: 12,
      cliffModel: 'auto',
    },
    terrain: { mode: 'raise', level: 0, step: 6, rampWidth: 16 },
    paint: { layer: 0, erase: false },
    water: { mode: 'fill', pour: 'water', body: -1, depth: 3, river: -1, riverPoint: -1 },
    objects: { mode: 'select', gizmo: 'move', asset: null, scatter: { ...DEFAULT_SCATTER }, snap: 0, randomRotation: true, rotation: 0, turnStep: 15, faceRoad: true, space: 'global', alignToSlope: false, line: { ...DEFAULT_LINE, follow: 'free' } },
    paths: { mode: 'draw', width: 8, kind: 'road', snap: 10, showRoutes: true },
    life: { mode: 'area', kind: 'birds', chosen: null, point: -1, hear: false },
    surfaces: { mode: 'draw', material: 'paving', marking: 'none', chosen: null, point: -1 },
    markers: { mode: 'spawn' },
    look: { at: null },
    stamp: { mode: 'select', parts: { ...ALL_PARTS }, rotation: 0, feather: 0.25, region: null, current: null, currentName: '' },
  };
}

/** Where the pointer meets the ground, map space; z is the height */
export interface MapHit extends MapPoint {
  z: number;
}

export interface ToolPointer {
  hit: MapHit | null;
  clientX: number;
  clientY: number;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export interface ToolContext {
  readonly editor: EditorDocument;
  readonly settings: EditorSettings;
  readonly catalog: CatalogIndex;
  /** The overlay's layers a tool draws on; a tool switch empties them */
  readonly overlay: ToolOverlay;
  heightAt(x: number, y: number): number;
  /** What stands under the pointer, nearest first */
  pick(p: ToolPointer): PickResult | null;
  /** A short line in the status bar */
  status(message: string): void;
  /** The line of help (hint) says something new, from what the tool holds rather than from its settings */
  hintChanged(): void;
  /** Box selection rectangle in client pixels, or null */
  setBox(box: { x0: number; y0: number; x1: number; y1: number } | null): void;
  /** Map points of the screen box corners (for box selection) */
  boxToMap(box: { x0: number; y0: number; x1: number; y1: number }): MapPoint[] | null;
  /** The gizmo handle under the pointer, if any */
  pickGizmo(p: ToolPointer): GizmoHandle | null;
  /** Metres one screen pixel covers at a map point (handle size, vertical drags) */
  metresPerPixel(at: MapPoint): number;
  /** Client pixel position of a map point at height z; null behind the camera */
  toScreen(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Lasso outline in client pixels, or null */
  setLasso(points: readonly { x: number; y: number }[] | null): void;
  /** Whether the view shows an object (its category is not hidden) */
  objectVisible(o: MapObject): boolean;
  /** The words of the player's language: status lines, hints and undo steps say them */
  t(): Messages;
}

export interface EditorTool {
  readonly id: ToolId;
  /** Whether it shows the brush ring now */
  brushVisible(ctx: ToolContext): boolean;
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
  /** True when the tool takes the drag (the camera does not get it) */
  pointerDown?(p: ToolPointer, ctx: ToolContext): boolean;
  pointerMove?(p: ToolPointer, ctx: ToolContext): void;
  pointerUp?(p: ToolPointer, ctx: ToolContext): void;
  /** Every frame with the latest pointer (null when off the map) */
  frame?(dt: number, p: ToolPointer | null, ctx: ToolContext): void;
  /** A key while the tool is active; true when it used it */
  key?(e: KeyboardEvent, ctx: ToolContext): boolean;
  /** The plain single keys `key` takes (lower case): no rebindable action may take them (ui/shell/keymap.ts) */
  readonly fixedKeys?: readonly FixedKey[];
  /** A wheel step over the view (-1 away from the user, 1 toward); true when the tool used it (the view does not zoom) */
  wheel?(step: number, p: ToolPointer, ctx: ToolContext): boolean;
  /** Esc: drop what is half done; true when there was something (a further Esc then goes to Look) */
  cancel?(ctx: ToolContext): boolean;
  /** The line of help under the map */
  hint(ctx: ToolContext): string;
}

/** A single key inside a tool and what it does there, for the keymap and its help */
export interface FixedKey {
  key: string;
  what: string;
}

/** A tool that does nothing on the map (Environment, Map settings, Rules) */
export class PanelTool implements EditorTool {
  constructor(readonly id: ToolId & keyof Messages['editor']['panelHints']) {}

  brushVisible(): boolean {
    return false;
  }

  hint(ctx: ToolContext): string {
    return ctx.t().editor.panelHints[this.id];
  }
}

