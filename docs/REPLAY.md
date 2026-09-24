# Replay einer Welle

**Stand:** 2026-09-24 · Branch `simulator`

Jede fertige Welle des Laufs lässt sich noch einmal ansehen: freie Kamera, Pause, 0,25x bis 4x, Sprung an jede
Stelle, Wechsel zur vorigen und nächsten Welle, Speichern als Datei und Laden auf derselben Karte. Nach dem Replay
steht das Spiel genau so da wie vorher, die Kamera eingeschlossen.

Das Replay ist eine **Neu-Simulation**: Es rechnet die Welle aus dem Zustand bei ihrem Start und den Befehlen noch
einmal, mit den echten Renderern. Es zeigt deshalb alles, was das Spiel zeigt, weil es das Spiel ist: Schadenszahlen,
Gold, Sounds an Gegnern, Eis, Upgrades mitten in der Welle, Bosse. Grundlagen und Entscheidungen:
[SIMULATOR_PLAN.md](SIMULATOR_PLAN.md). Das frühere Präsentations-Replay (Aufnahme der Renderer-Zustände) ist
entfallen (D3).

---

## Aufbau

| Datei | Aufgabe |
|-------|---------|
| `simulator/sim-snapshot.ts` | `SimSnapshot`: die Simulation zwischen zwei Wellen als reine Daten |
| `simulator/sim-recorder.ts` | `SimRecorder` am `GameStateManager`: je Welle Snapshot, Konfiguration, Einstieg in den Befehlslog, Prüfsummen |
| `simulator/state-hash.ts` | `StateHasher`: Prüfsumme über die Bits des Zustands |
| `simulator/resimulation.ts` | `Resimulation`: eine Welle aus Snapshot und Log nachrechnen, Prüfsummen vergleichen |
| `simulator/replay-session.ts` | `ReplaySession`: Live-Stand sichern, Welle abspielen und springen, Live-Stand zurück |
| `simulator/replay-file.ts` | Datei zum Speichern und Laden |
| `managers/game-state/command-log.ts` | `CommandLog`: jeder Befehl und jede Sichtlinien-Maske mit dem Sub-Step, an dem sie wirkten |
| `services/replay.service.ts` | Replay-Modus: HUD aus, Spiel pausiert, Kamera sichern, Wellenwahl, Datei |
| `components/replay-bar/` | Die Leiste unten mittig |
| `replay/replay-bar-view.ts` | Befehls-Marken und Zeitformat der Leiste |

## Aufnahme

Beim Start einer Welle mit Spawn-Plan (`startWave(config)`, der Weg jedes `command:start-wave` mit Konfiguration)
nimmt der `GameStateManager` einen Snapshot (`captureSnapshot`), bevor die Welle etwas ändert. Eine manuelle
Debug-Welle ohne Plan (`beginWave`) wird nicht aufgezeichnet. Im Snapshot stehen Uhr, Zufallsstand, Id-Zähler,
Credits, HQ-Leben, Wellennummer, Forschung, Fähigkeiten, Held, Tower (Upgrades, Zustand, Drehung, Sicht-Maske),
bemannter Tower, Warteschlange der Luft-Nachrüstung. Das sind einige KB,
bei 60 Towern einige zehn KB (die Sicht-Maske eines Towers als Base64 130 bis 1000 B).
Der Held wird dabei auf einen frisch geplanten Pfad gesetzt, derselbe, den das Laden plant.

Ein Snapshot geht nur, wenn nichts unterwegs ist (`snapshotRefusal`): keine Gegner, keine Projektile, kein offener
Schlag einer Fähigkeit, kein Event, das noch auf den nächsten Sub-Step wartet. Sonst bleibt die Welle ohne Snapshot
und ist nicht abspielbar. Cheats, die am Befehlslog vorbei Gegner setzen, entfernen oder töten
(`debug:spawn-enemy`, `debug:remove-enemy`, `debug:kill-all`), markieren die laufende Welle ebenso.

Während der Welle schreibt der `CommandLog` jeden Befehl und jede Sichtlinien-Maske (`tower:los-resolved`) mit ihrem
Sub-Step mit. Der Recorder nimmt jede Spielsekunde (60 Sub-Steps) eine Prüfsumme, am Beginn des Sub-Steps, wenn alle
Eingaben der Grenze davor durch sind. Kosten: 0,05 / 0,16 / 0,51 ms je Prüfsumme bei 200 / 1000 / 3000 Gegnern,
unter 0,01 ms je Sub-Step.

## Wiedergabe

