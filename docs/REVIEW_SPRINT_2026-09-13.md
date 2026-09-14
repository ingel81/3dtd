# Review-Handover: Nachtschicht 2026-09-13

Nachtschicht auf dem neuen Branch `sprint/night-2026-09-13`, abgezweigt von
`39fbb18` (Stand von `sprint/todo-2026-09-11` nach dem Playtest vom
2026-09-12). Der Haupt-Checkout `D:/Source/3dtd` steht auf diesem Branch.
Alles liegt lokal, `main` ist unberührt, nichts ist gepusht. DONE.md ist
nicht angefasst. In TODO.md haben die betroffenen Einträge eine Stand-Zeile
bekommen, die offenen Befunde stehen im neuen Abschnitt 1.8; verschoben ist
nichts (siehe "TODO-Stand"). Die Runde davor steht in
[REVIEW_SPRINT_2026-09-12.md](REVIEW_SPRINT_2026-09-12.md).

**Reihenfolge für den Playtest:** Zuerst die offenen Punkte der alten Liste
in REVIEW_SPRINT_2026-09-12.md auf diesem Branch weitertesten: 4 bis 9, 11 bis
16, 20 bis 22, 25, 27 bis 29, 31, 33, 34, 36, 38, 41 bis 44, 53 und 54. Wo die
Nacht an einem dieser Punkte etwas geändert hat, steht es am Anfang der
Playtest-Liste unten. Danach die neuen Punkte ab Nummer 101.

## Stand

| | |
|---|---|
| Branch | `sprint/night-2026-09-13`, Head `52f6b3b` |
| Diese Nacht | 219 Commits `39fbb18..52f6b3b`, 534 Dateien, +51 287 / -18 945 Zeilen |
| Gesamt vor `main` | 431 Commits |
| Tests | vitest 232 Testdateien mit 2892 Tests (Nachtbeginn 133 mit 1699), pytest 101 (Nachtbeginn 98) |
| Prüfung | am Head beide tsc, ESLint und Production-Build grün; Initial-Bundle 357,18 kB (Nachtbeginn 364,56 kB) |

Nichts davon lief im Browser. Optik, Shader, Laufzeiten und Speicher sind per
Code-Review, Tests und Rechnung geprüft, nicht angesehen oder gemessen. Wo
eine Zahl ungemessen ist, steht das dabei.

## Vorgehen

23 Worker in eigenen Git-Worktrees, je ein Thema: ui-split, engine-split,
tests, hygiene, docs, nuke, blender, vat, controls, portal, split, polish,
fix1, bundle, corridor, fix2, hud, meta, gsm, viz, hot, cold und fix3. Vor
jedem Merge habe ich den Diff gelesen, bei Bedarf Nacharbeit angefordert, auf
den Nacht-Head rebasen lassen (engine-split Runde 2, vat Runde 2, hud, cold
und blender selbst rebased) und per Fast-Forward übernommen. Nach jedem Merge liefen
vitest, beide tsc, ESLint und der Production-Build. Vier Review-Agents haben
den gemergten Stand gelesen (Abschnitt "Review"), kleine Fix-Worker haben die
Befunde behoben (fix1 bis fix4).

Die Umbauten an Services, Visualization-Facade und `GameStateManager` stehen
auf Charakterisierungs-Specs, die vorher geschrieben wurden und grün bleiben
mussten; einige Specs wurden dabei an Mocks und entfernte Methoden angepasst
(`89871ab`, `6639381`, `a214973`). Die Engine hatte vorher keine eigene Spec,
dort sichern die Specs der neuen Module ab; hot stützt sich auf die schon
vorhandenen Specs.

## Was sich ändert

### Struktur und Aufräumen

#### Templates in eigene Dateien (ui-split, `a2d24f2`, `1a7a09c`, `1e475b0`)

- 24 Komponenten (die elf Debug-Fenster, HUD-Teile, Dialoge, DevWorld-Panel)
  haben Template und SCSS in eigenen `.html`- und `.scss`-Dateien. Die
  Scrollbar- und Glas-Rezepte sind Sass-Mixins in `styles/_td-mixins.scss`.
- Laut Commits kompiliert ein unminifizierter Build jede Komponente zum
  selben Code und zu denselben CSS-Deklarationen. Einzige Anpassung: der Pfad
  der Stein-Textur im Header.
- Die drei Commits bauen aufeinander auf (der dritte entfernt die
  TS-Konstanten, die nach den ersten beiden niemand mehr nutzt). Ein Revert
  am Head kollidiert bei allen dreien, weil spätere Worker dieselben
  Templates, Styles und `DESIGN_SYSTEM.md` geändert haben.

#### Hygiene (hygiene, `9306661` bis `c51ca12`)

- Alle `any`-Casts außerhalb der Specs durch Typen ersetzt. Sechs ungenutzte
  Barrel-Dateien, tote Helfer, Config-Getter, Typ-Aliase und die Style-Rezepte
  (`TD_PANEL_STYLES` usw.) entfernt, gefunden mit knip und Grep über `src`,
  `tools`, `training-backend` und `docs`.
- Konsole: die Start-Banner von Partikel-Pools, Decal-Managern, Flame Beam und
  Pathfinding-Worker sind weg, ebenso die Zeilen je Feuer-Event im Spiel.
  `[Tiles]`, `[Warmup]` und `[Corridor]` bleiben.
- Kein Verhaltenswechsel außer der Konsole. `f984d18` baut auf `a2192c1` auf.
  Ein Revert am Head kollidiert bei `9306661` (`wave-director.service.ts`,
  von cold zerlegt), `75f7658` (`particle-effects-renderer.ts`, von hot
  zerlegt), `7a8aaf3` (`DEVWORLD.md`, `terrain-generator.ts`) und `c51ca12`
  (`DESIGN_SYSTEM.md`); die übrigen fünf gehen konfliktfrei zurück.

#### Engine zerlegt (engine-split, `89871ab` bis `f8d1a97`, `d57026c` bis `5e4552f`)

- `three-tiles-engine.ts` von 2 234 auf 1 144 Zeilen (heute 1 198, unter
  anderem mit dem Screenshot-Pfad aus dem Photo Mode). Neu: `RenderLoop` (`engine.renderLoop`:
  rAF, Heartbeat im Training, Frame-Cap, FPS), `TerrainQueries`
  (`engine.terrain`: Säulenprobe, Tile-LOD, Straßen-Freiraum, Tower-Sicht),
  `scene-environment` (Lichter und Himmel), `ScreenPicker` (`engine.picker`)
  und `tiles-renderer-setup` (Plugins, Streaming-Budget). Cache-Schlüssel,
  Strahlen und die Aufrufernamen in `__raycastStats()` bleiben gleich.
- **Verhaltensänderung** `fe89146`: `dispose()` entfernt den
  `visibilitychange`-Listener, den der Hintergrund-Loop im Training anlegt.
  Vorher hielt er die ganze alte Engine im Speicher.
- **Konsole** `1f7c867`: zehn Banner-Zeilen eines DevWorld-Starts (darunter
  die Kamera-Position des Camera-Rigs) und die Zeile beim Umschalten der
  Tiles im Debug-Fenster ("3D Tiles visible/hidden") sind weg. Am Head
  konfliktfrei zurückzunehmen (siehe Entscheidungen).

#### GameStateManager zerlegt (gsm, `cf3de83` bis `e4d1a57`)

- Zuerst eine Spec, die die Aufrufreihenfolge festschreibt: im Sub-Step, pro
  Frame, über Pause und Timescale 1 und 10, Wellenende, Game Over, Reihenfolge
  der Listener je Event, Tower-Befehle, Reset. Später kamen der
  Korridor-Flush und der wartende Schlag dazu.
- Dann ausgelagert: `GameClock` (Sub-Step-Akkumulator, Nachhol-Grenze,
  Spielzeit), `CreditsLedger`, `BaseHealthLedger` (HQ-HP und Leck-Budget der
  Welle), `TowerLifecycle` (Platzieren, Verkaufen, Upgrade-Regeln,
  Wachrichtung) und `summarizeWaveGroups` als reine Funktion. Die
  Upgrade-Regeln lagen vorher im `GameCommandsHandler`, der jetzt nur noch
  weiterleitet.
- `game-state.manager.ts` von 1 089 auf 864 Zeilen. Die Reihenfolge-Spec ist
  unverändert grün, also keine Verhaltensänderung; `runSubStep()` legt kein
  Objekt pro Sub-Step mehr an. Die Commits bauen aufeinander auf; `e4d1a57`
  braucht zusätzlich `cf6b6ee` (fix2).

#### Visualization-Facade zerlegt (viz, `d750728` bis `2e64f7e`)

- `visualization-facade.service.ts` von 1 353 auf 793 Zeilen, sieben
  Hilfsklassen: `CorridorController` (Messung, Neuaufbau, Flush-Hook),
  `CorridorConsole` (`__corridor`), `RouteGridConvergence` (Terrain-Sweep
  nach Tile-Loads, Neuaufbau bei geänderten Zellen), `IntroLoadingGate`,
  `CameraOverview` (Totale, Reset Camera), `DpsBinsOverlay` und
  `BuildingOverlay`.
- Keine Verhaltensänderung: gleiche Aufrufreihenfolge, gleiche Logs und
  Rückgaben, die Charakterisierungs-Spec lief unverändert grün. Vorbestehende
  Eigenheiten wurden bewusst mit übernommen und danach von fix3 behoben
  (unter "Bugfixes").

#### Route, Grid, Tower-Renderer, Partikel zerlegt (hot, `14560ad` bis `a40dd11`)

- `path-route.service.ts` 1 686 auf 1 059 Zeilen: Höhenglättung der
  Straßen, Routengeometrie, der Bericht hinter `__routes.describe()` und die
  Routenlinien (`RouteLineLayer`) in eigenen Modulen.
- `global-route-grid.ts` 1 561 auf 1 100: Zellbau (`route-grid-builder`),
  Höhen-Sweep (`RouteGridHeightSweep`), Tower-LOS (`route-grid-los`) und
  die Probes hinter `__corridor.towerCells()` und `pick()`. Die Abfragen je
  Gegner bleiben in der Klasse.
- `three-tower.renderer.ts` 1 567 auf 1 016: Reichweitenanzeige und
  Debug-Marker (`tower-overlays`), Turret-Zielen (`tower-turret-aim`),
  Mündungslicht (`TowerMuzzleFlash`); drei nie aufgerufene Helfer entfernt.
- `particle-effects-renderer.ts` 1 259 auf 699: Einmal-Emitter
  (`particle-emitters`), Blut-, Eis- und Brandflecken (`GroundDecals`), eine
  Zündroutine für jedes Feuer (`fire-particles`).
- Laut Commits keine Verhaltensänderung: dieselben Zellen, Zufallsziehungen
  in derselben Reihenfolge, Logs und Konsolen-Globals gleich.

#### Services zerlegt (cold, `390ab11` bis `c811b96`)

- Wave-Director 620 auf 294 Zeilen (`wave-config-builder`, `onnx-policy`),
  AI-Data-Collector 825 auf 436 (`WaveOutcomeTracker`, `WaveHistory`,
  Snapshot-Teile), Hintergrundmusik 636 auf 387 (`MusicMixer`,
  `MusicBufferLoader`), Spatial Audio 545 auf 401 (`SpatialAudioLoops`,
  `EnemySoundBudget`), Tower-Platzierung 1 008 auf 602 (`TowerLosRegistry`,
  `BuildPreviewLos`, `tower-preview-model`), Location-Coordinator 703 auf 315
  (`LocationChangeExecutorService`), Location-Facade 790 auf 551
  (`MapRelocationService`).
- Laut Commits keine Verhaltensänderung; die Specs der Services blieben bis
  auf Mocks und Spione unverändert. Einzige Verschiebung: Die
  Wave-Result-Listener laufen jetzt nach dem vollständigen History-Eintrag,
  vorher dazwischen. Der einzige Listener, das Gate des Directors, liest die
  History nicht.

### Tests (tests, `b10c0bb` bis `4e5349b`)

- Elf Charakterisierungs-Specs für die Services, die danach zerlegt werden
  sollten: Location-Coordinator und -Facade, Tower-Platzierung,
  Global-Route-Grid-Service, Wave-Director, AI-Data-Collector, Kamera, Marker,
  Hintergrundmusik, Spatial Audio, Visualization-Facade. 411 Tests, laut
  Worker 87 bis 99 % Zeilenabdeckung dieser Dateien.
- Die Specs schreiben auch Ist-Fehler fest, statt sie zu beheben. Behoben
  haben sie polish (HQ-Marker, `cdbb558`) und cold (unter "Bugfixes").
- Über die Nacht: 1699 auf 2892 Tests, mit den Specs der neuen Module und
  Features.

### Doku (docs, `e7ef496` bis `7f1e529`, dazu die Doku-Commits der Feature-Worker)

- Neu [ROUTE_CORRIDOR.md](ROUTE_CORRIDOR.md): der Korridor, wie er auf dem
  Branch arbeitet, jede Aussage mit Dateiverweis; bisher über
  ROUTE_GEOMETRY_ANALYSIS und zwei Handovers verteilt.
- 15 Dokumente gegen den Code abgeglichen, dazu README, darunter
  ARCHITECTURE, EVENT_SYSTEM, SIGNAL-STORE, WAVE_SYSTEM, BOT_SYSTEM,
  TOWER_CREATION, PARTICLE_SYSTEM und LOCATION_SYSTEM. Drei überholte Dokumente
  liegen unter `docs/archive/`. INDEX.md listet jedes Dokument mit Status,
  CLAUDE.md und README folgen.
- Neu [ABILITIES.md](ABILITIES.md) (nuke). ENEMY_MODEL_BUDGET.md hat Spalten
  für Format und Half-Fehler und eine Alpha-Tabelle und beschreibt den Stand
  nach der Blender-Runde (`c19aefe`). Die Zerlegungen haben
  die Datei- und Zeilenverweise in ROUTE_CORRIDOR, ARCHITECTURE,
  SPATIAL_AUDIO, LOCATION_SYSTEM und weiteren Dokumenten nachgezogen.
- Die großen Diffs (ARCHITECTURE, WAVE_SYSTEM, PARTICLE_SYSTEM,
  TOWER_CREATION) hat der Worker gegen den Stand `39fbb18` geprüft; ein
  unabhängiger Faktencheck dieser Diffs steht aus.

### Features

#### Nuklearschlag (nuke, `94213b0` bis `44b8741`; Fix `cf6b6ee`)

- **Werte** wie am 2026-09-12 entschieden: eine Ladung, eine neue nach je drei
  abgeschlossenen Wellen (die Welle des Einsatzes zählt mit, eine volle
  Fähigkeit sammelt nichts an), 25 m Radius, 1,5 s Vorwarnung, 60 % der
  Max-HP, Bosse 20 %, Boden und Luft. Einschlag auf der Mitte der nächsten
  Route-Zelle im Umkreis von 30 m. Nur in einer Welle einsetzbar.
- **Forschung** "Nuclear Strike": 1 000 Gold, 40 s, nach Advanced Weaponry,
  kommt damit voraussichtlich nach dem ersten Boss (W10); eine Wellensperre
  gibt es nicht. Sie gibt die erste Ladung. Der
  Forschungsbaum hat 16 Knoten, das Encoder-Feature `research_progress` teilt
  jetzt durch 16. Gold-Puffer bis W30 69 auf 68 %.
- **Bedienung**: Knopf mit Strahlungssymbol neben START WAVE oder Taste K. Ein
  Ring mit 25 m folgt dem Cursor, rastet auf der Route-Zelle ein, gold dort,
  rot mit "No route within 30 m" abseits. Esc, kurzer Rechtsklick, zweites K,
  Build-Mode oder Wellenende brechen ab. Drei Striche am Knopf zählen die
  Wellen bis zur nächsten Ladung.
- **Simulation**: Der Einschlag landet im 90. Sub-Step nach dem Befehl, bei
  jeder Timescale, ohne Zufall; in der Pause steht der Countdown (Spec).
  Kein Tower-Credit, ein Kill zahlt seinen Anteil am Kill-Budget wie jeder
  andere.
- **Director**: Fähigkeits-Kills zählen im Fairness-Gate als Leck, im Spiel
  und im Trainings-Backend; der Reward liest weiter nur echte Lecks.
- **Bot**: `NuclearStrikeStrategy` (Priorität 97) feuert, sobald mindestens
  10 Gegner im letzten Fünftel ihrer Route stehen, auf den Gegner mit den
  meisten Nachbarn in 25 m. Nur strategist und meta erforschen den Schlag.
- **Darstellung**: Zielmarker mit schrumpfendem Ring, Explosion in drei Stufen
  (140 Partikel, dann 6 und 9 kleinere nach 120 und 260 ms) mit Brandflecken,
  Blut nur für die ersten 24 Kills, stärkster Shake (0,008 für 700 ms) wo
  immer er einschlägt, lauterer Explosions-Sound.
- **Fix nach Review 2** (`cf6b6ee`): Liegt ein Schlag noch in der Vorwarnung,
  bleibt die Welle offen bis zum Einschlag, höchstens 1,5 s Spielzeit. Vorher
  konnte er in der Bauphase oder in der nächsten Welle landen.
- Die Commits bauen aufeinander auf, als Block verwerfen. Außerdem braucht
  `44b8741` den Split, `61215ef` die Pause und `4a72e01` die Hotkeys.

