import { describe, it, expect } from 'vitest';
import type { GameEvent } from '../game-engine/game-event-bus';
import { COMMAND_FIELDS, knownFields } from './command-fields';

/** Every event a client may give as a command: the game's commands and the dev tools' cheats */
type CommandType = Extract<GameEvent['type'], `command:${string}` | `debug:${string}`>;
type Table = typeof COMMAND_FIELDS;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The fields of command `T` the game's event has, `type` aside */
type EventFields<T extends CommandType> = Exclude<keyof Extract<GameEvent, { type: T }>, 'type'>;
/** The commands whose fields in the table are not the event's */
type Wrong = { [T in CommandType]: T extends keyof Table ? (Same<EventFields<T>, Table[T][number]> extends true ? never : T) : T }[CommandType];

// The type check of the specs fails here when the game adds a command or a field without an entry in the table
const everyCommand: Same<keyof Table, CommandType> = true;
const everyField: [Wrong] extends [never] ? true : Wrong = true;

describe('knownFields', () => {
  it('names every command of the game with each of its fields', () => {
    expect(everyCommand && everyField).toBe(true);
  });

  it('keeps the type and the known fields, drops the rest and unknown commands', () => {
    expect(knownFields({ type: 'command:give-credits', to: 'p2', amount: 5, note: 'x' })).toEqual({ type: 'command:give-credits', to: 'p2', amount: 5 });
    expect(knownFields({ type: 'command:set-targeting', towerId: 't1' })).toEqual({ type: 'command:set-targeting', towerId: 't1' });
    expect(knownFields({ type: 'command:nope' })).toBeNull();
    expect(knownFields({ type: 'hasOwnProperty' })).toBeNull();
  });
});
