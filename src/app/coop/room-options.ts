/**
 * The options of a coop room (docs/COOP_PLAN.md, D38): the host sets them in
 * the lobby, the relay keeps them and enforces pause and cheats, every
 * client reads the same values from the start message. Pure, no Angular:
 * the relay (coop-server/) imports it too.
 */

/** Who may use the dev tools' cheats: nobody, the host, or everyone (only where the relay allows cheats) */
export type CheatRule = 'off' | 'host' | 'all';
/** Who may pause the game */
export type PauseRule = 'host' | 'all' | 'off';
/** How the next wave starts: once all are ready, when the host says, or by itself after AUTO_WAVE_DELAY_MS (D44) */
export type WaveRule = 'all' | 'host' | 'auto';

export interface CoopRoomOptions {
  cheats: CheatRule;
  pause: PauseRule;
  wave: WaveRule;
}

/** A new room (User, 2026-09-25: as in the design handover) */
export const DEFAULT_ROOM_OPTIONS: CoopRoomOptions = { cheats: 'off', pause: 'host', wave: 'all' };

export type RoomOptionKey = keyof CoopRoomOptions;

/** The options as the lobby lists them, in order: label and the choices with theirs */
export const ROOM_OPTION_CHOICES: readonly {
  key: RoomOptionKey;
  label: string;
  choices: readonly { value: string; label: string }[];
}[] = [
  { key: 'cheats', label: 'Cheats', choices: [{ value: 'off', label: 'Off' }, { value: 'host', label: 'Host only' }, { value: 'all', label: 'Everyone' }] },
  { key: 'wave', label: 'Next wave', choices: [{ value: 'all', label: 'All ready' }, { value: 'host', label: 'Host starts' }, { value: 'auto', label: 'Auto 10 s' }] },
  { key: 'pause', label: 'Pause', choices: [{ value: 'host', label: 'Host only' }, { value: 'all', label: 'Anyone' }, { value: 'off', label: 'Off' }] },
];

/** The label of `value` for option `key`, as the lobby shows it */
export function optionLabel(key: RoomOptionKey, value: string): string {
  return ROOM_OPTION_CHOICES.find((o) => o.key === key)?.choices.find((c) => c.value === value)?.label ?? value;
}

/** `options` if every value is one of its choices, else null (the relay refuses what a client made up) */
export function validOptions(options: unknown): CoopRoomOptions | null {
  if (!options || typeof options !== 'object') return null;
  const o = options as Record<string, unknown>;
  for (const { key, choices } of ROOM_OPTION_CHOICES) {
    if (!choices.some((c) => c.value === o[key])) return null;
  }
  return { cheats: o['cheats'] as CheatRule, pause: o['pause'] as PauseRule, wave: o['wave'] as WaveRule };
}

/** `playerId` may use a cheat: the relay allows cheats and the room's rule lets them */
export function mayCheat(options: CoopRoomOptions, relayAllows: boolean, playerId: string, hostId: string): boolean {
  if (!relayAllows) return false;
  return options.cheats === 'all' || (options.cheats === 'host' && playerId === hostId);
}

/** The player may pause the game, or resume it */
export function mayPause(options: CoopRoomOptions, isHost: boolean): boolean {
  return options.pause === 'all' || (options.pause === 'host' && isHost);
}

/**
 * What the wave button (and Space) does in a coop game: say ready, or start
 * the wave at once where the room lets the host start them (D38)
 */
export function waveButtonAction(options: CoopRoomOptions, isHost: boolean): 'ready' | 'start' {
  return isHost && options.wave === 'host' ? 'start' : 'ready';
}

/** All are ready: the host's client starts the wave, unless the room leaves that to the host's button */
export function startsWhenAllReady(options: CoopRoomOptions): boolean {
  return options.wave !== 'host';
}

/** The keys whose value differs between `a` and `b` */
export function changedOptions(a: CoopRoomOptions, b: CoopRoomOptions): RoomOptionKey[] {
  return ROOM_OPTION_CHOICES.map((o) => o.key).filter((key) => a[key] !== b[key]);
}