#### Skeleton spaltet sich (split, `99178cd` bis `0557aba`; Fix `5dc8409`, `42f94b3`)

- Neuer Typ `skeleton-minion`: das Kenney-Skeleton mit 0,6 der Größe (etwa
  1,7 m), 6 HP, 7 m/s, unarmored, spaltet sich nicht weiter.
- Ein im Kampf getötetes Skeleton hinterlässt zwei Minions an seiner Stelle
  auf der Route. Ein Leck am HQ und "Kill all" spalten nicht. HP und Tempo der
  Minions folgen den Multiplikatoren der Welle. Kein Zufall, das passiert im
  Sub-Step des tödlichen Schadens.
- **Gold**: Das Kill-Budget der Welle verteilt sich auf alle Körper, die
  Summe pro Welle bleibt gleich, die Economy-Chart ändert sich nicht. "N left"
  und der Balken zählen die Minions mit.
- **Director**: Der Fairness-Cap rechnet ein Skeleton mit 32 HP und drei
  Körpern; nach Review 2 halbiert sich das Leck-Kontingent von
  `skeleton_swarm`, weil ein spät getötetes Skeleton zwei Minions zum HQ
  schicken kann. `skeleton_swarm` 40 bis 1500 auf 25 bis 940 (etwa dieselben
  HP je Welle), das statische W19 310 Skelette mit hpMult 0,5. Das
  Python-Gate rechnet gleich. AI-Schema bleibt v5, Checkpoints laden weiter.
- Knochen-Puff an der Todesstelle (12 Partikel, aus mit Impact Effects), Text
  "Splits into 2 minions on death" im Wave-Panel und im COMING-UP-Tooltip.
- Als Block verwerfen; `c395b95` (Pfad mittendrin starten) ändert allein
  nichts.

#### Spawn-Portal (portal, `a214973` bis `cc8da0f`; Nacharbeit portal2, `cfb85a8` bis `5bb5073`)

- Der schwebende Diamant am Spawn ist ein Steintor am Anfang der Route, mit
  Blick entlang des ersten Segments. Die Öffnung folgt der Korridorbreite
  (0,75- bis 1,75-fach einer 8 m breiten, 11 m hohen Öffnung). Das HQ behält
  seinen Diamanten.
- Heraustreten (`cfb85a8`): Die Portalfläche steht 0,8 m vor dem Routenstart
  (vorher 2 m, der Spawn lag damit hinter dem Rahmen). Der Spawn liegt jetzt
  in der Tiefe des Rahmens. Die Leere in der Öffnung ist opak und schreibt
  Tiefe (vorher 82 % deckend, ohne Tiefe): ein Gegner erscheint knapp hinter
  der Fläche, bleibt samt Healthbar verdeckt und tritt aus ihr heraus. Ein
  Spec schießt Strahlen von einem Körper am Spawn (bis 2,2 m hoch) zu Kameras
  vor und über dem Portal bei drei Skalen. Von hinten ist der Gegner zu
  sehen, bis er eingetreten ist.
- Zwei instanzierte Draw Calls für alle Portale: Tor (Stein und Leere, opak)
  und Straßenlicht (additiv), eigene Shader mit logdepthbuf, alles Leuchten
  emissiv.
- Look (`0916712`, `5bb5073`): schwerer Rahmen mit gestuften Plinthen, Sturz
  und Gesims, Krone, gezackten Spitzen und Hörnern, Oberkante 19,5 m bei
  Skala 1. Die Leere glimmt dunkelrot bis schwarz mit etwas Violett,
  Glutpunkte steigen im Shader auf. Stein prozedural: Quader mit Fugen,
  abgenutzte Kanten mit Abplatzern, Risse, Ruß und Brandspuren, Relief,
  gefaktes Licht mit dem Kernlicht aus der Öffnung; etwa 17 Noise-Abfragen
  und eine Worley-Abfrage pro Rahmenpixel, keine Texturen.
- Siegel (`634e4b6`): ein fester Satz von zehn fiktiven Siegeln aus Kreisen,
  Bögen und Punkten statt zufälliger Runen, die wie Kana, Kanji oder
  Buchstaben aussahen. Keine Fuge läuft durch ein Siegel.
- Aufflammen bei Wellenstart, heller während der Welle, danach Ruhe. Wirbel
  und Aufflammen laufen in Echtzeit, auch in der Pause.
- Burst beim Durchtreten: Ring und 10 Funken in Glutfarben, höchstens 4 pro
  Sekunde und Portal, aus mit Impact Effects (Preset Low).
- Die Platzier-Vorschau eines Spawns ist ein Portal.
- Intro und Totale lesen die Portalmaße. Der höchste Punkt am Spawn (Label
  des größten Portals) sinkt von 52,5 m (Diamant) auf 40,6 m (vor der
  Nacharbeit 33,6 m); das Intro hält etwas weiter weg als mit dem ersten
  Portal.
- Grundlage ist `a214973`, die vier Folge-Commits (drei Features, eine Doku)
  bauen darauf auf. Die vier Commits der Nacharbeit bauen jeder auf dem
  vorigen auf und lassen sich nur von oben her einzeln verwerfen.

#### Steuerung (controls, `c9880fe` bis `b48d2ac`; Fixes `3adfe31`, `c2f4877`, `4923c7d`)

- **Echte Pause** (`001e32d`): P oder Pause-Knopf links vom Tempo. Kein
  Sub-Step läuft, die Spielzeit steht, danach geht es ohne Nachholen weiter.
  Rendering, Kamera, Partikel und UI laufen weiter. Chip "Paused".
- **Tempo in der Bauphase** (`eaf07d8`): Der Knopf ist da, solange das Spiel
  läuft; Forschung läuft in Spielzeit und lässt sich so beschleunigen.
- **Verkaufen mit zweitem Klick** (`8cbe458`): rot, "Click again to sell",
  2,5 s. Bots verkaufen direkt.
- **Welle im Build-Mode starten** (`fdcce05`), Vorschau und Karte bleiben.
- **Hotkeys** (`241066b`): 1 bis 9 Karten, U erstes bezahlbares Upgrade, Entf
  oder Backspace zweimal verkauft, Space Welle, P Pause (der Debug-Shader liegt
  jetzt auf Shift+P), + und - Tempo, H oder ? Übersicht, Esc der Reihe nach
  Menü, Verkauf, Auswahl. Später dazu K (Nuklearschlag) und O (Photo Mode).
  Nichts beim Tippen, in Dialogen, beim Laden, mit Strg/Alt/Meta oder bei
  Tastenwiederholung.
- **Kamera-Sprünge** (`8c5b3a3`): Pos1 zum HQ, N reihum zu den Spawns, 600 ms.
- **Reichweite bei Hover** (`bf414ab`): ohne Build-Mode zeigt der Tower unter
  dem Zeiger seine Reichweite; höchstens ein Pick pro 100 ms, keiner bei
  gedrückter Maustaste.
- **Research-Queue** (`11b2884`): Sind alle Slots belegt oder fehlt Gold,
  reiht ein Klick die Forschung ein. Bots nutzen die Queue nicht.
- **Targeting "Last"** (`c9880fe`): der Gegner mit dem wenigsten Weg.
- **Auto-Start** (`b48d2ac`): Checkbox unter dem Wave-Button, Standard aus,
  10 s Spielzeit nach Wellenende; mit Bot aus.
- Abhängigkeiten laut Commits: Hotkeys brauchen Pause und
  Verkauf-Bestätigung, die Kamera-Sprünge die Hotkeys, die Queue-Spec die
  Pause.
- Fixes nach den Reviews: Eine fokussierte Checkbox schluckte alle Tasten
  (`3adfe31`), Space löste keinen fokussierten Button mehr aus (`c2f4877`),
  Slider verloren ihre Pfeiltasten an die Kamera (`4923c7d`).

#### HUD (hud, `f715bc9` bis `fc11e94`)

- **Air-Alert**: In der Bauphase eine Zeile über dem Wave-Button, wenn die
  nächste oder übernächste Curriculum-Welle Luft bringt, mit der Zahl der
  Tower, die Luft treffen (ohne: orange). Je neu angekündigter Luftwelle
  einmal ein kurzer Ton über die SFX-Lautstärke (W7 und W8 je einmal). Nach
  W30 aus.
- **Leck-Feedback**: roter Rand über dem Canvas, neu höchstens alle 900 ms;
  die HQ-Zelle im Header zeigt "72/100" und einen 2-px-Balken, der bei
  Verlust aufblitzt.
- **Offscreen-Pfeile** in der Welle: Bosse überall, andere Gegner auf den
  letzten 15 % der Route, in acht Sektoren, höchstens sechs Pfeile mit Zahl,
  mit Boss gold. 8-Hz-Timer außerhalb von Angular.
- **COMING UP**: Anzahl vom Template-Minimum bis zum Maximum, das der Director
  mit der aktuellen DPS schicken kann (dieselbe Funktion wie im Director),
  Rüstung, "Weak to" aus der Damage-Matrix; nach W30 "Director's pick" oder
  "Boss wave".
- **Boss-Leiste** oben mittig mit HP-Zahl; mehrere Bosse als dünne Leisten
  darunter, höchstens vier, dann "+N".
- **`isBoss` statt `bossName`** (`fc11e94`): `bossName` setzte kein Typ, der
  Boss-Shake beim Tod feuerte nie. Jetzt schüttelt Herberts Tod den
  Bildschirm (wenn Screen Shake an ist).
- `0858671` (COMING UP) nutzt Injections aus `f715bc9` (Air-Alert).
  `fc11e94`, `cdf8ef2` und `d7549ee` lesen `isBoss` aus `94213b0`
  (Nuklearschlag).

#### Meta (meta, `20e6a54` bis `27644cf`)

- **Build-Version**: Sidebar-Fuß und Ladebildschirm lesen `BUILD_VERSION`
  (vorher v0.1.0 gegen v0.2.0).
- **Zuletzt besucht**: die letzten 8 Orte in `td_recent_locations_v1`, HQs
  innerhalb 150 m zählen als ein Ort, ein Klick lädt mit dem gespielten
  Spawn. DevWorld wird nicht gespeichert.
- **Showcase**: 13 kuratierte Orte als zweiter Tab
  (`showcase-locations.config.ts`). Koordinaten per Nominatim geprüft, dass
  sie auf Weg, Straße oder Platz liegen; nicht einzeln angespielt. Braucht
  den Recent-Commit.
- **Schaden pro Tower**: Kachel "Dealt" im Tower-Panel, zählt die tatsächlich
  abgezogenen HP (kein Overkill); pro Treffer eine Map-Abfrage.
- **Run-Statistik** bei Game Over: Welle, Kills, Spielzeit, Gold verdient und
  ausgegeben, Lecks und HQ-Schaden je Welle, die drei Tower mit dem meisten
  Schaden. Braucht den Schaden pro Tower.
- **Photo Mode**: O oder Display, View. HUD weg, auch Boss-Leiste,
  Offscreen-Pfeile und roter Rand; Kamera frei, Klicks wählen nichts;
  Screenshot als PNG mit Logos und Attribution,
  `3dtd-<Ort>-<Datum>-<Zeit>.png`. Esc beendet. `3d62cd8` beendet beim
  Einschalten den Zielmodus des Schlags und braucht deshalb den
  Nuklearschlag.
- **Onboarding**: vier Tipps im Context-Hint beim ersten Start, Skip und Hide,
  `td_onboarding_v1`; "Tips" im Sidebar-Fuß startet sie neu. Die Tipp-Box
  liegt über den Offscreen-Pfeilen.

### Performance

#### Gegner-VAT (vat, `eb2ca4d`, `e948529`, `eb3b7da`, `578a821`, `03d3b7c`, `ec878b6`; Fix `3619914`, `29b94c0`)

- **Half Float** (`e948529`): Positionen relativ zur Bounding-Box als
  RGBA16F, wenn der Fehler im Spiel höchstens 2 mm beträgt, sonst Float32 wie
  vorher. Damals 18 von 19 Typen Half (0,26 bis 1,78 mm), der Stone Golem
  Float32 (2,64 mm). VAT 486,6 auf 264,7 MB GPU-Speicher, halb so viele Bytes
  pro Vertex-Zugriff. Mit dem Minion 264,2 MB, nach der Blender-Runde
  105,2 MB.
- **Opak statt transparent** (`eb3b7da`): 16 Typen im opaken Pass ohne
  Blending; Bear, Ghost und Hornet blenden weiter, Dragon ist eine Maske bei
  Alpha 0,5 (weiche Kanten werden hart). Der Review-Verdacht dazu ist per
  Model-Budget geprüft: kein opaker Typ hat Texel unter Alpha 0,05.
- **Beidseitig** (`578a821`): 11 Modelle sind glTF doubleSided, wurden aber
  einseitig gezeichnet, Flügel verschwanden von hinten. Ghost und Hornet
  bleiben in einem Pass.
- **Loops ohne doppelte Startpose** (`03d3b7c`): sechs Clips (Mech Walk,
  Wallsmasher Walk und Run, Mammoth Walk, Zombie Soldier Run, Bear Walk).
  Todes-Clips, die vor dem Entfernen des Gegners enden, halten ihre Endpose
  (Wallsmasher Death).
- **VAT nur auf der GPU** (`ec878b6`): Die CPU-Kopie wird nach dem Upload
  freigegeben, laut Rechnung 264 MB weniger Tab-Speicher (nicht gemessen).
  Nach einem WebGL-Context-Restore backt der Renderer alle Typen neu, in Node
  etwa 5 s für 19 Typen. Konsole: `__perf.loseContext(ms)`.
- FPS-Wirkung ungemessen.

#### Gegnermodelle in Blender (blender, `99f2845` bis `32195cb`, dazu `d64e4f1`)

- **VAT aller Typen 264,2 auf 105,2 MB** (in Float32 wären es 188,9 MB), kein
  Template mehr über 5 Mio. Vertices pro Frame. Die teuersten Wellen jetzt:
  `rat_tide` 5,0 Mio., `mech_army` 4,2, `zombie_horde` 3,6, `skeleton_swarm`
  3,3. Die Commit-Texte nennen die VAT-MB meist in Float32.
- **Dezimiert**: Hornet 69 297 auf 4 915 VAT-Vertices (`hornet_strike` 14,9
  auf 1,4 Mio.; `cc8a114`, Kopf ohne UV-Streifen `64c1f11`), zombie_v2
  31 342 auf 4 870 mit neuen UVs und neu übertragener Farbe (`4c8d21c`,
  `b09d24d`), Wraith 30 228 auf 8 126 (`c2d1f72`), Spider 13 173 auf 2 140
  mit nur noch dem Walk-Clip (`5ae5411`), Rat 2 150 auf 999 (`43a511c`).
- **Nur Texturen und Clips**: Bat und Penguin mit einer 512-px-Basisfarbe
  (`9d142e2`, `113f3c8`), Mammoth nur mit Walk und Die (`bbe0c41`).
- **Loops**: Dragon-Flug auf einen 3,3-s-Zyklus (`e726923`), Stone-Golem-Walk
  auf 1,33 s ohne Sprung am Loop, Texturen 1024 px (`d28d6b1`).
- **Wallsmasher als GLB** (`99f2845`, 17 010 auf 3 444 VAT-Vertices, Skala
  0,037 auf 3,7 wegen Meter statt Zentimeter) und **FBX-Loader entfernt**
  (`aaa4efc`, braucht den GLB-Commit).
- **`Electrocuted_Fall` zurück** (`05b2523`), auf den Sturz geschnitten:
  Einer von drei Todes-Clips von zombie_v2 fällt jetzt innerhalb der 2 s zu
  Boden. Hängt wie `b09d24d` an `4c8d21c` (dieselbe GLB).
- **Zombie mit glatten Normalen** (`700b102`): 4 525 auf 1 453 VAT-Vertices,
  eine Look-Änderung. Code und GLB einzeln zurückzunehmen; am Head kollidiert
  der Revert nur in `docs/ENEMY_MODEL_BUDGET.md`, die Datei danach per
  `npm run model-budget` neu erzeugen. Gleiches gilt für `43a511c` (Rat).
- **Sichtbare Unterschiede** laut Commits: Hornet-Beine aus der Nähe
  facettiert; zombie_v2 etwas weicher, Schädelumriss facettiert; Wraith-Brustkorb
  gröber, Roben-Falten einfacher; Spider-Beine kantiger. Die Rat-Animation ist
  nicht exakt (Entscheidungen, Punkt 8).
- Nicht geändert: Mech, Ghost und Tank.
- **Werkzeuge**: `tools/blender/optimize_enemy.py` (ein Rezept je Modell,
  liest das Original aus `39fbb18`, läuft headless; ersetzt
  `optimize_zombie_v2.py`), Vergleichsskripte `tools/model-budget/*.mjs`,
  Vergleichsbilder unter `tmp/blender-night/`.

#### Bundle (bundle, `2abb9f4` bis `073e9c6`)

- Der Location-Dialog lädt beim ersten Öffnen (73,1 kB), Damage-Matrix,
  Credits und Tastenübersicht als ein gemeinsamer Chunk (32,2 kB), der
  Token-Screen per `@defer` (11,0 kB). Statische Import-Hülle der Spielroute
  2 221,2 auf 2 105,8 kB roh, 588,0 auf 563,8 kB gzip.
