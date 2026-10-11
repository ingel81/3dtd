/**
 * The editor's tools: each turns pointer and key input over the map into
 * edits of the document. Tools are plain classes without Angular; the
 * viewport feeds them, the panels change their settings.
 */
import type { MapPathKind, MapPoint } from '../../world/custom-map/map-document';
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
  { id: 'paths', label: 'Paths', key: '6', about: 'Draw and edit the roads enemies walk' },
  { id: 'markers', label: 'Spawns and HQ', key: '7', about: 'Where enemies come from and what they attack' },
  { id: 'environment', label: 'Environment', key: '8', about: 'Sky, time of day, fog and weather' },
  { id: 'settings', label: 'Map', key: '9', about: 'Name, size and the terrain generator' },
  { id: 'stamp', label: 'Copy and stamps', key: '0', about: 'Copy a rectangle, place it turned, keep stamps' },
  { id: 'gameplay', label: 'Gameplay', key: 'G', about: 'Start credits, HQ health, towers and waves of this map' },
  { id: 'measure', label: 'Measure', key: 'D', about: 'Lengths, lane walking times, height lines and grid' },
];

export type TerrainMode = 'raise' | 'lower' | 'smooth' | 'flatten' | 'level' | 'noise' | 'erode' | 'terrace' | 'plateau' | 'ramp';

export const TERRAIN_MODES: readonly { id: TerrainMode; label: string; hint: string }[] = [
  { id: 'raise', label: 'Raise', hint: 'Hold to raise; Shift lowers' },
  { id: 'lower', label: 'Lower', hint: 'Hold to lower; Shift raises' },
  { id: 'smooth', label: 'Smooth', hint: 'Evens out bumps' },
  { id: 'flatten', label: 'Flatten', hint: 'Levels to the height where the stroke starts; Ctrl picks a height' },
  { id: 'level', label: 'Level', hint: 'Pulls to the set height; Ctrl click picks it from the ground' },
  { id: 'noise', label: 'Roughen', hint: 'Adds bumps' },
  { id: 'erode', label: 'Erode', hint: 'Slides steep slopes down into scree' },
  { id: 'terrace', label: 'Terrace', hint: 'Snaps heights to steps of the set height' },
  { id: 'plateau', label: 'Cliff', hint: 'Builds a cliff level one step above where the stroke starts; Shift one below' },
  { id: 'ramp', label: 'Ramp', hint: 'Click the start, click the end: a ramp between the two heights' },
];

export type LandscapeMode = 'biome' | 'mountain' | 'valley' | 'plateau' | 'cliff' | 'erode' | 'river' | 'road';

export const LANDSCAPE_MODES: readonly { id: LandscapeMode; label: string; hint: string; line?: boolean }[] = [
  { id: 'biome', label: 'Biome', hint: 'Hold to paint the chosen landscape: ground, paint and plants together' },
  { id: 'mountain', label: 'Mountain', hint: 'Hold to grow a ridged mountain; size and strength set its height' },
  { id: 'valley', label: 'Valley', hint: 'Hold to sink a valley' },
  { id: 'plateau', label: 'Plateau', hint: 'Hold to raise a table with a steep rim' },
  { id: 'cliff', label: 'Cliff edge', hint: 'Drag a line: the ground left of it rises as a cliff', line: true },
  { id: 'erode', label: 'Erode', hint: 'Hold to let rain carve gullies and fans of scree' },
  { id: 'river', label: 'River', hint: 'Drag a line: a river with banks, reeds and bridges over roads', line: true },
  { id: 'road', label: 'Road', hint: 'Drag a line: a road joined to the network, levelled and lit', line: true },
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
  view: { contours: boolean; contourStep: number; grid: boolean; gridStep: number };
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
  water: { mode: 'paint' | 'erase' | 'fill' };
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
    view: { contours: false, contourStep: 5, grid: false, gridStep: 25 },
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
    water: { mode: 'fill' },
    objects: { mode: 'place', gizmo: 'move', asset: null, scatter: { ...DEFAULT_SCATTER }, snap: 0, randomRotation: true },
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
