# Replay der letzten Welle

**Stand:** 2026-09-15

Nach einer Welle lässt sie sich noch einmal ansehen: freie Kamera, Pause,
0,25x bis 4x, Sprung an jede Stelle über den Fortschrittsbalken. Nur die
letzte Welle wird gehalten. Der Einstieg sitzt im WAVE-Panel unter dem
Wellen-Button und auf dem Game-Over-Screen; nach dem Replay steht das Spiel
genau so da wie vorher, die Kamera eingeschlossen.

---

## Entscheidung: Präsentations-Replay statt Re-Simulation

Die naheliegende Idee war, den Zustand beim Wellenstart zu sichern und die
Welle mit den aufgezeichneten Befehlen noch einmal zu simulieren. Das geht
heute nicht verlässlich, aus diesen Gründen im Code:

| Befund | Fundstelle | Folge für eine Re-Simulation |
|--------|------------|------------------------------|
| Ungeseedetes `Math.random()` bei jedem Spawn: Seitenversatz im Korridor, Höhenvariation der Luftgegner | `managers/enemy.manager.ts` (`spawn()`) | Gegner laufen auf anderen Bahnen, treffen andere Zellen, andere Türme zielen auf sie |
| Spawnpunkt per `Math.random()`, `spawnMode` ist standardmäßig `'random'` | `managers/wave.manager.ts` (`selectSpawnPoint()`) | Gegner kommen aus anderen Portalen |
| Sichtlinie eines Turms aus einem GPU-Readback gegen die gerade geladenen Tiles; ein während der Welle gebauter Turm schießt erst, wenn `losReady` gesetzt ist, und Zellhöhen ändern sich, während Tiles nachladen | `services/tower-los-registry.ts`, `services/combat/tower-combat.service.ts`, `EnemyManager.update()` (Bodenhöhe aus dem Route-Grid) | Andere Treffer, anderer Ausgang, abhängig von Framerate und Streaming |
| Die Turmdrehung, die das Feuern freigibt, lebt im Renderer | `ThreeTowerRenderer.advanceTurretAim()` | Die Simulation hängt an Renderer-Zustand |
| Die Simulationsdienste sind Singletons, die das laufende Spiel teilt: Route-Grid (Gegner je Zelle, Sichtbarkeit), Spatial-Grid, Kampf-, Status- und Turm-Kampfdienst | `GlobalRouteGridService`, `SpatialGridService`, `CombatEffectService`, `StatusEffectService`, `TowerCombatService` | Eine zweite Simulation müsste all das sichern und zurückspielen oder doppelt aufbauen; der Live-Zustand darf aber nicht angefasst werden |