- `provideAnimationsAsync` entfernt (nichts nutzt Angular-Animations,
  Material behält seine CSS-Übergänge), Roboto 300 entfernt (keine Regel
  fragte danach). Initial-Bundle 364,6 auf 356,4 kB, mit HUD und Meta heute
  357,18 kB.
- Ohne gespeicherten Key wartet der Token-Screen einen Request länger.
- Mit der Blender-Runde fällt der FBX-Loader aus dem Bundle (laut
  bundle-Worker etwa 61 kB); das Initial-Bundle bleibt bei 357,18 kB.

#### Korridor-Messung in Scheiben (corridor, `879ad8b` bis `b9f468c`)

- Die Freiraum-Messung lief in einem Stück (Playtest-Punkt 52: 1260 Strahlen,
  520 bis 533 ms). Jetzt höchstens 4 ms pro Frame, die erste Scheibe läuft im
  Aufruf. Routen und Zellen behalten den alten Korridor, bis die Messung fertig
  ist, dann ein Neuaufbau wie bisher (etwa 40 ms, synchron). In der Log-Zeile
  ist `in` die Summe der Scheiben, dazu `slices=` und `wall=`.
- Ein Tower oder eine Welle während der Messung (Klick, Hotkey, Auto-Start,
  Director, Bot) misst erst den Rest in einem Stück (`b9f468c`, Log
  `flushed=tower` bzw. `flushed=wave`), schlimmstenfalls also der alte Hänger.
  Debug-Gegner brechen die Messung ab ("clearance cancelled").
- `428f339`: Spawn oder HQ auf der Karte versetzen misst den Korridor jetzt
  (vorher OSM-Breite, TODO 1.7). `9a6aa37`: Eine Nachmessung, die das Intro
  oder die 3-s-Drossel zurückhielt, wird nach etwa 3 s nachgeholt (der offene
  Rest von Review-Befund 2 vom 2026-09-12).
- `879ad8b` nicht ohne `b9f468c` behalten: ohne den Flush bleibt ein Ort, an
  dem während der Messung gebaut wird, auf OSM-Breite.

### Bugfixes

#### Audit-Befunde (polish, `215c9ef` bis `cdbb558`)

- Der Build-Hinweis zeigt "Hover" und "Line of Sight" statt "Wait" (`215c9ef`).
  Die LOS-Vorschau folgte dem Zeiger schon vor der Nacht ohne Verzögerung,
  der Commit ändert nur den Text.
- **Magic Tower** (`36299ab`): Die Kugel drehte sich ohne Ziel in Echtzeit;
  das verschob die Zeit bis zum ersten Schuss und der Tower drehte nach der
  Welle nicht zur Wachrichtung. Jetzt zielt, hält und dreht er wie alle
  anderen, die Kugel wippt nur noch.
- **Enemy Debugger** (`13123a9`): Entfernen und Clear All laufen über den
  Event-Bus, danach drehen die Tower zur Wachrichtung. Zwei Debug-Events ohne
  Sender sind gestrichen.
- **State-Dump** (`d70dd64`): Dateiname mit Ortsnamen statt "unknown"; vier
  nie geschriebene Signale im LocationStore sind weg.
- **HQ-Marker** (`cdbb558`): Beim Neusetzen ohne Terrainprobe behält er seine
  Höhe, vorher fiel er auf `MARKER_FLOAT_HEIGHT` in absoluter Szenenhöhe.
- Ohne Verhaltensänderung: Poison-Grundschaden aus der Config, ein
  Decal-Default, `FIRE_INTENSITY` wird gelesen, eine Liste der
  Terrain-Presets, `?grid`, `isElite` und `fetchWithRetry` entfernt,
  ARCHITECTURE nennt die 10 Boot-Schritte.

#### Review-Fixes (fix1 `3adfe31` bis `29b94c0`, fix2 `5dc8409` bis `4923c7d`)

Siehe Abschnitt "Review".

#### Service-Fehler aus den Specs (cold, `59e7bea` bis `8777487`, `0e6187e`)

Die Charakterisierungs-Specs hatten diese Fehler als Ist-Stand festgehalten;
sie erwarten jetzt das richtige Verhalten.

- **Tower-Vorschau** (`59e7bea`): Esc im Build-Mode, während das
  Vorschaumodell noch lud, ließ das späte Modell versteckt im Overlay
  liegen; zwei schnelle Typwechsel konnten in falscher Reihenfolge fertig
  werden. Ein veralteter Ladevorgang verwirft sein Modell jetzt.
- **ONNX-Session** (`5b6d061`): Nach "Use rules" im Debug-Fenster brachte ein
  späteres `setEnabled(true)` das Modell zurück, während der Status "Rule
  director active" zeigte. Die Session wird jetzt freigegeben. Nur der
  Debug-Pfad.
- **AI-Data-Collector**: `recentAvgDamage` entfernt (`89196c4`), es cachte
  seinen ersten Wert und niemand las es. `avgEnemyLifetimeMs` misst von Spawn
  bis Tod oder HQ statt bis Wellenende (`600534e`); das Feld geht ans
  Trainings-Backend, dessen Reward es nicht nutzt.
- **Spatial Audio**: Eine Datei, die nicht lädt, liefert null statt einer
  Rejection (`912ff9b`). `stopAll` stoppt auch globale Sounds (`c4fa853`); es
  läuft heute nur aus `dispose()` (`spatial-audio.manager.ts:394`). Der `visibilitychange`-Listener geht beim
  Dispose (`72b48b7`).
- **Projektil-Sounds** (`0e6187e`): Bei vollem Projektil-Budget (25) nahm eine
  abgelehnte Anfrage trotzdem einen Slot des Samples und gab ihn nicht
  zurück. Nach einigen Ablehnungen blieb das Sample stumm, bis sein Buffer aus
  dem Cache fiel. Das Budget wird jetzt zuerst geprüft.
- **Musik** (`23160b6`): Scheitert ein Track, während sein Preload noch läuft,
  gibt es keine unbehandelte Rejection mehr, und ein früher Ladefehler bleibt
  nicht dauerhaft in der Map.
- **Location-Facade** (`8777487`): `dispose()` gibt Komponente, Spielstand und
  Callbacks frei. Arbeit, die erst nach dem Ende der Komponente fertig wird
  (Straßen-Load für einen HQ-Wechsel, DevWorld-Neubau), setzt das alte Spiel
  nicht mehr zurück.

#### Kleinbefunde (fix3, `158f0f1` bis `c8c4242` und `06d49b2` bis `9d60aaa`)

Von viz, cold und gsm gefunden und bewusst nicht in deren Umbau behoben:

- **DPS-Bins** (`158f0f1`): Zweimal eingeschaltet, abonnierten sie die
  Tower-Events doppelt; nach Anzeigen, Anzeigen, Ausblenden machte die nächste
  Tower-Änderung sie wieder sichtbar. Jetzt genau ein Abo.
- **Höhen-Refresh nach Dispose** (`3a17d65`): Ein kurz vor einem Ortswechsel
  angefordertes Refresh lief einen Frame später noch und baute Routenlinien,
  Markerhöhen und Routen-Animation des alten Orts neu. `dispose()` bricht es
  jetzt ab.
- **`__corridor` nach Dispose** (`1d49e51`): blieb auf `globalThis` und hielt
  die alte Facade samt Spielstand und Engine; `dispose()` entfernt es.
- **Musik bei verweigertem `resume()`** (`cbbbf4e`): Verweigerte der Browser
  das Fortsetzen des Audio-Kontexts (noch keine Nutzergeste), gab es bei jedem
  Phasenwechsel eine unbehandelte Rejection, und der Mixer blieb halb
  umgeschaltet: Der neue Track startete nie, die Musik lief aus und blieb
  stumm. Jetzt läuft der Crossfade weiter, mit einer Konsolenzeile pro Mixer.
- **Sounddatei nach Ladefehler** (`9828d0e`): Ein gescheiterter Ladeversuch
  blieb für die Sitzung im Cache, spätere Registrierungen luden nie neu. Jetzt
  gibt es einen neuen Versuch, frühestens 30 s nach einer gescheiterten Runde,
  höchstens drei Runden (12 Requests pro URL und Sitzung).
- **Leck-Budget in `beginWave()`** (`08a6d22`): wird jetzt aufgefüllt wie in
  `startWave()`. Heute erreicht laut Commit kein Produktionspfad
  `beginWave()`, alle Wellenstarts bringen eine Config mit.
- **Doku** (`c8c4242`): HANDOVER_ROUTE_GRID_GPU_LOS beschreibt den Ablauf
  nach einem Tile-Load wieder so, wie der Code ihn macht.

Teil 2 behebt die vier Befunde des dritten Reviews (`06d49b2` bis `9d60aaa`):

- **Pan-Taste auf einem Slider losgelassen** (`06d49b2`): Hielt man eine
  Pfeiltaste über der Karte und klickte dabei in einen Slider, kam das
  Loslassen nicht mehr an, die Kamera fuhr weiter. Das Loslassen wird jetzt
  immer verarbeitet; der Verdacht aus dem Review hat sich bestätigt.
- **Air-Alert-Ton** (`d132884`): Nach einem Restart oder Ortswechsel kam der
  Ton für W7 nicht mehr, und eine Welle galt als angekündigt, auch wenn der
  Ton mangels Audio nicht spielte. `AirAlertAnnouncer` vergisst die Welle bei
  einem neuen Lauf und merkt sie sich erst, wenn der Ton gespielt hat.
- **Photo Mode und Fokus** (`c23280b`): Beim Einschalten fiel der Fokus auf
  die Seite, beim Ausschalten kam nichts zurück. Jetzt liegt der Fokus auf
  "Save", nach dem Beenden wieder auf dem vorherigen Element; das zuvor offene
  Menü geht wieder auf. Beides wird über den LiveAnnouncer angesagt.
- **Lazy-Chunk lädt nicht** (`9d60aaa`): Beim Start ohne Standort zeigt der
  Fehlerbildschirm den Grund, statt bei "Select location..." zu hängen; ein
  Klick auf "DEFEND <Ort>" zeigt ein Banner über dem Spiel (`UIStore.notice`),
  das Spiel läuft weiter; der Token-Screen hat einen `@error`-Block mit
  Reload.

#### Befunde des vierten Reviews (fix4, `54a51cf` bis `52f6b3b`)

- **Ladefehler oder Öffnungsfehler** (`54a51cf`): Nur ein fehlgeschlagener
  Import des Dialog-Chunks gilt noch als Ladefehler. Ein Fehler beim Öffnen
  (Konstruktor, Dependency Injection) zeigt "The location dialog failed to
  open. Reload the page." und steht per `console.error` in der Konsole; geht
  die Komponente vorher weg, bleibt es still wie bisher.
- **Air-Alert erst nach dem Ton** (`005ba23`): Eine Luftwelle gilt erst als
  angekündigt, wenn `playGlobal` ein Audio-Objekt liefert; eine Antwort, die
  erst nach einem Restart kommt, zählt nicht.
- **`getOrLoad`** (`52f6b3b`): löst nach allen Versuchen mit null auf, statt
  zu rejecten. Heute ohne sichtbare Wirkung.

## Entscheidungen für dich

Von Workern selbst getroffen, bitte im Playtest bewerten:

1. **`isBoss` nur bei Herbert** (`94213b0`). Die Bosswellen W10, W20 und W30
   sind Herbert-Wellen (`boss_herbert`). Stone Golem und Dragon laufen in
   `golem_squad` (W15) und `dragon_elite` (W12, W24); `boss_golem` und
   `boss_dragon` stehen auf keinem Curriculum-Platz und sind erst ab W31
   wählbar. Weil das Flag je Typ gilt, nimmt der Schlag Golem und Dragon 60 %
   statt 20 %, und in `boss_golem` oder `boss_dragon` bekämen sie keine
   Boss-Leiste, keinen goldenen Pfeil und keinen Boss-Shake.
2. **Bot-Baselines**: strategist und meta geben 1 000 Gold für den Schlag aus
   und setzen ihn ein. Ihre Läufe sind mit denen vor `77f3f2d` nicht direkt
   vergleichbar; beginner und casual spielen wie vorher.
3. **Keine Rückgabe der Ladung**: Trifft der Schlag niemanden, ist die Ladung
   weg. Stattdessen wartet die Welle auf den Einschlag (`cf6b6ee`).
4. **Magic-Kugel dreht sich nicht mehr** ohne Ziel (`36299ab`).
5. **Dragon mit harten Kanten** (Alpha-Maske statt Blending, `eb3b7da`).
6. **Stone Golem bleibt Float32**: Mit 2,64 mm liegt er über der 2-mm-Schwelle
   (ein halbes Pixel bei 1440 Zeilen, 5 m Mindestabstand, 60° Sichtfeld). Nach
   `d28d6b1` hat er 21,5 MB, als Half Float spräche er rund 11 MB ein.
7. **Zombie mit glatten Normalen** (`700b102`): glatt statt facettiert, im
   Spiel und in der Sidebar-Vorschau. Code und GLB einzeln zurückzunehmen,
   dann bleibt die facettierte Optik; `docs/ENEMY_MODEL_BUDGET.md` danach per
   `npm run model-budget` neu erzeugen.
8. **Rat-Animation nicht exakt** (`43a511c`): Der Weg durch Blender verändert
   den Run-Clip zwischen den Keys, auch ohne Dezimieren. Bei Frame 3 und 7 von
   11 liegt der obere Hinterkörper bis 9,4 % der Modellhöhe daneben (etwa
   7 cm im Spiel). Code und GLB einzeln zurückzunehmen, danach
   `npm run model-budget`; eine reine Texturänderung behielte die 2 150
   VAT-Vertices.
9. **Portalfarbe nur als Akzent**: Seit der Nacharbeit glimmt jedes Portal
   dunkelrot (`SPAWN_PORTAL_LOOK.palette`); die Spawnfarbe tönt nur den Rand
   der Leere, die Siegel und das Straßenlicht, die Funken sind Glut.
10. **Log-Zeilen entfernt** (`1f7c867`): "3D Tiles visible/hidden" und die
    Kamera-Position des Camera-Rigs; am Head konfliktfrei zurückzunehmen.
11. **Slider behalten ihre Tasten** (`4923c7d`): Auf einem fokussierten Slider
    bewegen Pfeile, Pos1, Ende, Bild auf und Bild ab den Slider statt der
    Kamera. WASD, Space und Ziffern gehen weiter ans Spiel.
12. **Verkaufen auf Entf und Backspace**, nicht auf S (WASD). Esc wählt am
    Ende der Kaskade den Tower ab.
13. **Auto-Start standardmäßig aus**, 10 s in Spielzeit, folgt also dem Tempo.
14. **Research-Queue**: Gold erst beim Start; die vorderste wartet auf ihr
    Gold, günstigere dahinter überholen nicht; Entfernen ohne Erstattung (es
    war nichts bezahlt).
15. **Herbert `immunityPercent: 100`** wird weiterhin nirgends gelesen. Das ist
    Entscheidung 7 in BALANCE_PROPOSAL_2026-09.md (Empfehlung dort: streichen,
    zusammen mit dem Tentacle True Damage).
16. **Stone-Golem-Schritt** (`d28d6b1`): Der Walk-Loop dauert 1,33 s statt
    4,17 s, der Schritt wiederholt sich öfter, die Schrittlänge bleibt.
17. **Sidebar-Vorschau**: Der Wallsmasher zeigt seine Atlasfarben statt einer
    Holzfarbe; Rat, Bat und Penguin haben dort keine Normal-Map mehr, das Fell
    der Ratte wirkt flacher.
18. **Photo Mode stellt das Menü wieder her** (`c23280b`): Wer über Display,
    View einschaltet, hat nach Esc das Display-Menü wieder offen (bewusst so).

## Review

Zwei Review-Agents haben gelesen: einer `39fbb18..cc8da0f` (ui-split,
hygiene, tests, engine-split, docs, vat, controls, portal), einer
`cc8da0f..29b94c0` (split, polish, nuke, fix1). Keiner fand einen Befund der
Schwere hoch.

Befunde:

1. **Fokussierte Checkbox legt alle Tasten lahm** (mittel): Nach einem Klick
   auf "Auto-start" behielt die Checkbox den Fokus, `isTypingTarget` hielt
   jedes `input` für ein Textfeld, Space kippte die Checkbox. Behoben
   `3adfe31`.
2. **Space klickte keinen fokussierten Button mehr** (niedrig), weil jedes
   Space-keyup geschluckt wurde. Behoben `c2f4877`: nur noch das keyup des
   Drucks, der die Welle gestartet hat.
3. **Opake VAT-Typen verwerfen Alpha unter 0,05 nicht mehr** (Verdacht).
   Geprüft per Model-Budget (`3619914`, `29b94c0`): kein opaker Typ betroffen.
4. **Fairness-Cap zählt ein Skeleton als ein Leck** (mittel, Verdacht),
   obwohl es zwei Minions schicken kann. Behoben `5dc8409`, `42f94b3` (TS und
   Python, nur `skeleton_swarm`).
5. **Schlag überlebt das Wellenende** (niedrig), die Ladung ging verloren oder
   traf die nächste Welle. Behoben `cf6b6ee`.
6. **`bossName` neben `isBoss`** (Parallelsystem), der Boss-Shake feuerte nie.
   Behoben `fc11e94` (hud).
