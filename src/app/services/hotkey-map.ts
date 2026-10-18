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
import { UPGRADE_MANY } from '../utils/player-actions';
import type { Messages } from '../i18n/messages/en';

export type HotkeyAction =
  /** Pick the build card at this position of the BUILD panel, 0-based */
  | { kind: 'select-tower'; slot: number }
  /** Upgrade the selected tower `times` in a row, as far as the credits go (Shift 5, Ctrl 10, TODO E45) */
  | { kind: 'upgrade'; times: number }
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
  /** Glide to saved camera view `slot` (F1 to F5), 0-based */
  | { kind: 'camera-recall'; slot: number }
  /** Save the camera's view in `slot` (Shift+F1 to Shift+F5), 0-based */
  | { kind: 'camera-store'; slot: number }
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

/**
 * Saved camera views on F1 to F5, Shift to save, as in RTS games (TODO E20).
 * The number keys pick towers, Ctrl+number switches tabs and Alt+number does
 * so on Linux. The browser's F1 (help), F3 (find) and F5 (reload) and their
 * Shift forms give way when the page takes the key; Ctrl+F5 stays the
 * browser's. The desktop app keeps only F11 and F12 for itself.
 */
const CAMERA_SLOT_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5'];

/** The camera slot of F1 to F5 with no modifier but Shift, 0-based; null for any other key */
export function cameraSlotOf(e: HotkeyEvent): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  const slot = CAMERA_SLOT_KEYS.indexOf(e.key);
  return slot >= 0 ? slot : null;
}

/** Ability by its key (AbilityConfig.hotkey), lower case */
const ABILITY_BY_KEY = new Map(ABILITY_IDS.map((id) => [ABILITIES[id].hotkey.toLowerCase(), id]));

/** Number key of the build card at `index`, null past the ninth. */
export function towerSlotKey(index: number): string | null {
  return index >= 0 && index < TOWER_SLOT_KEYS ? String(index + 1) : null;
}

/** The game action for a key, null when the key is not a game hotkey. */
export function resolveHotkey(e: HotkeyEvent): HotkeyAction | null {
  // Ctrl+U buys ten upgrades (TODO E45), the one Ctrl key the game takes
  if (e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && e.key.toLowerCase() === 'u') {
    return { kind: 'upgrade', times: UPGRADE_MANY.ctrl };
  }
  // Browser and system shortcuts (Ctrl+1 switches tabs) stay theirs. A held
  // key repeats keydown; none of these actions should fire twice from it.
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return null;

  const cameraSlot = cameraSlotOf(e);
  if (cameraSlot !== null) {
    return e.shiftKey ? { kind: 'camera-store', slot: cameraSlot } : { kind: 'camera-recall', slot: cameraSlot };
  }
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
      return { kind: 'upgrade', times: e.shiftKey ? UPGRADE_MANY.shift : 1 };
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

/** The overview in the help dialog (H or ?), in the player's language. Keep it in step with resolveHotkey. */
export function hotkeyHelp(t: Messages): HotkeyHelpGroup[] {
  const k = t.hud.keys;
  const c = k.caps;
  return [
    {
      title: k.game,
      rows: [
        { keys: [c.space], label: k.startWave },
        { keys: ['P'], label: k.pause },
        { keys: ['+', '-'], label: k.speed },
        { keys: [c.esc], label: k.skipIntro },
        { keys: ['Q'], label: k.research },
        { keys: ['M'], label: k.mute },
        { keys: [c.alt], label: k.healthBars },
        ...ABILITY_IDS.map((id) => ({ keys: [ABILITIES[id].hotkey.toUpperCase()], label: k.ability(t.abilities[id].name) })),
      ],
    },
    {
      title: k.towers,
      rows: [
        { keys: ['1', '9'], range: true, label: k.pickTower },
        { keys: ['R'], label: k.rotate },
        { keys: ['U'], label: k.upgrade },
        { keys: [c.shift, 'U'], label: k.upgradeMany(UPGRADE_MANY.shift, UPGRADE_MANY.ctrl) },
        { keys: [c.del], label: k.sell },
        { keys: ['C'], label: k.man },
        { keys: [c.esc], label: k.cancel },
      ],
    },
    {
      title: k.hero,
      rows: [
        { keys: ['G'], label: k.heroSelect(t.hero.name) },
        { keys: ['V'], label: k.heroAmmo },
      ],
    },
    {
      title: k.camera,
      rows: [
        { keys: ['W', 'A', 'S', 'D'], label: k.move },
        { keys: [c.home], label: k.toHq },
        { keys: ['N'], label: k.toSpawn },
        { keys: [`${c.shift}+F1`, `${c.shift}+F5`], range: true, label: k.saveView },
        { keys: ['F1', 'F5'], range: true, label: k.recallView },
        { keys: ['O'], label: k.photo },
      ],
    },
    {
      title: k.replay,
      rows: [
        { keys: [c.space, 'P'], label: k.replayPause },
        { keys: ['+', '-'], label: k.replaySpeed },
        { keys: [c.esc], label: k.replayBack },
      ],
    },
    {
      title: k.coop,
      rows: [
        { keys: [c.tab], label: k.dock },
        { keys: [c.enter], label: k.chat },
        { keys: ['X'], label: k.mark },
      ],
    },
    {
      title: k.help,
      rows: [
        { keys: ['H', '?'], label: k.overview },
      ],
    },
    {
      title: k.debug,
      rows: [
        { keys: ['T'], label: k.hideMap },
        { keys: [`${c.shift}+P`], label: k.particles },
      ],
    },
  ];
}
