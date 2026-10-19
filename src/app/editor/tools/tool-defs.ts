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

/** A tool of the column; its name, short name and what it is for are the dictionary's (i18n `editor.tools`) */
export interface ToolDef {
  id: string;
  /** The key that picks it (Esc for Look: it is no single key one can give away) */
  key: string;
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
  { id: 'look', key: 'Esc', icon: 'eye', group: '', create: (): EditorTool => new LookTool() },
  { id: 'landscape', key: '1', icon: 'terrain', group: 'Shape', brushRadius: 40, create: (): EditorTool => new LandscapeTool() },
  { id: 'terrain', key: '2', icon: 'sliders', group: 'Shape', brushRadius: 16, create: (): EditorTool => new TerrainTool() },
  { id: 'paint', key: '3', icon: 'edit', group: 'Shape', brushRadius: 12, create: (): EditorTool => new PaintTool() },
  { id: 'water', key: '4', icon: 'splash', group: 'Shape', brushRadius: 16, create: (): EditorTool => new WaterTool() },
  { id: 'objects', key: '5', icon: 'build', group: 'Shape', brushRadius: 20, create: (): EditorTool => new ObjectTool() },
  { id: 'life', key: 'N', icon: 'wind', group: 'Shape', create: (): EditorTool => new LifeTool() },
  { id: 'surfaces', key: 'U', icon: 'grid', group: 'Shape', create: (): EditorTool => new SurfaceTool() },
  { id: 'paths', key: '6', icon: 'route', group: 'Play', create: (): EditorTool => new PathTool() },
  { id: 'markers', key: '7', icon: 'portal', group: 'Play', create: (): EditorTool => new MarkerTool() },
  {
    id: 'gameplay',
    key: 'G',
    icon: 'coin',
    group: 'Play',
    create: (): EditorTool => new PanelTool('gameplay'),
  },
  {
    id: 'environment',
    key: '8',
    icon: 'sparkle',
    group: 'Map',
    create: (): EditorTool => new PanelTool('environment'),
  },
  { id: 'settings', key: '9', icon: 'cog', group: 'Map', create: (): EditorTool => new PanelTool('settings') },
  { id: 'stamp', key: '0', icon: 'copy', group: 'Map', create: (): EditorTool => new StampTool() },
  { id: 'measure', key: 'D', icon: 'pin', group: 'Map', create: (): EditorTool => new MeasureTool() },
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
