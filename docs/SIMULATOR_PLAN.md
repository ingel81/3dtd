# Simulator: deterministische Simulation, Replay als Neu-Simulation, Unterbau für Coop

**Stand:** 2026-09-24 · Status: P1 bis P7 gebaut, Playtest R ok (2026-09-24), ausgeliefert mit v0.4.0; Messung nachgezogen 2026-09-25

Ziel: Die Simulation rechnet einen Lauf aus Startzustand, Seed und Befehlen auf einem Rechner bit-genau nach.
Darauf stehen das Replay als Neu-Simulation (TODO E2) und später Coop im Lockstep
([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md), Stufe 3 in [BALANCING_PLAN.md](BALANCING_PLAN.md) Abschnitt 5).
Performance ist Randbedingung: Das laufende Spiel darf pro Sub-Step nicht teurer werden, das Nachrechnen muss schnell
genug für Springen im Replay sein.

## Stand der Pakete (2026-09-24)

| Paket | Stand | Wo |
|-------|-------|----|
| P1 Sim-Grenze, Befehlslog | gebaut | `GameCommandsHandler.beginStep/endStep`, `CommandLog`, `command:tower-aim`, Director in Spielzeit, Forschung aus dem `ResearchManager` |
| P2 Turmdrehung | gebaut | `Tower.aim` (`entities/tower-aim.ts`), Config `turnsTurret`, `turretRestY`, `modelTop` |
| P3 Sicht als Daten | gebaut | `LosMask`, Randzellen, kein Raycast im Kampf, Nachrüstung aus der Spielschleife |
| P4 Snapshot | gebaut | `SimSnapshot`, `captureSnapshot`/`restoreSnapshot`, Zufallsstand, Id-Zähler, Held, Tower |
| P5 Prüfsumme, Abnahme, Benchmark | gebaut | `StateHasher`, `integration/resimulation.scenario.spec.ts`, `npm run bench:sim` |
| P6 Replay | gebaut | `ReplaySession`, `ReplayService`, alle Wellen, Datei; das Präsentations-Replay ist entfernt |
| P7 Unterbau Coop | gebaut (Formate) | Replay-Datei = Match-Log (Welt-Schlüssel, Balance-Hash, Seed, Eingaben mit Masken, `playerId`) |

Gefunden und behoben auf dem Weg:
- Nach einem Neustart zogen Spawnpunkt und Seitenversatz aus den Strömen des vorigen Seeds (`GameRng.reset` warf die
  Funktionen weg, die Manager hielten die alten).
- Die Streuung des Spawn-Takts steckte als Funktion in der Wellen-Konfiguration und fiel beim Loggen weg; jetzt Daten
  (`delayVariation`), dieselben Zahlen.
- Das Kill-Gold-Budget setzte sich nur bei einer neuen Wellennummer zurück; eine nachgerechnete Welle zahlte aus dem
  Rest der Live-Welle.

Aus dem Review nach dem Bau (2026-09-24, behoben, je mit Abnahme-Test):
- Das `wave:completed` der nachgerechneten Welle lag nach dem Verlassen noch in der Event-Warteschlange und kam im
  Live-Spiel an (Ladung für Fähigkeiten, doppelter Run-Log-Eintrag). Das Laden eines Snapshots leert sie jetzt.
- Auto-Start und Run-Log-Stichprobe lasen während des Replays dessen Uhr; sie ruhen jetzt.
- Die Pfad-Id der Wurmketten hing davon ab, auf welcher Route in der Sitzung der erste Wurm lief; sie kommt jetzt aus
  dem Pfad selbst.

Offen: Playtest ([PLAYTEST.md](PLAYTEST.md), Paket R). Nicht in diesem Plan: Netz, Lobby, Gold je Spieler,
Tower-Besitz, Sicht vom Host über das Netz, Umgang mit Float-Abweichungen zwischen Browsern.

---

## 1. Stand heute (Stufe 1 fertig)