`ReplayService.enter()` blendet die Spiel-UI aus (Bau, Platzierung, Zielmarker, Auswahl, Veteranen-Abzeichen),
merkt sich Kamera, Pause, Menü und Fokus und pausiert das Spiel. Kommt der Klick direkt nach einer Welle, während
noch Schüsse fliegen, wartet es bis zu 5 s auf ein ruhiges Feld. Dann übernimmt eine `ReplaySession`:

- **Betreten:** Snapshot des Live-Stands, Replay-Modus an, Snapshot der Welle laden, Welle mit ihrer Konfiguration
  starten.
- **Replay-Modus:** Befehle kommen nur aus dem Log, Befehle vom Bus werden verworfen; Sicht-Masken für Bau und Upgrade
  kommen aus dem Log statt von der GPU, die Luft-Nachrüstung zum aufgezeichneten Sub-Step; das Nachrechnen schreibt
  einen eigenen Log. Alles, was den Lauf festhält oder die Live-UI spiegelt, hört nicht mit (`GameEventBus.onLive`):
  Run-Log, Director-Historie, Stores, Bestwelle, Bot, Boss-Intro, Hinweise, Boss-Leiste, Leck-Vignette, Portale.
  Auto-Start-Countdown und Run-Log-Stichprobe, die je Frame die Uhr lesen, ruhen ebenso
  (`GameStateManager.isReplaying`).
- **Abspielen:** Je Frame rückt die Simulation um Tempo mal Frame-Zeit vor, höchstens `GameClock.MAX_CATCHUP_MS`
  wie die Spieluhr, und die Renderer bekommen den Stand (`presentReplayFrame`). Die Renderer-Uhr folgt dem Tempo.
- **Springen:** Ohne Rendering und ohne Show (`GameEventBus.onShow`: VFX, Sounds, Musik, Screen-Shake, Blutmond) bis
  zum Ziel rechnen, rückwärts ab Wellenstart. Eine mittlere Welle (10 800 Sub-Steps) braucht rund 0,6 s.
- **Verlassen:** Den Live-Snapshot laden, solange der Replay-Modus noch an ist, dann aus. Das Laden leert die
  Warteschlange der verzögerten Events, damit das `wave:completed` der nachgerechneten Welle nicht im Live-Spiel
  ankommt. Die Stores haben während des ganzen Replays nichts gehört und stehen danach auf dem Live-Stand.
- **Bild und Ton nach jedem Laden und Springen:** Ein Laden oder Springen ändert den Zustand ohne die Events, die sonst
  Bild und Ton mitbringen. Deshalb räumt `GameStateManager.clearShow()` vorher ab (Partikel, Bodenmarken,
  Schadenszahlen, Schlag-Effekte der Fähigkeiten und deren Sounds, einmalige Sounds; die Loops bleiben bei ihren
  Gegnern und Towern), und `resyncPresentation()` baut danach auf, was der Stand zeigt: Glut der Feuer-Tower, HQ-Feuer,
  Status-Auren der Gegner, Musik und Blutmond der Phase, die Rakete im Silo. Feuerpause und Reichweitenring eines
  Towers setzt der Tower-Renderer auch dann, wenn sein Modell erst nach dem Laden kommt; ein Modell für einen Tower,
  der inzwischen wieder weg ist, verwirft er. Zustands-Events eines Ladens tragen `restored` und klingen nicht
  (kein Glöckchen für eine Ladung, kein Geräusch des Helden).
- **Bemannter Tower:** Vor dem Replay steigt der Spieler aus; nach dem Replay steht er draußen.

Weicht eine Prüfsumme beim Nachrechnen vom Live-Lauf ab, zeigt die Leiste „differs from m:ss“. Das ist ein
Determinismus-Bug: bitte mit der Replay-Datei melden.

### Bedienung

| Eingabe | Wirkung |
|---------|---------|
| „replay W12“ im WAVE-Panel (zwischen den Wellen) oder „Replay wave N“ auf dem Game-Over-Screen | Replay der neuesten Welle starten |
| Pfeile neben „Wave N“ in der Leiste | Vorige oder nächste abspielbare Welle |
| Leertaste, P, Play-Knopf | Pause und weiter; am Ende startet Play von vorn |
| + / - , Geschwindigkeitsknöpfe | 0,25x, 0,5x, 1x, 2x, 4x |
| Fortschrittsbalken | Springen; beim Ziehen hält das Replay an. Marken zeigen Befehle des Spielers (ohne Zielen und Sichtlinien) |
| Save in der Leiste | Alle abspielbaren Wellen des Laufs als Datei |
| load im WAVE-Panel | Eine Datei laden; nur auf derselben Karte und mit denselben Balance-Werten |
| Maus, WASD, Pos1, N | Kamera wie im Spiel |
| Esc, Exit | Zurück ins Spiel |

