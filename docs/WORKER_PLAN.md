# Simulation in einem Worker (Konzept, TODO E57)

Stand 2026-09-29: gebaut (Branch `simu-worker`, seit 2026-09-30 auf `next`), Aufbau und Entscheidungen in [SIM_WORKER.md](SIM_WORKER.md). Dieses
Dokument bleibt das Konzept mit Demo und Stufe 1. Die Zahlen unter „Demo“ stammen aus einem
Stellvertreter der Simulation (`tools/worker-demo`, `e2e/perf/worker-demo.ts`), die unter „Stufe 1“ aus der echten
Simulation ohne Bild (`tools/worker-sim`, `e2e/perf/worker-sim.ts`).

## Frage

Unter Last teilen sich Simulation und Bild den Hauptthread. E57 hat gemessen: 5000 Gegner, Tempo 4, Offline-Testwelt,
Produktions-Build: die Simulation nimmt 67 bis 68 % des Bildes, 24 FPS. Heute gibt es nur die Wahl zwischen flüssigem
Bild und vollem Tempo (H6, geparkt). Trägt ein Worker für die Simulation, und wie kommt ihr Stand zum Renderer?

## Demo

- `sim.js`: 5000 Gegner laufen Kreise, fester Sub-Step 1/60 s, dazu eine Warteschleife je Sub-Step als Kosten der echten
  Simulation. Je Gegner 8 Zahlen für den Renderer (Ort, Richtung, Animationszeit, HP-Anteil, Typ, Flags), 160 kB je Bild.
- Drei Wege: `main` (Simulation im Hauptthread, wie heute), `post` (Worker, Stand als übertragener Puffer per
  `postMessage`, drei Puffer im Umlauf), `sab` (Worker, `SharedArrayBuffer` mit drei Slots, `Atomics` für den neuesten).
- Jeder Weg bekommt dieselbe Render-Last je Bild (Warteschleife). Alle 250 ms ein Befehl wie ein Klick; gemessen wird,
  wann das erste Bild ihn angewendet zeigt.
- `coep.html`: die fremden Quellen des Spiels mit einer kleinen Anfrage je Quelle, ohne Schlüssel, unter drei
  Header-Varianten (`server.mjs`: keine, COOP + COEP `require-corp`, COOP + COEP `credentialless`).

## Ergebnis (2026-09-29, ein Windows-Rechner, headless, während paralleler Bot-Läufe)

Sim 2,8 ms je Sub-Step und 13 ms Render je Bild bilden E57 nach (ohne Worker bei Tempo 4 rund 24 FPS):

| Browser | Weg | Tempo | FPS | erreichtes Tempo | Hauptthread für den Stand je Bild | Befehl bis sichtbar (Median) |
|---|---|---|---|---|---|---|
| Chromium | main | 1 | 60,6 | 1,00 | 2,9 ms (Sim) | 0,6 ms |
| Chromium | post | 1 | 60,2 | 0,99 | 0,1 ms | 20 ms |
| Chromium | sab | 1 | 60,0 | 0,99 | 0,015 ms | 19 ms |
| Chromium | main | 4 | 23,9 | 3,98 | 28,7 ms (Sim) | 0 ms |
| Chromium | post | 4 | 60,2 | 3,99 | 0,1 ms | 21 ms |
| Chromium | sab | 4 | 60,2 | 3,99 | 0,015 ms | 20 ms |
| Firefox | main | 4 | 21,7 | 3,98 | 33 ms (Sim) | 0 ms |
| Firefox | post | 4 | 76,9 | 3,92 | 0 ms (unter der Messauflösung) | 13 ms |
| Firefox | sab | 4 | 76,5 | 3,94 | 0,02 ms | 26 ms |

- Mit Worker bleibt das Bild bei der Monitorrate und das Tempo voll, solange die Simulation allein in Echtzeit
  mitkommt. Braucht sie mehr, als die Echtzeit hergibt (Probe mit 7 ms je Sub-Step, Tempo 4 = 28 ms Rechnung je
  16,7 ms), schafft kein Weg Tempo 4: der Worker hält das Bild, das Spiel läuft langsamer, Befehle stauen sich (330 ms).
