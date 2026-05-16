# Engine Deep-Review — Abschlussbericht

**Datum:** 2026-05-16
**Branch:** `review/engine-deep-review-2026-05-16`
**Scope:** Komplette Game-Engine (`src/app/`), Dependencies, Tests

---

## 1. Zusammenfassung des Vorgehens

Das Review wurde als koordinierter Multi-Agenten-Durchlauf in vier Phasen durchgeführt:

1. **Analyse** — 8 spezialisierte Read-only-Agenten haben parallel je einen
   abgegrenzten Prüfbereich auditiert und strukturierte Findings-Reports geliefert.
2. **Konsolidierung & Verifikation** — Der Koordinator hat alle Findings gesichtet,
   priorisiert und jede Fix-Annahme am Code verifiziert. Dabei wurde ein Fehlbefund
   (PERF-1) widerlegt und verworfen.
3. **Umsetzung** — Risikoarme, verhaltenserhaltende Fixes wurden umgesetzt: 10
   Source-Fixes vom Koordinator, Dead-Code-Bereinigung und 160 neue Tests durch
   drei parallele Fix-Agenten.
4. **Verifikation** — Build, vollständiger Test-Lauf und Lint wurden ausgeführt;
   eine pre-existierende Test-Blockade wurde dabei aufgedeckt und behoben.

**Leitprinzip:** Funktionalität unverändert, keine Regressionen, kein
Overengineering. Jeder Fix ist klein, einzeln nachvollziehbar und in einem
thematisch gebündelten Commit. Größere strukturelle Findings wurden bewusst nur
dokumentiert (siehe Abschnitt 7).

---

## 2. Eingesetzte Agenten / Rollen

| Agent | Prüfbereich |
|-------|-------------|
| ARCHITEKTUR | Einhaltung der dokumentierten Architektur (framework-agnostische Manager, Signal-Store als Single Source of Truth), Separation-of-Concerns, Layering, Hidden Dependencies |
| EVENT-SYSTEM | Event-Bus-Nutzung: Immediate/Deferred, Kopplung & Umgehungen, Subscription-Leaks, Re-Entrancy, tote Events |
| CODEQUALITÄT | Code Smells, Anti-Pattern, technische Schulden (`TODO/HACK/@ts-ignore`), `any`-Nutzung, Magic Numbers, inkonsistente Patterns |
| DEAD-CODE & DUPLIKATE | Ungenutzte TypeScript-Exports/Methoden, duplizierte Logik |
| MODULARISIERUNG | Zu große Dateien/Klassen, God Objects, vermischte Verantwortlichkeiten |
| PERFORMANCE | Hot Paths (pro Frame / pro Enemy / pro Projektil), Allokationen, nicht-O(1)-Lookups, ineffiziente Datenstrukturen |
| TESTS | Test-Coverage-Lücken, schwache Tests, vitest-Konfiguration |
| DEPENDENCIES | `npm outdated` / `npm audit`, Bewertung von Updates nach Nutzen/Risiko/Kompatibilität |

Umsetzungsphase: 1 Dead-Code-Agent + 2 Test-Agenten (parallel, im Hintergrund).

---

## 3. Findings nach Kategorie und Priorität

Gesamt: **~70 Findings**. Übersicht — Detailbefunde der Agenten siehe Abschnitte 4 & 6.

| Kategorie | Kritisch | Hoch | Mittel | Niedrig |
|-----------|:-:|:-:|:-:|:-:|
| Architektur | 1 | 4 | 4 | 2 |
| Event-System | 0 | 1 | 6 | 3 |
| Codequalität | 2 | 9 | 7 | 4 |
| Dead Code / Duplikate | 0 | 2 | 1 | 13 |
| Modularisierung | 0 | 3 | 3 | 1 |
| Performance | 0 | 2* | 2 | 3 |
| Tests | 0 | 5 | 4 | 3 |
| Dependencies | 1 | 1 | 2 | 7 |

\* Ein als „Hoch" gemeldeter Performance-Befund (PERF-1) wurde bei der Verifikation
als Fehlbefund widerlegt — siehe Abschnitt 5.

---

## 4. Umgesetzte Fixes

Alle Fixes sind verhaltenserhaltend und durch Build + Test verifiziert.

### 4.1 Korrektheit & Robustheit — Commit `2b13f18`

