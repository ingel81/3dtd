/**
 * Every tool of the editor in one list: what it is called, its key, its
 * icon and group in the tool column, the brush it starts with, and how it
 * is made. ToolId comes from this list; a new tool is one entry here, and
 * its panel one entry in ui/shell/tool-panels.ts (a missing one does not
 * compile). The column shows the tools in this order, grouped.
 */
import type { TdIconName } from '../../components/icon/icon.component';
import { LandscapeTool } from './landscape-tool';
import { LifeTool } from './life-tool';
import { LookTool } from './look-tool';
import { MarkerTool } from './marker-tool';
import { MeasureTool } from './measure-tool';
import { ObjectTool } from './object-tool';
import { PaintTool } from './paint-tool';
import { PathTool } from './path-tool';
import { StampTool } from './stamp-tool';
import { SurfaceTool } from './surface-tool';
import { TerrainTool } from './terrain-tool';
import { WaterTool } from './water-tool';
import { PanelTool, type EditorTool } from './tool';

export interface ToolDef {
  id: string;
  label: string;
  /** The name under its icon in the column */
  short: string;
  /** The key that picks it (Esc for Look: it is no single key one can give away) */
  key: string;
  /** What it is for, for the tooltip */
  about: string;
  icon: TdIconName;
  /** Its group in the column: a map maker shapes the land, makes it playable, sets the map as a whole; Look stands above */
  group: '' | 'Shape' | 'Play' | 'Map';
  /**
   * The size of its brush when first used, for a brush tool (each keeps its
   * own): a landscape stroke shapes hills and woods, paint touches up a verge
   */
  brushRadius?: number;
  create(): EditorTool;
}

export const TOOL_DEFS = [
  { id: 'look', label: 'Look', short: 'Look', key: 'Esc', about: 'Look around and click things to see what they are; changes nothing', icon: 'eye', group: '', create: (): EditorTool => new LookTool() },
  { id: 'landscape', label: 'Landscape', short: 'Landscape', key: '1', about: 'Biomes, mountains, rivers and roads: ground, paint and plants at once', icon: 'terrain', group: 'Shape', brushRadius: 40, create: (): EditorTool => new LandscapeTool() },
  { id: 'terrain', label: 'Terrain', short: 'Terrain', key: '2', about: 'Raise, lower, smooth, level, terrace, cliffs and ramps', icon: 'sliders', group: 'Shape', brushRadius: 16, create: (): EditorTool => new TerrainTool() },
  { id: 'paint', label: 'Paint', short: 'Paint', key: '3', about: 'Ground layers and auto paint', icon: 'edit', group: 'Shape', brushRadius: 12, create: (): EditorTool => new PaintTool() },
  { id: 'water', label: 'Water', short: 'Water', key: '4', about: 'Fill hollows, paint water, lava or ice', icon: 'splash', group: 'Shape', brushRadius: 16, create: (): EditorTool => new WaterTool() },
  { id: 'objects', label: 'Objects', short: 'Objects', key: '5', about: 'Place, scatter, select, move, turn and scale', icon: 'build', group: 'Shape', brushRadius: 20, create: (): EditorTool => new ObjectTool() },
  { id: 'life', label: 'Life', short: 'Life', key: 'N', about: 'Birds, fireflies, fog, boats and sounds over areas and along routes, and what the map brings by itself', icon: 'wind', group: 'Shape', create: (): EditorTool => new LifeTool() },
  { id: 'surfaces', label: 'Surfaces', short: 'Surfaces', key: 'U', about: 'Squares, playgrounds, pitches, courts and car parks laid over the ground, with their lines', icon: 'grid', group: 'Shape', create: (): EditorTool => new SurfaceTool() },
  { id: 'paths', label: 'Roads', short: 'Roads', key: '6', about: 'Draw and edit the roads enemies walk', icon: 'route', group: 'Play', create: (): EditorTool => new PathTool() },
  { id: 'markers', label: 'Spawns and HQ', short: 'Spawns', key: '7', about: 'Where enemies come from and what they attack', icon: 'portal', group: 'Play', create: (): EditorTool => new MarkerTool() },
  {
    id: 'gameplay',
    label: 'Rules',
    short: 'Rules',
    key: 'G',
    about: 'Start credits, HQ health, towers and waves of this map',
    icon: 'coin',
    group: 'Play',
    create: (): EditorTool => new PanelTool('gameplay', 'Start credits, HQ health, allowed towers and the waves of this map'),
  },
  {
    id: 'environment',
    label: 'Sky and weather',
    short: 'Sky',
    key: '8',
    about: 'Sky, time of day, fog and weather',
    icon: 'sparkle',
    group: 'Map',
    create: (): EditorTool => new PanelTool('environment', 'Sky, sun and fog change the look of the map; the game uses them too'),
  },
  { id: 'settings', label: 'Map', short: 'Map', key: '9', about: 'Name, size, terrain generator and versions', icon: 'cog', group: 'Map', create: (): EditorTool => new PanelTool('settings', 'Name, author, description and size of the map') },
  { id: 'stamp', label: 'Copy and stamps', short: 'Stamps', key: '0', about: 'Copy a rectangle, place it turned, keep stamps', icon: 'copy', group: 'Map', create: (): EditorTool => new StampTool() },
  { id: 'measure', label: 'Measure', short: 'Measure', key: 'D', about: 'Lengths, lane walking times, height lines and grid', icon: 'pin', group: 'Map', create: (): EditorTool => new MeasureTool() },
] as const;

// Every entry is a ToolDef (checked here: on the list itself the tools' own types would make ToolId refer to itself)
const _checked: readonly ToolDef[] = TOOL_DEFS;
void _checked;

export type ToolId = (typeof TOOL_DEFS)[number]['id'];

/** Tool by id */
export const TOOL_INFO: ReadonlyMap<ToolId, ToolDef & { id: ToolId }> = new Map(TOOL_DEFS.map((t) => [t.id, t]));

/** The tool column's groups in order, each with its tools */
export const TOOL_GROUPS: readonly { label: ToolDef['group']; tools: readonly (ToolDef & { id: ToolId })[] }[] = TOOL_DEFS.reduce<{ label: ToolDef['group']; tools: (ToolDef & { id: ToolId })[] }[]>((groups, t) => {
  const last = groups.at(-1);
  if (last?.label === t.group) last.tools.push(t);
  else groups.push({ label: t.group, tools: [t] });
  return groups;
}, []);
