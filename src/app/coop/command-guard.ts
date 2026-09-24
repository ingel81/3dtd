/**
 * Plausibility of a command before it acts (docs/COOP_PLAN.md, S4). The UI
 * never sends these values out of range; a changed client or a garbled
 * message could, and the game logic behind a command trusts its numbers
 * (a NaN position, a tower type that is not there). Every client checks the
 * same command the same way, so one refused acts nowhere, like a command the
 * rules refuse. Existence of towers, researches and funds stays with the
 * game logic. Framework-free and pure.
 */
import { TOWER_TYPES } from '../configs/tower-types.config';
import { ABILITIES } from '../configs/abilities.config';
import { HERO_AMMO } from '../configs/hero.config';

/** A stone plinth under a tower is never higher, m */
const MAX_PLINTH_M = 200;
/** Footprint probes a plinth may hang over at most */
const MAX_OVERHANG_PROBES = 64;
/** Ids the game hands out are short */
const MAX_ID_LENGTH = 64;
/** A wave larger than this is no wave the game or its dev tools make */
const MAX_WAVE_ENEMIES = 20_000;
/** Gold a player may send or a dev tool may add at once */
const MAX_AMOUNT = 10_000_000;

type Command = { readonly type: string } & Readonly<Record<string, unknown>>;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalFinite = (value: unknown) => value === undefined || finite(value);
const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
const bool = (value: unknown) => typeof value === 'boolean';
const integerIn = (value: unknown, min: number, max: number) =>
  finite(value) && Number.isInteger(value) && value >= min && value <= max;
const known = (value: unknown, table: object) => typeof value === 'string' && Object.hasOwn(table, value);

/** A place on the earth: lat, lon, and an optional height */
function geo(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lon, height } = value as Record<string, unknown>;
  return finite(lat) && Math.abs(lat) <= 90 && finite(lon) && Math.abs(lon) <= 180 && optionalFinite(height);
}

/** The enemies of a wave from the wave source: known shape, a sane count */
function directorWave(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const enemies = (value as Record<string, unknown>)['enemies'];
  if (!Array.isArray(enemies) || enemies.length > 256) return false;
  let total = 0;
  for (const group of enemies) {
    const { type, count } = (group ?? {}) as Record<string, unknown>;
    if (!id(type) || !integerIn(count, 0, MAX_WAVE_ENEMIES)) return false;
    total += count as number;
  }
  return total <= MAX_WAVE_ENEMIES;
}

function placeTowerProblem(c: Command): string | null {
  if (!geo(c['position'])) return 'position';
  if (!known(c['typeId'], TOWER_TYPES)) return 'tower type';
  if (!optionalFinite(c['rotation'])) return 'rotation';
  const plinth = c['plinthHeight'];
  if (plinth !== undefined && !(finite(plinth) && plinth >= 0 && plinth <= MAX_PLINTH_M)) return 'plinth height';
  const overhang = c['plinthOverhang'];
  if (overhang !== undefined
    && !(Array.isArray(overhang) && overhang.length <= MAX_OVERHANG_PROBES && overhang.every((p) => integerIn(p, 0, 1000)))) {
    return 'plinth overhang';
  }
  return null;
}

/**
 * A heading within two turns either way and a pitch from straight down to
 * straight up. The mouse keeps the pitch within TOWER_CONTROL's limits; the
 * simulation does not ask for them, so neither does this.
 */
function aimOk(c: Command): boolean {
  const heading = c['heading'];
  const pitch = c['pitch'];
  return finite(heading) && Math.abs(heading) <= 4 * Math.PI && finite(pitch) && Math.abs(pitch) <= Math.PI / 2;
}

/** What is wrong with `command`, null when it may act. */
export function commandProblem(c: Command): string | null {
  switch (c.type) {
    case 'command:place-tower':
      return placeTowerProblem(c);
    case 'command:sell-tower':
    case 'command:man-tower':
      return id(c['towerId']) ? null : 'tower id';
    case 'command:upgrade-tower':
      return id(c['towerId']) && id(c['upgradeId']) ? null : 'upgrade';
    case 'command:set-targeting':
      return id(c['towerId'])
        && (c['strategy'] === undefined || id(c['strategy']))
        && (c['airSubStrategy'] === undefined || id(c['airSubStrategy'])) ? null : 'targeting';
    case 'command:set-hold-fire':
      return id(c['towerId']) && bool(c['holdFire']) ? null : 'hold fire';
    case 'command:tower-trigger':
      return bool(c['held']) ? null : 'trigger';
    case 'command:tower-aim':
      return aimOk(c) ? null : 'aim';
    case 'command:start-wave':
      return c['director'] === undefined || directorWave(c['director']) ? null : 'wave';
    case 'command:restart-game':
      return c['seed'] === undefined || integerIn(c['seed'], 0, 0xffffffff) ? null : 'seed';
    case 'command:set-ready':
      return bool(c['ready']) ? null : 'ready';
    case 'command:give-credits':
      return id(c['to']) && integerIn(c['amount'], 1, MAX_AMOUNT) ? null : 'gift';
    case 'command:start-research':
    case 'command:cancel-research':
    case 'command:queue-research':
    case 'command:unqueue-research':
      return id(c['researchId']) ? null : 'research';
    case 'command:move-queued-research':
      return id(c['researchId']) && integerIn(c['toIndex'], 0, 1000) ? null : 'research queue';
    case 'command:use-ability':
      return known(c['abilityId'], ABILITIES) && geo(c['target']) ? null : 'ability';
    case 'command:hero-move':
      return geo(c['target']) ? null : 'hero move';
    case 'command:hero-ammo':
      return known(c['ammo'], HERO_AMMO) ? null : 'hero ammo';
    case 'debug:add-credits':
    case 'debug:add-health':
      return finite(c['amount']) && Math.abs(c['amount']) <= MAX_AMOUNT ? null : 'amount';
    case 'debug:ready-ability':
      return known(c['abilityId'], ABILITIES) ? null : 'ability';
    case 'debug:jump-to-wave':
      return integerIn(c['wave'], 1, 10_000) && bool(c['grantGold']) ? null : 'wave';
    case 'debug:remove-enemy':
      return id(c['enemyId']) ? null : 'enemy id';
    case 'debug:spawn-enemy':
      return id(c['enemyType']) && (c['count'] === undefined || integerIn(c['count'], 1, 1000)) ? null : 'enemy';
    default:
      return null;
  }
}