| Baustein | Stand | Stelle |
|----------|-------|--------|
| Geseedeter Zufall | mulberry32, Ströme `director`, `spawn`, `enemy`, `bot`, Seed im Run-Log | `utils/game-rng.ts` |
| Fester Takt | 16,667 ms je Sub-Step, fortlaufender Zähler `subStep` | `managers/game-state/game-clock.ts` |
| Befehle | alle Spieler- und Bot-Aktionen als `command:*` | `managers/game-commands.handler.ts` |
| Zellhöhen | nach dem Korridorbau eingefroren, Gegner, Held, Ooze lesen sie | `utils/global-route-grid.ts` |
| Held, Fähigkeiten, Forschung | Spielzeit, kein Zufall | Kopfkommentare der Manager |
| Koordinaten | `geoToLocalSimple` rein analytisch, Ursprung fest je Ort | `three-engine/ellipsoid-sync.ts:223` |
| Test-Harness | `new GameStateManager()` mit Fake-Engine, rund 12 Specs treiben `gsm.update()` | `integration/test-helpers.ts` |

## 2. Was fehlt (Befunde)

| # | Lücke | Stelle | Folge |
|---|-------|--------|-------|
| L1 | Turmdrehung lebt im Renderer (`TowerRenderData`). Solange das GLTF lädt, gilt ein Tower als ausgerichtet; ob ein Modell ein Turret-Teil hat, weiß erst das geladene Modell | `three-tower.renderer.ts:868`, Aufruf aus der Facade `game-loop-facade.service.ts:515` | Feuern hängt an Ladezeit und Renderer, headless verhält sich anders als gerendert |
| L2 | Sichtlinie aus GPU-Cube gegen die gerade geladenen Tiles; Reichweiten-Upgrade rechnet inkrementell (mischt Cubes verschiedener Zeitpunkte), Luft-Nachrüstung per `requestAnimationFrame` | `tower-los-registry.ts:155, 240` | Nachrechnen gibt nicht dieselbe Sicht |
| L3 | Raycast-Rückgriff gegen Live-Tiles, wenn die Zelle keinen Eintrag hat: Reichweitenrand, Gegner neben dem Korridor, Fenster der Luft-Nachrüstung, blinde Tower; `body-aim` (Ooze) raycastet mit LOD-Cache | `tower-combat.service.ts:147`, `body-aim.ts:247` | abhängig von Kamera und LOD, teuer |
| L4 | Befehle wirken sofort beim `emit`: UI zwischen Frames, Bots mitten in der Schleife vor dem Wellenende-Check; kein Log mit `subStep` | `game-state.manager.ts:563`, `replay-recorder.ts:246` | Reihenfolge nicht reproduzierbar |
| L5 | Zielen im bemannten Tower direkt am Befehlsweg vorbei | `tower-control.service.ts:274` | nicht im Log |
| L6 | Zufallsstand steckt in Closures, nicht lesbar | `game-rng.ts:28` | kein Snapshot mitten im Lauf |
| L7 | Kein Snapshot, kein Serializer; `GameObject.idCounter` statisch (bestimmt Ids, Map-Reihenfolge und den Seed von `enemy-rush`) | `core/game-object.ts:108`, `entities/enemy-rush.ts:44` | kein Einstieg an einem Wellenstart |
| L8 | Simulation liest Root-Stores: `ResearchStore.airTargetingUnlocked`, `completedResearches`, `EnemyDebugService.debugEnemies()` | `tower-combat.service.ts:351`, `tower-lifecycle.ts:74`, `game-state.manager.ts:649` | Zustand außerhalb der Simulation |
| L9 | Director-Snapshot rechnet mit `Date.now()` | `director/state-snapshot.service.ts:67ff` | Wanduhr im Zustand |
| L10 | `modelTopY` (Augenhöhe bemannter Tower) aus dem geladenen Modell | `tower-combat.service.ts:537` | Treffer hängen am Modell |
| L11 | Keine Prüfsumme über den Zustand, kein Spec, der denselben Lauf zweimal rechnet, kein Benchmark des ganzen Sub-Steps | – | Divergenz bleibt unsichtbar |

## 3. Kernidee: Ruhe-Snapshot