`REPLAY_CONFIG.offered` schaltet die Einstiege. Auf dem Branch `simulator` ist es für den Playtest an.

## Datei

`simulator/replay-file.ts`: Format und Version, Snapshot-Version, Welt-Schlüssel (`GameStateManager.worldKey`:
Zellhöhen, Routen, Ursprung), Balance-Hash (`run-log/config-hash.ts`), Seed, die abspielbaren Wellen und der Ausschnitt
des Befehlslogs, den sie brauchen. Die Welt selbst steht nicht darin: Ein Replay rechnet auf der Welt nach, auf der es
gespielt wurde. Abgelehnt wird mit einem Satz, warum: keine Replay-Datei, andere Version, andere Karte, andere
Balance, keine Welle. Ein geladenes Replay zeigt „from file“ in der Leiste; der laufende Lauf bleibt unberührt.
Die Datei trägt auch Spielversion und Commit: Der Balance-Hash deckt die Tabellen ab, nicht den Code. Eine Datei
einer anderen Version lädt trotzdem, die Leiste sagt dann „from file, other version“ (Tooltip: gespeichert mit
welcher Version), weil das Replay dort abweichen kann, wo sich die Spiellogik geändert hat.

Das ist zugleich das Match-Log für Coop ([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md), Abschnitt 18): Welt,
Balance, Seed, Eingaben mit Sub-Step und Sicht-Masken, jeder Eintrag mit `playerId`.

## Was das Replay nicht zeigt

- Beim Springen die Sounds, Effekte, Bodenmarken und Schadenszahlen der übersprungenen Strecke; was bei der Ankunft
  auf dem Feld steht, zeigt es
- Die Bodenmarken des Live-Spiels vor dem Replay: Sie sind nach dem Verlassen weg
- Den bemannten Tower nach dem Verlassen: Der Spieler steigt vor dem Replay aus
- Die Ringe des Helden (Auswahl, Posten, Laufziel): Er ist im Replay nicht auswählbar
- Die Spiel-UI (HUD, Boss-Leiste, Leck-Vignette); die Leiste zeigt HQ-Leben und Gegner auf der Route

## Grenzen

- Eine Welle, bei deren Start noch etwas unterwegs war, oder mit Cheats am Log vorbei, ist nicht abspielbar
- Bit-gleich gilt auf demselben Rechner und Browser. Über Browser hinweg können `Math.sin`, `cos` und `atan2`
  abweichen ([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md), 2.4); eine Datei von einem anderen Rechner kann dann
  „differs from“ zeigen
- Eine Datei gilt nur für die Karte, deren Zellhöhen beim Laden dieselben sind: Nach einer Änderung am Korridorbau
  passen alte Dateien nicht mehr

## Tests

| Spec | Prüft |
|------|-------|
| `integration/resimulation.scenario.spec.ts` | Abnahme: Welle mit Befehlen mittendrin bit-genau nachgerechnet; Zurückspringen; Live-Stand zurück; nach einem Replay laufen die nächsten 120 Sub-Steps wie ohne; Ooze, Wurm, Skelette; Würmer auf zwei Routen aus einer Datei in einer frischen Sitzung; Datei in einem frischen Spiel; fremde Welt und Balance abgelehnt |
| `simulator/state-hash.spec.ts` | Prüfsumme: letzte Bits, Reihenfolge, Cooldown |
| `utils/game-rng.spec.ts` | Zufallsstand lesen und setzen, Ströme überleben einen Reset |
| `managers/hero.manager.spec.ts`, `ability.manager.spec.ts` | Sichern und Laden des Helden und der Fähigkeiten |
| `entities/tower.entity.spec.ts` | Upgrade-Stufen wiederherstellen (den übrigen Tower-Zustand prüft die Abnahme) |
| `managers/game-state/command-log.spec.ts` | Befehlslog |
| `replay/replay-bar-view.spec.ts` | Marken, Zeitformat |
| `services/replay.service.spec.ts` | Einstieg: Boss-Intro, Welle vorhanden, Phase |
| `game-engine/game-event-bus.spec.ts` | `onLive` |
| `integration/sim-step.perf.spec.ts` | Benchmark (`npm run bench:sim`): Sub-Step, Vorspulen, Prüfsumme |