- `postMessage` mit übertragenem Puffer kostet den Hauptthread 0,1 ms je Bild für 160 kB, `SharedArrayBuffer` 0,015 ms.
  Beides ist gegen 16,7 ms je Bild klein. **Der geteilte Speicher ist für diese Datenmenge nicht nötig.**
- Ein Befehl braucht mit Worker rund ein Bild länger bis zur Anzeige (13 bis 26 ms). Der Lockstep im Coop hat ohnehin
  eine Eingabeverzögerung.

**Header:** Unter `require-corp` und `credentialless` sind Chromium und Firefox `crossOriginIsolated` und lesen
Cesium Ion (`api.cesium.com`), Google Tiles (`tile.googleapis.com`), Overpass (`overpass-api.de`) und Nominatim
weiter: alle antworten mit CORS. Die Ausweich-Server `overpass.kumi.systems` und `overpass.private.coffee` liefen in
allen drei Varianten in den Timeout (10 s), auch ohne Header, das lag an den Servern. Schriften liefert das Spiel
selbst. Nicht geprüft: die Tile-Inhalte mit Schlüssel (dieselben Hosts, Kartensitzung) und Safari.

## Stufe 1: die echte Simulation im Worker

Frage: Läuft der echte `GameStateManager` ohne Bild in einem Web Worker, rechnet er dort bitgleich, und was kostet ein
Sub-Step?

**Aufbau** (`tools/worker-sim`): ein esbuild-Bündel aus der Spec-Welt (`sim-world.ts`, `sim-step-bench.ts`): echter
`GameStateManager` mit Routenraster, Kampf, Schaden, Geschossen, acht Tower auf zwei Routen, Engine als No-op-Stub.
`@angular/core` ist das echte Modul, nur `inject`, `Injectable` und `effect` sind ersetzt wie in den Specs
(`angular-shim.ts`). Dasselbe Bündel läuft im Hauptthread und in einem Modul-Worker, die Seite ist cross-origin
isolated (feine Zeitauflösung in Firefox).

- Ein Lauf von vier Wellen wird im Hauptthread von Chromium aufgezeichnet: gemischt mit Befehlen (Upgrade,
  Zielwahl, Held, Feuerpause, Fähigkeit), Ooze, Wurm und Splitter, Würmer auf beiden Routen, 400 Gegner.
- Die Replay-Datei (123 kB) geht in eine frische Welt, Welle für Welle nachgerechnet (`Resimulation`), in Chromium und
  Firefox, jeweils Hauptthread und Worker.
- Sub-Step bei 5000 Gegnern (4 Routen, 120 Tower, `createSimBench`), 600 Sub-Steps, beste von drei Runden.

**Bitgleich:** ja. Alle 1453 Prüfsummen der vier Wellen (alle 60 Sub-Steps) und der Stand am Ende jeder Welle sind in
allen vier Kombinationen gleich dem aufgezeichneten Lauf, auch in Firefox gegen die Aufzeichnung aus Chromium.
Die ganze Nachrechnung (rund 87 000 Sub-Steps) dauert in Chromium 0,7 s im Hauptthread und 0,85 s im Worker, in Firefox
2,0 bis 2,2 s auf beiden Seiten.

**Kosten je Sub-Step bei 5000 Gegnern** (zweiter Lauf, ein Windows-Rechner, headless):

| Browser | Ort | Tempo | Median | p95 | davon Kampf |
|---|---|---|---|---|---|
| Chromium | Hauptthread | 1 | 1,80 ms | 3,24 ms | 0,58 ms |
| Chromium | Hauptthread | 4 | 1,95 ms | 3,22 ms | 0,57 ms |
| Chromium | Worker | 1 | 1,57 ms | 3,07 ms | 0,51 ms |
| Chromium | Worker | 4 | 1,77 ms | 3,31 ms | 0,52 ms |
| Firefox | Hauptthread | 1 | 3,76 ms | 4,92 ms | 1,60 ms |
| Firefox | Hauptthread | 4 | 3,76 ms | 5,68 ms | 1,65 ms |
| Firefox | Worker | 1 | 3,84 ms | 5,26 ms | 1,90 ms |
| Firefox | Worker | 4 | 4,00 ms | 5,30 ms | 1,76 ms |

