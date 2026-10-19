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
import type { Messages } from '../../../i18n/messages/en';

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

/** The group an action shows under in the palette (i18n `editor.actionGroups`) */
export type ActionGroup = keyof Messages['editor']['actionGroups'];

/** An action of the editor; its words are the dictionary's (actionLabel, i18n `editor.actions`, `editor.fileActions`) */
export interface EditorAction {
  id: string;
  /** Shown beside the label in the palette: Tools, View, Map … */
  group: ActionGroup;
  /** The single key it starts with, as KeyboardEvent.key in lower case; the user may give it another */
  defaultKey?: string;
  /** A fixed key that does the same (Ctrl+Z) */
  keys?: string;
  /** It is in the File menu, with its own words there (i18n `editor.fileActions`) */
  file?: true;
  run(h: ActionHost): void;
  /** False when it does not apply now (the palette leaves it out, its key goes on to the view) */
  enabled?(h: ActionHost): boolean;
}

const withView = (h: ActionHost) => h.session.view.shown;

export const EDITOR_ACTIONS: readonly EditorAction[] = [
  { id: 'edit:undo', group: 'Edit', keys: 'Ctrl+Z', run: (h) => h.session.undo() },
  { id: 'edit:redo', group: 'Edit', keys: 'Ctrl+Y', run: (h) => h.session.redo() },
  { id: 'edit:history', group: 'Edit', run: (h) => h.showHistory() },
  { id: 'map:save', group: 'Map', keys: 'Ctrl+S', run: (h) => void h.session.saves.save(true) },
  { id: 'map:check', group: 'Map', defaultKey: 'v', run: (h) => h.check() },
  { id: 'map:test', group: 'Map', run: (h) => void h.session.check.testPlay() },
  { id: 'map:download', group: 'Map', file: true, run: (h) => h.session.saves.downloadFile() },
  { id: 'map:picture', group: 'Map', file: true, run: (h) => void h.session.pictures.downloadPng() },
  { id: 'map:trial', group: 'Map', defaultKey: 'p', run: (h) => h.trial(), enabled: withView },
  ...TOOL_DEFS.map(
    (t): EditorAction => ({
      id: `tool:${t.id}`,
      group: 'Tools',
      // Look stays on Esc: Esc first drops what is half done, so it is no key to give away
      ...(t.id === 'look' ? { keys: t.key } : { defaultKey: t.key.toLowerCase() }),
      run: (h) => h.pick(t.id),
    }),
  ),
  { id: 'view:frame-map', group: 'View', file: true, run: (h) => h.session.view.frameMap(), enabled: withView },
  { id: 'view:frame', group: 'View', defaultKey: 'f', run: (h) => h.session.view.focusSelection(), enabled: withView },
  { id: 'view:top', group: 'View', defaultKey: 't', file: true, run: (h) => h.session.view.setTopDown(!h.session.view.topDown), enabled: withView },
  { id: 'view:game', group: 'View', defaultKey: 'c', run: (h) => h.session.view.toggleGameView(), enabled: withView },
  { id: 'view:still', group: 'View', defaultKey: 'b', run: (h) => h.toggleStill() },
  { id: 'view:contours', group: 'View', run: (h) => patch(h.session.tools.settings.view, { contours: !h.session.tools.settings.view().contours }) },
  { id: 'view:grid', group: 'View', run: (h) => patch(h.session.tools.settings.view, { grid: !h.session.tools.settings.view().grid }) },
  { id: 'map:symmetry', group: 'Symmetry', defaultKey: 'm', run: (h) => h.nextSymmetry() },
  { id: 'map:mirror', group: 'Symmetry', run: (h) => h.session.mirrorNow() },
  { id: 'editor:keys', group: 'Editor', keys: '?', run: (h) => h.showHelp() },
  { id: 'editor:tour', group: 'Editor', run: (h) => h.startTour() },
  { id: 'editor:guide', group: 'Editor', run: (h) => h.openGuide() },
];

/** Action by id */
/** What an action says in the palette and the keys list */
export function actionLabel(t: Messages, action: EditorAction): string {
  if (action.id.startsWith('tool:')) return t.editor.tools[action.id.slice(5) as ToolId].label;
  if (action.id === 'editor:tour') return t.editor.actions['editor:tour'](TOUR_STEPS.length);
  const label = t.editor.actions[action.id as Exclude<keyof Messages['editor']['actions'], 'editor:tour'>];
  return typeof label === 'string' ? label : action.id;
}

/** What an action says in the File menu */
export function fileLabel(t: Messages, action: EditorAction): string {
  return t.editor.fileActions[action.id as keyof Messages['editor']['fileActions']] ?? actionLabel(t, action);
}

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