| ID | Datei | Fix | Begründung |
|----|-------|-----|------------|
| CQ-1 | `game-state.manager.ts` | `healBase()` nutzt `GAME_BALANCE.player.startHealth` statt hartkodierter `100` | Verhindert stillen Balance-Bug, wenn `startHealth` in der Config geändert wird. Wert aktuell identisch (100) → kein Verhaltensunterschied. |
| CQ-2 | `enemy.manager.ts` | Poison-Tick-Schaden `value * (COMBAT_TUNING.poisonTickIntervalMs / 1000)` statt Magic `0.5` | Entkoppelt den Tick-Schaden vom hartkodierten Intervall-Ableitwert. Bei 500ms-Intervall rechnerisch identisch. |
| CQ-7 | `global-route-grid.ts` | `INV_CELL_SIZE = 1 / this.CELL_SIZE` statt Literal `1 / 2` | Beseitigt Desync-Risiko zwischen `CELL_SIZE` und seinem Kehrwert in einer Hot-Path-Klasse. `CELL_SIZE` wird im Feld-Initializer davor gesetzt → Wert identisch. |
| EVT-3 | `game-engine/game-event-bus.ts` | `emit()` umschließt jeden Handler-Aufruf mit `try/catch` + `console.error` | Eine werfende Handler-Funktion brach bisher die `forEach`-Iteration ab — nachfolgende Subscriber desselben Events (z.B. Credits-/Health-State) liefen nicht mehr. Im Normalbetrieb ohne Exception null Verhaltensänderung. |
| EVT-1 | `services/debug/los-debug.service.ts` | 3 Event-Subscriptions in `SubscriptionBag`, `disposeAll()` bei jedem `initialize()` | Echter Leak: `initialize()` wird bei jedem Ortswechsel erneut aufgerufen → bisher N×3 akkumulierte Listener. |
| EVT-2 | `services/combat/combat-effect.service.ts` | `vfx:chain-lightning` per `emitDeferred()` statt `emit()` | Architektur-konform: alle anderen `vfx:*`-Events sind deferred (laut EVENT_SYSTEM.md). Self-contained Payload, rein visuell → kein Spielverhalten betroffen. |

### 4.2 Performance — Hot-Path-Allokationen — Commit `c7a5c69`

| ID | Datei | Fix | Begründung |
|----|-------|-----|------------|
| PERF-2 | `services/combat/tower-combat.service.ts` | `buildLosCheck`: ein wiederverwendeter `Vector3` pro Prädikat via `geoToLocalSimpleInto` statt `new Vector3` pro Kandidaten-Enemy. Zusätzlich `engine`-Referenz gefangen (entfernt Non-null-Assertion auf nullbares Feld → behebt auch CQ-3). | Eliminiert mehrere hundert `Vector3`-Allokationen pro Frame im LOS-Fallback-Pfad. |
| PERF-2 | `managers/projectile.manager.ts` | Trail-Position über wiederverwendeten Scratch-`Vector3` (`geoToLocalSimpleInto`). `pushPosition` kopiert intern via `.copy()` → Reuse sicher. | Eliminiert eine `Vector3`-Allokation pro fliegendem Projektil pro Frame. |
| PERF-7 | `managers/projectile.manager.ts` | `toRemove`-Array als wiederverwendetes Klassenfeld (`length = 0`), analog zum bestehenden `EnemyManager`-Pattern | Eine Array-Allokation pro `update()` weniger; folgt etabliertem Projekt-Pattern. |
| PERF-4 | `game-components/movement.component.ts` | `getPathProgress()` nutzt vorab in `precomputeSegmentLengths()` gebildete `totalPathLength` statt `reduce` pro Aufruf | Entfernt eine O(n)-Summierung pro Kandidaten-Enemy bei `first`-Targeting. |

> **Nachtrag 2026-05-16 (Playtest-Regression — aufgeklärt & behoben):** Ein
> Playtest zeigte eine Visualisierungs-Regression (Route-Grid/Air-Route/
> LOS-Preview). Zunächst war PERF-2 (Vektor-Reuse) im Verdacht und wurde
> testweise zurückgenommen — die Regression blieb jedoch bestehen; PERF-2 ist
> wieder aktiv (kein Bug). Ein Deps-A/B-Test isolierte das Dependency-Update;
> ein Quellcode-Diff von `3d-tiles-renderer` 0.4.19↔0.4.24 die exakte Ursache:
> **Der 0.4.20+-Umbau des internen Tile-Datenmodells benannte `tile.__depth`
> → `tile.internal.depth` um (ohne Backwards-Compat-Alias).** `three-tiles-
> engine.ts` las das undokumentierte `tile.__depth` → ab 0.4.20 `undefined` →
> `depth: 0` für jedes Tile → `sampleCellY` verwarf jeden Höhen-Raycast als
> „noLOD" → alle Cells unsampled. **Fix:** `three-tiles-engine.ts` liest jetzt
> `tile.internal?.depth`; `3d-tiles-renderer` ist auf **0.4.24** aktualisiert.
> **Lehre:** Nie undokumentierte `__`-Interna von Libraries lesen.