Zwischen den Wellen ist die Simulation fast leer: keine Gegner, kein Spawner, keine offenen Schläge (eine Fähigkeit
landet immer in ihrer eigenen Welle). Es bleiben Tower (mit Sicht als Daten, Upgrades, Drehung), Credits, HQ-Leben,
Forschung, Fähigkeiten, Held, Wirtschaft (`_perfectStreak`), Director-Zustand, Uhr, Zufallsstand und Id-Zähler. Das
sind wenige KB und in unter einer Millisekunde geschrieben.

Ein Snapshot wird genau dort genommen, beim Befehl `command:start-wave`. Ist der Zustand nicht ruhig (Projektile
eines bemannten Towers noch in der Luft, Debug-Gegner), wartet der Snapshot nicht, sondern die Welle gilt als nicht
nachrechenbar und das Replay fällt weg; der Fall wird gezählt und geloggt.

Damit gilt: **Welle N = Ruhe-Snapshot vor N + Befehle mit `subStep` + dieselbe Welt.** Derselbe Serializer sichert und
stellt auch den Live-Zustand beim Betreten und Verlassen des Replays wieder her, denn das Replay startet nur zwischen
den Wellen oder nach Game Over.

## 4. Pakete

Reihenfolge nach Abhängigkeit. P1 bis P3 sind unabhängig voneinander.

### P1 Sim-Grenze und Befehlslog
- Befehle wirken nur an der Grenze zwischen zwei Sub-Steps. Der Bot-Tick wandert ans Ende des Sub-Steps (nach
  Wellenende- und Game-Over-Check); ein Befehl, der während eines Sub-Steps kommt, wird bis zur Grenze gepuffert.
  UI-Befehle zwischen Frames liegen schon an einer Grenze und wirken weiter sofort (keine spürbare Latenz).
- `CommandLog`: jeder `command:*` als Klartext mit dem `subStep`, vor dem er wirkt. Gehört zum Lauf, nicht zur Welle.
- Zielen im bemannten Tower als Befehl `command:tower-aim` (nur bei Änderung, höchstens einmal je Sub-Step).
- Director-Snapshot auf Spielzeit statt `Date.now()`.
- Die Simulation liest Forschung aus dem `ResearchManager`, nicht aus dem `ResearchStore` (L8); Debug-Gegner über den
  `EnemyManager`.

### P2 Turmdrehung in der Simulation
- Zustand (aktuelle und Zieldrehung, Suchschwenk, Neigung) wandert auf den Tower (`TowerAim`), `stepTowerAim` läuft in
  `runSubStep` für alle Tower. Der Renderer liest die Drehung nur noch zum Zeichnen.
- Ob ein Typ ein Turret dreht, steht in der Config (neues Feld), nicht im geladenen Modell. Ein Spec lädt die GLTFs und
  prüft Config gegen Modell.
- Augenhöhe des bemannten Towers aus der Config (L10).
- Perf: ein Array-Durchlauf über Tower statt Map-Lookup je Tower-Id im Renderer.

### P3 Sichtlinie als Daten
- `LosMask`: das Ergebnis eines Towers als 2 Bit je Zelle (Boden, Luft) über die Zellen seines Reichweiten-Quadrats in
  fester Reihenfolge, 240 bis 420 B je Tower. Wird bei Bau, Reichweiten-Upgrade und Luft-Nachrüstung erzeugt und steht
  im Befehlslog als Ergebnis des Befehls; beim Nachrechnen wird die Maske angewendet statt gerechnet.
- Luft-Nachrüstung ohne `requestAnimationFrame`: Warteschlange in Spielzeit, abgearbeitet an Sub-Step-Grenzen; das
  Anwenden hat einen `subStep` und steht im Log.
- Raycast-Rückgriff im Kampf fällt weg (D2): Die Maske nimmt jede Zelle auf, deren Fläche die Reichweite anschneidet,
  nicht nur die mit Mittelpunkt darin; was dann noch keinen Eintrag hat (Gegner neben dem Korridor), gilt als nicht
  sichtbar. `body-aim` fragt die Zellen statt zu raycasten.
