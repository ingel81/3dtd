/**
 * The editor's single keys that the user may give other keys: the tools,
 * the views, the check, symmetry and the trial wave. Kept in this browser
 * (localStorage `3dtd-editor-keys`); a key given to one action leaves the
 * action that had it. Keys inside a tool (W E R, Q H, S X J …) stay fixed:
 * each tool names them (EditorTool.fixedKeys), and no action takes them.
 */
import { TOOL_DEFS } from '../../tools/tool-defs';
import { EDITOR_ACTIONS } from './actions';
import type { EditorTool } from '../../tools/tool';

export interface KeyAction {
  id: string;
  label: string;
  /** The default key, as KeyboardEvent.key in lower case */
  key: string;
}

/** The actions with a key of their own the user may change (actions.ts, `defaultKey`) */
export const KEY_ACTIONS: readonly KeyAction[] = EDITOR_ACTIONS.filter((a) => a.defaultKey).map((a) => ({
  id: a.id,
  label: a.group === 'Tools' ? `Tool: ${a.label}` : a.label,
  key: a.defaultKey!,
}));

const STORAGE_KEY = '3dtd-editor-keys';

export type Keymap = Record<string, string>;

/** The tools' fixed keys: what each does, with the tool's name ("move the selection (Objects)") */
export function toolKeys(tools: Iterable<EditorTool>): ReadonlyMap<string, string> {
  const out = new Map<string, string[]>();
  for (const tool of tools) {
    const label = TOOL_DEFS.find((t) => t.id === tool.id)?.label ?? tool.id;
    for (const { key, what } of tool.fixedKeys ?? []) out.set(key, [...(out.get(key) ?? []), `${what} (${label})`]);
  }
  return new Map([...out].map(([key, list]) => [key, list.join(', ')]));
}

/**
 * The keys in use: the defaults with the user's own over them. An own key a
 * tool keeps fixed (`fixed`, toolKeys) is dropped: taken before that was
 * checked, it stole the tool's key
 */
export function loadKeymap(storage: Pick<Storage, 'getItem'> | null = safeStorage(), fixed: ReadonlyMap<string, string> = new Map()): Keymap {
  const map: Keymap = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.key]));
  try {
    const own = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as Keymap;
    const dropped: string[] = [];
    for (const [id, key] of Object.entries(own)) {
      if (!(id in map) || typeof key !== 'string' || !key) continue;
      if (fixed.has(key)) dropped.push(id);
      else map[id] = key;
    }
    // Back on its default key, unless another action has that one now: then it waits for a key of its own
    for (const id of dropped) if (Object.entries(map).some(([other, k]) => other !== id && k === map[id])) map[id] = '';
  } catch {
    // a broken entry keeps the defaults
  }
  return map;
}

/** Gives `action` the key; an action that had it takes the action's old key. Returns the new map */
export function rebind(map: Keymap, action: string, key: string): Keymap {
  const next = { ...map };
  const old = next[action];
  for (const [id, k] of Object.entries(next)) if (k === key && id !== action) next[id] = old;
  next[action] = key;
  return next;
}

export function saveKeymap(map: Keymap, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  const defaults = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.key]));
  const own = Object.fromEntries(Object.entries(map).filter(([id, k]) => defaults[id] !== k));
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(own));
  } catch {
    // a private window keeps the keys for this visit only
  }
}

/** The action a key stands for, or null */
export function actionFor(map: Keymap, key: string): string | null {
  const k = key.toLowerCase();
  for (const [id, bound] of Object.entries(map)) if (bound === k) return id;
  return null;
}

/** Keys that may not be given away: they mean something everywhere (+ and - the trial wave's speed) */
export function bindable(key: string): boolean {
  return key.length === 1 && !'[]{}?,.+-='.includes(key) && key !== ' ';
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
