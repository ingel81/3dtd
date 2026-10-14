/**
 * The editor's single keys that the user may give other keys: the tools,
 * the views, the check, symmetry and the trial wave. Kept in this browser
 * (localStorage `3dtd-editor-keys`); a key given to one action leaves the
 * action that had it. Keys inside a tool (W E R, Q H, S X J …) stay fixed.
 */
import { TOOLS } from '../../tools/tool';

export interface KeyAction {
  id: string;
  label: string;
  /** The default key, as KeyboardEvent.key in lower case */
  key: string;
}

export const KEY_ACTIONS: readonly KeyAction[] = [
  // Look stays on Esc: Esc first drops what is half done, so it is no key to give away
  ...TOOLS.filter((t) => t.id !== 'look').map((t) => ({ id: `tool:${t.id}`, label: `Tool: ${t.label}`, key: t.key.toLowerCase() })),
  { id: 'view:frame', label: 'Frame the selection or the map', key: 'f' },
  { id: 'view:top', label: 'Top view on or off', key: 't' },
  { id: 'view:game', label: 'Game view on or off', key: 'c' },
  { id: 'view:still', label: 'Still frame: wind, water and particles stand still', key: 'b' },
  { id: 'map:trial', label: 'Trial wave on or off', key: 'p' },
  { id: 'map:check', label: 'Check the map', key: 'v' },
  { id: 'map:symmetry', label: 'Next symmetry', key: 'm' },
];

const STORAGE_KEY = '3dtd-editor-keys';

export type Keymap = Record<string, string>;

/** The keys in use: the defaults with the user's own over them */
export function loadKeymap(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Keymap {
  const map: Keymap = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.key]));
  try {
    const own = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}') as Keymap;
    for (const [id, key] of Object.entries(own)) if (id in map && typeof key === 'string' && key) map[id] = key;
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
