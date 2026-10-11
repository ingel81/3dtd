/**
 * The editor's tools: each turns pointer and key input over the map into
 * edits of the document. Tools are plain classes without Angular; the
 * viewport feeds them, the panels change their settings.
 */
import type { GizmoHandle } from '../view/transform-gizmo';
import type { MapObject, MapPathKind, MapPoint } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../catalog/asset-catalog';
import type { EditorDocument } from '../model/editor-document';
import { DEFAULT_BRUSH, type BrushSettings } from '../ops/brush';
import { DEFAULT_SCATTER, type ScatterOptions } from '../ops/object-ops';
import type { BiomeId } from '../ops/landscape/biomes';
import type { SymmetryMode } from '../ops/symmetry';
import { ALL_PARTS, type Stamp, type StampParts, type StampRect } from '../ops/stamp';
import { randomSeed } from '../ops/landscape/landscape-noise';
import { DEFAULT_RIVER, type RiverOptions } from '../ops/landscape/river';
import { DEFAULT_ROAD, type RoadOptions } from '../ops/landscape/road';
import type { EditorOverlay } from '../view/editor-overlay';

export type ToolId = 'landscape' | 'stamp' | 'gameplay' | 'measure' | 'terrain' | 'paint' | 'water' | 'objects' | 'paths' | 'markers' | 'environment' | 'settings';

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** The key that picks it */
  key: string;
  /** What it is for, for the tooltip */
  about: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: 'landscape', label: 'Landscape', key: '1', about: 'Biomes, mountains, rivers and roads: ground, paint and plants at once' },
  { id: 'terrain', label: 'Terrain', key: '2', about: 'Raise, lower, smooth, level, terrace, cliffs and ramps' },
  { id: 'paint', label: 'Paint', key: '3', about: 'Ground layers and auto paint' },
  { id: 'water', label: 'Water', key: '4', about: 'Fill hollows, paint water, lava or ice' },
  { id: 'objects', label: 'Objects', key: '5', about: 'Place, scatter, select, move, turn and scale' },
  { id: 'paths', label: 'Roads', key: '6', about: 'Draw and edit the roads enemies walk' },
  { id: 'markers', label: 'Spawns and HQ', key: '7', about: 'Where enemies come from and what they attack' },
  { id: 'environment', label: 'Sky and weather', key: '8', about: 'Sky, time of day, fog and weather' },
  { id: 'settings', label: 'Map', key: '9', about: 'Name, size, terrain generator and versions' },
  { id: 'stamp', label: 'Copy and stamps', key: '0', about: 'Copy a rectangle, place it turned, keep stamps' },
  { id: 'gameplay', label: 'Rules', key: 'G', about: 'Start credits, HQ health, towers and waves of this map' },
  { id: 'measure', label: 'Measure', key: 'D', about: 'Lengths, lane walking times, height lines and grid' },
];

/**
 * The tool column: short names under the icons, in three groups by what
 * a map maker does (shape the land, make it playable, the map as a whole)
 */
export const TOOL_GROUPS: readonly { label: string; tools: readonly { id: ToolId; short: string }[] }[] = [
  {
    label: 'Shape',
    tools: [
      { id: 'landscape', short: 'Landscape' },
      { id: 'terrain', short: 'Terrain' },
      { id: 'paint', short: 'Paint' },
      { id: 'water', short: 'Water' },
      { id: 'objects', short: 'Objects' },
    ],
  },
  {
    label: 'Play',
    tools: [
      { id: 'paths', short: 'Roads' },
      { id: 'markers', short: 'Spawns' },
      { id: 'gameplay', short: 'Rules' },
    ],
  },
  {
    label: 'Map',
    tools: [
      { id: 'environment', short: 'Sky' },
      { id: 'settings', short: 'Map' },
      { id: 'stamp', short: 'Stamps' },
      { id: 'measure', short: 'Measure' },
    ],
  },
];

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

export type LandscapeMode = 'biome' | 'mountain' | 'valley' | 'plateau' | 'crater' | 'dunes' | 'cracks' | 'cliff' | 'erode' | 'river' | 'road';