### 4.3 Dead-Code-Bereinigung — Commit `1d0050f`

6 grep-verifizierte, referenzlose TypeScript-Symbole entfernt (185 Zeilen).
Keine Assets angefasst. GLSL-String-Literale wurden korrekt als
Nicht-Referenzen ausgeschlossen.

- `getShortExplanation` (`decision-explainer.ts` + Barrel-Re-Export)
- `fromRatio` (`spawn-schedule-builder.ts`)
- `facePixelToDirection` (`los-debug-pixel-math.ts`) + dadurch ungenutzter `Vector3`-Import
- `cellular`, `smoothstep`, `remap`, `mix`, `clamp` (`seeded-random.ts`)
- `Component.getGameObject()` (`core/component.ts`)

### 4.4 Tests — Commit `89ac216`

**160 neue Unit-Tests** für bisher ungetestete reine/ökonomische Logik:

| Spec | Tests | Abdeckung |
|------|:-:|-----------|
| `economy.service.spec.ts` | 35 | Wave-Completion-Bonus (Perfect, Combo-Streak + Cap, CloseCall, Comeback, Milestone), `reset()`, Robustheit |
| `research.manager.spec.ts` | 36 | `canStartResearch`-Ablehnungsbedingungen, Slot-Logik, Progression, Refund, Save/Load-Roundtrip |
| `wave-curriculum.config.spec.ts` | 36 | `goldBudgetForWave`, `endgameHpMultiplier`, `enemyBaseDamageForWave`, `templateForWave` inkl. Cap/Extrapolation/Edge-Cases |
| `tower-dps.util.spec.ts` | 20 | `computeTowerDPS` (alle Tower-Pfade), `armorMultipliersFor` gegen Damage-Matrix |
| `spawn-schedule-builder.spec.ts` | 33 | `buildSpawnSchedule` mit allen 7 Spawn-Patterns |

**Mock-Fixes** (damit die gesamte Suite grün läuft):

- **Pre-existierende Blockade behoben:** 5 Integration-Specs scheiterten seit
  Commit `c5d27eb` (LOS-Pipeline) bereits beim Import — ihr Inline-`three`-Mock
  kannte `Color` nicht (transitiv über `los-viz.config.ts` eingezogen). Per
  Stash-Diagnose gegen Original-Code verifiziert: **keine Regression durch
  dieses Review.** Die 5 Specs nutzen jetzt den vollständigen, bereits
  existierenden Shared-Mock `@/test/mocks/three.mock` (gleiches Pattern wie
  `projectile.manager.spec.ts`).
- `projectile.manager.spec.ts`: `sync`-Mock um `geoToLocalSimpleInto` ergänzt
  (folgt aus PERF-2).

### 4.5 Dependencies — Commit `d3e6274`

`npm update` innerhalb der bestehenden semver-Ranges:

| Paket | Vorher → Nachher | Typ |
|-------|------------------|-----|
| `@angular/*` (12 Pakete) | 21.0.x → **21.2.13** | Minor — schließt i18n-XSS-CVEs (CVSS 9.0) |
| `3d-tiles-renderer` | 0.4.19 → **0.4.24** | Patch — 0.4.20+ benannte interne Tile-Felder um; brach 3DTDs Route-Grid-Höhen-Sampling (Playtest-Regression). 3DTD-seitig behoben (`tile.__depth` → `tile.internal.depth`, siehe Nachtrag 4.2). `package.json` exakt `"0.4.24"`, da 3DTD auf internen Feldern aufsetzt — künftige Bumps brauchen einen Internal-API-Recheck. |
| `onnxruntime-web` | 1.23.2 → **1.26.0** | Minor — WASM-Assets korrekt nachkopiert (postinstall verifiziert) |
| `vitest` / `@vitest/coverage-v8` | 4.0.18 → **4.1.6** | Minor |
| `zone.js` | 0.16.0 → **0.16.2** | Patch |
| `@fontsource/roboto`, `eslint`/`@eslint/js` | aktualisiert | Minor/Patch |

**`npm audit`: 35 Vulnerabilities (1 Critical / 23 High / 10 Moderate / 1 Low) → 0.**