Das deckt sich mit den Blockern in [MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md#2-die-drei-determinismus-blocker)
(GPU-LOS, Zellhöhen, RNG). Deshalb zeichnet das Replay auf, **was die
Renderer gezeigt haben**, und spielt das über dieselben Renderer ab. Die
Simulation wird dabei nie berührt.

Die Befehle der Welle werden trotzdem vollständig mitgeschrieben (jedes
`command:*` als Klartext, dazu die `WaveConfig` des Startbefehls). Eine
spätere Re-Simulation, sobald die Blocker gelöst sind, kann darauf aufsetzen
(MULTIPLAYER_CONCEPT, Abschnitt 18).

---

## Aufbau

| Datei | Aufgabe |
|-------|---------|
| `configs/replay.config.ts` | Framedichte, Speichergrenze, Event-Grenze, Geschwindigkeiten |
| `replay/replay-recording.ts` | Die Aufnahme: Tabellen je Gegner, Projektil, Turm, Frames als Typed-Array-Spalten, Events, Befehle, HQ-Leben; Speichergrenze mit Ausdünnen (`thin()`) |
| `replay/replay-recorder.ts` | Nimmt auf. Gehört dem `GameStateManager`, liest den Bus während einer aufgenommenen Welle über `onAny()` |
| `replay/replay-events.ts` | Welche Events aufgehoben werden und in welcher Form; Befehle als Klartext (`toPlainData`) |
| `replay/replay-player.ts` | Spielt eine Aufnahme über die Live-Renderer ab und gibt sie danach unverändert zurück |
| `replay/replay-bar-view.ts` | Reine Funktionen für die Leiste: Befehls-Marken, Zeit, Geschwindigkeit |
| `services/replay.service.ts` | Replay-Modus: HUD aus, Spiel pausiert, Kamera sichern und zurückstellen, Leiste füttern |
| `components/replay-bar/` | Die Leiste unten mittig |

Einbindung:

- `GameStateManager`: hält `replayRecorder`, ruft `onSubStep()` in jedem Sub-Step nach dem Turret-Aim, `finish('completed')` direkt nach `endWave()`, `finish('gameover')` in `triggerGameOver()` noch vor dem Leeren der Gegner, `clear()` bei `reset()`, `initialize()` (neuer Ort) und `reseatWavePipeline()` (neue DevWorld). Den Helden liest der Recorder über `HeroManager.getPresentation()`, dasselbe Objekt, das `presentFrame()` dem Renderer gibt
- `GameLoopFacadeService.onEngineUpdate()`: `replay.update(deltaTime)` nach `gameState.update()`, damit das Replay den Timescale der Renderer setzt, nachdem die Pause ihn auf 0 gestellt hat
- `HotkeyService`: während des Replays steuern Leertaste, P, +/- und Esc das Replay (siehe Bedienung)
- `UIStore.replayMode` und `UIStore.viewOnly` (Photo Mode oder Replay): der `InputHandlerService` wählt dann per Klick und Hover nichts aus
- Neu an den Renderern: `ThreeEffectsRenderer.holdGroundMarks()`, `ThreeFlameBeamRenderer.getBeam()`, `ThreeTentacleRenderer.getStrikeTarget()`, `setVisible()`, `captureStrike()` und `restoreStrike()`, `TowerPlinthRenderer.setVisible()`, `OozeBandRenderer.discard()` (ein Band sofort weg, ohne Absinken) und `clearDebris()` (nur die Trümmer, bei jedem Sprung)
- `command:set-targeting`: die Zielwahl im Tower-Panel lief bisher an der Befehlskette vorbei und geht jetzt über den Bus, damit sie im Befehlslog steht ([EVENT_SYSTEM.md](EVENT_SYSTEM.md))

---

## Aufnahme

Die Aufnahme beginnt mit `wave:started` (auch bei manuellen Debug-Wellen) und
hält dabei den Stand zu Wellenbeginn fest: die stehenden Türme (Position, Typ,
Drehung, Sockelhöhe), HQ-Leben, Credits, ob es eine Blutmond-Welle ist
(`isBloodMoonWave`) und die `WaveConfig` des Befehls, der die Welle gestartet
hat. Solange der Renderer aus ist (Training ohne Rendering), wird nichts
aufgenommen.

Alle `stepsPerFrame` Sub-Steps (6, also 10 Frames pro Sekunde Spielzeit)
kommt ein Frame dazu, im selben Sub-Step direkt nach dem Turret-Aim:

| Stichprobe | Felder | Bytes |
|------------|--------|-------|
| Gegner (lebend) | Tabellenindex, lokale Position mit Höhenversatz, Blickrichtung (16 bit), Bodengeschwindigkeit (cm/s), Leben (0-255), Status (verlangsamt, vergiftet, brennt, rennt, eingefroren, betäubt) | 22 |
| Projektil | Tabellenindex, lokale Position | 16 |
| Turm | Tabellenindex, Zielrichtung (Turret-Drehung, auch ohne Turret-Teil), Flammenstrahl oder Tentakelschlag mit Ziel und Breite | 23 |
| Körper entlang der Route (Ooze) | Tabellenindex, Schwanz und Spitze in Metern ab `path[0]` (`RouteBody.tailM`, `tipM`) | 12 |
| Held (je Frame, nicht je Körper) | Pose (idle, run, shoot, run-shoot; 0 = kein Held), lokale x und z, Blickrichtung | 13 |

Jeder Turm außer einem passiven Gebäude (dem Research Center) bekommt je
Frame eine Stichprobe, auch ohne Turret-Teil: Archer, Lightning und Tentacle
drehen ihre Zielrichtung wie die anderen, nur dreht sich am Modell nichts,
und ihr Blutmond-Scheinwerfer folgt ihr. Eine Stichprobe nur bei geänderter
Richtung reicht nicht: der Player zeigt die Stichproben des Frames, in dem
er steht, ein Sprung zurück behielte die spätere Richtung. Sterbende Gegner
stehen nicht in den Frames; ihr Tod steht in der Tabelle, der Player spielt
die Todesanimation von dort.

Ein Ooze hat zusätzlich zur Körper-Stichprobe eine normale Gegner-Stichprobe
(Spitze, Leben, Status). Die Stationen seiner Route (`RouteBodyStations`)
stehen einmal je Ooze in der Aufnahme, als Verweis auf das Objekt, das auch
das Live-Band nutzt. Der Held steht auf dem Boden des Route-Grids, deshalb
reichen x und z; seine Schüsse sind Projektile (`hero-round`, `hero-shell`,
`hero-rune`) und kommen mit Typ und damit Tracer-Farbe je Munition über die
Projektil-Stichproben.

Neben den Frames kommt alles aus dem Bus:

- Tabellen: Spawn (`enemy:spawned`), Tod (`enemy:died`), Leck (`enemy:reached-base`), Treffer eines Projektils mit Trefferpunkt (`projectile:hit`), gebaute und verkaufte Türme (`tower:placed`, `tower:sold`). Ein Projektil ohne Treffer-Event (Ziel verloren, kein Splash) endet am ersten Frame, in dem es fehlt
- Effekt-Events: jedes `vfx:*`, `audio:play`, die `ability:*`-Events außer `ability:state-changed` und `ability:rejected` (damit Zielmarker, Atompilz, Frost-Explosion, EMP-Welle und Orbitallaser), `health:changed`, `enemy:split` (als Stummel mit der Stelle des toten Gegners) und `hero:level-up`. Die Objekte werden aufgehoben, nicht kopiert: ihre Sender bauen je Event ein neues Objekt. Ein Event, das eine lebende Entity hält (etwa `hero:kill`), wird verworfen, weil es beim Abspielen deren heutigen Zustand zeigen würde
- Befehle: jedes `command:*` als Klartext mit Zeitpunkt, die des Helden (`command:hire-hero`, `command:hero-move`, `command:hero-ammo`) eingeschlossen. Befehle, die es heute noch nicht gibt, landen ohne Änderung im Log

Die Aufnahme endet, wenn der `GameStateManager` sie schließt (Welle vorbei
oder HQ zerstört); ein letzter Frame hält den Stand dabei fest. Offene Gegner
gelten dann als „cleared“. Der nächste Wellenstart, ein Neustart, ein neuer
Ort, eine neu erzeugte DevWorld und ein Wellensprung (`wave:jumped`, Dev-Cheat
„Jump to wave“) verwerfen sie. Beim Sprung ist das eine Entscheidung: der
Cheat setzt den Wellenzähler neu, die Aufnahme wäre danach nicht mehr die
Welle vor der nächsten, und der Link „replay W12“ im WAVE-Panel nennte eine
Welle, zu der das Panel nicht mehr führt.

### Speicher

Die Stichproben liegen in wachsenden Typed-Array-Spalten, die von Welle zu
Welle bleiben: nach der ersten großen Welle legt die Aufnahme nur noch
Tabelleneinträge und Map-Einträge für neue Gegner und Projektile an. Alle
Spalten zusammen bleiben unter `sampleBudgetBytes` (48 MB). Passt ein Frame
nicht mehr hinein, fällt jeder zweite Frame weg und der Abstand verdoppelt
sich (`ReplayRecording.thin()`), bis hinunter zu 1,25 Frames pro Sekunde
(`maxStepsPerFrame` 48). Passt es auch dann nicht, hört die Aufnahme auf zu
wachsen (`truncated`), das Replay endet früher. Die Frames liegen immer auf
Vielfachen des aktuellen Abstands ab Wellenbeginn, deshalb geht das Ausdünnen
ohne Lücken weiter.

Die Spalten wachsen durch Verdoppeln. Passt das nicht mehr ins Budget,
wächst eine Spalte auf ihren Bedarf und bis zur Hälfte davon darüber hinaus,
soweit das Budget reicht (`GROWTH_SLACK`), statt in jedem Frame genau auf den
Bedarf. So gibt es zwischen dem letzten Verdoppeln und dem Ausdünnen ein oder
zwei Neuanlagen, nicht eine je Frame. Während einer Neuanlage bestehen alte
und neue Spalte kurz nebeneinander; der Speicher liegt in diesem Moment um
die alte Spalte über dem Budget.

Rechnung für den ungünstigsten Fall, 2 800 Körper gleichzeitig auf der Route
(ein Skelett-Schwarm am Rand seiner Template-Spanne; die Curriculum-W19 hat
310 Skelette mit je 2 Minions, höchstens 930 Körper):

- 2 800 × 22 B × 10 Frames/s = 616 KB pro Sekunde Spielzeit, nur Gegner
- 48 MB reichen damit für rund 78 s mit 10 Frames/s, danach 5 Frames/s bis rund 156 s, 2,5 bis rund 312 s, 1,25 bis rund 624 s
- Mit einigen hundert Gegnern gleichzeitig (500 × 22 B × 10 = 110 KB/s) belegt eine dreiminütige Welle rund 20 MB, ohne auszudünnen
- Ooze-Körper zählen mit ins Budget und dünnen mit aus: 12 B je Ooze und Frame, 20 Oozes also 2,4 KB/s
- Türme ebenso: 23 B je Turm und Frame, 60 Türme also 13,8 KB/s. `reserveFrame()` rechnet schon mit einer Stichprobe je Turm
- Der Held und die Frame-Spalten (Zeit 8 B, vier Startindizes 16 B) liegen außerhalb des Budgets: zusammen 37 B je Frame, bei 10 Frames/s 370 B/s, eine zehnminütige Welle rund 222 KB; sie dünnen mit den Frames aus

Dazu kommen die Tabellen (11 B je Gegner, 18 B je Projektil) und die Events,
höchstens `maxEvents` (150 000) Stück; darüber wird gezählt und verworfen
(`droppedEvents`). Ein aufgehobenes Event-Objekt ist geschätzt 100 B groß,
das wären bis zu rund 15 MB.

### Kosten im laufenden Spiel

Gemessen in `replay-recorder.spec.ts` (vitest, jsdom): ein Frame mit 2 800
Gegnern, 300 Projektilen und 60 Türmen kostet 77 bis 84 µs (zwei Läufe), also
rund 0,8 ms je Sekunde Spielzeit bei 10 Frames/s; bei 4x
Spielgeschwindigkeit rund 3,2 ms je Sekunde Echtzeit. In der ersten Welle,
während die Spalten wachsen, waren es 96 bis 113 µs. Enthalten ist das
Zählen der Körper vor jedem Frame (eine Schleife über die Gegnerliste); die
Messung hat keine Oozes und keinen Helden, die je Frame eine
beziehungsweise zwei Umrechnungen mehr kosten. Eine Messung im Browser steht aus. Die übrigen Sub-Steps kosten einen
Zähler. Pro Frame wird nichts angelegt außer Map-Einträgen für neue Gegner
und Projektile (und den seltenen Neuanlagen der Spalten, siehe Speicher).

Am Bus hängt der Recorder nur, solange er eine gerenderte Welle aufnimmt, über
den Catch-all-Pfad (`onAny`); Wellenstart, Startbefehl und Wellensprung hört
er typisiert. Zwischen den Wellen und im Headless-Training bleibt `emit` damit
auf seinem schnellen Pfad ohne Catch-all-Listener. Jeder Schritt des Recorders
(Events, Frames, Abschluss) ist geschützt: ein Fehler verwirft die Aufnahme,
wird geloggt und erreicht das Spiel nicht. Der Bus selbst fängt Würfe von
Catch-all-Listenern ab wie die der typisierten.

---

## Wiedergabe

`ReplayService.enter()` beendet Build-, Platzierungs- und Zielmodus, die
Tower- und die Helden-Auswahl, das offene Quick-Menü und einen laufenden Photo
Mode, blendet die Veteranen-Abzeichen aus, merkt sich Kamera (Position,
Ausrichtung, Up), Pause, Menü und Fokus und pausiert das Spiel
(`GameStore.paused` und `GameStateManager.paused`). Während ein Boss-Intro
läuft, startet es nicht. Umgekehrt kann während des Replays kein Boss-Intro
beginnen: das Live-Spiel steht, und die Events des Replays laufen über den
eigenen Bus des Players, auf dem der `BossIntroService` nicht hört. Dann
übernimmt der `ReplayPlayer`:

- Gegner und Projektile bekommen eigene Instanzen in den bestehenden Renderern (`replay-enemy-N`, `replay-projectile-N`); Positionen, Blickrichtungen und Turret-Drehungen werden zwischen zwei Frames interpoliert. Status-Tönungen und Auren, Eis (Tönung und Eiskristalle) und Betäubung (Tönung und Funken im Takt des Spiels, `STUN_SPARKS`), Gehen und Rennen, Todesanimationen (ab dem aufgezeichneten Todeszeitpunkt) und Lecks folgen der Aufnahme
- Ein Ooze bekommt statt einer Instanz ein eigenes Band im `OozeBandRenderer` (unter derselben `replay-enemy-N`-Id), auf denselben Stationen und dem Boden des Route-Grids; Schwanz und Spitze werden interpoliert, Leben und Status kommen aus seiner Gegner-Stichprobe. Stirbt er, kollabiert das Band wie im Spiel (`OozeBandRenderer.collapse`, `OOZE_LOOK.collapse`) samt Blasen und Trümmern; die Pfützen fehlen, weil die Bodenmarken angehalten sind ([PARTICLE_SYSTEM.md](PARTICLE_SYSTEM.md#tod-der-ooze)); leckt er, sinkt es (`OOZE_LOOK.dissolve`); ein Sprung davor legt es neu hin
- Der Held-Renderer zeigt den aufgezeichneten Helden mit Pose und Blickrichtung, interpoliert. In Frames ohne Helden (vor dem Anheuern) ist er nicht zu sehen; der Live-Held kommt beim Verlassen zurück (`HeroManager.presentFrame()`). Der Blutmond-Look ist der der aufgezeichneten Welle, sofort ohne Überblendung; beim Verlassen kehrt der Live-Zustand zurück
- Die Live-Türme drehen sich auf die aufgezeichnete Turret-Drehung und sind unsichtbar, bis sie in der Welle gebaut wurden. In der Welle verkaufte Türme kommen als eigene Modelle (`replay-tower-N`) mit Sockel und Tentakel zurück, nach der Welle gebaute sind während des Replays ausgeblendet. Die Blutmond-Scheinwerfer folgen der Sichtbarkeit der Türme und der aufgezeichneten Drehung, auch bei Türmen ohne Turret-Teil; ein verkaufter Turm bekommt einen eigenen. Flammenstrahlen und Tentakelschläge spielen aus den Turm-Stichproben
- Die Effekt-Events laufen über einen eigenen Bus des Players, auf dem ein eigener `VFXService`, `AudioService` und `ScreenShakeService` hören: dieselben Effekte wie im Spiel. Oberhalb von 1x spielt das Replay keine Sounds, auch keine Einschlagsounds der Fähigkeiten und keinen Nachhall: der `AudioService` des Players hört auf einem eigenen Bus, der dann nichts bekommt, und ein noch ausstehender Nachhall wird verworfen, ebenso bei einem Sprung
- Der Timescale der Renderer folgt der Replay-Geschwindigkeit (0 in der Pause), damit laufen Gehzyklen, Todesanimationen und Atompilze mit
- Je Frame rückt das Replay höchstens `GameClock.MAX_CATCHUP_MS` (50 ms) Echtzeit vor, wie die Spieluhr: ein langer Frame (GC, Shader-Kompilierung, Tiles) springt nicht und spielt nicht die Events einer langen Spanne auf einmal. Unter 20 Frames pro Sekunde läuft das Replay dadurch langsamer als sein Tempo
- Bodenmarken (Blut, Frost, Brandflecken) sind angehalten (`holdGroundMarks`): die Einschläge der Welle haben den Boden schon markiert
- Springen spielt keine Events dazwischen, holt Gegner zurück ins Leben, wenn der Sprung vor ihren Tod geht, und beginnt die Projektilspuren neu. Es nimmt Zielmarker weg, deren Einschlag noch aussteht, und räumt nach einer im Replay gelandeten Fähigkeit Atompilze, Frost-Explosionen, EMP-Wellen und Orbitallaser ab (wie `exit()` samt denen des Live-Spiels): ein übersprungener Einschlag ließ sonst den Marker bis zum Ende stehen, ein Sprung zurück ließ den Effekt beim erneuten Abspielen doppelt kommen

`exit()` nimmt alle eigenen Instanzen weg, stellt Turret-Drehung, Suchschwenk,
Tentakelschlag und Sichtbarkeit der Live-Türme zurück, entfernt die Replay-Modelle, gibt die
Bodenmarken frei und stellt Kamera, Pause, Menü und Fokus zurück. Die
Controls der Kamera werden dafür kurz ab- und wieder eingeschaltet, das
verwirft Trägheit und einen laufenden Zug.

### Bedienung

| Eingabe | Wirkung |
|---------|---------|
| „replay W12“ im WAVE-Panel (zwischen den Wellen) oder „Replay wave N“ auf dem Game-Over-Screen | Replay starten |
| Leertaste, P, Play-Knopf | Pause und weiter; am Ende startet Play von vorn |
| + / - , Geschwindigkeitsknöpfe | 0,25x, 0,5x, 1x, 2x, 4x |
| Fortschrittsbalken (Maus, Pfeiltasten bei Fokus) | Springen; beim Ziehen hält das Replay an und spielt beim Loslassen weiter (`pointerup`, `pointercancel`, auch nach einem Klick ohne Bewegen; `change` für die Tastatur). Marken zeigen, wann der Spieler Befehle gab |
| Maus, WASD, Pos1, N | Kamera wie im Spiel |
| Esc, Exit | Zurück ins Spiel |

Bauen, Verkaufen, Upgraden, Fähigkeiten und der Photo Mode ruhen während des
Replays. Die Leiste zeigt Welle, HQ-Leben und Gegner auf der Route im
gezeigten Moment, Tab bleibt in ihr.

---

## Was das Replay nicht zeigt

- Schadenszahlen, Gold-Popups und das Aufblitzen bei Kettenblitz-Treffern: sie gehen direkt an den Renderer, nicht über ein Event
- Eis-Explosionen und Frost-Decals der Eis-Treffer (`CombatVfxService.emitIceExplosion` ruft den Renderer direkt); Bodenmarken allgemein (angehalten, siehe oben)
- Gegner-Sounds (Laufgeräusche, Zufallsrufe) und den Flammen-Loop der Feuertürme: sie hängen an Entities, nicht an Events
- Den Zustand des HQ-Feuers: er bleibt, wie die Welle ihn hinterlassen hat. Die Leck-Vignette und die Boss-Leiste sind mit dem HUD ausgeblendet; der Screen-Shake beim Tod eines Bosses fehlt, weil `enemy:died` nicht wiederholt wird
- Das Innenfeuer eines Feuerturms und das Knistern eines Blitzturms bei Türmen, die während oder nach der Welle gebaut oder verkauft wurden: sie folgen der Sichtbarkeit des Modells nicht
- Türme haben im Replay ihr heutiges Modell, Upgrades der Welle sind nicht Schritt für Schritt zu sehen
- Ein Gegner, der zwischen zwei Frames spawnt und stirbt, hat keine Stichprobe und fehlt; nach dem Ausdünnen werden Kurven gröber
- Eine Todesanimation, in deren Mitte gesprungen wird, beginnt von vorn. Zielmarker einer Fähigkeit erscheinen nur, wenn das `ability:used` abgespielt wurde, nicht nach einem Sprung; ebenso Atompilz, Frost-Explosion, EMP-Welle und Laser nur, wenn ihr `ability:impact` abgespielt wurde
- Landet im Replay eine Fähigkeit, räumen jeder Sprung und `exit()` alle Atompilze, Frost-Explosionen, EMP-Wellen und Orbitallaser ab, auch einen, der im Spiel noch lief
- Ein Sprung in das Absinken eines Ooze-Bandes zeigt kein Absinken, das Band fehlt dann; das Blubbern der Oozes fehlt (ein Loop an der Entity, kein Event)
- Ein Sprung räumt die Trümmer ab, die bis dahin liegen, auch die der gerade gespielten Live-Welle (`seek()` ruft `oozes.clearDebris()`); läuft das Replay wieder über den Kill, wirft der Kollaps einen neuen Satz. `exit()` räumt Bänder und Trümmer ab
- Die Ringe des Helden (Auswahl, Posten, Laufziel) gibt es im Replay nicht, er ist dort nicht auswählbar

---

## Erweitern

- **Neue Effekte:** ein neues `vfx:*`- oder `ability:*`-Event mit reinen Daten wird ohne Änderung aufgenommen und über den `VFXService` des Players abgespielt. Hält es eine Entity, braucht es in `replay-events.ts` einen Stummel wie `enemy:split`, sonst wird es verworfen
- **Neue Befehle:** jedes `command:*` steht ohne Änderung im Befehlslog
- **Neue Gegner und Bosse:** was über den Instanced-Renderer läuft und seinen Zustand über Position, Höhe, Blickrichtung, Leben, Status und Animation zeigt, braucht nichts; der Wurm etwa (Segmente sind normale Gegner). Ein Gegner mit einem Körper entlang der Route (`Enemy.body`, heute der Ooze) kommt über die Körper-Stichproben. Ein Boss mit eigenem Renderer außerhalb davon erscheint im Replay erst, wenn sein Zustand in den Frames steht
- **Neue Status-Effekte:** ein Bit in `ENEMY_FLAG` (zwei sind frei), gesetzt im Recorder, gezeigt in `ReplayPlayer.applyStatus()`
- **Visuals direkt aus Diensten:** was ein Dienst an einem Renderer ruft statt ein Event zu senden, fehlt, bis es in einer Stichprobe oder als Event steht. Flammenstrahl und Tentakelschlag stehen deshalb eigens in den Turm-Stichproben

---

## Tests

| Spec | Prüft |
|------|-------|
| `replay/replay-recording.spec.ts` | Tabellen, Frames, Quantisierung, Posen des Helden, Wachsen bis zur Grenze (nahe der Grenze höchstens zwei Neuanlagen bis zum Ausdünnen), Ausdünnen mit erhaltenen Stichproben (auch Körper und Held), `truncated`, Event-Grenze |
| `replay/replay-recorder.spec.ts` | Start und Ende, Frame-Takt, Stichproben mit Eis und Betäubung, Ooze-Körper, Held, Tabellen aus dem Bus, Türme mit Strahl und Schlag, Zielrichtung ohne Turret-Teil je Frame, keine Stichprobe für passive Gebäude, Befehlslog mit den Befehlen des Helden, Effekt-Events mit `hero:level-up`, Blutmond, nur die letzte Welle, Verwerfen beim Wellensprung, kein Rendering keine Aufnahme, Catch-all nur während der Aufnahme, ein Fehler verwirft die Aufnahme; Kostenmessung |
| `game-engine/game-event-bus.spec.ts` | Catch-all-Listener: Wurf gefangen, Zähler, Abmelden während eines Events |
| `replay/replay-recorder-budget.spec.ts` | Frames bleiben beim Ausdünnen auf dem Raster, Körper und Held gehen mit |
| `replay/replay-events.spec.ts` | Auswahl der Events, Stummel für `enemy:split`, Klartext der Befehle |
| `replay/replay-player.spec.ts` | Interpolation, gedeckeltes Frame-Delta, Status, Eis und Betäubung, Lecks, Todesanimation und Zurückspringen, Ooze-Bänder (Strecke, Absinken, Zurückspringen, ohne Boden keins), Held, Blutmond, Projektile, Türme (Sichtbarkeit, Drehung, Strahl, Schlag, Scheinwerfer), Events und Sounds (Einschlag und Nachhall nur bis 1x, mit den echten Diensten), Zielmarker und Effekte beim Springen, Rückgabe beim Verlassen samt Fähigkeiten-Effekten |
| `three-engine/renderers/searchlight/searchlight.renderer.spec.ts` | `setVisible()` je Turm, Slot bleibt |
| `managers/hero.manager.spec.ts` | `getPresentation()` ohne Renderer |
| `replay/replay-bar-view.spec.ts` | Marken, Zeitformat |
| `services/hotkey.service.spec.ts` | Tasten während des Replays |