7. **Slider verlieren die Pfeiltasten** (niedrig), Folge von `3adfe31`.
   Behoben `4923c7d`.

Ein dritter Review-Agent las `29b94c0..2e64f7e` (bundle, corridor, fix2,
hud, gsm, meta, viz), ebenfalls ohne Befund der Schwere hoch; gsm und viz sind
laut Review nachweislich verhaltensgleich. Befunde, alle von fix3 behoben:

8. **Lazy-Chunk ohne Fehlerpfad** (mittel): Scheiterte der Download eines
   Dialog-Chunks, blieb der Start ohne Standort bei "Select location..."
   hängen. Betroffen: die Location-Facade, der Klickpfad im Coordinator und
   der Token-Screen (`@defer` ohne `@error`). Behoben `9d60aaa`.
9. **Air-Alert-Ton nach einem Restart stumm** (niedrig). Behoben `d132884`.
10. **keyup auf einem Slider verschluckt das Loslassen einer Pan-Taste**
    (Verdacht, bestätigt). Behoben `06d49b2`.
11. **Photo Mode ohne Fokusführung** (niedrig). Behoben `c23280b`.

Ein vierter Review-Agent las `2e64f7e..9d60aaa` (hot, cold, fix3 und den
Code der Blender-Runde), ebenfalls ohne Befund der Schwere hoch. Die
Zerlegungen hat er Commit für Commit gegen den Stand davor verglichen: keine
verlorenen Subscriptions, keine geänderte Aufrufreihenfolge, Dispose und das
Abbrechen von rAF-Callbacks vollständig; die Zufallsreihenfolge beim Feuer von
Hand verglichen, unverändert. Drei niedrige Befunde, von fix4 behoben:

12. **Boot-Fehler zu grob** (niedrig): Der Catch beim Start in der
    Location-Facade meldete jeden Fehler des Dialogs, auch einen im
    Konstruktor oder in der Dependency Injection, als Ladefehler und loggte
    die Ursache nicht (`9d60aaa`). Behoben `54a51cf`.
13. **Air-Alert galt zu früh als angekündigt** (niedrig): auch dann, wenn
    `playGlobal` keinen Ton lieferte (`d132884`). Behoben `005ba23`.
14. **`AudioBufferCache.getOrLoad` falsch typisiert** (niedrig): rejectete
    nach dem Rethrow, heute ohne Auswirkung (`9828d0e`). Behoben `52f6b3b`.

Damit decken die vier Reviews `39fbb18..9d60aaa`.

## Befunde, offen

In TODO.md unter 1.8 eingetragen. Was fix3 in der Nacht noch behoben hat,
steht unter "Bugfixes".

1. **Canvas folgt keiner Fenstergröße**: `engine.resize()` läuft nur beim Start
   (`engine-initialization.service.ts:308`) und über `fitToCanvas()` beim Photo
   Mode. Aus dem Code, nicht im Browser gesehen.
2. **COMING UP** zeigt die Anzahl-Spanne nur mit aktivem Director (hud).
3. **Nuklearschlag**: Die Explosionsstufen laufen über `setTimeout`
   (`vfx.service.ts:108`), also in Echtzeit; pausiert man kurz nach dem
   Einschlag, gehen die restlichen Stufen trotzdem los. VFX, Audio und Shake
   unterscheiden noch keine Fähigkeiten. Keine Warnsirene.
4. **Portal**: Pfeiler und Hörner können in Gassen in Fassaden ragen (der
   Rahmen ist seit der Nacharbeit größer), der Lichtfleck liegt am Hang
   eventuell schief. Von hinten sieht man Gegner, bis sie in die Fläche
   getreten sind. Große Gegner ragen beim Spawn teils vor die Fläche,
   Lufteinheiten sind nicht geprüft. Farben und Stein sind ohne Browser
   abgestimmt, die Shader nur gegengelesen (laut Worker).
5. **Korridor**: Der Neuaufbau (etwa 40 ms) landet meist mitten im Intro, die
   Routen-Animation startet dann neu. Eine Welle nach einem Flush nutzt die
   vorher berechnete Director-Konfiguration.
6. **Split**: Balance ungespielt. Das Training-`total_count` enthält die
   Minions. Die Debug-Platzierung kopiert weiter den Pfad. Ist ein
   Debug-Skeleton der einzige Gegner, drehen die Tower eventuell kurz zur
   Wachrichtung. `99178cd` nennt +0,5 MB statt 0,2 MB.
7. **Bundle**: `@angular/animations` steht noch in `package.json`. Der
   Fehlerbildschirm nach einem gescheiterten Chunk-Download nennt weiter
   "Change tile credentials" als Ausweg (laut fix3).
8. **HUD**: Layout ungesehen ("100/100" knapp, 47 von 51 px), Ton ungehört,
   Offscreen-Scan bei 20k ungemessen.
9. **Steuerung**: Hover-Pick bis 10 pro Sekunde ungemessen. Ein Wellenstart
   hebt die Pause nicht auf. Die Queue nimmt keine Ketten von
   Voraussetzungen (laut Worker).
10. **Meta**: Showcase-Orte nicht angespielt; Screenshot und `fitToCanvas`
    nicht im Browser; Recent speichert auch Orte, deren Route scheitert.
11. **VAT**: Die Ersparnis im Tab-Speicher ist gerechnet; ein Context-Restore
    backt alle Typen neu, im Browser ungemessen.
12. **Gegnermodelle**: Wraith-Brustkorb aus der Nähe gröber, Hornet-Beine und
    zombie_v2-Schädelumriss facettiert; Mech, Ghost und Tank nicht optimiert
    (`mech_army` 4,2 Mio. Vertices pro Frame).
13. **Training-Debugger**: bekommt seine Callbacks als Funktions-`@Input`
    statt als Outputs; von hygiene nicht umgestellt, weil API-Änderung.
14. **Bot-Läufe** mit Chaos Tower, `skeleton_swarm`, Split und Nuklearschlag
    fehlen weiter (TODO 1.7).
15. **Photo-Leiste ohne Fokusfalle**: Tab kann die Leiste verlassen (laut
    fix3).

## Playtest-Liste

**Offene Punkte stehen jetzt in [docs/PLAYTEST.md](PLAYTEST.md) (Stand 2026-09-15).**

**Stand 2026-09-14 (nach der Fix-Session):** Die offenen Punkte 117, 121,
142, 144, 151, 154 bis 231 und 238, dazu die alten Punkte 53 und 14, sind
vorsortiert in
`tmp/fix1/reports/sorter-night1.md` (Code-Stand `509aaed0`): 17 überholt,
32 per Szenario-Test prüfbar (verifyE), 29 für den User in den Runden O bis
T, 7 gemischt. **verifyE:** von 39 Logikpunkten (inklusive der Logikteile
der gemischten) sind 37 per Test bestätigt, kein Befund; 166 (Hinweistext)
und 189 (blockierter Chunk des Token-Screens) nur teilweise per Test.
Teilweise überholt: 163 (Kamera-Timeline loggt in DevWorld eine
`[Camera]`-Zeile), 174 (HQ-Teil durch 541/544), 176 (`clamped` ersetzt
durch `unwalkable`/`walkable`). Hinweis zu 161: mit Token in
`environment.ts` kommt der Token-Screen nur mit `?tokensetup`. Die Erwartungen zu 176, 178 und 205 bis 209 sind dort an den
neuen Korridor angepasst (keine orangen Zellen mehr). 157 bleibt in TODO 1.4.
Für alte Liste 14 (Paris-Brücke) gibt es einen Fix aus dem Code
(`427443a6`, corridor2), belegt durch Specs, im Browser ungesehen; offen ist
H2 (kurze Zufahrts-Ways ohne Brücken-Tag noch über dem Kai). Nachtest-Frage
in Runde O.

Nummeriert, damit du mit "7 ok, 12 kaputt" antworten kannst. Die neuen Punkte
beginnen bei 101, damit sie sich nicht mit der alten Liste überschneiden.

**Zuerst: alte Liste auf diesem Branch**

Offene Punkte aus REVIEW_SPRINT_2026-09-12.md: 4 bis 9, 11 bis 16, 20 bis 22,
25, 27 bis 29, 31, 33, 34, 36, 38, 41 bis 44, 53, 54. Seitdem geändert:

- **9**: Die clearance-Zeile hat jetzt `slices=` und `wall=`, `in` ist die
  Summe der Scheiben. Der Hänger nach dem Laden sollte weg sein (siehe 147).
- **16 und 29**: Vergleich jetzt gegen `39fbb18`. Die VATs sind Half Float,
  zum Teil opak, nur noch auf der GPU und nach der Blender-Runde zusammen
  105,2 MB statt vorher rund 486 MB (siehe 157).
- **28**: Der Wallsmasher hält im Tod jetzt die Endpose.
- **38**: Mit der Forschung Nuclear Strike sinkt der Gold-Puffer bis W30 von
  69 auf 68 %.
- **42**: Vom Intro zurückgehaltene Nachmessungen kommen jetzt nach etwa 3 s
  (siehe 150).

**Steuerung**

101. Welle starten, P oder Pause-Knopf: Gegner, Projektile und Forschung
     stehen, Chip "PAUSED"; Partikel und HQ-Feuer laufen weiter. P setzt ohne
     Sprung fort.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
102. Vor W1: Tempo-Knopf sichtbar, + und - schalten 1x, 2x, 4x.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
103. Tower wählen, Sell: Knopf rot, "CLICK AGAIN TO SELL", zweiter Klick
     innerhalb 2,5 s verkauft, sonst zurück. Entf zweimal: ebenso.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
104. Tower-Karte gewählt (Build-Mode), START WAVE: Welle startet, Vorschau
     bleibt, Bauen geht weiter.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, mit dem neuen
     Knopf "▶ WAVE N" und Space)
105. Hotkeys: 1 wählt Archer, U kauft das erste bezahlbare Upgrade, Space
     startet die Welle, H oder ? zeigt die Übersicht, Esc schließt der Reihe
     nach Menü, Verkauf, Auswahl. Tippen im Ortsdialog löst nichts aus.
     Shift+P schaltet den Debug-Shader. Tastenkappe im Karten-Tooltip.
     **ok mit Wünschen** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     U braucht mehr sichtbares Feedback beim Drücken; die Tastenübersicht geht,
     sollte aber prominenter zu öffnen sein (eigener Knopf); Shift+P nicht
     geprüft, weil unklar war, was man sieht. Wünsche in TODO 1.10.
106. Pos1: Kamera gleitet in 0,6 s zum HQ; N reihum zu den Spawns; im Intro
     passiert nichts.
     **ok mit Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     Pos1 und N gleiten. Im Intro-Flug bricht aber jede Taste das Intro ab,
     ohne dass der Sprung folgt; Wunsch: nur Esc und Maus brechen das Intro
     ab. Steht in TODO 1.10.
107. Maus über einen Tower ohne Build-Mode: Reichweite erscheint; nicht,
     während die Maustaste gedrückt ist.
     **ok mit Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     Hover zeigt die Reichweite. Drückt man die Maustaste aber auf dem Tower
     selbst, um die Kamera zu ziehen, erscheint sie trotzdem. Steht in TODO
     1.10.
108. Tower-Panel, Targeting "Last": der Turm zielt auf den hintersten Gegner.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
109. Alle Research-Slots belegt, weitere Forschung klicken: "Queued · credits
     are paid when it starts", startet von selbst; X entfernt ohne
     Erstattung.
     **Ersetzt** durch Nacht 2 (Queue nimmt Ketten, `7914062f`): siehe
     REVIEW_SPRINT_2026-09-14.md Punkt 339. Das ist wiederum überholt durch
     `a1bcb3d5` (Fix-Session 2026-09-14): der Revert stellt die Regeln vor
     `7914062f` wieder her, 109 beschreibt wieder das aktuelle Verhalten,
     339 nicht mehr.
110. Checkbox "Auto-start" an: nach Wellenende 10 s Countdown mit Balken, P
     hält ihn an, nach einem Reload noch an; mit Bot bleibt er aus.
     **Ersetzt** durch Nacht 2 (Auto-Start ist jetzt der Schalter "auto 10s"
     unter dem Wellenknopf): siehe REVIEW_SPRINT_2026-09-14.md Punkt 324.
111. Checkbox anklicken, dann Space: Welle startet, Checkbox kippt nicht;
     danach gehen WASD, P, + und -.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, mit dem
     Schalter "auto 10s" statt der Checkbox)
112. In der Welle mit Tab auf einen Upgrade-Button, Space: Upgrade gekauft.
     Nach der Welle Fokus auf Upgrade, Space: Welle startet, kein Kauf.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
113. Slider fokussiert (Enemy-Debugger, Audio): Pfeile und Pos1 ändern den
     Wert, die Kamera steht; W pannt, Space startet die Welle, 1 wählt eine
     Karte.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)

**Nuklearschlag**

114. Dev-Menü, Cheats, Credits (Shift+Klick +100k), Forschung "Nuclear
     Strike" nach Advanced Weaponry: Knopf mit Strahlungssymbol neben START
     WAVE; zwischen den Wellen grau, Tooltip "ready, fires during a wave".
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`; der Knopf
     sitzt seit Nacht 2 in der linken Fähigkeitsleiste)
115. In der Welle Knopf oder K: goldener Ring folgt dem Cursor auf der Route,
     abseits rot mit "NO ROUTE WITHIN 30 M"; ein Klick dort tut nichts.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
116. Klick auf die Route: Marker und schrumpfender Ring, nach 1,5 s
     Explosion, Shake, Sound. Gegner im Radius verlieren 60 % der Max-HP,
     Fledermäuse auch. Bei 4x kommt der Einschlag nach etwa 0,4 s (1,5 s
     Spielzeit), der Ring schrumpft entsprechend schneller.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
117. Herbert (W10) im Radius: verliert nur 20 %.
118. Nach dem Schlag drei Striche am Knopf, einer je fertige Welle; Tooltip
     nennt die Restwellen und (K).
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, mit der
     Ladeanzeige der neuen linken Leiste)
119. Esc, Rechtsklick, zweites K oder Build-Mode brechen den Zielmodus ab;
     die Übersicht (H) listet K.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
120. P während der Vorwarnung: der Einschlag wartet.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
121. Kleine Welle (3 Zombies), der letzte kurz vor dem HQ, K und Klick hinter
     ihn: die Welle bleibt laufend bis zur Explosion, Auto-Start erst danach.
122. W19: Skeletons, die der Schlag tötet (vorher unter 60 % HP), spalten
     sich; die Minions bleiben unbeschädigt.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, W19 per Jump
     to wave)
123. `?devworld`, Bot strategist: er nutzt den Schlag.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)

**Skeleton-Split**

124. Enemy Debugger: Skeleton setzen, Archer daneben: nach dem Kill zwei
     Minions an der Todesstelle, Knochen-Puff. Skeleton Minion allein setzen,
     Walk: Füße rutschen nicht.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
125. Wave Debugger, Single Skeleton 20: Zeile "Splits into 2 minions on
     death", "N left" steigt je Skeleton-Kill um 1 (ein Toter weniger, zwei
     Minions mehr), die Welle endet nach dem letzten Minion.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
126. Skeleton erreicht das HQ: keine Minions. Impact Effects aus: kein Puff,
     Minions trotzdem.
     **HQ ok, Befund Impact Effects** (Playtest 2026-09-14 auf
     `sprint/night-2026-09-14`): Am HQ entstehen keine Minions. Die Einstellung
     "Impact Effects" hat aber keine sichtbare Wirkung: Der Knochen-Puff beim
     Zerfall (siehe 124) bleibt auch ausgeschaltet. Steht in TODO 1.10.
127. COMING UP an W19: der Tooltip nennt den Split.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, in der
     NEXT-Zeitleiste)

**Spawn-Portal**

128. `?devworld`: am Routenanfang ein Steintor (zwei Pfeiler, Sturz, Krone,
     Hörner), Wirbel, Siegel, Lichtfleck, Label. Das HQ ist weiter ein
     Diamant. Look und Heraustreten der Nacharbeit: Punkte 192 bis 204.
     **Ersetzt** (Playtest 2026-09-14): Das Steintor gibt es so nicht mehr, das
     Portal ist seit den Nacharbeits-Runden das Doppeltor-Asset mit neuen
     Sigillen; geprüft über 192 bis 249 (Zwischenstand abends: 239 bis 247 ok).
129. Intro: hält am Spawn mit dem Portal im Bild, kein Flug durch das Tor.
     Reset Camera: HQ, Portal und Route im Bild.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
130. N zum Portal, von vorn und von hinten: Wirbel sichtbar, keine Lücke unter
     den Pfeilern. P: der Wirbel dreht weiter.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
131. Space: das Portal flammt 1 bis 3 s auf, während der Welle heller;
     Gegner treten mit Ring und Funken durch; bei großen Wellen höchstens 4
     Bursts pro Sekunde. VFX-Preset Low: keine Bursts, das Portal bleibt.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
132. Spawn neu setzen: die Vorschau ist ein Portal, grün oder rot.
     **Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`): Die
     Vorschau ist ein Portal und das Setzen klappt, sie ist aber immer rot,
     auch an gültigen Stellen; die Karte unten zeigt es richtig. Steht in
     TODO 1.10.
