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
3. **Autosave:** ein eigener Autosave-Platz nach jeder Welle, dazu mehrere Plätze per Knopf. Der Startbildschirm bietet
   „Continue“ an, wenn ein Autosave da ist.
4. **Ältere Spielversion:** laden mit Hinweis wie beim Replay („saved with version X, values may differ“); nur bei
   inkompatiblem Format ablehnen.
5. **Coop:** vorerst nur Einzelspiel, im Coop ist Speichern ausgeblendet. Das Format bleibt so, dass der Host es später
   als Raum-Start verteilen kann.
6. **Menü:** dazu kommen Restart am selben Ort (mit Rückfrage), getrennte Regler für Effekte, Musik und UI,
   Grafikqualität und Spieltempo, Run-Log und Replay exportieren (heute nur am Game-Over-Bildschirm).