export const LANDSCAPE_MODES: readonly { id: LandscapeMode; label: string; hint: string; group: string; line?: boolean }[] = [
  { id: 'biome', label: 'Biome', hint: 'Hold to paint the chosen landscape: ground, colour and plants together', group: 'Paint a landscape' },
  { id: 'mountain', label: 'Mountain', hint: 'Hold to grow a ridged mountain; size and strength set its height', group: 'Shapes' },
  { id: 'valley', label: 'Valley', hint: 'Hold to sink a valley', group: 'Shapes' },
  { id: 'plateau', label: 'Plateau', hint: 'Hold to raise a table with a steep rim', group: 'Shapes' },
  { id: 'crater', label: 'Crater', hint: 'Click or hold for a crater with a raised rim; size sets its width', group: 'Shapes' },
  { id: 'dunes', label: 'Dunes', hint: 'Hold to heap rounded dunes across the wind', group: 'Shapes' },
  { id: 'erode', label: 'Erode', hint: 'Hold to let rain carve gullies and fans of scree', group: 'Shapes' },
  { id: 'cracks', label: 'Glow cracks', hint: 'Hold to break the ground into glowing lava cracks with a crust', group: 'Shapes' },
  { id: 'river', label: 'River', hint: 'Drag a line: a river with banks, reeds and bridges over roads', group: 'Draw a line', line: true },
  { id: 'road', label: 'Road', hint: 'Drag a line: a road joined to the network, levelled and lit', group: 'Draw a line', line: true },
  { id: 'cliff', label: 'Cliff edge', hint: 'Drag a line: the ground left of it rises as a cliff', group: 'Draw a line', line: true },
];

export type ObjectMode = 'select' | 'place' | 'scatter' | 'erase';
export type GizmoMode = 'move' | 'rotate' | 'scale';
export type PathMode = 'draw' | 'edit';
export type MarkerMode = 'spawn' | 'hq';

export interface EditorSettings {
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
  };
  terrain: { mode: TerrainMode; level: number; step: number; rampWidth: number };
  paint: { layer: number; erase: boolean };
  water: {
    mode: 'fill' | 'lake' | 'paint' | 'erase' | 'river';
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
    /** Move arrows along the map's axes, or turned with the first selected object */
    space: 'global' | 'local';
  };
  paths: { mode: PathMode; width: number; kind: MapPathKind; /** Snap radius to nodes and edges, metres */ snap: number; showRoutes: boolean };
  markers: { mode: MarkerMode };
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

export function defaultSettings(): EditorSettings {
  return {
    brush: { ...DEFAULT_BRUSH },
    symmetry: 'none',
    view: { contours: false, contourStep: 5, grid: false, gridStep: 25, hidden: [] },
    measure: [],
    landscape: {
      mode: 'biome',
      biome: 'forest',
      seed: randomSeed(),
      reroll: true,
      river: { ...DEFAULT_RIVER },
      road: { ...DEFAULT_ROAD },
      cliffHeight: 12,
    },
    terrain: { mode: 'raise', level: 0, step: 6, rampWidth: 16 },
    paint: { layer: 0, erase: false },
    water: { mode: 'fill', body: -1, depth: 3, river: -1, riverPoint: -1 },
    objects: { mode: 'select', gizmo: 'move', asset: null, scatter: { ...DEFAULT_SCATTER }, snap: 0, randomRotation: true, space: 'global' },
    paths: { mode: 'draw', width: 8, kind: 'road', snap: 10, showRoutes: true },
    markers: { mode: 'spawn' },
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

/** Something on the map the pointer is over */
export type PickResult =
  | { kind: 'spawn'; id: string }
  | { kind: 'hq' }
  | { kind: 'object'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string };

export interface ToolContext {
  readonly editor: EditorDocument;
  readonly settings: EditorSettings;
  readonly catalog: CatalogIndex;
  readonly overlay: EditorOverlay;
  heightAt(x: number, y: number): number;
  /** What stands under the pointer, nearest first */
  pick(p: ToolPointer): PickResult | null;
  /** A short line in the status bar */
  status(message: string): void;
  /** The settings changed from inside a tool (picked height, asset) */
  settingsChanged(): void;
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
  /** Esc: drop what is half done */
  cancel?(ctx: ToolContext): void;
  /** The line of help under the map */
  hint(ctx: ToolContext): string;
}

/** A tool that does nothing on the map (Environment, Map settings) */
export class PanelTool implements EditorTool {
  constructor(
    readonly id: ToolId,
    private readonly help: string,
  ) {}

  brushVisible(): boolean {
    return false;
  }

  hint(): string {
    return this.help;
  }
}