133. Echter Ort, breite Straße gegen Gasse: das Portal ist sichtbar
     unterschiedlich groß. Ragen Pfeiler in Fassaden?
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)

**HUD**

134. W5 beenden: über START WAVE 6 steht "AIR · WAVE 7 · in 2 waves" und
     ein Ton kommt; nach W6 kündigt die Zeile W8 an, wieder mit Ton. Mit
     Archer "1 tower hits air", ohne orange "No tower hits air yet". SFX
     stumm: kein Ton.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
135. W1 ohne Tower: roter Rand bei Lecks, höchstens etwa einmal pro Sekunde;
     Header "HQ 99/100", der Balken blitzt. Passt "100/100" in die Zelle?
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
136. Kamera weg vom HQ-Ende: rote Pfeile mit Zahl am Rand, Herbert gold. P
     und Kamera drehen: die Pfeile folgen.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`). Rückfrage
     "nur für den Boss?": Pfeile bekommen Bosse immer und alle anderen Gegner
     auf den letzten 15 % der Route vor dem HQ (`NEAR_HQ_PROGRESS = 0.85`,
     `utils/offscreen-indicators.ts:11`).
137. COMING UP: etwa "W1 Zombie Horde 20-218", Unarmored, "Weak to Fire,
     Poison, Pierce"; die obere Zahl steigt mit mehr DPS; W7 zeigt Air.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, in der
     NEXT-Zeitleiste)
138. W10: Leiste "HERBERT" oben mittig, mit P keine Überlappung mit PAUSED.
     W30: eine große und zwei dünne Leisten.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`). Rückfrage
     "warum drei bei W30?": W30 bringt laut Curriculum 3 Herberts
     (`configs/wave-curriculum.config.ts:315`), je einer eine Leiste.
139. Herbert stirbt: Boss-Shake (gab es vorher nie).
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)

**Meta**

140. Sidebar-Fuß zeigt "v0.2.0".
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
141. Zwei Orte laden, Ortsname im Header: Tab Recent mit "just now", ein
     Klick lädt den Ort mit seinem Spawn.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
142. Tab Showcase, drei bis vier Orte (etwa Tokyo Shibuya): Route ok, HQ
     nicht im Gebäude.
     **Playtest 2 (2026-09-14):** London ok, Prag gut, Tokyo "komisch"
     (Screenshot: die Route macht eine unnötige Schlaufe um einen Block,
     "sah kaputt aus"; URL und `__routes.describe()` angefragt).
     Showcases haben nur feste HQ-Koordinaten, der Spawn wird bei jedem
     Laden neu gewürfelt. **Entscheidung User:** Showcases bekommen feste
     Spawns, die der User selbst wählt (Rio schon geschickt); Dubai fliegt
     raus (dort keine 3D-Tiles). Umsetzung showcase.
143. Tower-Panel: die Kachel "Dealt" wächst in der Welle.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
144. Game Over: Wave, Kills, Time, Earned, Spent, Leck-Balken je Welle,
     Top-3-Tower; Restart leert alles.
145. Photo Mode (O oder Display, View): HUD weg, Kamera frei, Klicks wählen
     nichts; "Save screenshot" speichert ein unverzerrtes PNG mit Logo und
     Attribution; Esc zurück. K, dann O: der Zielmodus endet. W10 mit
     Herbert, O: Boss-Leiste, Pfeile und roter Rand sind ebenfalls weg.
     **ok mit Wunsch** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     Im Screenshot zusätzlich das Logo als Wasserzeichen und unten links
     dezent `https://3dtd.sgeht.net` einbacken. Steht in TODO 1.10.
146. Konsole `localStorage.removeItem('td_onboarding_v1')`, Reload: "1/4
     Place the research center"; die Tipps gehen mit der Aktion weg, Skip und
     Hide gehen; "Tips" im Sidebar-Fuß startet neu. Stehen Offscreen-Pfeile
     unten mittig, liegt die Tipp-Box darüber.
     **ok mit Befund** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     Die Funktion geht. Der frühe Tipp zum Research Center ist aber unsinnig;
     Reihenfolge und Inhalt der Tipps überarbeiten. Steht in TODO 1.10.
     **Überholt** durch `4a219445` (Fix-Session 2026-09-14), so nicht mehr
     testen: sieben Tipps folgen dem Spiel, gespeichert unter
     `td_onboarding_v2`; der erste heißt "Build a tower", der Tipp zum
     Research Center kommt erst später (`RESEARCH_TIP_AFTER_WAVE`).

**Korridor**

147. Innenstadt-Ort (wie Punkt 52), Konsole mit Filter `[Corridor]`: kein
     Hänger von einer halben Sekunde; die Zeile "... in ~500ms slices=...
     wall=...ms" (slices etwa Stationen durch 2, wall etwa 2,5 s bei 60 fps).
     `__raycastStats()`: `routeCorridor` maxBurstMs etwa 4 statt 500.
     **ok mit Anmerkung** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`,
     Daten aus alter Liste 9 und 27): kein Hänger gemeldet. Slices: Dorf 484
     Stationen / 242 Scheiben, Stadt 742 / 385, Chiyoda 604 / 455; Wanduhr 1,7
     bis 3,6 s. `routeCorridor` maxBurstMs beim Laden 36,2 ms statt der
     erwarteten etwa 4 (weit unter den früheren 500, aber etwa zwei Frames).
148. Spawn versetzen und sofort einen Tower setzen: kurzer Hänger, die Zeile
     endet mit `flushed=tower`, der Tower steht auf dem neuen Korridor.
     Dasselbe mit Space: `flushed=wave`.
     **Nicht provozierbar** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`):
     Die Messung nach dem Versetzen ist fertig, bevor ein Tower oder eine Welle
     sie abbrechen kann. Log: 29 Segmente, 176 Stationen, `rays=704`,
     `changed=true` in 251,6 ms, 82 Scheiben, Wanduhr 563,6 ms, danach
     `rebuild` 84,4 ms; ein zweiter Lauf 173 Stationen, 292,6 ms, Wanduhr
     727,6 ms, `rebuild` 99,3 ms. Der Flush-Pfad ist damit im Spiel kaum zu
     treffen, bleibt aber für lange Routen relevant.
149. Spawn versetzen ohne Tower: die clearance-Zeile kommt gleich, der
     Korridor passt sich an, `__corridor.pick()` meldet nicht "not measured
     yet". HQ versetzen: die ganze Route wird gemessen.
     **ok, nach Augenschein** (Playtest 2026-09-14 auf
     `sprint/night-2026-09-14`): Die clearance-Zeile kommt direkt nach dem
     Versetzen (Log bei 148), der Korridor sieht passend aus; `pick()` und
     die HQ-Messung im Detail waren schwer zu prüfen.
150. Zeigt die clearance-Zeile `unmeasured` über 0: wenige Sekunden nach der
     Intro-Landung folgt eine weitere.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, Logs aus alter
     Liste 9): an allen drei Orten folgt auf die erste Zeile mit allen
     Stationen `unmeasured` eine zweite mit Messung und nur 1 bis 2 übrigen
     Stationen.

**Gegner-Rendering**

151. Enemy Debug, alle 20 Typen setzen: keine Löcher; Dragon mit harten statt
     weichen Kanten, Ghost und Hornet durchscheinend, Penguin wie vorher.