- Der Worker rechnet so schnell wie der Hauptthread; die Unterschiede liegen im Rauschen zwischen den Läufen.
- Die Zahlen sind ohne Darstellung: jeder Aufruf an die Engine ist ein No-op. E57 hat im Spiel 2,8 ms je Sub-Step
  gemessen, mit den echten Renderer- und Audio-Aufrufen. Genau diese Aufrufe fielen im Worker weg (siehe unten).
- Firefox braucht rund das Doppelte von Chromium. Ein Gesamtlauf zeigte in Firefox einmal 38 bis 42 ms je Sub-Step
  und 38 s für die Nachrechnung; einzeln und im zweiten Gesamtlauf wieder 3,5 bis 4 ms. Die Ursache ist nicht
  geklärt, der Lauf ist verworfen.

**Was beim Laden im Worker bricht:** nichts. Das Bündel zieht Three.js, das echte `@angular/core` und die Manager mit
Audio- und VFX-Diensten; keines greift beim Laden auf DOM, WebGL oder Web Audio zu. Zur Laufzeit gab es keine Fehler,
keine verworfenen Promises. Einzige Anfrage nach außen: `BackgroundMusicService` lädt die Musik per `fetch`
(im Labor 404, im Worker relativ zum Bündel).

**Was die Simulation zur Laufzeit außerhalb anfasst** (`reach` im Labor: Engine und nicht gelieferte Dienste hinter
einem zählenden Proxy, die vier Wellen einmal). Das ist die Kopplungsliste für Stufe 2:

| Bereich | Aufrufe (Anzahl im Lauf) | Art |
|---|---|---|
| Koordinaten | `sync.geoToLocalSimpleInto` (2,3 Mio.), `getOrigin`, `geoToLocalSimple`, `localToGeo` | reine Rechnung, braucht die Simulation selbst: im Worker als eigene Instanz des Bezugsrahmens |
| Gelände | `getTerrainHeightAtGeo` (1783) | **liest zurück**: Spawn-Höhe aus den Tiles, wo das Routenraster nichts hat (`enemy.manager.ts`, E63 b); im Worker gibt es keine Tiles |
| Ton | `spatialAudio.rebalanceEnemyLoops` (je Sub-Step), `playAtGeo`, `registerSound`, `geoToLocalPosition`, `playGlobal`, `getListener`, `holdLoops`; Musik lädt per `fetch` | Meldung |
| Gegner | `enemies.create`, `remove`, `playDeathAnimation`, `setRenderType`, `clear`, `setFootstepListener`; `oozes.add`, `setFrame`, `collapse`, `remove` | Meldung |
| Geschosse | `projectiles.create`, `remove`, `trailStreaks.create`, `remove` | Meldung |
| Tower | `towers.create`, `setPartShown`, `setHoldFire`, `get` (1022, VFX und Ton lesen den Startpunkt der Rakete), `towerBadges`, `searchlights`, `tentacles.resetAllToIdle`, `flameBeams.stopBeam` (je Sub-Step), `lightningBolts` | Meldung; `get` liest für die Darstellung |
| Effekte | `effects.*` (Schadenszahl, Blut, Explosion, Brandfleck, Eis, Burst), `frostBursts`, `orbitalBeams`, `abilityMarkers`, `bloodMoon.setActive`, `triggerScreenShake`, `getCamera` (Abstand fürs Wackeln) | Meldung |
| Held | `hero.present`, `hero.setGround` | Meldung |
| Engine | `setTimescale` (je Bild), `setRenderingEnabled`, `getScene` (Debug-Anzeige des Rasters) | Meldung |
| Dienste ohne Lieferung | `GameStore.renderingEnabled`, `HQDamageService.initialize`, `WaveDebugService.setCurrentWaveGroups`; dazu injiziert, nicht aufgerufen: `UIStore`, `MarkerVisualizationService` | Stores und Anzeige |

