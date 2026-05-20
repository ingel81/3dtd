# Static Wave Fallback

**Stand:** 2026-05-20

Static-Wave-Fallback ist ein Debug-/Playtest-Modus, der Wellen aus einer
festen Per-Wave-Tabelle spawnt — als Alternative zum AI Wave Director.
Gedacht für Offline-Playtests, Headless-Tests, und Situationen in denen
das ONNX-Modell nicht geladen ist. **AI bleibt der Production-Default**;
dies ist ein bewusst opt-in Debug-Pfad.

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

## STATIC_WAVE_PROFILES

Definiert in `src/app/configs/wave-curriculum.config.ts`:

```ts
export interface StaticWaveProfile {
  wave: number;              // 1-indexed
  enemyType: EnemyTypeId;
  count: number;
  hpMult: number;            // baseHp × hpMult = per-enemy HP
  spawnDelayMs: number;
}

export const STATIC_WAVE_PROFILES: readonly StaticWaveProfile[] = [
  // ── Early game (W1-W9) ──
  { wave:  1, enemyType: 'zombie',      count:  20, hpMult: 0.8, spawnDelayMs: 1000 },
  { wave:  2, enemyType: 'rat',         count:  60, hpMult: 1.0, spawnDelayMs:  400 },
  { wave:  3, enemyType: 'penguin',     count:  25, hpMult: 1.0, spawnDelayMs:  500 },
  ...
  // ── Mid game (W10-W19) ──
  { wave: 10, enemyType: 'herbert',     count:   1, hpMult:  8.0, spawnDelayMs: 1500 },
  ...
  { wave: 15, enemyType: 'stone-golem', count:   6, hpMult: 1.5, spawnDelayMs: 1100 },
  ...
  // ── Late game (W20-W30) ──
  { wave: 30, enemyType: 'herbert',     count:   3, hpMult: 35.0, spawnDelayMs: 1800 },
];
```

Rough sizing: Gesamt-Wave-HP ≈ Player-DPS × 10–30 s, kalibriert gegen den
Player-DPS aus dem Wave-Planner-Roster-Plan. Boss-Wellen (W10/W20/W30)
nutzen 1 Herbert mit hohem `hpMult` als Stand-In für den AI-Boss + Support
(siehe Limitations unten).

### HP-Berechnung zur Laufzeit

```ts
enemyHealth = baseHp × hpMult × endgameHpMultiplier(waveNum)
```

`endgameHpMultiplier` (auch in `wave-curriculum.config.ts`) rampt ab W20
mit +5%/Welle hoch und cappt bei 4× (W80). So bleiben spätere Loop-
Iterationen herausfordernd, obwohl das Template wieder vorne anfängt.

### Speed

`enemySpeed = ENEMY_TYPES[enemyType].baseSpeed` — kein Speed-Override pro
Welle (Vereinheitlichungsentscheidung; die Variation kommt aus dem
HP-Mult und der Anzahl, nicht aus Spawn-Speed).

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

## Bekannte Limitationen (= aktuelle TODOs)

1. **Single-Enemy-per-Wave.** `StaticWaveProfile.enemyType: EnemyTypeId`
   ist genau einer. Der Template-Pfad unterstützt Mixed-Waves
   (z.B. `dragon_elite` = 60% Dragons + 40% Hornets), der Static-Pfad
   kollabiert das auf den Primary-Type. Sichtbar bei W12 / W24
   (dragon_elite ohne Hornet-Begleitung), W8 / W26 (hornet_strike ohne
   Bats).

2. **Keine Boss-mit-Support.** Boss-Wellen W10/W20/W30 spawnen im
   AI/Template-Pfad 1 Herbert + Tanks + Zombies (rund 4.83 / 4.83 / 0.03
   Anteil). Im Static-Pfad: solo Herbert mit hohem `hpMult`. Spielbar,
   aber leblos.

3. **Kein Per-Spawn-Variation.** Der `WaveManager` unterstützt
   `SpawnEntry.delay`-Overrides und `pauseAfter` für „Welle-in-Welle"-
   Pattern. Static nutzt einen einzigen `spawnDelayMs` für alle Spawns
   einer Welle.

4. **Golem-Template ist AI-unsichtbar.** `golem_squad.minWave: 999` ist
   ein temporärer Gate-Mechanismus für die untrainierte AI. Beim
   nächsten AI-Re-Training muss das Gate runter UND der Python-Mirror
   in `training-backend/wave_curriculum.py` parallel ergänzt werden
   (TODO 2.2 in [TODO.md](../TODO.md)).

5. **Per-Wave-Tuning ist iterativ.** Die aktuellen Counts/HP-Mults sind
   gegen die optimistische Player-DPS aus dem Wave-Planner kalibriert.
   Real abweichende Builds (z.B. nur Archer-Spam, kein Magic gegen
   Ethereal) leaken früher. Erwartet — Static-Fallback ist „rough
   playtest", nicht eine balancierte Gegen-AI.

### Geplante Erweiterung — Boss-Support & Mixed-Waves

```ts
// Vorschlag (noch nicht implementiert):
interface StaticWaveProfile {
  wave: number;
  // Statt:  enemyType + count + hpMult
  // Neu:    Liste von Einträgen, oder direkter SpawnSchedule
  entries: ReadonlyArray<{
    enemyType: EnemyTypeId;
    count: number;
    hpMult: number;
    delayMs?: number;        // optional override pro Eintrag
  }>;
  spawnDelayMs: number;      // default zwischen den Spawns
  pattern?: 'sequential' | 'interleaved' | 'clustered';
}
```

`buildStaticCurriculumWaveConfig` würde dann entweder einen
`MixedWaveConfig` oder einen `SpawnSchedule` (siehe `wave.manager.ts`)
generieren. Die existierenden Mixed-Wave-Code-Pfade greifen dafür schon.

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
