/**
 * The fields of every command a coop client may send (docs/COOP_PLAN.md,
 * S4). The relay passes a command on with these fields only: a changed
 * client's extra keys would otherwise land in every client's command log,
 * its replay and its run log. Unknown command types do not pass at all.
 *
 * Only the top level: what a field holds (a position, a wave, a line of
 * sight) the clients check with commandProblem (command-guard.ts), the
 * relay bounds it in size (validate.ts).
 *
 * The relay imports this file, so it imports nothing. The table must name
 * every command and every field of it: command-fields.spec.ts holds it
 * against the game's events, a command or field the game adds without an
 * entry here fails the spec's type check.
 */
export const COMMAND_FIELDS = {
  'command:place-tower': ['position', 'typeId', 'rotation', 'plinthHeight', 'plinthOverhang'],
  'command:sell-tower': ['towerId'],
  'command:upgrade-tower': ['towerId', 'upgradeId'],
  'command:choose-path': ['towerId', 'pathId'],
  'command:set-targeting': ['towerId', 'strategy', 'airSubStrategy'],
  'command:set-hold-fire': ['towerId', 'holdFire'],
  'command:man-tower': ['towerId'],
  'command:leave-tower': [],
  'command:tower-trigger': ['held'],
  'command:tower-aim': ['heading', 'pitch'],
  'command:start-wave': ['config', 'director', 'plan'],
  'command:restart-game': ['seed'],
  'command:los-mask': ['towerId', 'reason', 'mask', 'generation'],
  'command:leave-game': [],
  'command:set-ready': ['ready'],
  'command:give-credits': ['to', 'amount'],
  'command:start-research': ['researchId'],
  'command:cancel-research': ['researchId'],
  'command:queue-research': ['researchId'],
  'command:unqueue-research': ['researchId'],
  'command:move-queued-research': ['researchId', 'toIndex'],
  'command:use-ability': ['abilityId', 'target'],
  'command:hire-hero': [],
  'command:hero-move': ['target'],
  'command:hero-ammo': ['ammo'],
  'debug:sound': ['eventType', 'soundId', 'timestamp', 'details'],
  'debug:start-custom-wave': [],
  'debug:spawn-enemy': ['enemyType', 'count', 'path', 'start', 'speed', 'paused', 'health'],
  'debug:kill-all': [],
  'debug:add-credits': ['amount'],
  'debug:add-health': ['amount'],
  'debug:complete-all-research': [],
  'debug:max-upgrade-all-towers': [],
  'debug:ready-ability': ['abilityId'],
  'debug:jump-to-wave': ['wave', 'grantGold'],
  'debug:ready-hero': [],
  'debug:remove-enemy': ['enemyId'],
  'debug:enemy-move': ['enemyId', 'action'],
  'debug:enemy-speed': ['enemyId', 'speedMps'],
  'debug:movement': ['enabled'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

/**
 * `command` with its type and the known fields it has, nothing else; null
 * for a type that is no command. Own keys only, so a type like "toString"
 * is none.
 */
export function knownFields(command: { readonly type: string } & Readonly<Record<string, unknown>>): { type: string } & Record<string, unknown> | null {
  if (!Object.hasOwn(COMMAND_FIELDS, command.type)) return null;
  const out: { type: string } & Record<string, unknown> = { type: command.type };
  for (const key of COMMAND_FIELDS[command.type as keyof typeof COMMAND_FIELDS] as readonly string[]) {
    if (Object.hasOwn(command, key)) out[key] = command[key];
  }
  return out;
}