- Perf: keine Raycasts mehr im Kampf.
- Das ist zugleich die Host-Maske für Coop (MULTIPLAYER_CONCEPT 2.1).

### P4 Snapshot
- `GameRng` mit lesbarem und setzbarem Zustand je Strom (mulberry32 hat 32 bit, bleibt dieselbe Folge).
- `GameObject.idCounter` im Snapshot.
- `SimSnapshot` (versioniert, reine Daten): Uhr, Zufall, Id-Zähler, Credits, HQ-Leben, Tower (Typ, Position, Drehung,
  Sockel, Upgrades, Zielwahl, Feuerpause, Cooldown, Kills, Schaden, `TowerAim`, `LosMask`), Forschung (fertig, laufend,
  Warteschlange), Fähigkeiten (Ladungen), Held, Wirtschaft, Director-Zustand (Wellenhistorie, Druck-Regler),
  Wellennummer, Blutmond.
- Der Held wird beim Sichern auf einen frisch geplanten Pfad gesetzt, derselbe, den das Laden plant; so braucht die
  Bewegung keinen Serializer (gebaut, `HeroManager.captureState`).
- `capture()` und `restore()`: Restore baut Tower über denselben Weg wie ein Bau (ohne Kosten, ohne GPU, mit Maske).
- Welt-Siegel (Zellhöhen, Routen, Spawns) als eigenes Artefakt je Ort; für das lokale Replay reicht ein Fingerprint,
  weil die Welt gleich bleibt.

### P5 Prüfsumme, Abnahme, Benchmark
- `stateHash()`: Sub-Step, Credits, HQ-Leben, Wellennummer, Zufallsstand, je Gegner Id, quantisierte Position, Leben,
  je Tower Cooldown und Drehung. Nur beim Aufnehmen und Prüfen, alle 60 Sub-Steps und am Wellenende; im normalen Spiel
  nicht.
- Abnahme-Spec: ein Lauf mit Bot über mehrere Wellen, Befehle aufgezeichnet; dann jede Welle aus ihrem Snapshot
  nachgerechnet, Prüfsumme je 60 Sub-Steps gleich. Dazu dieselbe Welle bei Timescale 1 und 20.
- Benchmark-Spec für den ganzen Sub-Step (Gegner, Tower, Projektile in festen Mengen), damit P1 bis P3 zeigen, dass nichts
  teurer wurde.

### P6 Replay als Neu-Simulation
- Betreten: Live-Zustand per Snapshot sichern, Snapshot der Welle laden, Befehle der Welle abspielen, mit Renderern.
  Verlassen: Live-Snapshot zurück.
- Beobachter am Bus, die den Lauf festhalten (Run-Log, Wellenhistorie des Directors, Bot-Client, Statistik), hören
  während des Replays nicht mit: Das Nachrechnen sendet dieselben Events wie das Spiel (Kills, Credits, Wellenende).
- Springen nach vorn: headless vorrechnen bis zum Ziel (Rendering aus). Springen zurück: Snapshot neu laden und vorrechnen.
  Ziel: eine dreiminütige Welle (rund 10 800 Sub-Steps) in unter 2 s.
- Das Replay zeigt dann alles, was das Spiel zeigt (Schadenszahlen, Sounds an Entities, Eis-Explosionen, Upgrades),
  weil es das Spiel ist. Die Lücken aus REPLAY.md, Abschnitt "Was das Replay nicht zeigt", fallen weg.
- Speicher: statt bis zu 48 MB Stichproben einige KB je Welle; damit sind alle Wellen des Laufs abspielbar, nicht nur die
  letzte (D4). Wellenauswahl in der Replay-Leiste und auf dem Game-Over-Screen.
- Export und Import (D4): eine Datei mit Welt-Fingerprint, Config-Hash, Seed, Snapshots je Welle und Befehlslog. Import
  nur auf derselben Welt und mit demselben Config-Hash, sonst klare Ablehnung.
- Die Präsentations-Aufnahme (`replay-recording`, `replay-recorder`, große Teile von `replay-player`) fällt weg,
  sobald die Neu-Simulation läuft (Entscheidung D3). Die Leiste und der Replay-Modus bleiben.

