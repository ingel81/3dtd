# Simulation in einem Worker (Konzept, TODO E57)

Stand 2026-09-29: Konzept und Demo, nichts im Spiel gebaut. Zahlen aus der Demo (`tools/worker-demo`,
`e2e/perf/worker-demo.ts`), einem Stellvertreter der Simulation, nicht aus dem Spiel.

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

## Offene Fragen

- Lohnt der Umbau, bevor es Spieler mit schwachen Rechnern im Spätspiel gibt? Die Messung gilt für 5000 Gegner bei
  Tempo 4.
- Soll der Coop-Websocket im Hauptthread bleiben und Befehle weiterreichen, oder mit in den Worker?
