/**
 * Game hotkeys: which key asks for what. Resolved from the key alone;
 * whether the action can run right now is HotkeyService's call.
 *
 * Not here, InputHandlerService handles them first: W/A/S/D and the arrows
 * (camera), R (rotate while building), Esc in build and placement mode and
 * while aiming an ability, and the debug keys T and Shift+P. S stays with the
 * camera, selling is Delete.
 */

import { ABILITIES, ABILITY_IDS, type AbilityId } from '../configs/abilities.config';

export type HotkeyAction =
  /** Pick the build card at this position of the BUILD panel, 0-based */
  | { kind: 'select-tower'; slot: number }
  | { kind: 'upgrade' }
  | { kind: 'sell' }
  | { kind: 'start-wave' }
  | { kind: 'pause' }
  | { kind: 'speed'; step: 1 | -1 }
  | { kind: 'help' }
  | { kind: 'cancel' }
  /** Arm the ability's targeting mode, or leave it */
  | { kind: 'ability'; abilityId: AbilityId }
  /** Select the hero, or fly the camera to him while he is selected */
  | { kind: 'hero' }
  /** The hero's next ammo */
  | { kind: 'hero-ammo' }
  | { kind: 'camera-hq' }
  /** Fly to the next spawn point, round the list */
  | { kind: 'camera-spawn' }
  /** Photo mode on or off */
  | { kind: 'photo-mode' }
  /** The research tree, once a Research Center stands */
  | { kind: 'research' }
  /** All sound on or off */
  | { kind: 'mute' }
  /** Into the selected tower to aim it by hand, or out of the manned one */
  | { kind: 'tower-control' };

/** The parts of a KeyboardEvent the mapping reads. */
export type HotkeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey' | 'repeat'>;

/** Build cards reachable by number key: the first nine, in BUILD panel order. */
const TOWER_SLOT_KEYS = 9;

/** Ability by its key (AbilityConfig.hotkey), lower case */
const ABILITY_BY_KEY = new Map(ABILITY_IDS.map((id) => [ABILITIES[id].hotkey.toLowerCase(), id]));

/** Number key of the build card at `index`, null past the ninth. */
export function towerSlotKey(index: number): string | null {
  return index >= 0 && index < TOWER_SLOT_KEYS ? String(index + 1) : null;
}

/** The game action for a key, null when the key is not a game hotkey. */
export function resolveHotkey(e: HotkeyEvent): HotkeyAction | null {
  // Browser and system shortcuts (Ctrl+1 switches tabs) stay theirs. A held
  // key repeats keydown; none of these actions should fire twice from it.
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return null;

  const key = e.key;
  if (key.length === 1 && key >= '1' && key <= '9') {
    return { kind: 'select-tower', slot: Number(key) - 1 };
  }
  switch (key) {
    case ' ':
      return { kind: 'start-wave' };
    case 'Delete':
    case 'Backspace':
      return { kind: 'sell' };
    case '+':
    case '=':
      return { kind: 'speed', step: 1 };
    case '-':
      return { kind: 'speed', step: -1 };
    case '?':
      return { kind: 'help' };
    case 'Escape':
      return { kind: 'cancel' };
    case 'Home':
      return { kind: 'camera-hq' };
  }
  switch (key.toLowerCase()) {
    case 'u':
      return { kind: 'upgrade' };
    case 'p':
      // Shift+P is the particle-shader debug toggle in InputHandlerService
      return e.shiftKey ? null : { kind: 'pause' };
    case 'h':
      return { kind: 'help' };
    case 'g':
      return { kind: 'hero' };
    case 'v':
      return { kind: 'hero-ammo' };
    case 'n':
      return { kind: 'camera-spawn' };
    case 'o':
      return { kind: 'photo-mode' };
    case 'm':
      return { kind: 'mute' };
    case 'c':
      return { kind: 'tower-control' };
    case 'q':
      // R rotates while building and T is the debug key; the ability keys are
      // K, F, E and L, so Q is what is left near the camera hand.
      return { kind: 'research' };
  }
  // After the fixed keys, so an ability cannot take one of them over
  const abilityId = ABILITY_BY_KEY.get(key.toLowerCase());
  return abilityId ? { kind: 'ability', abilityId } : null;
}

export interface HotkeyHelpRow {
  keys: string[];
  label: string;
  /** Keys span a range (1 to 9) instead of being alternatives */
  range?: boolean;
}

export interface HotkeyHelpGroup {
  title: string;
  rows: HotkeyHelpRow[];
}

/** The overview in the help dialog (H or ?). Keep it in step with resolveHotkey. */
export const HOTKEY_HELP: readonly HotkeyHelpGroup[] = [
  {
    title: 'Game',
    rows: [
      { keys: ['Space'], label: 'Start the next wave' },
      { keys: ['P'], label: 'Pause and resume' },
      { keys: ['+', '-'], label: 'Game speed up and down' },
      { keys: ['Esc'], label: 'Skip the intro flight or the boss intro' },
      { keys: ['Q'], label: 'Open the research tree, once a Research Center stands' },
      { keys: ['M'], label: 'All sound on and off' },
      { keys: ['Alt'], label: 'Hold to show the health bars the other way round (option Health Bars)' },
      ...ABILITY_IDS.map((id) => ({
        keys: [ABILITIES[id].hotkey.toUpperCase()],
        label: `Aim the ${ABILITIES[id].name} once researched, press again to cancel`,
      })),
    ],
  },
  {
    title: 'Towers',
    rows: [
      { keys: ['1', '9'], range: true, label: 'Pick a tower from the build panel' },
      { keys: ['R'], label: 'Hold to rotate while building, or the portal while placing a spawn' },
      { keys: ['U'], label: 'Upgrade the selected tower: the first upgrade you can afford' },
      { keys: ['Del'], label: 'Sell the selected tower, press twice' },
      { keys: ['C'], label: 'Get into the selected tower and fire it yourself: mouse aims, left button fires, right button zooms; C or Esc gets out' },
      { keys: ['Esc'], label: 'Cancel building, close a menu, deselect' },
    ],
  },
  {
    title: 'Hero',
    rows: [
      { keys: ['G'], label: 'Select the Mercenary once hired, click the route to send him; again to fly to him' },
      { keys: ['V'], label: 'Switch his ammo: standard, explosive, rune' },
    ],
  },
  {
    title: 'Camera',
    rows: [
      { keys: ['W', 'A', 'S', 'D'], label: 'Move, arrow keys too, hold Shift for faster' },
      { keys: ['Home'], label: 'Fly to the HQ' },
      { keys: ['N'], label: 'Fly to the next spawn point' },
      { keys: ['O'], label: 'Photo mode: hide the interface, save screenshots; Esc leaves it' },
    ],
  },
  {
    title: 'Replay of the last wave',
    rows: [
      { keys: ['Space', 'P'], label: 'Pause and play' },
      { keys: ['+', '-'], label: 'Replay speed, 0.25x to 4x' },
      { keys: ['Esc'], label: 'Back to the game' },
    ],
  },
  {
    title: 'Help',
    rows: [
      { keys: ['H', '?'], label: 'This overview' },
    ],
  },
  {
    title: 'Debug',
    rows: [
      { keys: ['T'], label: 'Hide or show the 3D map' },
      { keys: ['Shift+P'], label: 'Particle shader on or off' },
    ],
  },
];