### P7 Unterbau Coop (Formate, kein Netz)
- Match-Log = Welt-Fingerprint + Config-Hash (`run-log/config-hash.ts`) + Seed + Befehlslog mit Masken. Das ist das
  Format, das ein Relay später durchreicht (MULTIPLAYER_CONCEPT, Abschnitt 18).
- Befehle tragen ein Feld `playerId` (heute immer der lokale Spieler).
- Kein Netz, keine Lobby, kein Gold je Spieler in diesem Plan.

## 5. Performance

| Punkt | Wirkung |
|-------|---------|
| Befehlslog | Klartext je Befehl, einige hundert Befehle je Lauf, außerhalb des Sub-Steps |
| Turmdrehung in der Sim | gleiche Rechnung, ohne Map-Lookup je Tower im Renderer |
| Sicht als Daten, kein Raycast-Rückgriff | Kampf wird billiger; Maske kodieren nur beim Bau (µs) |
| Snapshot | nur an Wellenstart, wenige KB, unter 1 ms |
| Prüfsumme | nur beim Aufnehmen und Prüfen, alle 60 Sub-Steps |
| Präsentations-Aufnahme weg | spart rund 0,8 ms je Sekunde Spielzeit und bis zu 48 MB |
| Vorrechnen beim Springen | headless, gemessen per Benchmark; Ziel 10 800 Sub-Steps unter 2 s bei typischer Welle |

### Messung Basis

Benchmark: `npm run bench:sim` (Spec `src/app/integration/sim-step.perf.spec.ts`, Harness `sim-step-bench.ts`). Der
normale `npx vitest run` prüft nur, dass das kleinste Szenario läuft, jeder Towertyp Schaden macht und derselbe Seed
dasselbe Ergebnis gibt, auch wenn `Math.random` anders zieht.

Aufbau: echter `GameStateManager` mit echtem Route-Grid, Kampf, Schaden, Statuseffekten und Projektilen; Rendering aus
(wie im Trainings-Tab), damit nimmt auch die Präsentations-Aufnahme des Replays nichts auf. Gestubbt: Engine und
Renderer (Türme gelten als ausgerichtet) und die Sichtlinie (jede Routenzelle in Reichweite sichtbar, so wie
`resolveTowerLos` ohne Hindernis schreibt). Tower aller kämpfenden Typen reihum (Projektil, Strahl, Nahkampf, Kette),
Gegner gemischt mit Luft, 8-fache HP, nach jedem Sub-Step auf die Sollzahl aufgefüllt. Gemessen: 300 Sub-Steps
Aufwärmen, dann drei Runden zu 600 Sub-Steps bei Timescale 10, die Runde mit dem kleinsten Median zählt. Die
Aufschlüsselung kommt aus den Profiler-Summen des Loops; "Rest" ist der übrige Sub-Step (Gegner-Update, Wellen,
Fähigkeiten, Held, Anteil des Frames).

Gemessen am 2026-09-24 auf dem Windows-PC des Users, Stand `simulator` 1b2e275c (nur der Harness dazu), sieben Läufe.
Ein Lauf als Beispiel, dahinter die Spanne der Mediane über alle sieben:

| Szenario | Tower | Gegner | Median ms | p95 ms | Kampf ms | Projektile ms | Rest ms | Median über 7 Läufe |
|----------|-------|--------|-----------|--------|----------|---------------|---------|---------------------|
| S | 20 | 200 | 0,073 | 0,135 | 0,039 | 0,003 | 0,042 | 0,07 bis 0,11 |
| M | 60 | 1000 | 0,345 | 0,599 | 0,161 | 0,009 | 0,232 | 0,30 bis 0,51 |
| L | 120 | 3000 | 1,594 | 3,113 | 0,565 | 0,027 | 1,127 | 1,25 bis 2,32 |