152. Nahzoom Dragon, Mammoth, Mech, Wallsmasher, zombie_v2: kein Flirren (der
     Stone Golem ist die Float32-Referenz).
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`, Mech schon in
     der dezimierten Fassung aus Nacht 2)
153. Bat, Hornet, Dragon, Ghost, Mech, Spider, Skeleton, Penguin, Herbert,
     Mammoth, Wraith rundum: Flügel und Rückseiten auch von hinten sichtbar
     und hell.
     **ok** (Playtest 2026-09-14 auf `sprint/night-2026-09-14`)
154. Mech, Wallsmasher, Mammoth, Zombie Soldier, Bear laufen ohne Stocken im
     Loop; der Wallsmasher hält im Tod die Endpose.
155. Ghost und Zombie gemischt: Verdeckung stimmt.
156. Konsole `__perf.loseContext(2000)`: "Baked N VATs again", die Gegner
     kollabieren nicht; zweimal wiederholen.
157. 20k-Benchmark gegen `39fbb18`: FPS, GPU-Speicher, Tab-Speicher.
     **Nach TODO verschoben** (Playtest 2026-09-14): Messaufgabe gegen einen
     alten Stand, zusammen mit alter Liste 16 in TODO 1.4.

**Laden und Dialoge**

158. Hard Reload mit Standort-URL: Start normal, Konsole sauber. "DEFEND
     <Ort>" im Header: Dialog kommt zügig und gestylt, Suche mit Spinner.
159. Ohne URL, Standort ablehnen: "Select location...", der Dialog lässt sich
     nicht wegklicken.
160. BUILD-Info "Damage vs armor": Matrix, Esc, Fokus zurück. Tower-Panel,
     Matrix: Zeile hervorgehoben. H, Attributions. Doppelklick öffnet nur
     einen Dialog. Übergänge animiert, Schriften wie vorher.
161. Map Key: Token-Screen, Esc. Key löschen und Reload: Token-Screen.

**Umbau und Aufräumen (sollte aussehen wie vorher)**

162. Header-Steintextur, Quick Actions Display, Audio und Layers mit Glas
     und dunkler Scrollbar, Tower-Karten-Tooltip, Debug-Fenster ziehen
     (mindestens 300 × 200), LOS-Zoom, Matrix-Dialog mit festem Kopf,
     DevWorld-Panel.
163. Konsole beim Laden: `[Tiles]`, `[Warmup]`, `[Corridor]` da; die
     Init-Banner von Partikel-Pools, Flame Beam und Pathfinding fehlen. Mit
     `?devworld`: auch die zehn Engine- und Camera-Rig-Zeilen fehlen, es
     bleibt "DevWorld mode active". Fire-Tower-Effekte wie vorher. AI
     Training, Load ONNX: kein TypeError.
164. Tiles, Himmel und Licht wie vorher; FPS 30, 60, Off; Build-Vorschau,
     Platzieren, Auswahl; Favorit wechseln; LOD Colors; `?devworld`.
165. Spielablauf: Archer bauen (Gold, Ring), Range-Upgrade (Ring wächst,
     Wachrichtung), Upgrade bis Stufe 5, ohne T2-Forschung bleibt 6 gesperrt,
     Verkaufen mit Erstattung, Forschung, Welle mit Pause, Tempo und Bonus,
     Lecks gedeckelt; Dev-Cheats Credits, Health, Max-Upgrade, Research
     komplett.
166. Build-Mode: der Hinweis zeigt "Hover" und "Line of Sight", die LOS
     erscheint sofort. **ok (Playtest 2, 2026-09-14)**
167. Magic Tower setzen: nach 0,8 s Sweep um 75°, dann zur Wachrichtung, die
     Kugel wippt ohne Drehen; in der Welle hält er die letzte Richtung.
168. Enemy Debug, zwei Gegner, X und Clear All: die Tower drehen danach zur
     Wachrichtung.
169. Dev, Dump: der Dateiname enthält den Ortsnamen statt "unknown".

**Services, Route, Renderer (cold, hot, viz)**

170. Build-Mode: Tower wählen und sofort Esc: keine Geister-Vorschau, ein
     anderer Typ folgt dem Cursor. Schnell Archer, dann Cannon: nur die
     Cannon-Vorschau.
171. Tower setzen, heranzoomen: die LOS-Anzeige folgt dem Nachladen der
     Tiles. **ok (Playtest 2, 2026-09-14)**, auch "LOD Colors" an und aus.
172. Etwa 10 Archer oder Gatling, große Welle bei 1x, 2 Minuten: die
     Schuss-Sounds bleiben hörbar.
173. Musik: Main Theme, dann Build, Crossfades, Ausblenden bei Game Over;
     An/Aus und Lautstärke wirken sofort.
174. HQ innerhalb der geladenen Straßen versetzen: Wechsel an Ort und Stelle,
     der Korridor wird gemessen; außerhalb: voller Ortswechsel. Ortsdialog:
     Zufalls-Spawn, Favorit speichern, wählen, löschen. `?devworld`: Terrain
     neu erzeugen.
175. Training-Fenster: ONNX laden, dann "Use rules": "Rule director active",
     und es bleibt dabei.
176. Ladeschirm "Preparing Intro Flight"; `[Corridor]`-Zeilen wie vorher;
     `__corridor.get()`, `.set({...})`, `.reset()`, `.towerCells()`,
     `.pick()` antworten wie vorher.
177. Reset Camera, Show buildings, DPS-Bins im Training-Fenster, Ortswechsel:
     wie vorher.
178. Routenlinie, `__routes.describe()`, Route Grid Overlay, Reichweitenring
     und LOS-Ring eines Towers, Mündungsblitz, HQ-Feuer, Blut-, Eis- und
     Brandflecken, Explosionen: wie vorher.

**Kleinbefunde (fix3)**

179. Training-Fenster: DPS-Bins an, aus, an, aus, dann einen Tower setzen:
     die Bins bleiben aus. Wieder an und einen Tower verkaufen: sie
     aktualisieren sich.
180. Konsole `__corridor.get()`, dann die Spielseite verlassen: `__corridor`
     ist undefined; an einem neuen Ort geht es wieder.
181. Reload und nichts anklicken: in der Konsole höchstens eine Warnung
     "[MusicMixer] Audio context did not resume", kein "Uncaught"; nach dem
     ersten Klick laufen Musik und Loop (hängt an der Autoplay-Regel des
     Browsers).

**Gegnermodelle (blender)**

182. Enemy Debug, Nahzoom: Hornet (Mandibeln ohne Streifen, Beine leicht
     facettiert), zombie_v2 (Schädel ohne Flecken, Brust-Chevron und Gürtel
     da, etwas weicher), Wraith (Brustkorb gröber), Spider (Beine kantiger).
     Akzeptabel?
183. Dragon fliegt im 3,3-s-Zyklus ohne Sprung, der Stone Golem läuft ohne
     Ruck am Loop, die Ratte rennt (bei zwei Frames sitzt der Hinterkörper
     anders). Akzeptabel?
184. zombie_v2 mehrmals sterben lassen: bei einem der drei Todes-Clips fällt
     er zu Boden, bevor er verschwindet.
185. Wallsmasher: Größe und Animation wie vorher, in der Sidebar-Vorschau mit
     Atlasfarben. Der Zombie wirkt glatt statt facettiert.

**Review-Fixes (fix3 Teil 2)**

186. Pfeiltaste über der Karte halten, dabei in einen Slider klicken,
     loslassen: die Kamera stoppt.
187. Bis zum Air-Alert spielen (Ton), dann Restart oder Ortswechsel und
     wieder bis dahin: der Ton kommt erneut.
188. Display, View, Photo Mode: der Fokus liegt auf "Save" (Tab zeigt es),
     Esc: das Display-Menü ist wieder offen, der Fokus zurück auf dem Knopf.
189. DevTools, Network "Offline" oder Request-Blocking auf den Chunk des
     Ortsdialogs, ohne Standort-URL laden: Fehlerbildschirm statt Hängen bei
     "Select location...". Im laufenden Spiel auf "DEFEND <Ort>" klicken:
     Banner über dem Spiel, das Spiel läuft weiter. Token-Screen-Chunk
     blockiert, ohne Key: Hinweis mit Reload.

**Review-Fixes (fix4)**

190. Air-Alert-Ton kommt einmal; solange der Alarm steht, einen Tower bauen
     und verkaufen: kein zweiter Ton.
191. DevTools "Offline" vor dem ersten Öffnen des Ortsdialogs, dann im Spiel
     auf den Standort-Knopf ("DEFEND <Ort>"): Banner "The location dialog did
     not load..." und in der Konsole "[LocationCoordinator] Location dialog
     did not load:".

**Spawn-Portal, Nacharbeit (portal2, `cfb85a8` bis `5bb5073`)**

192. `?devworld`: das Portal ist deutlich höher und schwerer (gestufte
     Plinthen, dicker Sturz mit Gesims, Hörner, gezackte Krone), der Stein
     fast schwarz, die Leere dunkel mit trägem dunkelrotem Wirbel, schwarzem
     Auge und einzelnen aufsteigenden Glutpunkten. Kein heller pink-oranger
     Diskus mehr.
193. Intro: hält am Spawn mit dem ganzen Portal samt Label im Bild, kein Flug
     durch das Tor. Reset Camera: HQ, Portal und Route im Bild.
194. N zum Portal, Space: die Gegner treten aus der Fläche heraus. Von vorn,
     schräg vorn links und rechts (etwa 45° und 80°) und steil von oben: kein
     Gegner und keine Healthbar hinter dem Tor, bevor er aus der Fläche kommt.
195. Kamera hinter das Portal: dort sind Gegner kurz hinter dem Tor zu sehen,
     bis sie eingetreten sind; wer vorn herausgetreten ist, verschwindet von
     hinten gesehen hinter der Leere.
196. Nah an einen Pfeiler: 5 Siegel je Pfeiler, 6 auf dem Sturz, nur Kreise,
     Bögen und Punkte in einem Ring; keine Kreuze, Striche, Buchstaben- oder
     Kana-Formen; vorn und hinten gleich.
197. Wellenstart: das Portal glimmt 1 bis 3 s auf (heißere Stellen, Rand,
     Siegel), danach ruhiger; Burst-Ring und Funken in Glutfarben. VFX-Preset
     Low: keine Funken, Portal und Glutpunkte bleiben.
198. Spawn neu setzen: die Vorschau ist das neue, größere Portal.
199. Echter Ort, breite Straße und Gasse: das Portal skaliert. Ragen Pfeiler
     oder Hörner in Fassaden? Treten die Gegner an beiden Orten aus der Fläche?
200. Mehrere Spawns (rot, orange, cyan, magenta): unterscheidbar am Rand der
     Leere, an den Siegeln und am Straßenlicht.
     **Entfällt (Playtest 2, 2026-09-14):** per UI gibt es nur einen Spawn
     ("Set spawn" ersetzt `spawn-1`); mehrere Portale nur über eine URL mit
     mehreren Spawns (`editableSpawnLocations`), Vorarbeit für
     Multi-Lane/Multiplayer.
201. Nah an einen Pfeiler (N, dann heranzoomen): Quaderlagen mit dunklen
     Fugen, je Siegel ein Quader, keine Fuge durch ein Siegel; Kanten gefast,
     heller abgerieben, einzelne Abplatzer; Risse; Ruß und Brandflecken rund
     um die Öffnung, schwarze Schlieren über dem Sturz.
202. Kamera um das Portal drehen: das rote Kernlicht fällt auf die
     Innenseiten und die Fasen nahe der Öffnung; keine flimmernden Flächen an
     den Pfeilerfüßen innen. **ok (Playtest 2, 2026-09-14)**
203. Weit herauszoomen: der Stein wird ruhig, die Details blenden aus, kein
     Funkeln oder Moiré. **ok (Playtest 2, 2026-09-14)**
204. Space: bei Wellenstart glimmen die Risse an der Öffnung auf.

## Nachtrag: Playtest 2026-09-13 vormittags

### Korridor an einer Tile-Naht (gapfix, `512674e` bis `a899b1f`)

Befund (echter Ort, Wohnstraße, Route Grid Overlay an): eine Querreihe Zellen
mit anderer Kontur, dort, wo früher eine Lücke im Korridor war (Punkt 43 in
REVIEW_SPRINT_2026-09-12), und in der Welle eine Taille im Gegnerstrom.
`__corridor.pick()` an der Stelle:

- Nächste Station `7:3/32` (Route spawn-1, Way 89873545 residential, alongM
  230,2): `unmeasured: 'no tile'`, links und rechts 2,75 m, rule
  `unmeasured: street width`. Die Stationen um sie herum (alongM 222,2 bis
  238,1) haben alle 7 m.
- Zellen im Umkreis von 4 m: die Spalte x=113 (z=157, 155, 153, 151) ist
  `unsampled`, drei mit heightM 243,19, eine (113,151) mit -3542,17. Alle
  anderen sind stabil bei 242,7 bis 243,1.

Ursache, aus dem Code abgeleitet und im Spiel nicht nachgestellt: Die Säule
unter der Station und die Säulen der Zellreihe finden kein Tile, am
wahrscheinlichsten eine Naht zwischen zwei Tile-Meshes.

- Die Station bekam die OSM-Breite. Jede Station wird ein Waypoint, Zellen
  und Seitenversatz lesen dieselbe Breite, und über den taper von 0,5 m/m
  wird aus einer 2 m schmalen Stelle eine Taille von etwa 19 m.
- Die Zellen blieben ohne Höhenprobe (rosa Kontur). Eine erste Höhenprobe
  wurde bisher ungeprüft übernommen. Die -3542 m sind der Routenanker der
  Zelle, der vermutlich aus so einer Probe stammt; belegt ist das nicht.

Änderungen:

- `512674e`: Kurze Messlücken (bis etwa `dipLength`) nehmen den kleineren
  gemessenen Freiraum ihrer Nachbarn, rule `unmeasured: from neighbours, ...`.
- `f8bb554`: Eine Station ohne Tile misst von der Säule 0,5 m voraus oder
  zurück, `pick()` zeigt `shiftM`.
- `24e0099`: Eine Zelle ohne Treffer probt die Säulen 0,5 m daneben.
- `8fc2da3`: Der 50-m-Ausreißertest gilt auch für erste Proben und Upgrades
  (nur Nachbarn derselben Fläche aus mindestens so tiefen Tiles).
- `a7a69ec`: Eine Zelle zwischen stabilen Zellen bekommt deren Mittel,
  Zustand `filled`: Sie hat eine Höhe, das Overlay zeigt sie ohne rosa
  Kontur, das Sampling versucht sie weiter.
- `d0d3bbf`: Kurze Engstellen in den fertigen Stücken jeder Route werden
  geschlossen, auch vor der ersten Messung; Tunnel und Routenenden nicht.
- `a899b1f`: Die `[Corridor] clearance`-Zeile nennt Stationen, die auch
  daneben kein Tile fanden (`noTile=x,z;...`).
- `834cb40`: ROUTE_CORRIDOR.md.

Grenzen: Bei einer Lücke breiter als 0,5 m hilft die Verschiebung nicht, eine
Zell-Lücke breiter als eine Zelle bleibt rosa. Liegt ein Zellmittelpunkt in
keiner Bounding Box eines Tiles, probt der Sweep ihn nicht, dann greift nur
das Füllen. Gefüllte Zellen sind im Overlay nicht von gesampelten zu
unterscheiden, nur in `pick()` und `__rg.dumpStats()`.

205. Gleicher Ort, noch ohne Tower und Welle (die sperren den Neuaufbau),
     Layers, Route Grid Overlay an, warten, bis `[Corridor] clearance` in der
     Konsole steht. Endet die Zeile mit `noTile=`, sind das die Stationen,
     die auch daneben kein Tile fanden.
206. `__corridor.pick()`, Klick auf die alte Stelle: Station `7:3/32` hat auf
     beiden Seiten `halfWidthM` 7, entweder gemessen (`unmeasured` null,
     `shiftM` 0.5 oder -0.5) oder mit rule `unmeasured: from neighbours, no
     wall within the maximum`. In der Nearby-Tabelle keine 2.75.
207. In derselben Ausgabe die Zellen x=113: `state` stable oder filled,
     `heightM` um 243, kein -3542. Im Overlay keine abweichende Querreihe.
208. `__routes.describe()`: Way 89873545 zeigt in leftM und rightM keine
     2.75 mehr, solange `noTile` dort keine weiteren Stationen nennt.
209. Welle starten: an der Stelle keine Taille im Gegnerstrom.
     **Playtest 2 (2026-09-14), 205 bis 209:** Erlenbach, Clearance ohne
     `noTile` (`stations=236 unmeasured=0 rays=944 changed=true in
     373.6ms`), Zellen bis auf einzelne Ausreißer in Bäumen und Hecken gut
     (an corridor3). Die Route lief nicht über den Schießmauerweg (Way
     89873545), die alte Stelle ist also nicht nachgeprüft.

### Header-Zahlen (hqfix, `8dfe042`)

Nach +HP stand im HQ-Feld "101100/100", und die rote Zahl lief ins
CREDITS-Feld. Jetzt bleibt jede Zahl in ihrem Feld:

- Credits sind exakt bis 999.999, Welle und Gegnerzahl bis 99.999,
  HQ-Leben bis 9.999; darüber kompakt ("101k", "1.2M").
- Über dem Maximum, was nur +HP schafft, steht der Wert ohne "/100", der
  Balken ist voll.
- Zeigt ein Feld weniger als die genaue Zahl, steht sie im Tooltip ("101,100
  / 100"). Screenreader lesen die genaue Zahl.
- Eine Zahl, die allein nicht passt, endet mit Auslassungspunkten statt
  überzulaufen. Schriften, Farben und Balkenhöhe sind unverändert.

210. Dev-Menü, Cheats, +HP mehrfach, dann mit Shift (+100k): HQ-Feld ab
     10.000 kompakt, ohne "/100", voller Balken, Tooltip mit der genauen
     Zahl; nichts ragt ins CREDITS-Feld.
211. Credits mehrfach, dann mit Shift: exakt bis 999.999, darüber kompakt,
     Tooltip mit der genauen Zahl; nichts ragt in die Nachbarfelder.

### Atompilz (mushroom, `fea8f42` bis `7bcbfd4`)

Der Nuklearschlag geht als Atompilz hoch. Die gestaffelten
Feuer-Explosionen mit setTimeout sind weg.

- Ablauf: Blitz über dem Einschlag und schwach über dem Bild, Feuerball am
  Boden, Druckwellenring bis 36 m. Der Feuerball steigt zu einer Kappe auf,
  die über einem Stamm aus Feuer und Rauch rollt, am Boden eine Staubwalze.
  Ab 5,5 s breitet sich die Wolke aus, driftet und verblasst, nach 10 s ist
  sie weg. Beim Radius von 25 m ist sie gut 60 m hoch und skaliert mit dem
  Radius.
- Alles läuft in Spielzeit: Pause hält die Wolke an, höheres Tempo spielt sie
  schneller ab.
- Der Schaden bleibt im Sub-Step des Einschlags. Die Brandflecken haben das
  alte Muster, liegen jetzt aber alle schon beim Einschlag.
- Low-Preset (Impact Effects aus): Blitz, Feuerball und Druckwelle, vorher
  gar keine Explosion.
- Budget: 106 Glut- und 270 Rauchpartikel je Wolke, zwei Wolken gleichzeitig,
  nichts wird pro Frame alloziert.

212. Schlag setzen (wie Punkt 114 bis 116): Blitz, Feuerball, Ring, dann der
     Pilz. Ist er aus der Übersicht (Reset Camera) lesbar?
213. P, während der Pilz steht: er friert ein, nach P geht es weiter.
214. Tempo schneller: der Pilz läuft entsprechend schneller ab.
215. VFX-Preset Low (wie Punkt 197): nur Blitz, Feuerball und Ring.

### Atompilz, mehr Wumms (mushroom2, `f77cae2` bis `840b1d7`)

Befund aus dem Playtest: "Atompilz muss noch gewaltiger sein, es fehlt an
optischem Wumms und Explosion." Richtung und Spielzeit bleiben, der Moment
schlägt härter ein. Nur Bild und Ton, am Schaden ändert sich nichts.

- `f77cae2` Detonation: weißglühender Kern; Feuerball in 0,15 s auf 18 m,
  sein Zentrum schießt in der ersten halben Sekunde 14 m hoch, bis 0,7 s
  von weiß zu orange; zweite Feuerfront bis 38 m; Schockkuppel bis 46 m;
  Druckwellenring bis 70 m (vorher 36 m) mit einer Staubwand auf der Front;
  48 Glutschweife fliegen nach außen und oben und verlöschen am Boden;
  Bodenfeuer bis 7,5 s. Blitz-Sprite 150 m, Aufhellung des Bildes mit
  Spitze 0,65 für 0,55 s (vorher 0,3 für 0,3 s).
- `526123d` Pilz: schießt in der ersten Sekunde auf gut 55 m, bei 5 s knapp
  100 m, beim Auflösen über 110 m (vorher knapp 60 m). Kappe und Stamm
  breiter und dichter, oben dunkel, unten länger glühend, mit Wülsten, die
  um den Stamm wandern; Kondensationsring um den Stamm von 0,5 bis 3,8 s.
  Steht 14 s (vorher 10 s).
- `2a46f62` Bloom-Kick, nur mit Bloom an: 0,9 s lang Stärke bis 1,4 und
  Schwelle bis 0,55, danach genau die alten Werte.
- `8500ea6` Shake 0,014 für 1600 ms (vorher 0,008 für 700 ms), voll bis
  350 m Kameraabstand, keiner ab 1500 m; aus der Übersicht gut 90 %.
- `3e42592` Ton: `explosion.mp3` nach 350 und 900 ms noch zweimal leiser
  (55 und 35 %).
- `840b1d7`: ABILITIES.md, PARTICLE_SYSTEM.md.
- Budget je Pilz 432 Glut- und 546 Rauchpartikel (vorher 106 und 270), zwei
  Pilze gleichzeitig, ohne Pilz kein Draw Call.

216. Schlag setzen (wie Punkt 114 bis 116), Kamera in der Übersicht (Reset
     Camera): das ganze Bild blitzt hell auf, ein weißglühender Feuerball
     schießt hoch und wird orange, eine helle Kuppel und der Ring laufen
     über den Boden, am Ring steht eine Staubwand, Glutschweife fliegen
     nach außen. Das Bild wackelt deutlich länger als bei Raketen.
217. Weiter zusehen: die Kappe schießt hoch und steigt dann langsam, kurz
     steht ein weißer Ring um den Stamm, die Unterseite der Kappe glüht
     orange, oben ist sie dunkel, die Wülste rollen sichtbar. Der Pilz
     beherrscht die Übersicht und steht rund 14 s. Am Boden brennt es
     einige Sekunden.
218. Ton: auf den Knall folgen zwei leisere Nachschläge, zusammen gut 2 s.
219. P direkt nach dem Einschlag: Blitz und Pilz frieren ein, nach P geht es
     weiter. Tempo schneller: alles läuft entsprechend schneller ab.
220. Display-Menü (Augen-Button), Bloom an, Schlag setzen: helle Flächen
     glühen kurz stark nach, nach etwa einer Sekunde sieht Bloom aus wie
     vorher. Bloom wieder aus.
221. Display-Menü, Screen Shake aus, Schlag setzen: kein Wackeln.
222. VFX-Preset Low (wie Punkt 197): Blitz, Feuerball, Feuerfront, Kuppel und
     Ring, kein Rauch, keine Glutschweife, kein Bodenfeuer.
223. Kamera nah an den Einschlag (unter 100 m): Feuerball und Glut sind
     nicht abgeschnitten und zeigen keine harten Kanten.
     **Befund 216 bis 223 (Playtest 2, 2026-09-14):** optisch und klanglich
     noch nicht gut, zu wenig Wumms, nicht typisch genug; soll deutlich mehr
     nach krassem Atompilz aussehen. **Entscheidung User:** Überarbeitung in
     der Nachtschicht (Worker nuke, eigener Branch), erneut prüfen.

Cheat "Nuke" im Dev-Menü (Gruppe Cheats, orange Kachel mit
Strahlungssymbol, Tooltip "Nuke ready"): schließt die Forschung Nuclear
Strike samt Voraussetzungen ab und füllt die Ladung auf, beliebig oft. Läuft
als verzögertes `debug:ready-ability` über den `GameCommandsHandler` und
greift im nächsten Sub-Step, in der Pause also erst beim Weiterlaufen.

224. Neues Spiel, Dev-Menü, Cheats, Nuke: der Strike-Knopf neben START WAVE
     erscheint geladen, im Forschungsbaum sind Nuclear Strike und seine
     Voraussetzungen (Advanced Weaponry und darunter) fertig. Welle starten,
     Schlag setzen, sofort wieder Nuke: der Knopf ist wieder geladen, ein
     zweiter Schlag geht noch in derselben Welle.

### Spawn-Portal, Runde 3 (portal3, `186474e` bis `329c4d0`)

Befund aus dem Playtest: "portal sieht besser aus..aber die glyphen sind
nicht düster un mysterisch genug...da geht noch wesentlich mehr. auch
textur geht noch merh". Dazu aus dem Screenshot: Glyphen wie helle runde
UI-Knöpfe, darunter Auge und Tomoe; Stein fast schwarz; Krone und Hörner
flach. Und: Gegner waren vor dem Heraustreten zu sehen.

- `186474e` Volumen statt einer Fläche: eine Fläche der Leere vor und eine
  hinter dem Portal, 10,5 m auseinander, Pfeiler und Sturz schließen es;
  die Gegner starten in der Mitte (`path[0]`, dieselbe Route wie das
  Portal) und bleiben verdeckt, bis sie vorn heraustreten. Kein
  Setback mehr, kein Clipping im VAT-Shader.
- `2d85efa` `SPAWN_PORTAL_LOOK.frameExposure`: Regler für die Helligkeit
  des Steins.
- `5aac6f7`, `ba1bbc5` Sigillen neu, zweimal: das erste Set mit gebrochenem
  Rand las sich weiter als Drehregler, das zweite hat keinen Rand mehr,
  lose schiefe Gruppen, je Zelle gedreht, skaliert und aus der Mitte
  gerückt.
- `c418c1e` Asset neu gebacken: so tief wie das Volumen, Steine in der
  Tiefe versetzt gefugt, Stein dunkel graubraun mit Ton je Block, helleren
  Kanten, Verwitterung, Glyphen abgewittert, gerissen, teils unter Ruß,
  Kronenspitzen mit Rillen, Brüchen und Segmenten. 6 589 Dreiecke, 2,4 MB.
- `cde6bad` Beschwörungskreis auf der Straße vor der vorderen Fläche,
  flammt beim Wellenstart auf.
- `1a65874` Rahmen im Spiel aus dem Asset, der prozedurale Stein ist weg.
  Bis das Asset geladen ist, stehen nur die zwei Flächen der Leere.
- `482b727` Sigillen ruhen, flackern schwach tief in der Rille, erwachen ab
  und zu mit einem ungleichmäßigen Glimmen entlang der Linien, ohne
  umlaufenden Schreibring.
- `f68cb2e` Sigillen nach dem Render-Review nachgeschärft: das Siegel, das wie
  das Steam-Logo las, ist ersetzt; keine Sichel mehr mit genau einem
  freistehenden Punkt daneben (Halbmond und Stern), der Spec prüft das.
- `c73e684` Silhouette als Doppeltor: vorn und hinten je ein Tor mit Pfeilern,
  Sturz, Gesims und Krone, dazwischen niedrigere Seitenwände und ein
  Satteldach mit glühender Rinne unter eisernen Gittern, Spitzen entlang
  First und Traufecken, Hörner vorn größer, Krone größer mit Spitzen
  entlang der Gesimskante. 7 151 Dreiecke, 2,5 MB. Wände und Traufe sind
  so bemessen, dass der Stone Golem darin verschwindet; im ersten,
  schmaleren Entwurf ragte er seitlich heraus, die Volumen-Spec hat das
  gefangen.
- `329c4d0` Das Glimmen entlang der Linien liest die Strichfolge langsamer und
  weicher: im Render zeigten ihre 8-Bit-Stufen Streifen.
- Kosten: weiter zwei Draw Calls für alle Portale; je Rahmenpixel vier
  Texturzugriffe statt 17 Noise- und einer Worley-Abfrage; Texturen etwa
  53 MB GPU-Speicher mit Mipmaps; einmal 2,5 MB Download.
- Offen: das Bild im Spiel habe ich nicht gesehen (kein Browser), nur die
  Blender-Renders. Helligkeit (`frameExposure` 1,4) und Stärke des
  Glimmens sind daraus abgeleitet und im Playtest zu prüfen. Bei der
  kleinsten Portalskala (Gasse) ragen Mammoth, Mech, Stone Golem und
  Wallsmasher über oder neben das Tor. Lufteinheiten fliegen über dem Tor.

225. Neues Spiel an einem Ort mit Spawns, Kamera in der Übersicht (Reset
     Camera): jedes Portal ist ein Doppeltor, vorn Pfeiler, Sturz, Krone
     mit Spitzen und zwei große Hörner mit Eisenringen, dahinter ein
     niedrigeres Satteldach mit einer glühenden Rinne unter Gittern, hinten
     ein zweites, kleineres Tor. Der Stein ist dunkel graubraun, nicht
     schwarz, die Blöcke unterschiedlich hell, Kanten heller, Fugen und
     Risse aus der Übersicht zu erkennen.
226. Nah an ein Portal zoomen: die Sigillen in den Stirnseiten sind keine
     runden Knöpfe, Drehregler oder Gitter, kein Auge, kein Komma, keine
     Buchstaben. Sie sind teils abgewittert, von Rissen durchlaufen, teils
     unter Ruß. Das Glühen sitzt nur tief in der Rille, dunkelrot bis
     violett, schwach und flackernd.
227. Eine halbe Minute zusehen: ab und zu erwacht eine Sigille, ein
     unregelmäßiges Glimmen kriecht an ihren Linien entlang, kein Ring,
     der umläuft, danach sinkt sie zurück; darüber steigt Glut auf.
228. Welle starten: die Portale schwellen an, alle Sigillen glimmen kurz,
     der Kreis auf der Straße vor dem Portal flammt auf und wird wieder
     dunkel. Während der Welle erwachen die Sigillen öfter.
229. Gegner erscheinen: keiner ist zu sehen, bevor er vorn aus der Fläche
     tritt, auch nicht von hinten oder schräg von oben (Kamera um das
     Portal kreisen), auch große wie Mammoth und Golem bei normaler
     Portalgröße. **ok (Playtest 2, 2026-09-14**, mit Mammoth)
230. Setup, Spawn setzen: die Vorschau zeigt den Steinrahmen in der
     Spawnfarbe.
231. Standort wechseln: die Portale stehen sofort mit Rahmen da, die
     Konsole zeigt keinen Fehler zum Portal.

### Luftgegner aus dem Tor (airgate, `eaf1a12`, `bd7ec68`)

Befund aus dem Playtest: "Luftgegner kommen in der Mitte des Tores
durch.. fliegen wenige Meter und steigen dann auf ihre korrekte Höhe?"
Bisher erschienen Luftgegner einer Welle auf Flughöhe, 15 bis 20 m über
dem Portal.

- `eaf1a12` Alles, was etwas am Modell platziert oder darauf zielt, liest
  die Höhe über dem Boden je Gegner (`Enemy.heightOffset`) statt aus der
  Config: gerenderte Position, Projektilziel, Flammenstrahl, Kegel,
  Tentakel, Kettenblitz, Raycast-Fallback der Air-LOS, Schadenszahlen,
  Blut, Eis, Knochen-Puff, Credit-Popup. `create()` des Renderers bekommt
  die Höhe des Modellursprungs. Keine Verhaltensänderung.
- `bd7ec68` Luftgegner einer Welle starten wie Bodengegner auf `path[0]`
  im Volumen des Portals. Ihre Körpermitte liegt auf der Mitte der
  Öffnung, `PORTAL_OPENING_HEIGHT` (11 m) × Skala / 2 über dem Boden:
  4,1 m bei Skala 0,75, 5,5 m bei 1, 9,6 m bei 1,75. Die Skala kommt wie
  beim Portal aus dem Korridor am Routenstart (`portalCorridorWidth`),
  den Körper misst der VAT-Bake (`enemy-aim.util` hält jetzt min und
  max). Ein Körper, der höher ist als die Öffnung, steht auf dem Boden.
  Alle Gegner eines Typs kommen auf derselben Höhe durch, ihre Streuung
  (±3 bis 4 m) setzt beim Steigen ein.
- Danach waagrecht bis `AIR_PORTAL_EXIT.holdPastFront` (8 m) hinter die
  vordere Fläche, die 5,25 m vor `path[0]` steht (über Skala 1 mal
  Skala), dann über `climbDistance` (30 m) Route mit Smoothstep auf die
  Flughöhe, ohne Sprung in Höhe oder Steigrate. 8 m, weil der Drache
  7,8 m Schwanz hinter seinem Ursprung hat. Steilste Stelle etwa 35°
  (Bat), 40° (Hornet), 50° (Drache oben in seiner Streuung). Die tiefe
  Strecke endet 43 m nach `path[0]`, bei Skala 1,75 nach 47 m.
- Die Höhe folgt der geflogenen Routenstrecke
  (`MovementComponent.getDistanceAlongPath`) und wird in jedem Sub-Step
  gesetzt, bei jeder Timescale gleich (Spec mit 8, 16 und 32 ms).
- Nur Wellen-Spawns, auch die Custom Wave aus dem Wave-Fenster:
  `WaveManager` übergibt `'portal'`. Debug-Spawns aus dem Enemy-Fenster
  und Split-Kinder starten auf Flughöhe.
- Wer die Höhe liest, in der tiefen Phase:
  - Modell, Healthbar (hängt am Modell), Projektile, Strahlen, Effekte,
    Popups: die echte Höhe.
  - Zielwahl der Tower: Das Grid liefert die Air-Sicht, vorab gerechnet
    auf 15 m über der Zelle (`getAirTargetY`). Auf den ersten 43 bis
    47 m kann ein Tower einen Luftgegner beschießen, den er auf 15 m
    sieht, in 4 bis 10 m Höhe aber nicht (etwa hinter einer Mauer), und
    einen nicht wählen, den er nur tief sähe. Treffer rechnet das Spiel
    waagrecht, der Schuss trifft. Nur der Raycast-Fallback (Tower ohne
    Grid-Daten) nimmt die echte Höhe. Die LOS-Pipeline ist nicht
    umgebaut.
  - Offscreen-Pfeile lesen wie bisher die Bodenhöhe, der Air-Alarm hängt
    an der Wellenvorschau, die Kamera folgt keinem Gegner, Schatten unter
    Gegnern gibt es nicht: unberührt.
- Offen: Der Drache ist 14,5 m breit und 11,4 m hoch (gemessen über
  seinen Flugclip), breiter als jede Öffnung (höchstens 14 m) und bis
  Skala 1 höher; er ragt seitlich und oben aus dem Tor. Die
  Fledermaus ist mit 7,8 m Spannweite breiter als die kleinste Öffnung
  (6 m). Mit `lateralSpread` (Drache 1,0, Bat 0,65) kommen beide auch
  außermittig heraus, die Flügel können durch die Pfeiler ragen. Die
  Healthbar des Drachen sitzt 14 m über seinem Ursprung, im Tor etwa
  13 m über dem Boden, über der Öffnung; ob der Rahmen sie verdeckt, ist
  nicht geprüft. Nicht im Browser gesehen.

232. Neues Spiel, Dev-Menü, Waves & Inspect, Waves: Type Bat, Count 10,
     Start Custom Wave. Kamera nah ans Portal, schräg von vorn: jede
     Fledermaus kommt durch die Mitte der Öffnung aus der Fläche, keine
     erscheint über dem Tor.
     **ok** (Playtest 2026-09-13)
233. Weiter zusehen: gut eine Sekunde waagrecht vor dem Tor, dann steigen
     sie weich auf ihre Höhe, ohne Ruck am Anfang oder oben; beim Steigen
     fächern sich die Höhen auf.
     **ok** (Playtest 2026-09-13)
234. Tempo schneller (wie Punkt 214), noch eine Welle: der Steigflug
     beginnt und endet an denselben Stellen der Route, nur schneller.
     **ok** (Playtest 2026-09-13)
235. Dasselbe mit Hornet: wie die Fledermaus. Mit Dragon: steht bei
     normalen Portalen auf der Straße, ragt oben und seitlich aus dem Tor
     (bekannt), steigt dann.
     **ok** (Playtest 2026-09-13). Nebenbei: der Drache wirkte stumm, laut
     User eventuell eine Falschmeldung; erst nachstellen (TODO 1.8).
236. Ein Tower, der Luft angreift, nah am Portal: er beschießt die tiefen
     Fledermäuse, die Schüsse fliegen auf den Körper, Schadenszahlen und
     Blut erscheinen am Körper, nicht 10 m darüber.
     **ok** (Playtest 2026-09-13, Archer am Portal)
237. Enemies (Enemy inspector), Bat wählen, Place, auf die Route klicken:
     die Fledermaus steht dort auf Flughöhe, ohne Tor-Phase.
     **ok** (Playtest 2026-09-13). **Befund** nebenbei: ein per Debug
     gesetzter Gegner schaut anfangs in eine falsche Richtung und dreht sich
     erst beim Loslaufen Richtung HQ. Auf Wunsch nur notiert (TODO 1.8).
238. Regulär bis W7 (bat_swarm) und W8 (hornet_strike) spielen: an jedem
     Portal wie 232 und 233.

### Spawn-Portal, Runde 4: heller Stein, lesbare Sigillen (portal4, `2034997` bis `f3f7238`)

Befund aus dem Playtest: "etwas zu dunkel würde ich sagen und die glyphen
sind garnicht zu erkennen?" Auf dem Screenshot bei Abendlicht war das Tor
eine fast schwarze braune Masse, die Sigillen nur schwaches dunkles Relief.

Ursache:

- Der Tor-Shader ist ein eigenes `ShaderMaterial` ohne
  `colorspace_fragment`. Die Basisfarbe ist eine sRGB-Textur, die GPU
  dekodiert sie beim Lesen in lineares Licht, der Shader schrieb das
  Ergebnis unkodiert. Mit Bloom und Color Grading aus (Standard in
  `vfx-settings.ts`) rendert die Engine direkt auf den sRGB-Canvas, der
  lineare Wert wurde als Anzeigewert gezeigt. Gerechnet: Basisfarbe im
  Median linear 0,068, unter dem gefakten Licht etwa 0,05, gezeigt als etwa
  14/255 statt etwa 60/255. Mit Bloom an lief der Rahmen über das
  HalfFloat-Target und den OutputPass, der kodiert, und war heller. Die
  Blender-Renders der Runde 3 liefen mit AgX und Blenders Licht; daran waren
  `frameExposure` 1,4 und das Glimmen abgestimmt.
- Die Sigillen glühten nur aus einem Kanal der Emissive-Karte am
  Rillengrund: gut 0,1 % der Texel der 1024-px-Karte, eine Linie von ein
  bis zwei Texeln, ruhend höchstens etwa 0,02 Rot. Mipmaps mitteln so eine
  Linie aus 30 m und weiter mit dem Stein weg.
- Die Lichter der Szene erreichen den Rahmen nicht (eigener, unbeleuchteter
  Shader); Tag und Abend ändern nur die Umgebung.

Änderungen:

- `2034997` Asset und Generator: R der Emissive-Karte ist eine weiche
  Glühmaske je Sigillenzelle (wie viel der Sigille noch glühen kann, weniger
  wo sie abgewittert oder verrußt ist) statt des Rillengrunds. Basisfarbe
  etwas brauner, abgeriebene Kanten heller, Fugen und Risse in der
  Verdeckung tiefer. Die Sigille "drifting bodies" (Ring und Punkte
  beiderseits eines langen flachen Schwungs, las sich als Prozentzeichen)
  ist durch "averted moon" ersetzt: große Sichel, abgewandt, dahinter ein
  gebrochener Ring, darunter ein Bogen aus Punkten. Die Render-Stufe des
  Skripts ist entfernt; sie zeigte mit Blenders Licht und AgX einen Look,
  den das Spiel nie hatte. Texturgrößen gleich, GPU-Speicher gleich (etwa
  53 MB mit Mipmaps), GLB 2,54 auf 2,64 MB (JPEG der kontrastreicheren
  Basisfarbe).
- `0be611c` Shader und Anbindung: Der Tor-Shader rechnet linear und
  kodiert selbst. Die Leere ist in Anzeigewerten gebaut und wird vorher
  zurückgewandelt: sie sieht aus wie bisher, jetzt mit und ohne Bloom
  gleich. Stein mit umhülltem Hauptlicht und mehr Himmel, `frameExposure`
  1,4 auf 1,15. Die Sigillen zeichnet der Shader aus ihrem Distanzfeld
  (Pose je Zelle wie im Asset): heißer Kern, blutroter Rand, schwacher
  Schein auf dem Stein; fern bleibt die Linie etwa anderthalb Pixel breit.
  Ruhend 0,38, in der Welle 1,2, beim Wellenstart bis 0,8 darüber
  (`SPAWN_PORTAL_LOOK.glyphs`, `portalGlyphDrive`), `gain` 4,3. Jede
  Sigille atmet in eigenem Takt (5 bis 11 s, zweite Welle langsamer, bis
  zur Hälfte gedimmt, `sigilBreathForCell`), Stücke entlang der Striche
  glühen heißer oder schwächer. Das Erwachen bleibt, bis etwa 2,5-mal
  heller.
- `6e9877a` Sigille "chained nodes" ersetzt: drei gebogene Arme um einen
  zentralen Knoten lesen sich als Triskele, die u. a. rechtsextreme Gruppen
  nutzen. Neu "tethered seeds": zwei Bögen mit je einem Knoten an beiden
  Enden, eine abgewandte Sichel, ein kleiner Ring. Der Sigillen-Spec prüft
  neu: kein Knoten mit drei oder mehr Armen, keine drei- oder vierzählige
  Drehsymmetrie um den Schwerpunkt oder den Mittelpunkt eines Teils; vom
  alten Satz fällt nur "chained nodes" durch. Asset neu gebacken.
- `90e4ca8` Atem-Uhr: Atem und Erwachen laufen in Echtzeit zwischen den
  Frames und stehen in der Pause (`animateMarkers(dt, paused)`,
  `GameStateManager.paused`). Die Zeitskala beschleunigt sie nicht mehr;
  in Spielzeit atmeten sie bei 10x zehnmal so schnell und flackerten bei
  75x. Das Erwachen hängt über die Energie weiter an den Wellen.
- `f3f7238` Beschwörungskreis kodiert wie das Tor: in Anzeigewerten
  gebaut, für sein Ziel kodiert (`linearToOutputTexel`), auf dem Canvas
  unverändert. Über dunkler Straße mit und ohne Bloom gleich; über heller
  Straße weichen die Pfade etwas ab, weil additives Licht auf dem Canvas
  in Anzeigewerten, im Nachbearbeitungs-Target linear addiert. Das
  Straßenlicht im selben Shader ist nicht angefasst.
- Kosten: weiter zwei Draw Calls; in einer Sigillenzelle zusätzlich das
  Distanzfeld der einen Sigille (6 bis 12 Teile) und drei Noise-Abfragen,
  sonst wie vorher.
- Geprüft per Render: ein numpy-Nachbau des alten und des neuen Shaders auf
  einem G-Buffer aus Blender (Cycles mittelt Texturen je Pixel, ähnlich den
  Mipmaps), 35 und 70 m, über einer Kulisse aus dem Playtest-Screenshot und
  einer helleren, kühleren Mittagsversion. Der Nachbau des alten Shaders
  trifft den Screenshot. Nicht im Browser gesehen.
- Geprüft per Compiler: Tor- und Glow-Shader, wie three sie zusammensetzt,
  kompilieren unter Desktop-OpenGL 4.6 (Blender); eine Gegenprobe ohne
  eine Funktion scheitert dort. Unter WebGL2 (GLSL ES 3.00, strenger bei
  Typen) nicht kompiliert. `marker-shaders.spec.ts` prüft, dass beide
  Shader nur Funktionen aufrufen, die es gibt.
- Offen: Das Straßenlicht (im selben Glow-Material wie der Kreis), der
  HQ-Diamant und die übrigen eigenen Shader schreiben weiter unkodiert und
  sehen mit Bloom anders aus als ohne; nicht angefasst, die Liste geht an
  TODO.

239. Neues Spiel, N zum Portal, auf 30 bis 40 m herauszoomen: der Stein ist
     dunkel graubraun, nicht schwarz; Quaderfugen dunkel, Kanten heller,
     Risse sichtbar.
     **ok** (Playtest 2026-09-13, Screenshot in der Innenstadt bei Tag:
     "portal sieht gut aus")
240. Display-Menü (Augen-Button), Bloom an und wieder aus: Stein und Leere
     gleich hell, nur die Glut der Sigillen strahlt mit Bloom etwas mehr.
     **ok** (Playtest 2026-09-13)
241. Vor der ersten Welle: alle Sigillen der Stirnseiten lesbar als
     blutrote Glut in den Rillen, heißerer Kern, dunklerer Rand. Reset
     Camera (Übersicht): noch als Zeichen zu erkennen.
     **ok** (Playtest 2026-09-13, aus der Nähe mit laufender Welle und in
     der Übersicht nach Reset Camera)
242. Eine Minute zusehen: jede Sigille atmet langsam für sich, nie alle im
     Gleichtakt; entlang der Striche Stellen heller und dunkler.
     **ok** (Playtest 2026-09-13)
243. P (Pause): das Atmen der Sigillen steht, der Wirbel der Leere läuft
     weiter; P wieder: es geht ohne Sprung weiter.
     **ok** (Playtest 2026-09-13)
244. Space (Welle): die Sigillen flammen auf, der Kern wird orange-rot,
     während der Welle deutlich heller als davor; nach der Welle zurück auf
     die Glut.
     **ok** (Playtest 2026-09-13)
245. Nah an eine Sigille: scharfe Linien, kein Kasten und kein Schein über
     der ganzen Zelle; abgewitterte oder verrußte Stellen glühen schwächer.
     Keine Sigille wie ein Prozentzeichen; die neue ("averted moon", große
     Sichel, gebrochener Ring dahinter, Punktbogen darunter) erinnert an
     kein bekanntes Symbol.
     **ok** (Playtest 2026-09-13)
246. Ort mit hellen Tiles bei Tag (etwa ein Showcase-Ort): der Rahmen hebt
     sich als dunkler Stein ab, die Glut bleibt lesbar.
     **ok** (Playtest 2026-09-13, Innenstadt mit hellen Fassaden bei Tag)
247. Tempo 10x, dann (in der Bauphase oder mit Custom Wave) höchstes Tempo:
     die Sigillen atmen so langsam wie bei 1x, kein Flackern.
     **ok** (Playtest 2026-09-13)
248. Beschwörungskreis vor dem Portal (Straße vor der vorderen Fläche), Bloom
     im Display-Menü an und aus: der Kreis bleibt gleich hell, nur bei
     Wellenstart blüht er mit Bloom etwas.
     **Befund** (Playtest 2026-09-13): mit Bloom ist der Kreis nicht mehr
     sichtbar, ohne Bloom schon. Vermutlich aus `f3f7238` (Kodierung des
     Kreises für das Composer-Target). Auf Wunsch nur notiert, Fix später
     (TODO 1.8).
249. Nah an die Sigillen: keine liest sich als Triskele (drei Arme um einen
     Knoten); die neue ("tethered seeds": zwei Bögen mit Knoten an beiden
     Enden, abgewandte Sichel, kleiner Ring) erinnert an kein bekanntes
     Symbol.
     **ok** (Playtest 2026-09-13)

### Kamera an der Route und nach dem Atomschlag (camnear, `bac034a`, `a7cdcf4`, `aef9d9e`)

Befund aus dem Playtest: "irgendwas beeinflusst das zoom und pan
verhalten wenn man in der nähe der route unterwegs ist ... zäher und
träger und lässt mich auch nich so nahe heran oder so geschmeidig panen".
Nachgereicht: "tritt vermutlich erst nach einem atomschlag auf", "pan und
co treffen irgendwas was in der luft verbleibt".

- Nach dem Atomschlag: Die Draw-Gates des Atompilzes stellen seine
  Objekte nach dem Effekt nur unsichtbar. Schockkuppel, Flash-Sprite und
  Schockwellen-Ring bleiben in ihrer letzten Lage in der Szene: die
  Kuppel mit 46 m Radius und 36,8 m Höhe über dem Einschlag, der Sprite
  150 m groß 10 m über dem Boden, der Ring 70 m auf 0,6 m (Schlag mit
  25 m Radius). Ein senkrechter Strahl 5 m neben dem Einschlag traf nach
  dem Ende des Pilzes die versteckte Kuppel in 36 m Höhe, 30 m daneben in
  27 m. Die Kamera zoomte also auf eine unsichtbare Kuppel, hielt 10 m
  davor, pivotierte auf ihr und hielt 5 m Abstand über ihr.

- Ursache: Die GlobeControls raycasten gegen die Szene, die sie
  bekommen, und `CameraRig` gab ihnen die ganze Szene. Ihre Strahlen:
  pro Frame zwei für den Punkt unter der Kamera (Mindestabstand
  `cameraRadius`, 5 m), beim Zoomen einer für den Punkt unter dem Zeiger
  (Zoom-Ziel, Halt `minDistance`, 10 m, davor), beim Drücken einer für
  den Pivot von Ziehen und Drehen. three.js prüft beim Raycast `visible`
  nicht. Getroffen wurden deshalb auch die versteckten
  Reichweiten-Scheiben der Tower: je Tower ein DoubleSide-Mesh mit 20
  bis 100 m Radius, 1,5 m über den gesampelten Tile-Höhen, auf 8 Ringen
  × 48 Segmenten über Dächer und Straßen gespannt; dazu Randlinie
  (+2 m), Auswahl- und LOS-Ring, Tower-Modelle und Route-Linien. Tower
  stehen an der Route.
- Wirkung dort: Der Zoom zielte auf die Scheibe über der Straße und
  hielt 10 m davor an. Ein Pivot über dem Boden schiebt die Welt beim
  Ziehen langsamer als den Zeiger, senkrecht von oben etwa im Verhältnis
  (h - e) / h (Kamera h über dem Boden, Pivot e darüber). Jeder
  Kamera-Strahl testete zusätzlich die Dreiecke dieser Meshes. Aus dem
  Code hergeleitet, nicht im Browser gemessen.
- Geprüft und nicht die Ursache: Die Dämpfung der Controls rechnet mit
  der Frame-Zeit (`2^(-dt / dampingFactor)`), der Mausrad-Zoom wird je
  Update ganz angewandt, Ziehen folgt dem Zeiger, Tastatur-Pan rechnet
  m/s × dt. Keine Kamera-Höhenklemme liest `TerrainQueries`. Der
  Hover-Pick der Tower (`bf414ab`) läuft höchstens alle 100 ms und nie
  bei gedrückter Taste.
- Herkunft: Die ganze Szene als Raycast-Ziel ist älter als die
  Nachtschicht; in `39fbb18` stehen `setScene(scene)` und die versteckten
  Scheiben genauso, vor `04ca3d7` stand es im Engine. Die Kuppel in der
  Luft kam mit dem Atompilz dieser Nacht (`327cc62`). DevWorld raycastete
  schon nur gegen ihre Terrain-Gruppe.
- Geprüft am Atomschlag, unauffällig: Der Screen Shake verschiebt nur die
  Projektion für den einen Draw und stellt sie danach zurück
  (`drawFrame()`), Kamera und Controls sieht er nicht; er fällt nach
  1,6 s auf 0. Der Bloom-Kick fällt nach 0,9 s Spielzeit auf 0 und setzt
  dann die Werte des Passes exakt zurück. Der Schlag ändert weder
  Zeitskala noch Kamera-Einstellungen. Pilz-Partikel mit leerem
  Draw-Range sind weder gezeichnet noch treffbar.
- `bac034a` Die Controls bekommen eine `GroundPickRoot`: eine Gruppe
  ohne Transform in der Szene, die Strahlen nur mit der Tiles-Gruppe
  beantwortet und das Pivot-Mesh trägt. Tiles per Debug ausgeblendet:
  kein Treffer, Rückfall aufs Ellipsoid wie bisher. Verhaltensänderung:
  Die Kamera hält nicht mehr an Towern, Overlays, Markern oder Gegnern
  an und pivotiert nicht darauf. Die Spec nimmt die echten
  `EnvironmentControls`: Eine versteckte Scheibe in 8 m hob die Kamera
  vorher auf 13 m, jetzt nicht; der Pivot lag vorher auf ihr, jetzt auf
  dem Boden.
- `a7cdcf4` Die Strahlen der Controls stehen in `__raycastStats()` unter
  `cameraControls` statt `unscoped`.
- `aef9d9e` Alle Objekte des Atompilzes (Partikel, Ringe, Kuppeln,
  Flash-Sprites, Bildschirm-Quad) haben einen leeren `raycast()`, auch
  für andere Raycaster als die Kamera. Sie bleiben für Gates und
  Shader-Warm-up in der Szene. Spec: Ein Strahl durch den Einschlag
  trifft während und nach dem Pilz nichts.
- Offen: Nah an einem Tower kann die Kamera jetzt in sein Modell fahren,
  der Mindestabstand gilt nur zu den Tiles. Tower als Hindernis wieder
  aufzunehmen, würde Zoom-Halt und Pivot an ihnen wieder anheben; nicht
  gemacht.

250. Spiel an einem Ort mit Route, 4 bis 6 Tower dicht an eine gerade
     Strecke der Route bauen, keine Welle nötig. Kamera über eine Stelle
     300 m oder mehr abseits der Route ohne Tower, mit dem Mausrad bis
     zum Anschlag hineinzoomen und die Nähe zum Boden merken. Dasselbe
     über der Straße zwischen den Towern: Der Anschlag liegt genauso nah
     am Boden, nicht höher, und der Zoom wird davor nicht zäher.
     **ok** (Playtest 2026-09-13)
251. Über der Route zwischen den Towern mit der linken Taste ziehen: Der
     Boden unter dem Zeiger bleibt unter dem Zeiger, wie abseits der
     Route.
     **ok** (Playtest 2026-09-13)
252. Rechte Taste über der Route halten und drehen: Der Pivot-Kreis
     liegt auf der Straße, nicht in der Luft darüber.
     **ok** (Playtest 2026-09-13)
253. Mit dem Mausrad direkt auf einen Tower zoomen: Die Kamera fährt bis
     nah an den Boden am Tower und kann dabei ins Modell geraten
     (bekannt, siehe Offen).
     **ok** (Playtest 2026-09-13, das Hineinfahren stört nicht)
254. Konsole: `__raycastStats(true)`, 10 s über der Route zoomen und
     ziehen, dann `__raycastStats()`: Zeile `cameraControls`, bei ruhender
     Kamera etwa 2 Aufrufe pro Frame.
     **Teilweise** (Playtest 2026-09-13): Zeile `cameraControls` da, 10752
     Aufrufe in 37 s, 4238 ms gesamt, 0,39 ms je Aufruf, maxBurst 2,4 ms,
     1 Treffer je Aufruf. Das sind im Schnitt 290 Aufrufe und 115 ms pro
     Sekunde (etwa 11 % der Laufzeit, bei 60 fps rund 1,9 ms je Frame),
     gemittelt über Ruhe und 10 s Zoomen und Ziehen. Die Rate in Ruhe ist
     daraus nicht zu trennen, siehe Nachmessung. Kostenpunkt in TODO 1.8.
     Nachmessung ohne Kameraberührung: 5010 Aufrufe, 1355 ms, 0,27 ms je
     Aufruf, maxBurst 1,5 ms. Die Dauer seit dem Reset ist nicht notiert;
     bei etwa 10 s wären das rund 500 Aufrufe und 135 ms pro Sekunde. Die
     Controls raycasten also auch in Ruhe spürbar.
255. DevWorld (`?devworld`): Zoom, Ziehen und Drehen wie bisher.
     **ok** (Playtest 2026-09-13)
256. Neues Spiel, Dev-Menü, Cheats, Nuke, Schlag auf die Route setzen
     (wie Punkt 224), den Pilz ganz ablaufen lassen (14 s). Dann über dem
     Einschlag mit dem Mausrad bis zum Anschlag zoomen: Die Kamera kommt
     so nah an den Boden wie an jeder anderen Stelle, kein Halt in der
     Luft.
     **ok** (Playtest 2026-09-13)
257. Gleiche Stelle, links ziehen und rechts drehen: Der Boden bleibt
     unter dem Zeiger, der Pivot-Kreis liegt auf dem Boden.
     **ok** (Playtest 2026-09-13)
258. Während der Pilz steht, über ihm zoomen und ziehen: Die Kamera geht
     durch Pilz und Kuppel hindurch, nichts bremst.
     **ok** (Playtest 2026-09-13)

## Zwischenstand Playtest 2026-09-13 abends

Getestet auf `sprint/night-2026-09-13` bei Head `e586f437`, Ergebnisse stehen
an den Punkten.

- Hier ok: 232 bis 237, 239 bis 247, 249 bis 253, 255 bis 258.
  **Befund**: 248 (Beschwörungskreis mit Bloom unsichtbar). Teilweise: 254
  (die Kamera-Raycasts kosten auch in Ruhe Zeit). Nebenbei notiert: der
  Drache wirkte stumm, eventuell Falschmeldung, erst nachstellen (bei 235),
  per Debug gesetzte Gegner schauen
  anfangs falsch (bei 237), Tower versinken auf schrägen Dächern (Wunsch:
  automatischer Steinsockel). Alles in TODO 1.8.
- Alte Liste (`REVIEW_SPRINT_2026-09-12.md`) ok: 6, 7, 8, 11, 12, 13, 15, 20,
  21, 22, 25, 28, 31.
- Weiter beim nächsten Mal: alte Liste 34 und 36 (Rückfrage offen), dann 4,
  5, 9, 14, 16, 27, 29, 33, 38, 41 bis 44, 53, 54; aus dieser Liste 238 und
  die Punkte ab 101 ohne Ergebnis.

## TODO-Stand

Jeder dieser Einträge hat in TODO.md eine Zeile "Stand 2026-09-13 (Nacht)".
Nach DONE.md verschoben ist nichts, das passiert nach deinem OK:

| TODO-Eintrag | Stand | Commits |
|---|---|---|
| 1.2 `three-tiles-engine.ts` abspecken | Camera-Setup und Tile-Loading lagen schon vor der Nacht in `CameraRig` und `TileLoadingTracker`, der Eintrag war veraltet. Diese Nacht Render-Loop, Terrain-Abfragen, Szene, Picking und TilesRenderer-Setup ausgelagert, 2 234 auf 1 144 Zeilen (heute 1 198) | `89871ab` bis `f8d1a97`, `d57026c` bis `1f7c867` |
| 1.7 Routenkorridor: Restpunkte | Spawn- und HQ-Wechsel werden gemessen, die Messung läuft in 4-ms-Scheiben statt 520 ms am Stück, zurückgehaltene Nachmessungen werden nachgeholt. Offen: gemeinsame Zellen zweier Routen auf verschiedenen Ebenen; der Neuaufbau bleibt synchron | `879ad8b` bis `b9f468c` |
| 1.7 Gegnermodelle: Blender-Runde | 12 Modelle, VAT 264,2 auf 105,2 MB; Mech, Ghost und Tank nicht; `Electrocuted_Fall` zurück; VAT-Materialien opak, wo kein Alpha nötig ist | `99f2845` bis `32195cb`, `eb3b7da` |
| 1.7 Kleinkram Runde 2: Split des Skeletons | umgesetzt | `99178cd` bis `0557aba` |
| 1.7 Bot-Läufe mit den neuen Inhalten | weiter offen, dazu Split und Nuklearschlag | |
| Performance: zombie_v2 und alle Gegnermodelle | VAT als Half Float, opak wo möglich, nur auf der GPU; zombie_v2 in Blender 31 342 auf 4 870 VAT-Vertices; VAT gesamt 105,2 MB | `e948529`, `eb3b7da`, `ec878b6`, `4c8d21c`, `b09d24d` |
| Performance: BVH für Terrain-Raycasts | der größte gemessene Brocken, die Korridor-Messung, läuft in Scheiben; Entscheidung weiter nach dem Playtest | `879ad8b` |
| Visual Effects: Spawn-Portal | umgesetzt, nach dem Playtest nachgearbeitet (Heraustreten, Look, Siegel, Stein); Runde 3: Volumen, Doppeltor als Asset, neue Sigillen, Beschwörungskreis; Runde 4: Stein kodiert und heller, Sigillen aus dem Distanzfeld, Atem mit Pause, Kreis kodiert, Sigille ohne Triskele | `a214973` bis `cc8da0f`, `cfb85a8` bis `5bb5073`, `186474e` bis `329c4d0`, `2034997` bis `f3f7238` |
| Gameplay-Konzept: Spieler aktiver einbinden | Nuklearschlag gebaut, der Held ist offen | `94213b0` bis `44b8741`, `cf6b6ee` |
| Enemy-Ideen: Skeleton | Split dazu | `99178cd` bis `0557aba` |

Die Punkte unter "Befunde, offen" stehen in TODO.md im neuen Abschnitt "1.8
Befunde aus der Nachtschicht 2026-09-13 (nicht behoben)".
