# Speichern und Laden, Menü

Stand 2026-10-05, **Plan entschieden, im Bau**. Eintrag in [TODO.md](../TODO.md): E110 (Speichern und Laden im
Einzelspiel), E111 (Menü vervollständigen). Die Fragen unten hat der User am 2026-10-05 beantwortet.

## Ziel

Im Einzelspiel einen Lauf über das Spielmenü speichern und später am selben Ort weiterspielen. Das Menü bekommt dabei
die Punkte, die ein Spielmenü erwartet.

## Was es schon gibt

- **`SimSnapshot`** (`simulator/sim-snapshot.ts`): die Simulation zwischen zwei Wellen als einfache Daten, wenige KB:
  Tower, Forschung, Fähigkeiten, Held, Gold, HP, Uhr, Zufallsströme, Id-Zähler. Das Spiel nimmt ihn bei jedem
  Wellenstart (`GameStateManager.captureSnapshot`), Replays starten daraus.
- **`WaveSnapshot`** (`simulator/wave-snapshot.ts`): dazu alles, was nur während einer Welle lebt; bitgenau
  fortsetzbar (`captureWaveSnapshot`, `restoreWaveSnapshot`). Nicht darin: Gegner aus dem Debugger.
- **Weltpaket** des Coop (`coop/`): Zellen, Höhen und Routen, wie der Host sie dem Gast schickt.
- **Replay-Datei** (`simulator/replay-file.ts`): Format mit Version, `worldKey`, Config-Hash, Spielversion und
  Prüfung beim Laden; Vorlage für Kopf und Ablehnungsgründe.

## Was fehlt

- **Welt:** Ein Snapshot gilt nur auf der Welt, auf der er entstand (`worldKey`). Lädt man denselben Ort neu, misst
  das Spiel Höhen und Zellen wieder aus den Tiles; der Schlüssel kann abweichen. Ein Spielstand trägt darum Ort,
  Spawns und das Weltpaket mit und baut die Welt daraus statt aus den Tiles.
- **Hauptthread:** der Strom `director` des Wellenplaners und was der Budget-Quelle sonst gehört (Regler, Laufplan).
- **Run-Log:** nach dem Laden weiterschreiben statt neu beginnen.
- **Darstellung:** Modelle, Sichtlinien-Masken und Bauzustand aus dem geladenen Stand.

## Entschieden (User, 2026-10-05)

1. **Wann:** nur zwischen den Wellen (`SimSnapshot`). Während einer Welle ist Speichern gesperrt.
2. **Wohin:** beides. Feste Plätze im Browser (IndexedDB), dazu Export und Import als Datei, Format nach dem Vorbild
   der Replay-Datei (Kopf mit Version, `worldKey`, Config-Hash, Spielversion).
3. **Autosave:** ein eigener Autosave-Platz nach jeder Welle, dazu mehrere Plätze per Knopf. „Continue“ steht oben im
   Hauptmenü, solange der neue Lauf nicht begonnen hat; hinter dem Start-Menü lädt schon der Ort des Autosaves, und
   ein Autosave an einem anderen Ort fragt erst („Leaves Heilbronn“, E120; [MAIN_MENU_UI_PLAN.md](MAIN_MENU_UI_PLAN.md)).
4. **Ältere Spielversion:** laden mit Hinweis wie beim Replay („saved with version X, values may differ“); nur bei
   inkompatiblem Format ablehnen.
5. **Coop:** vorerst nur Einzelspiel, im Coop ist Speichern ausgeblendet. Das Format bleibt so, dass der Host es später
   als Raum-Start verteilen kann.
6. **Menü:** dazu kommen Restart am selben Ort (mit Rückfrage), getrennte Regler für Effekte, Musik und UI,
   Grafikqualität und Spieltempo, Run-Log und Replay exportieren (heute nur am Game-Over-Bildschirm).

## Gebaut (2026-10-05, E110 Kern)

- **Port** `services/save-game/save-game.port.ts`: `SAVE_GAME` mit `canSave`, `cannotSaveReason`, `slots`,
  `hasAutosave`, `startPlace`, `save`, `load`, `deleteSlot`, `exportFile`, `importFile`, `continueAutosave`. Im
  Spiel stellt `TowerDefenseComponent` den `SaveGameService` dahinter, außerhalb bleibt der Stub.
- **Format** `simulator/save-file.ts` (`3dtd-save`, Version 1): Kopf wie die Replay-Datei, dazu Ort (Name, HQ,
  Spawns), Weltpaket, `SimSnapshot`, Director (Quelle, deren Zustand, die zugesagte Welle), `SimMirror.rng`, Run-Log
  und Kurvenpunkte. Andere Spielversion oder andere Werte laden mit Hinweis, abgelehnt werden nur anderes Format,
  andere Snapshot-Form oder eine beschädigte Datei. Export als gzip (`3dtd-save-<ort>-w<welle>.json.gz`).
- **Plätze** in IndexedDB (`3dtd-saves`, Kopf und Text getrennt): `autosave` nach jeder Welle, sobald die
  Simulation ruht (`snapshotRefusal` leer, höchstens 10 s), dazu `slot-1` bis `slot-5`.
- **Speichern** nur zwischen den Wellen, nicht im Coop, nicht im Replay, nicht in DevWorld, nicht nach Game Over.
- **Laden:** Ort wie beim Coop-Gast (`WorldPackageLoader`, aus `CoopService` herausgezogen), dann Routen, Zellen und
  Höhen des Spielstands statt der gemessenen, Weltschlüssel muss passen; danach `restoreSnapshot` im Worker und, wenn
  das Paket mit `sim:restored` da ist, Director, Zufallsquelle und Run-Log (`RunLogCollector.resume`, gleiche
  `runId`). Ohne Ort (Start) startet die Engine am Ort des Spielstands (`startPlace`, vom Spiel übernommen).
- **Prüfung:** `integration/save-resume.scenario.spec.ts` speichert zwischen zwei Wellen, baut eine frische
  Simulation aus dem Weltpaket auf Boden ohne Werte und spielt die nächste Welle mit denselben Befehlen: jede
  Prüfsumme gleich dem ununterbrochenen Lauf.
- **Nach dem Review (2026-10-05):** Der Save nimmt den Snapshot exakt (der Held behält seinen Weg, ein Save ändert
  den Lauf nicht) und liest Director, Run-Log und Zufallsquelle vor der Antwort des Workers. Kein Save, solange ein
  Tower seine Sichtlinie misst („A tower is still measuring its line of sight.“, `SimScalars.losAwaiting`).
  `readSaveFile` prüft den Snapshot so tief, wie der Restore ihn liest, dazu den Quellzustand
  (`WaveSource.validState`) und die Zufallsströme; Dateien höchstens 32 MB, gepackt wie entpackt. Das Laden wartet
  immer, bis der Ort steht, setzt die Quelle des Spielstands vor `adopt` (`useSourceNextRun`, damit auch der Worker
  ihre Regeln spielt), und ein Restore, der mittendrin scheitert, hinterlässt einen sauberen frischen Lauf mit Meldung.
  IndexedDB: Öffnen gibt nach 5 s auf, `versionchange` schließt die Verbindung, ein unlesbarer Platz heißt nicht leer.

Offen: die Menü-Oberfläche (Plätze, Export, Import, „Continue“ im Startbildschirm, Rückfrage vor dem Laden über
einen laufenden Lauf) baut der Menü-Worker; ein Lauf im Browser mit echter Karte steht aus. Replays der Wellen vor
dem Laden gibt es nach dem Laden nicht (die Aufzeichnung beginnt neu).