Vorrechnen einer Welle zur Mitte des Spiels (20 Tower, 150 Gegner gleichzeitig, Timescale 75): 10 800 Sub-Steps in
0,79 bis 1,04 s, also 10 400 bis 13 700 Sub-Steps/s. Das Ziel aus P6 (unter 2 s) hält in dieser Umgebung.

Nachmessung am 2026-09-25 (Branch `coop` 7be5816d, ein Lauf, `npm run bench:sim`): S 0,072, M 0,331, L 1,613 ms
Median je Sub-Step, Vorrechnen 16 335 Sub-Steps/s. Der Coop-Umbau kostet den Einzelspieler also nichts Messbares.
Die Prüfsumme (StateHasher) kostet 0,08 / 0,21 / 0,78 ms je Aufruf; im Coop läuft sie alle 30 Ticks, das ist bei M
rund 1 % eines Sub-Steps.

Grenzen: Die Zeiten streuen zwischen Läufen deutlich (L zwischen 1,25 und 2,32 ms), vermutlich weil nebenher andere
Worker auf dem PC liefen. Vergleiche daher mit mehreren Läufen direkt hintereinander auf demselben Rechner. Die
Spielergebnisse (Kills, aktive Projektile) sind dagegen in jedem Lauf gleich. Nicht im Benchmark sind die Kosten im
Renderer (heute die Turmdrehung, dazu `presentFrame`) und der Raycast-Rückgriff der Sichtlinie. Holt P2 die
Turmdrehung in die Simulation, steigt der Sub-Step hier, die Ersparnis im Renderer sieht der Benchmark nicht. Ändert
P3 das Format der Sichtdaten, zieht `markAllVisible()` im Harness mit.

### Messung nach dem Umbau

2026-09-24, derselbe PC, Stand `simulator` nach P6, zwei Läufe ohne parallele Worker:

| Szenario | Median ms je Sub-Step | Basis |
|----------|-----------------------|-------|
| S (20 Tower, 200 Gegner) | 0,069 / 0,070 | 0,07 bis 0,11 |
| M (60 / 1000) | 0,321 / 0,316 | 0,30 bis 0,51 |
| L (120 / 3000) | 1,085 / 0,987 | 1,25 bis 2,32 |
| Vorspulen 10 800 Sub-Steps | 625 / 628 ms | 790 bis 1040 ms |

Nicht schlechter; die Basis lief neben vier Workern und streut entsprechend, ein Gewinn lässt sich daraus nicht
ablesen. Prüfsumme (nur solange eine Welle mit Snapshot läuft, einmal je Spielsekunde): 0,05 / 0,16 / 0,51 ms bei
200 / 1000 / 3000 Gegnern, also unter 0,01 ms je Sub-Step. Das Präsentations-Replay, das rund 0,8 ms je Spielsekunde
und bis zu 48 MB kostete, ist weg; ein Snapshot sind einige KB je Welle, bei 60 Towern einige zehn KB.

## 6. Entscheidungen

| # | Frage | Entscheidung |
|---|-------|--------------|
| D1 | Architektur des Replays | Ruhe-Snapshot: eine Simulation, Live-Stand sichern, Wellenstart laden, nachrechnen, Live-Stand zurück (User, 2026-09-24) |
| D2 | Raycast-Rückgriff im Kampf | Randzellen, die die Reichweite anschneiden, kommen mit in die Maske; was dann noch keine Antwort hat, gilt als nicht sichtbar (User, 2026-09-24) |
| D3 | Präsentations-Replay | Ersetzen und löschen, sobald die Neu-Simulation das Replay trägt (User, 2026-09-24) |
| D4 | Welche Wellen abspielbar | Alle Wellen des Laufs, dazu Export und Import als Datei (gleiche Welt vorausgesetzt) (User, 2026-09-24) |

## 7. Abnahme

- Abnahme-Spec aus P5 grün, Benchmark ohne Verschlechterung gegenüber `next`. **Erfüllt 2026-09-24.**
- Specs, beide tsc, Lint, Build grün. **Erfüllt 2026-09-24.**
- Im Spiel: Replay einer Welle auf einer echten Karte und in DevWorld, Springen vor und zurück, danach steht das Spiel
  wie vorher.