Bewusst **nicht** aktualisiert: `three` / `@types/three` (0.184 bricht potenziell
Custom-Shader — eigene Session nötig), `typescript` 6.0 (nicht Angular-21-kompatibel),
`eslint` 10 (typescript-/angular-eslint noch nicht bereit), `jsdom` 29 (Major).

---

## 5. Bewusst nicht umgesetzte Findings

### 5.1 Fehlbefund — verworfen

- **PERF-1** („`getEnemiesForTower` produziert Duplikate"): Verifikation von
  `updateEnemyPosition` zeigt, dass jeder Enemy über die `enemyCellKeys`-Map
  **genau einer** Cell zugeordnet ist (Entfernen aus alter, Hinzufügen zu neuer
  Zelle). `getEnemiesForTower` kann daher **keine Duplikate** erzeugen. Das
  Finding beruhte auf einer falschen Annahme über überlappende Zellen — kein Fix
  nötig.

### 5.2 Strukturelle Findings — zu groß für einen gezielten Fix

| Finding | Grund für Nicht-Umsetzung |
|---------|---------------------------|
| ARCH-1: `GameStateManager` ist `@Injectable` (verletzt „framework-agnostic") | Der GSM ist bewusst der Integrations-Adapter zwischen Angular-DI und Engine; eine saubere Entkopplung ist ein L-Refactoring mit hohem Regressionsrisiko. → Abschnitt 7. |
| ARCH-2/7/9: State-Duplikation GSM ↔ GameStore | Eingriff in laufende Store-Sync — hohes Regressionsrisiko bei marginalem Nutzen. → Abschnitt 7. |
| CQ-6 / MOD-1/2/3/4: God Objects (`three-effects.renderer.ts` 2313 LOC, `three-tiles-engine.ts` 2138 LOC, `game-sidebar.component.ts` 1693 LOC, `global-route-grid.ts`) | Große Modul-Splits; `three-effects`/`three-tiles-engine` stehen bereits in TODO.md 1.2. → Abschnitt 7. |

### 5.3 Findings mit Verhaltens- oder Kontrakt-Risiko

| Finding | Grund |
|---------|-------|
| DUP-1: `haversineDistance` 4× dupliziert | Delegation würde funktionierenden Geo-Code (OSM-Service, DevStreet-Provider) für marginalen Nutzen anfassen; minimale FP-Abweichungen möglich. Worker-Kopie ist isolationsbedingt zwingend. |
| DUP-2/4: Tower-Validierung / `estimatePathCoverage` mehrfach | Die Varianten nutzen unterschiedliche Distanzfunktionen — Konsolidierung würde Verhalten verschieben. |
| CQ-4: `attackType` optional → würde Type-Config-Default erfordern | Mittleres Risiko, betrifft Combat-Filter. |
| CQ-9: Stringly-typed Tower-IDs | M-Aufwand, breite Touch-Fläche — eigener fokussierter Pass sinnvoller. |
| PERF-5: Poison-`find()` nach `updateStatusEffects` | Nur ~2 Hz pro vergiftetem Enemy (kein echter Hot Path); Fix würde den `updateStatusEffects`-Rückgabekontrakt erweitern — Aufwand/Nutzen negativ. |
| PERF-3: `Math.cos` in `calculateDistanceFast` | Mikro-Optimierung ohne messbaren Nutzen (nur ~20 Aufrufe/Frame im Steady-State). |
| EVT-6: synchrone Re-Entrancy `enemy:reached-base → health:changed` | Kein demonstrierter Bug; ein Handler-Snapshot pro `emit()` würde 50 Allokationen/Frame kosten. |

### 5.4 Latente / kosmetische Findings — dokumentiert, nicht geändert

EVT-4/5 (Subscription-Cleanup bei Singletons — aktuell kein Leak), EVT-7/8/10/11
(irreführende/tote Event-Payloads — kein Bug), CQ-5 (58× `console.log` — Churn ohne
klaren Nutzen), CQ-8/11 (`any` in ONNX-/Bot-Code), CQ-10 (`setTimeout` statt
`afterNextRender`), DEAD-2/5/6/9/10 (nur-`export`-entfernen / Config-Konstanten —
konservativ belassen), DUP-3/5. → Empfehlung: Sammel-Pass, Abschnitt 7.

---

## 6. Test- & Build-Status

| Check | Ergebnis |
|-------|----------|
| `npm run build` | ✅ **Grün** — Production-Bundle ohne Fehler |
| `npm test` (vitest) | ✅ **Grün** — 49 Dateien, **802 Tests**, 0 Failures |
| `npm run lint` | ⚠️ **Pre-existierend rot** — 17 Probleme (15 Errors + 2 Warnings) |

**Lint-Detail:** `npm run lint` war bereits auf `main` rot. Beweis: Errors in
Dateien, die weder dieses Review noch die Agenten angefasst haben
(`three-tiles-engine.ts`, `tower-shadow-mapper.ts`, `damage-calculator.spec.ts`,
HTML-Templates). Dieses Review hatte zwischenzeitlich **einen** zusätzlichen
Lint-Error eingeführt (ungenutzte Variable in einer neuen Spec) — bereits behoben.
Netto-Lint-Stand damit unverändert gegenüber `main` (18 → 17 → Baseline).
Die verbleibenden 17 sind überwiegend auto-fixbare Stil-Verstöße
(`array-type`, `consistent-generic-constructors`); die `eqeqeq`-Template-Errors
brauchen manuelle Prüfung (`!=` → `!==` kann Coercion-Verhalten ändern). →
Empfehlung: dedizierter Lint-Cleanup-Pass (Abschnitt 7).

**Ersatzprüfung Integration-Tests:** Die 5 Integration-Specs waren seit `c5d27eb`
nicht lauffähig. Per `git stash`-Diagnose gegen den Original-Code wurde belegt,
dass die Blockade pre-existierend ist; nach dem Mock-Fix laufen sie wieder und
sind **grün** — d.h. keine Logik-Regression durch die LOS-Pipeline.

---

## 7. Bekannte Restrisiken & Empfehlungen

### Restrisiken

- **Lint ist rot** (pre-existierend, 17 Probleme). Build/Tests sind davon nicht
  betroffen, aber CI-Gates auf Lint würden fehlschlagen.
- **`onnxruntime-web` 1.26.0**: Das `postinstall`-Script kopiert WASM-Dateien;
  Assets wurden verifiziert vorhanden. Bei künftigen Updates erneut prüfen.
- **EVT-6** (synchrone Event-Re-Entrancy) bleibt eine fragile, aber aktuell
  bugfreie Struktur.

### Empfehlungen für spätere, größere Refactorings

1. **Lint-Cleanup-Pass** — die 17 pre-existierenden Probleme bereinigen;
   `eqeqeq`-Fälle einzeln prüfen statt `--fix`.
2. **God-Object-Splits** — `three-effects.renderer.ts`, `three-tiles-engine.ts`
   (beide in TODO.md 1.2), zusätzlich `game-sidebar.component.ts` (1693 LOC,
   ~800 LOC Inline-CSS + 4 Fachdomänen) und `global-route-grid.ts`
   (Daten/Algorithmus/Debug/Viz trennen).
3. **`GameStateManager`-Entkopplung** — die 16 `inject()`-Abhängigkeiten über
   Interfaces (Dependency Inversion) auflösen, um den Manager-Layer vollständig
   framework-agnostisch zu machen (ARCH-1/2/7/9).
4. **Stringly-typed-IDs härten** (CQ-9) — Tower-/Projektil-IDs als
   `as const`-Objekte materialisieren.
5. **Test-Coverage ausbauen** — verbleibende Lücken: `HQDamageService`,
   `StatusEffectService`, `canTargetAirEffective`, Pathfinding-Worker (TEST-6..9);
   flaky Wall-Clock-Performance-Tests entschärfen (TEST-10).
6. **`three` 0.184 + TypeScript 6 / Angular 22** — eigener Migrations-Pass mit
   Shader-Kompatibilitätsprüfung.

---

## 8. Branch & Commits

**Branch:** `review/engine-deep-review-2026-05-16` (von `main` @ `dac8113`)

| Commit | Bereich |
|--------|---------|
| `d3e6274` | `chore(deps)` — Dependency-Update, 35 → 0 Audit-Findings |
| `2b13f18` | `fix(engine)` — Config-Decoupling, Event-Handler-Isolation, Subscription-Leak |
| `c7a5c69` | `perf(engine)` — Hot-Path-Allokationen entfernt |
| `1d0050f` | `chore` — Verifizierter Dead-Code entfernt |
| `89ac216` | `test` — 160 Regressionstests, Integration-Suite repariert |
| _(dieser Bericht)_ | `docs` — Abschlussbericht |

**Geänderte Bereiche:** `managers/`, `services/combat/`, `services/debug/`,
`game-engine/`, `game-components/`, `utils/`, `ai/core/`, `core/`, `devworld/utils/`,
`integration/`, `configs/` (nur neue Specs), `package-lock.json`.
