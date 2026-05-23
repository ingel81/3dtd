# Static Wave Fallback

**Stand:** 2026-05-23

Static-Wave-Fallback ist ein Debug-/Playtest-Modus, der Wellen aus einer
festen Per-Wave-Tabelle spawnt — als Alternative zum AI Wave Director.
Gedacht für Offline-Playtests, Headless-Tests, und Situationen in denen
das ONNX-Modell nicht geladen ist. **AI bleibt der Production-Default**;
dies ist ein bewusst opt-in Debug-Pfad.

Seit 2026-05-23 nativ multi-group: Boss-Wellen kommen mit Tank/Zombie-
Support, Mixed-Templates wie `dragon_elite` werden tatsächlich gemixt
gespawnt. Der Static-Pfad nutzt dafür dieselbe Spawn-Pipeline wie der AI
(siehe „Unified Pipeline" unten).

---

## Drei Wave-Quellen — Prioritäten

In `game-loop-facade.service.ts` `startWave()` läuft folgende Prioritätskette:

1. **Static Curriculum** (wenn `useStaticCurriculum() === true`)
   → `buildStaticCurriculumWaveConfig(nextWave)`
   → fällt auf Debug-Panel-Werte zurück nur falls die Wellennummer ungültig ist.
2. **AI Wave Director** (wenn `useAIDirector() === true`)
   → `startWaveWithAI(0)`.
3. **Debug Panel** (sonst)
   → `buildWaveConfig()` aus `WaveDebugService`-Signals.

**Wichtig:** Der Static-Toggle **schlägt** den AI-Director. Das ONNX-Modell
schaltet beim Laden `useAIDirector` automatisch ein (Effect in
`game-loop-facade.service.ts`); ohne diese Prioritätsumkehr würde ein
Klick auf den Static-Toggle nicht wirken sobald das Modell geladen ist.

Vorher (vor 2026-05-20): AI-Director-Check kam zuerst → ein Klick auf
Static reichte nicht, man musste AI manuell abdrehen. Das ist gefixt.

---

## STATIC_WAVE_PROFILES (multi-group nativ)

Definiert in `src/app/configs/wave-curriculum.config.ts`:

```ts
export interface StaticWaveGroup {
  enemyType: EnemyTypeId;
  count: number;
  hpMult: number;            // baseHp × hpMult = per-enemy HP
  speedMult?: number;        // optional, default 1.0
}

export interface StaticWaveProfile {
  wave: number;              // 1-indexed
  groups: readonly StaticWaveGroup[];  // ≥1 group
  spawnDelayMs: number;
  pattern?: SpawnPattern;    // enemy ordering ('interleaved', 'clustered', ...)
}

export const STATIC_WAVE_PROFILES: readonly StaticWaveProfile[] = [
  // ── Early game (W1-W9) ──
  { wave:  1, groups: [{ enemyType: 'zombie', count: 20, hpMult: 0.8 }], spawnDelayMs: 1000 },
  { wave:  2, groups: [{ enemyType: 'rat',    count: 60, hpMult: 1.0 }], spawnDelayMs:  400 },
  ...
  // W8 hornet_strike mirror — hornet + bat mix
  { wave:  8, groups: [
    { enemyType: 'hornet', count: 15, hpMult: 0.9 },
    { enemyType: 'bat',    count:  6, hpMult: 1.0 },
  ], spawnDelayMs: 500, pattern: 'interleaved' },
  ...
  // ── Mid game (W10-W19) — Boss W10 mit Support ──
  { wave: 10, groups: [
    { enemyType: 'herbert', count:  1, hpMult: 8.0 },
    { enemyType: 'tank',    count: 12, hpMult: 1.0 },
    { enemyType: 'zombie',  count: 18, hpMult: 0.6 },
  ], spawnDelayMs: 700, pattern: 'clustered' },
  // W16 chaos_wave mirror — 4-Mix
  { wave: 16, groups: [
    { enemyType: 'zombie', count: 18, hpMult: 1.0 },
    { enemyType: 'tank',   count: 12, hpMult: 1.5 },
    { enemyType: 'hornet', count:  8, hpMult: 1.2 },
    { enemyType: 'bear',   count:  4, hpMult: 1.0 },
  ], spawnDelayMs: 400, pattern: 'interleaved' },
  ...
  // ── Late game (W20-W30) — Boss W30 mit max Support ──
  { wave: 30, groups: [
    { enemyType: 'herbert', count:  3, hpMult: 35.0 },
    { enemyType: 'tank',    count: 25, hpMult:  2.5 },
    { enemyType: 'zombie',  count: 30, hpMult:  1.5 },
  ], spawnDelayMs: 600, pattern: 'clustered' },
];
```

Boss-Wellen (W10/W20/W30) und Mixed-Templates (W8/W12/W13/W14/W16/W18/
W23/W24/W25/W29) spiegeln jetzt die AI-Template-Komposition direkt.
Single-Group-Wellen (W1-7, W11, W15, W17, W19, W21, W22, W26-28) bleiben
single-group.

### HP-Berechnung zur Laufzeit

```ts
healthMultiplier(group) = group.hpMult × endgameHpMultiplier(waveNum)
```

Der `endgameHpMultiplier` (auch in `wave-curriculum.config.ts`) rampt ab
W20 mit +5%/Welle hoch und cappt bei 4× (W80). So bleiben spätere Loop-
Iterationen herausfordernd, obwohl das Template wieder vorne anfängt.
Der Ramp wird beim Resolven pro Gruppe in `healthMultiplier` gebaken —
der WaveManager bekommt fertige Per-Enemy-HPs.

### Speed

`speedMult?` pro Gruppe optional, sonst `ENEMY_TYPES[enemyType].baseSpeed`.

---

## Post-W30 Loop

Statt linear zu extrapolieren, **loopt** der Static-Pfad modulo 30 in
Lockstep mit `templateForWave` und `goldBudgetForWave`:

```ts
export function staticWaveProfileForWave(waveNum: number) {
  if (waveNum < 1) return null;
  return STATIC_WAVE_PROFILES[(waveNum - 1) % STATIC_WAVE_PROFILES.length];
}
```

Bedeutung:
- W31 = Profil von W1 (Zombies)
- W42 = Profil von W12 (Dragons)
- W40 / W50 / W60 = wieder Boss (W10 / W20 / W30)

Die HP-Schwierigkeit steigt trotzdem, weil `endgameHpMultiplier(waveNum)`
unabhängig von der Loop-Position wirkt: bei W42 ist der Multiplier 2.1×,
bei W80 cappt er bei 4×.

**Historisch:** Vor 2026-05-20 nutzte `staticWaveProfileForWave` für
`waveNum > 30` eine lineare Extrapolation der letzten Entry (W30 = Herbert),
mit `count *= 1.15^extra` und `hpMult += 0.5 × extra`. Das degenerierte
zu endlosen Herbert-Schwärmen ab W31. Der Loop-Fix bringt die statische
Welle wieder in Sync mit dem AI-Pfad (der schon mod 30 loopte).

Genauso wurde `goldBudgetForWave` umgestellt: vorher
`last.goldKill + extra × KILL_DELTA_PER_WAVE` (linear, +20k/Welle nach W30)
— nach der Korrektur einfach `WAVE_CURRICULUM[(waveNum - 1) % 30]`. Die
Konstanten `KILL_DELTA_PER_WAVE` und `COMPLETE_DELTA_PER_WAVE` sind
entfernt.

---

## UI-Toggle

Filing-Icon-Button in der Quick-Actions-Dev-Toolbar (rechts unten):

```html
<button class="td-dev-btn"
        [class.active]="useStaticCurriculum()"
        (click)="staticCurriculumToggled.emit()"
        matTooltip="Static curriculum waves (AI-off fallback)">
  <td-icon name="filing" />
</button>
```

Verdrahtung:
- `QuickActionsComponent.useStaticCurriculum: input.required<boolean>()`
- `QuickActionsComponent.staticCurriculumToggled: output<void>()`
- `tower-defense.component.html` bindet den Input + Handler
- `tower-defense.component.ts.onStaticCurriculumToggled()` ruft
  `facade.toggleStaticCurriculum()`
- `tower-defense-facade.service.ts.toggleStaticCurriculum()` →
  `gameLoopFacade.toggleStaticCurriculum()`
- `game-loop-facade.service.ts.toggleStaticCurriculum()` flippt das Signal

---

## `useStaticCurriculum` Signal

In `src/app/store/game.store.ts`:

```ts
readonly useStaticCurriculum = signal<boolean>(false);
```

Default: aus. Wird nicht persistiert (existiert nur in-Memory pro Session).
Über `TowerDefenseStore` re-exportiert.

---

## Key-Dateien (Anker)

| Datei | Rolle |
|---|---|
| `src/app/configs/wave-curriculum.config.ts` | `STATIC_WAVE_PROFILES`, `staticWaveProfileForWave`, `staticWaveResolvedFor` |
| `src/app/configs/enemy-types.config.ts` | `ENEMY_TYPES` (baseHp/baseSpeed-Lookup) |
| `src/app/services/facade/game-loop-facade.service.ts` | `buildStaticCurriculumWaveConfig`, Priority-Order in `startWave`, `toggleStaticCurriculum` |
| `src/app/services/facade/tower-defense-facade.service.ts` | Facade-Methode `toggleStaticCurriculum` |
| `src/app/store/game.store.ts` | `useStaticCurriculum` Signal |
| `src/app/store/tower-defense.store.ts` | Re-Export |
| `src/app/components/quick-actions/quick-actions.component.ts` | UI-Button + Input/Output |
| `src/app/tower-defense.component.{html,ts}` | Binding + Handler |
| `src/app/ai/core/templates.ts` | `golem_squad` Template (mit `minWave: 999` AI-Gate) |
| `tools/wave-planner/generate.spec.ts` | Wave-Planner-Tool (zeigt das Curriculum visuell, inkl. Gates für golem_squad) |

---

## Arbeitsverlauf

Chronologisch (Mai 2026):

1. **Konzept & Design.** Idee aus der Wave-Planner-Diskussion: man will
   das Curriculum komplett spielen können *ohne* das AI-Modell laden zu
   müssen. Bisher führte AI-aus zum Debug-Panel-Pfad (manuelle Slider),
   was für „durchspielen und schauen" unbrauchbar war.

2. **Initial-Implementierung.** `STATIC_WAVE_PROFILES` (30 Einträge,
   single-type pro Welle) + `useStaticCurriculum` Signal + UI-Toggle in
   Quick-Actions. Erste Sizing-Pass anhand des geplanten Player-DPS aus
   dem Wave-Planner.

3. **Stone Golem als Welle.** Neues Template `golem_squad` in
   `templates.ts` (`minWave: 999` blockt die heutige untrainierte AI),
   Slot in W15 (vorher `mech_army`). Gate-Tag `fortified` ergänzt im
   Wave-Planner-Mapping.

4. **Prioritäts-Bug entdeckt + behoben.** Erste Version hatte den
   AI-Check vor dem Static-Check → der Toggle wirkte nicht, weil das
   Modell sich beim Laden auto-aktiviert. Static-Check zieht jetzt vor.

5. **Playtest W1–W42 (Benutzer).** Mitschnitt der Gold-Reserven pro
   Welle deckte zwei Probleme auf:
   - Late-Game-Gold explodiert (W42 → 3.16 M Surplus). Ursache: lineare
     `+20k/+10k`-Extrapolation in `goldBudgetForWave` nach W30.
   - Post-W30 spawnten nur noch Herberts. Ursache: gleiche Mechanik in
     `staticWaveProfileForWave` (skalierte den letzten Eintrag = Boss).
   Beide Funktionen jetzt **modulo 30 loopend** in Lockstep mit
   `templateForWave`.

6. **Poison-DoT-Bug (parallel)** gefunden während dieser Playtests:
   `deltaTime * 1000` in `enemy.manager.ts` Poison-Tick-Akku → ~1000×
   inflated DPS. Fix dokumentiert in
   [Commit 68b18c6](../../../commits/68b18c6).

---

## Unified Pipeline (kein Parallel-Code mehr)

Seit 2026-05-23 läuft Static-Curriculum durch dieselbe Spawn-Pipeline
wie der AI Director. Der WaveManager hat genau einen `startWave`-Pfad
— `WaveConfig = { schedule }`, schedule-only, kein Single-Type-Fast-
Path. `staticWaveResolvedFor(waveNum)` baut eine `AIWaveConfig` (gleicher
Shape wie das, was der NN ausspuckt), die Facade gibt das an
`adaptAIWaveConfig(...)` → fertige `WaveConfig` mit Schedule.

```
staticWaveResolvedFor(10)
  → { enemies: [{type:'herbert', count:1, hM:8}, {type:'tank', count:12, hM:1}, ...],
      totalCount: 31, spawnDelay: 700, pattern: 'clustered' }
  → adaptAIWaveConfig(…) → { schedule: { entries: [...31 SpawnEntries], baseDelay: 700 } }
  → WaveManager.startWave(...)
```

Single-Group-Wellen sind einfach Schedules mit 1 Group → N SpawnEntries
desselben Typs. Funktional identisch zum alten Single-Type-Pfad, aber
keine zweite Code-Welt mehr.

## Bekannte Limitationen (= aktuelle TODOs)

1. **Golem-Template ist AI-unsichtbar.** `golem_squad.minWave: 999` ist
   ein temporärer Gate-Mechanismus für die untrainierte AI. Beim
   nächsten AI-Re-Training muss das Gate runter UND der Python-Mirror
   in `training-backend/wave_curriculum.py` parallel ergänzt werden
   (TODO 2.2 in [TODO.md](../TODO.md)).

2. **Per-Wave-Tuning ist iterativ.** Die aktuellen Counts/HP-Mults sind
   gegen die optimistische Player-DPS aus dem Wave-Planner kalibriert.
   Real abweichende Builds (z.B. nur Archer-Spam, kein Magic gegen
   Ethereal) leaken früher. Erwartet — Static-Fallback ist „rough
   playtest", nicht eine balancierte Gegen-AI.

3. **Per-Group Spawn-Delay-Override.** Die Pipeline unterstützt
   `SpawnEntry.delay` und `pauseAfter` via `buildSpawnSchedule`, das
   Static-Schema setzt aber nur einen `spawnDelayMs` pro Welle. Für
   „Welle-in-Welle"-Pattern müsste man `pattern: 'wave-in-wave'` setzen
   und `subWavePause` durchreichen (heute fest auf den
   spawn-schedule-builder-Default).

---

## Tuning-Workflow

Wenn sich beim Static-Spiel etwas falsch anfühlt:

1. **Wave-Planner aufmachen** (`docs/wave-planner.html`, regen via
   `npm run wave-planner`) — zeigt Plan-Bedarf pro Welle.
2. **Tower-Stats-Chart aufmachen** (`docs/tower-stats-chart.html`) —
   zeigt erwarteten Player-DPS pro Tower und Level.
3. Anhand der zwei Datenpunkte den Player-DPS bei der problematischen
   Welle schätzen. Wave-Gesamt-HP ≈ DPS × 15–30 s ist die Zielzone.
4. `count` / `hpMult` / `spawnDelayMs` in `STATIC_WAVE_PROFILES` drehen.
5. Tests: `npm test` (Curriculum-Spec asserted monoton-mit-Boss-Dip auf
   den Gold-Werten, *nicht* auf den Static-Profilen — die sind frei
   tunbar).
6. Optional: Static-Toggle im Spiel aktivieren und durchspielen.

---

## Verwandte Dokumente

- [WAVE_SYSTEM.md](WAVE_SYSTEM.md) — gesamtes Wave-Management, Spawn-Logik,
  Mixed Waves, Phasen, Sub-Step-Spawner.
- [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) — die AI-Seite, die
  der Static-Fallback ersetzt.
- [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) — Template-System, das die
  Static-Profiles spiegeln (single-type-Limitation siehe oben).
- [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md) —
  Curriculum + Gold-Budget-Stand (rebalanced May 2026).
- [TODO.md](../TODO.md) §2.2 — offene Static-Fallback-Erweiterungen.