Folgerung: Bis auf die Spawn-Höhe aus den Tiles liest die Simulation nichts von der Darstellung zurück; alles andere
sind Meldungen, die sich als Ereignisliste je Bild bündeln lassen. Die Mathe des Bezugsrahmens muss mit in den Worker.
`VfxService`, `AudioService` und `ScreenShakeService` hängen heute am Event-Bus der Simulation und gehören auf die
Hauptthread-Seite.

Nicht geprüft: eine echte Karte (Routen, Höhen und Tile-Fallback aus einem Weltpaket), der Coop-Pfad im Worker, und
ob die gestubbten Stores im Spiel Werte in die Simulation zurückgeben.

Das Labor (`tools/worker-sim`, `e2e/perf/worker-sim.ts`) ist am 2026-10-01 entfernt; abgelöst von `SimCore` und der
Lastmessung `e2e/perf/sim-load.ts`. Der Stand liegt in der Git-Historie (bis `ecebfe02`).

## Vorschlag

1. **Transport per `postMessage`** mit übertragenen Puffern: keine Header, keine Hosting-Frage, beide Browser.
   `SharedArrayBuffer` erst, wenn die Datenmenge es verlangt; die Header-Prüfung oben zeigt, dass es dann ginge.
   Die Desktop-App könnte die Header im `app://`-Handler selbst setzen.
2. **Was in den Worker geht:** die Simulation (`GameStateManager` mit den Managern, Wellenquelle, Lockstep-Uhr,
   Snapshots, Replay). **Was bleibt:** Three.js, Renderer, Audio, VFX, Stores und UI, Eingabe, Tile-Loader.
3. **Schnittstelle:**
   - Befehle wie heute über den Befehlsweg (`command:*`), per Nachricht in den Worker, dort zur nächsten
     Sub-Step-Grenze.
   - Je Bild ein Stand für den Renderer: Instanzdaten der Gegner, Geschosse, Tower als Puffer (wie die Demo).
   - Ereignisse, die Bild und Ton auslösen (Treffer, Tod, Schüsse, Fähigkeiten) und die Stores füllen, gebündelt je Bild
     als Liste. Heute hören Renderer, Audio und Stores den Event-Bus direkt.
   - Sichtlinien: die Masken rechnet die GPU im Hauptthread (Würfel-Renders, `docs/LOS_PIPELINE.md`). Der Worker fragt
     sie an und bekommt sie als Daten; das gibt es schon (`registerTowerFromMask`, `applyCoopLosMask`).
4. **Kopplung heute** (Suche nach `tilesEngine` und `three` in `src/app/managers`): 15 Dateien, davon fünf Audio, dazu
   `enemy.manager.ts`, `projectile.manager.ts`, `tower.manager.ts`, `game-state.manager.ts`, Ooze und Wurm. Diese
   Stellen müssen ihre Darstellung über Ereignisse oder den Stand-Puffer abgeben statt Three.js direkt anzufassen.
5. **Aufwand:** grob 2 bis 4 Wochen (Schätzung aus E57). Reihenfolge: Darstellung aus den Managern lösen (auch ohne
   Worker nützlich, testbar im Hauptthread), dann Stand-Puffer und Ereignisliste, dann Umzug in den Worker hinter einem
   Schalter, messen gegen E57.

## Entschiedene Fragen

- Der Umbau lohnt sich schon jetzt: gebaut 2026-09-29 (Branch `simu-worker`, [SIM_WORKER.md](SIM_WORKER.md)).
- Der Coop-Websocket bleibt im Hauptthread; der Worker bekommt die gelieferten Ticks über einen `LockstepLink`.
- Transport: Tabellen im `SharedArrayBuffer` statt `postMessage` allein, mit COOP/COEP-Headern; ohne Isolation
  dieselbe Form mit Kopien je Bild.
