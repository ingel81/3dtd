# Balance calculator

Replays the wave planning of a recorded run against that run's defense, wave by wave, without bots and without a
browser: the real budget source (`director/sources/budget/`) with its pressure loop, the real run plan, the real
defense analysis. What it cannot know, what a wave costs the HQ, comes from a small estimate fitted to the run. The
point is a before/after table for every change to the planner: same defense, old against new constants.

```bash
# the tables, into a directory of your choice
BALANCE_OUT=<dir> BALANCE_LABEL=after npx vitest run tools/balance-calc/balance-calc.spec.ts

# a new trajectory from another run (run log and its replay)
BALANCE_RUN_LOG=<run.jsonl> BALANCE_REPLAY=<replay.json> npx vitest run tools/balance-calc/extract.spec.ts
```

Without `BALANCE_OUT` the spec runs as part of `npm test` and only checks that it still runs.

## Input: `trajectory.json`

One line per wave of the human solo run of 2026-10-01 (60 waves, death in W60), no place, seed or positions:

- `plan`: the towers and their upgrade levels when the wave was planned (end of the wave before), rebuilt from the
  replay's snapshot at that wave's start plus the placements, upgrades and sales during it; AA retrofit from the run
  log's research events.
- `start`: the towers at the wave's start (the replay's snapshot).
- `actual`: what the run log says the planner did (HP factors, budget, window, regulator) and what the wave cost.

The run log's own tower list leaves out towers that did nothing in a wave and so is not used for the defense.

## What is rebuilt and how well

| Part | Source | Check against the run |
|---|---|---|
| Matrix damage per armor | `defense-analyzer.addTowerDps`, `computeTowerDPSFromLevels` | HP factors W1 to W33 equal to the logged ones; from W33 1 to 2 % low (the hero, hired at W32, is not counted) |
| Metres of route under fire | read back from the logged window: `window = spawn seconds + mean(metres / speed)` | exact by construction; at the start of a wave the next wave's reading is used |
| Metres one tower sees (`damageMetres`) | `towerShare` = 0.215 of the metres under fire | the Ooze's logged HP factor 0.12 (W20); Herbert's 0.1 (W10, at the floor) agrees |
| Pressure loop | `BudgetWaveSource` itself, fed the logged HQ loss | regulator equal to the logged one in all 60 waves |

## The leak estimate (model.ts)

A wave's HP are worked through at the realised damage, `u` times the matrix damage, while the wave is under fire
(spawn seconds plus its mean time on the route, as the planner's window). What does not fit gets through, spread
evenly over the bodies: `leak share = 1 - window / need`. A single body that the defense cannot kill on its own while
it walks past (`hp > single * u * dps * fire`) gets through whole. A leak costs the type's leak damage times the
wave's leak scale, as in the game.

Fitted to the run (`HUMAN_RUN_MODEL`):

| Value | | Evidence |
|---|---|---|
| `ground` 0.65 | realised share against ground | no ground wave leaked, the highest load at u = 1 was 0.61; the logged utilisation (damage dealt over duration times matrix damage) peaks at 0.62 to 0.68 |
| `air` 0.58 | against air | W58 (load 0.65 at u = 1) lost 17 % of its bodies, W50 (0.67) 4 %, W42 and W49 (0.61, 0.57) none; 0.58 gives the late air losses in sum (estimate 261 HP, run 251), not wave by wave |
| `ethereal` 0.55 | ghosts, wraiths | W52 (0.62) lost 11 % of its wraiths: 0.55 gives 109 HP, the run 108; W24 (0.66, 23 bodies) lost nothing, the estimate 15 |
| `single` 1.4 | one body alone | W12 (one dragon of seven got through at 0.77 of a body's fire) and W27 (none at 0.71) |
| `buildUpWaves` 7 | W5 to W7 lost 136 HP at loads of 0.26 to 0.54 | where the first towers stand, which a load cannot see: these waves cost what they cost in the run, on top of the estimate |

With the planner as it was (R up to 1.5), the estimate gives HQ 363 / 348 / 315 / 315 / 224 / 21 after W10 to W60
against 363 / 357 / 356 / 356 / 330 / 0 in the run: the same total, the losses partly in other waves (W24, W27 and
W42 cost 15 to 29 HP in the estimate and nothing in the run; W58 and W60 cost less). It reads trends and the
difference between two sets of constants, not single waves.

Weaker and stronger players: `strength` scales `u`, not the towers. The planner sizes against the towers' damage, so
more or fewer towers alone change nothing; what tells players apart is what they make of the same towers (placement,
targeting, timing). 0.7 and 1.3 are guesses at the spread, not measured.

Not in it: the hero, abilities, coop, the split of an Ooze's body by the metre, slow and DoT beyond their DPS figure,
and anything about where the towers stand beyond the metres.
