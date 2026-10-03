# Speichern und Laden, Menü

Stand 2026-10-03, **Plan, nicht gebaut**. Eintrag in [TODO.md](../TODO.md): E110 (Speichern und Laden im
Einzelspiel), E111 (Menü vervollständigen). Gebaut wird nach dem Release 0.6; die offenen Fragen unten gehen vorher
einzeln per AUQ an den User.

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

## Offene Fragen (AUQ, einzeln)

1. Wann speichern: nur zwischen den Wellen (`SimSnapshot`, klein, ein Weg) oder auch mitten in der Welle
   (`WaveSnapshot`)?
2. Wohin: feste Plätze im Browser (IndexedDB), eine Datei zum Herunterladen, oder beides?
3. Automatisch speichern, etwa nach jeder Welle, oder nur auf Knopfdruck?
4. Spielstand einer älteren Spielversion: ablehnen, oder laden mit Hinweis wie beim Replay?
5. Coop: aus, oder später der Host?
6. Menü (E111): welche Punkte kommen dazu? Kandidaten: Weiterspielen oben, Neustart am selben Ort, Speichern und
   Laden, getrennte Regler für Effekte, Musik und UI (intern schon da), Grafikqualität, Spieltempo, Run-Log und
   Replay exportieren (heute nur am Game-Over-Bildschirm).
