/**
 * A run's defense and outcome, wave by wave, in the shape the balance
 * calculator replays (README.md). Built once from a run log and its replay
 * (extract.spec.ts); the file carries no place, seed or positions, only what
 * stood and what happened.
 */

/** Towers of one kind at one set of upgrade levels, and how many of them. */
export type TowerGroup = readonly [type: string, levels: Readonly<Record<string, number>>, count: number];

export interface DefenseAt {
  readonly towers: readonly TowerGroup[];
  /** AA retrofit researched (cannon, rocket and others hit air). */
  readonly aa: boolean;
}

/** What the run log says the planner did and what the wave cost. */
export interface WaveActual {
  readonly template: string;
  /** Per type: count and HP factor as shipped. */
  readonly composition: readonly { type: string; count: number; hp: number }[];
  readonly regulator: number;
  readonly targetPressure: number;
  readonly budget: number;
  readonly delivered: number;
  readonly window: number;
  readonly capped: boolean;
  readonly healthStart: number;
  readonly healthEnd: number;
  readonly spawned: number;
  readonly leaked: number;
  readonly durationS: number;
  /** Damage the towers dealt in the wave. */
  readonly damage: number;
}

export interface TrajectoryWave {
  readonly wave: number;
  /** The defense when the wave was planned: at the end of the wave before, before the break's purchases. */
  readonly plan: DefenseAt;
  /** The defense when the wave started. */
  readonly start: DefenseAt;
  readonly actual: WaveActual;
}

export interface Trajectory {
  readonly source: string;
  readonly startHealth: number;
  readonly waves: readonly TrajectoryWave[];
}

interface LogWave {
  kind: 'wave';
  wave: number;
  step: number;
  timeMs: number;
  durationMs: number;
  template: string;
  composition: { type: string; count: number; hp: number }[];
  pressureMultiplier: number;
  targetPressure: number;
  diagnostics: { budget: number; delivered: number; window: number; capped: boolean };
  healthStart: number;
  healthEnd: number;
  enemiesSpawned: number;
  leaked: number;
  towers: { type: string; levels: Record<string, number>; damage: number }[];
}

interface ReplayCommand {
  step: number;
  command: { type: string; typeId?: string; towerId?: string; upgradeId?: string; reason?: string };
}

interface LogEvent {
  kind: 'event';
  event: string;
  timeMs: number;
  id?: string;
}

interface ReplayWave {
  wave: number;
  startStep: number;
  endStep: number;
  snapshot: {
    towers: { id: string; typeId: string; upgrades: [string, number][] }[];
    research: { completed: string[] };
  };
}

const AA_RESEARCH = 'aa-retrofit';

function group(towers: readonly { type: string; levels: Record<string, number> }[]): TowerGroup[] {
  const groups = new Map<string, [string, Record<string, number>, number]>();
  for (const tower of towers) {
    const levels = Object.fromEntries(Object.entries(tower.levels).filter(([, level]) => level > 0).sort());
    const key = `${tower.type} ${JSON.stringify(levels)}`;
    const entry = groups.get(key);
    if (entry) entry[2]++;
    else groups.set(key, [tower.type, levels, 1]);
  }
  return [...groups.values()].sort((a, b) => (a[0] + JSON.stringify(a[1])).localeCompare(b[0] + JSON.stringify(b[1])));
}

/**
 * The towers standing at `step` of wave `wave`: the replay's snapshot at the
 * wave's start with the placements and upgrades of the wave up to `step`.
 * A placement's tower id comes with the LOS mask of the same step.
 */
function towersAt(replay: { waves: ReplayWave[]; log: ReplayCommand[] }, wave: number, step: number): { type: string; levels: Record<string, number> }[] {
  const start = replay.waves.find((w) => w.wave === wave);
  if (!start) return [];
  const towers = new Map(start.snapshot.towers.map((t) => [t.id, { type: t.typeId, levels: Object.fromEntries(t.upgrades) as Record<string, number> }]));
  const placed: string[] = [];
  for (const { step: at, command } of replay.log) {
    if (at < start.startStep || at > step) continue;
    if (command.type === 'command:place-tower' && command.typeId) placed.push(command.typeId);
    else if (command.type === 'command:los-mask' && command.reason === 'place' && command.towerId && placed.length) {
      towers.set(command.towerId, { type: placed.shift()!, levels: {} });
    } else if (command.type === 'command:upgrade-tower' && command.towerId && command.upgradeId) {
      const tower = towers.get(command.towerId);
      if (tower) tower.levels[command.upgradeId] = (tower.levels[command.upgradeId] ?? 0) + 1;
    } else if (command.type === 'command:sell-tower' && command.towerId) {
      towers.delete(command.towerId);
    }
  }
  return [...towers.values()];
}

/**
 * The trajectory of one run: `logLines` the run log (JSONL), `replay` its
 * replay file. The plan-time defense is what stood when the wave before
 * ended (its start snapshot and the commands during it), with the research
 * done by then; the start-time defense is the replay's snapshot at the
 * wave's start.
 */
export function extractTrajectory(
  source: string, logLines: readonly string[], replay: { waves: ReplayWave[]; log: ReplayCommand[] },
): Trajectory {
  const records = logLines.filter((line) => line.trim()).map((line) => JSON.parse(line) as { kind: string });
  const waves = records.filter((r): r is LogWave => r.kind === 'wave');
  const research = records.filter((r): r is LogEvent => r.kind === 'event' && (r as LogEvent).event === 'research-completed');
  const snapshots = new Map(replay.waves.map((w) => [w.wave, w]));
  const startHealth = waves[0]?.healthStart ?? 500;

  const out: TrajectoryWave[] = [];
  for (const record of waves) {
    const before = waves.find((w) => w.wave === record.wave - 1);
    const planTime = before ? before.timeMs + before.durationMs : 0;
    const replayBefore = snapshots.get(record.wave - 1);
    const snapshot = snapshots.get(record.wave)?.snapshot;
    out.push({
      wave: record.wave,
      plan: {
        towers: group(replayBefore ? towersAt(replay, record.wave - 1, replayBefore.endStep) : []),
        aa: research.some((r) => r.id === AA_RESEARCH && r.timeMs <= planTime),
      },
      start: {
        towers: group((snapshot?.towers ?? []).map((t) => ({ type: t.typeId, levels: Object.fromEntries(t.upgrades) }))),
        aa: snapshot?.research.completed.includes(AA_RESEARCH) ?? false,
      },
      actual: {
        template: record.template,
        composition: record.composition,
        regulator: record.pressureMultiplier,
        targetPressure: record.targetPressure,
        budget: record.diagnostics.budget,
        delivered: record.diagnostics.delivered,
        window: record.diagnostics.window,
        capped: record.diagnostics.capped,
        healthStart: record.healthStart,
        healthEnd: record.healthEnd,
        spawned: record.enemiesSpawned,
        leaked: record.leaked,
        durationS: record.durationMs / 1000,
        damage: Math.round(record.towers.reduce((sum, t) => sum + t.damage, 0)),
      },
    });
  }
  return { source, startHealth, waves: out };
}
