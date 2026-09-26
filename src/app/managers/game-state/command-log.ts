import { GameObject } from '../../core/game-object';
import type { LosResolveReason } from '../../game-engine/game-event-bus';
import { losMaskToJson, type LosMask, type LosMaskJson } from '../../utils/los-mask';
import type { CommandData } from './command-data';

/** The player at this machine; coop gives every player an id of its own. */
export const LOCAL_PLAYER_ID = 'local';

/** A command as it went in, see CommandLog. */
export interface CommandLogEntry {
  /**
   * Sub-steps run when the command took effect (GameClock.subStep at that
   * boundary): it acts after step `step` and before step `step + 1`.
   */
  readonly step: number;
  /** Who gave it, LOCAL_PLAYER_ID until there is coop */
  readonly playerId: string;
  /** The event as plain data (toPlainData), `type` included */
  readonly command: CommandData;
}

/**
 * Every command of a run in the order it took effect, with the sub-step
 * boundary it took effect at: the input a re-simulation plays again
 * (docs/SIMULATOR_PLAN.md, P1). A refused command is in it as well, a
 * re-simulation has to see the same inputs.
 *
 * Owned by the GameStateManager, written by the GameCommandsHandler when it
 * executes a command, cleared with a new run or a new place. Commands are
 * few (hundreds a run, the aim of a manned tower at most one a frame), so
 * the copy per entry costs nothing of note, and nothing here runs per
 * sub-step.
 */
export class CommandLog {
  private readonly list: CommandLogEntry[] = [];

  /** @param stepNow the sub-steps run so far (GameClock.subStep) */
  constructor(private readonly stepNow: () => number = () => 0) {}

  /** The entries in the order the commands took effect. */
  get entries(): readonly CommandLogEntry[] {
    return this.list;
  }

  get length(): number {
    return this.list.length;
  }

  /** Log `command` as taking effect now. */
  record(command: { readonly type: string }, playerId: string = LOCAL_PLAYER_ID): CommandLogEntry {
    const entry: CommandLogEntry = {
      step: this.stepNow(),
      playerId,
      command: toPlainData(command) as CommandData,
    };
    this.list.push(entry);
    return entry;
  }

  /**
   * Log a tower's line of sight as it was resolved now (tower:los-resolved).
   * Not an input but a result the GPU gave against the tiles loaded at the
   * time: a re-simulation applies it instead of rendering a cube again,
   * which could see other tiles (docs/SIMULATOR_PLAN.md, P3). The retrofit
   * resolves one tower per frame, so its moment depends on the frame rate
   * and has to come from here as well.
   */
  recordLos(towerId: string, mask: LosMask, reason: LosResolveReason): CommandLogEntry {
    const entry: CommandLogEntry = {
      step: this.stepNow(),
      playerId: LOCAL_PLAYER_ID,
      command: { type: LOS_LOG_TYPE, towerId, reason, mask: losMaskToJson(mask) },
    };
    this.list.push(entry);
    return entry;
  }

  clear(): void {
    this.list.length = 0;
  }
}

/** `command.type` of a line of sight entry, see CommandLog.recordLos. */
export const LOS_LOG_TYPE = 'los:resolved';

/** A line of sight entry of the log, see CommandLog.recordLos. */
export interface LosLogCommand {
  readonly type: typeof LOS_LOG_TYPE;
  readonly towerId: string;
  readonly reason: LosResolveReason;
  readonly mask: LosMaskJson;
}

export function isLosLogCommand(command: CommandData): command is CommandData & LosLogCommand {
  return command.type === LOS_LOG_TYPE;
}

/** How deep toPlainData() follows nested objects; a command is shallow. */
const PLAIN_DATA_DEPTH = 8;

/**
 * A command as plain data for the command log: numbers, strings, booleans,
 * plain objects and arrays are copied, functions left out, an entity is
 * kept as its id. The log stays valid whatever happens to the objects later.
 */
export function toPlainData(value: unknown, depth = 0): unknown {
  if (typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof GameObject) return { id: value.id };
  if (depth >= PLAIN_DATA_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((item) => toPlainData(item, depth + 1) ?? null);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const copy = toPlainData((value as Record<string, unknown>)[key], depth + 1);
    if (copy !== undefined) out[key] = copy;
  }
  return out;
}
