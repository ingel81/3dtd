/**
 * Everything the editor does by name, in one list: the command palette
 * (Ctrl+K), the single keys a user may give away (keymap.ts), the help and
 * the File menu are made from it. An action with `defaultKey` gets a
 * rebindable key; `keys` shows a fixed one beside it; `file` puts it in the
 * File menu. The palette adds what depends on the map (go to, select, hide
 * a category, biomes and landscape modes) to these.
 */
import { TOOL_DEFS, type ToolId } from '../../tools/tool-defs';
import { patch } from '../../tools/tool';
import type { EditorSession } from '../editor-session.service';
import { TOUR_STEPS } from './tour';

/** What the actions work on: the session and what the editor's page does around it */
export interface ActionHost {
  readonly session: EditorSession;
  pick(id: ToolId): void;
  check(): void;
  trial(): void;
  toggleStill(): void;
  nextSymmetry(): void;
  showHistory(): void;
  showHelp(): void;
  startTour(): void;
  openGuide(): void;
}

export interface EditorAction {
  id: string;
  label: string;
  /** Shown beside the label in the palette: Tools, View, Map … */
  group: string;
  /** The single key it starts with, as KeyboardEvent.key in lower case; the user may give it another */
  defaultKey?: string;
  /** A fixed key that does the same (Ctrl+Z) */
  keys?: string;
  /** Its label in the File menu, when it is there */
  file?: string;
  run(h: ActionHost): void;
  /** False when it does not apply now (the palette leaves it out, its key goes on to the view) */
  enabled?(h: ActionHost): boolean;
}

const withView = (h: ActionHost) => h.session.view.shown;

export const EDITOR_ACTIONS: readonly EditorAction[] = [
  { id: 'edit:undo', label: 'Undo', group: 'Edit', keys: 'Ctrl+Z', run: (h) => h.session.undo() },
  { id: 'edit:redo', label: 'Redo', group: 'Edit', keys: 'Ctrl+Y', run: (h) => h.session.redo() },
  { id: 'edit:history', label: 'History: jump to a step', group: 'Edit', run: (h) => h.showHistory() },
  { id: 'map:save', label: 'Save', group: 'Map', keys: 'Ctrl+S', run: (h) => void h.session.saves.save(true) },
  { id: 'map:check', label: 'Check the map', group: 'Map', defaultKey: 'v', run: (h) => h.check() },
  { id: 'map:test', label: 'Test the map in the game', group: 'Map', run: (h) => void h.session.check.testPlay() },
  { id: 'map:download', label: 'Download the map file', group: 'Map', file: 'Download map file', run: (h) => h.session.saves.downloadFile() },
  { id: 'map:picture', label: 'Download a picture of the map', group: 'Map', file: 'Export top view as picture', run: (h) => void h.session.pictures.downloadPng() },
  { id: 'map:trial', label: 'Trial wave: enemies walk the routes', group: 'Map', defaultKey: 'p', run: (h) => h.trial(), enabled: withView },
  ...TOOL_DEFS.map(
    (t): EditorAction => ({
      id: `tool:${t.id}`,
      label: t.label,
      group: 'Tools',
      // Look stays on Esc: Esc first drops what is half done, so it is no key to give away
      ...(t.id === 'look' ? { keys: t.key } : { defaultKey: t.key.toLowerCase() }),
      run: (h) => h.pick(t.id),
    }),
  ),
  { id: 'view:frame-map', label: 'Frame the map', group: 'View', file: 'Frame the whole map', run: (h) => h.session.view.frameMap(), enabled: withView },
  { id: 'view:frame', label: 'Frame the selection', group: 'View', defaultKey: 'f', run: (h) => h.session.view.focusSelection(), enabled: withView },
  { id: 'view:top', label: 'Top view on or off', group: 'View', defaultKey: 't', file: 'Top view on or off', run: (h) => h.session.view.setTopDown(!h.session.view.topDown), enabled: withView },
  { id: 'view:game', label: 'Game view on or off', group: 'View', defaultKey: 'c', run: (h) => h.session.view.toggleGameView(), enabled: withView },
  { id: 'view:still', label: 'Still frame on or off', group: 'View', defaultKey: 'b', run: (h) => h.toggleStill() },
  { id: 'view:contours', label: 'Height lines on or off', group: 'View', run: (h) => patch(h.session.tools.settings.view, { contours: !h.session.tools.settings.view().contours }) },
  { id: 'view:grid', label: 'Grid on or off', group: 'View', run: (h) => patch(h.session.tools.settings.view, { grid: !h.session.tools.settings.view().grid }) },
  { id: 'map:symmetry', label: 'Next symmetry', group: 'Symmetry', defaultKey: 'm', run: (h) => h.nextSymmetry() },
  { id: 'map:mirror', label: 'Mirror the map now (from the part in view)', group: 'Symmetry', run: (h) => h.session.mirrorNow() },
  { id: 'editor:keys', label: 'Keys', group: 'Editor', keys: '?', run: (h) => h.showHelp() },
  { id: 'editor:tour', label: `Tour: the editor in ${TOUR_STEPS.length} steps`, group: 'Editor', run: (h) => h.startTour() },
  { id: 'editor:guide', label: 'How to build a good level', group: 'Editor', run: (h) => h.openGuide() },
];

/** Action by id */
export const ACTION_BY_ID: ReadonlyMap<string, EditorAction> = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));

/** The File menu's actions, in order */
export const FILE_ACTIONS: readonly EditorAction[] = EDITOR_ACTIONS.filter((a) => a.file);

/** Runs action `id` when it applies now; false when it does not (its key then goes on to the view) */
export function runAction(id: string, h: ActionHost): boolean {
  const action = ACTION_BY_ID.get(id);
  if (!action || (action.enabled && !action.enabled(h))) return false;
  action.run(h);
  return true;
}
