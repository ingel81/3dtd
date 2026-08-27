Starte, überwache und steuere den AI-Training-Run (Wave-Director PPO).

Argumente (optional, `$ARGUMENTS`):
- `start`     — kompletten Stack hochfahren und Training starten (Default)
- `start N`   — mit N Trainings-Tabs (Default 4, sinnvoll 1-8)
- `fresh`     — From-Scratch: Checkpoints archivieren, dann `start`
- `status`    — nur Zustand berichten, nichts starten
- `watch`     — Status berichten und in Intervallen weiter beobachten
- `stop`      — Training pausieren (Bot aus, Timescale 1)
- `render on|off` — 3D-Rendering in allen Trainings-Tabs zu-/abschalten
- `speed N`   — Timescale setzen (1/4/10/25/50/75)
- `export`    — bestes/neuestes Checkpoint nach ONNX exportieren

## Stack

| Teil | Kommando | Port |
|---|---|---|
| Angular Dev-Server | `npm start` | 4200 |
| Training-Backend (WS) | `training-backend/venv/Scripts/python.exe manage_server.py start` | 3001 |
| Dashboard (FastAPI) | läuft im selben Prozess wie das Backend | 3002 |
| Trainings-Tab | `http://localhost:4200/?devworld` | — |

Das Backend startet **paused**. Clients verbinden sich, gehen automatisch
headless (`renderingEnabled=false`) und warten auf `start`.

## Ablauf `start`

1. Zustand prüfen: läuft schon was auf 3001/3002/4200? (`manage_server.py status`)
   Bereits laufende Teile nicht doppelt starten.
2. Backend starten (Hintergrund), auf Port 3001 warten.
3. Angular-Dev-Server starten (Hintergrund), auf Port 4200 warten.
4. N Chrome-Tabs auf `http://localhost:4200/?devworld` öffnen
   (Chrome-Automation-Tools, `tabs_create_mcp`). Der User soll die Tabs sehen —
   nicht minimieren, nicht schließen.
5. Dashboard-Tab auf `http://localhost:3002` öffnen und dem User den Link nennen.
6. Warten bis alle Clients verbunden sind (`GET http://localhost:3002/api/stats`
   → `clientCount`).
7. Training starten: `POST http://localhost:3002/api/control/start`.
8. Bestätigen: `clientCount`, `trainingState`, Timescale.

## Ablauf `fresh`

Vor `start`:
1. Dem User sagen, wie viele Checkpoints betroffen sind und wohin sie wandern.
2. `training-backend/checkpoints/*.pt` nach
   `training-backend/checkpoints/archive-<YYYY-MM-DD>/` verschieben
   (verschieben, nicht löschen).
3. Verifizieren, dass `checkpoints/` keine `.pt` auf oberster Ebene mehr enthält.
4. Dann normaler `start`-Ablauf. Das Backend startet dann bei Episode 0.

## Überwachung

Datenquellen (keine Log-Datei tailen, die Transkripte sind riesig):
- `GET http://localhost:3002/api/stats` — episode, avgReward, bestReward,
  gamesPlayed, clientCount, trainingState, gameOverRate, templateUsageCounts,
  modelMetrics und die v4-Kennzahlen:
  - `nearMissBandPct` / `avgNearMissRatio` — **Leitmetrik.** Anteil der Gegner
    über 80 % Pfad, Ziel 0,25. Das ist die Größe, auf der DRAMA rechnet.
  - `hpCurveError` — Abweichung der Spieler-HP von der Ziel-Zerfallskurve.
    Positiv = Spieler zu gesund, die AI greift zu wenig an (v3-Kollaps).
    Negativ = Runs enden zu früh.
  - `avgDamagePct` / `damageSweetPct` — tatsächlicher HP-Verlust pro Wave.
  - `sweetSpotPct` heißt nach dem Reward-Sweet-Spot, misst aber den **mittleren
    Pfad-Progress** — nicht die Größe, auf der der Reward rechnet. Nicht als
    Leitmetrik verwenden.
- `GET http://localhost:3002/api/clients/summary` — pro Client avgReward50 /
  avgProgress50 / avgDamage50
- `training-backend/venv/Scripts/python.exe inspect_training.py --summary`
- `training-backend/venv/Scripts/python.exe scripts/analyze_log.py`

Bericht an den User pro Check (kurz halten):
- Episode-Zähler + Änderung seit letztem Check
- avgReward-Trend, bestReward
- Game-Over-Rate, `nearMissBandPct`, `hpCurveError`
- Template-Verteilung: kollabiert die AI auf wenige Templates?
- Auffälligkeiten: Clients abgestürzt, Reward stagniert/NaN, Entropy → 0

Zwei Fehlerbilder, die von außen wie ein gesunder Lauf aussehen:

1. **Eingefrorene Tabs.** Chrome friert `requestAnimationFrame` in unsichtbaren
   Tabs komplett ein. Der Status-Push läuft auf `setInterval` und meldet die
   Clients weiter als gesund, während nichts mehr passiert. Symptom: `episode`
   steht still, `clientStatuses` bleiben in `phase: setup` oder auf derselben
   Wave. Ein Heartbeat-Worker treibt die Loop inzwischen auch versteckt
   (`three-tiles-engine.ts`), aber wenn der Zähler stillsteht, ist das die
   erste Vermutung.
2. **Passivitäts-Kollaps.** `avgNearMissRatio` gegen 0 und `hpCurveError` klar
   positiv heißt: die AI schickt harmlose Waves, weil Risiko sich nicht lohnt.
   Das war das v3-Versagen; `avgReward` kann dabei *steigen*.

Wenn `watch`: nach jedem Bericht ein sinnvolles Intervall wählen (Training
bewegt sich langsam — 10-20 min sind normal) und weiter beobachten.

## Regeln

- Ohne ausdrückliche Ansage keine Checkpoints löschen — nur archivieren.
- Trainings-Tabs bleiben sichtbar; Rendering nur auf Zuruf einschalten
  (`POST /api/control/set_rendering` mit `value=true`), da es die Trainingsrate
  stark drückt.
- `reload` schießt alle Tabs neu — nur wenn Clients hängen.
- Keine Commits ohne Zuruf.
