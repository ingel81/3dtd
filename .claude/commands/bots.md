Starte, überwache und steuere Bot-Läufe (Wave-Director gegen einen Bot in DevWorld).

Argumente (optional, `$ARGUMENTS`):
- `start`     — kompletten Stack hochfahren und Läufe starten (Default)
- `start N`   — mit N Bot-Tabs (Default 4, sinnvoll 1-8)
- `status`    — nur Zustand berichten, nichts starten
- `watch`     — Status berichten und in Intervallen weiter beobachten
- `stop`      — Läufe pausieren (Bot aus, Tempo 1)
- `render on|off` — 3D-Rendering in allen Bot-Tabs zu-/abschalten
- `speed N`   — Spieltempo setzen (1/4/10/25/50/75)

## Stack

| Teil | Kommando | Port |
|---|---|---|
| Angular Dev-Server | `npm start` | 4200 |
| Bot-Server (WS) | `bot-server/venv/Scripts/python.exe manage_server.py start` | 3001 |
| Dashboard (FastAPI) | läuft im selben Prozess wie der Server | 3002 |
| Bot-Tab | `http://localhost:4200/?devworld` | — |

Der Server startet **paused**. Clients verbinden sich, gehen automatisch
headless (`renderingEnabled=false`) und warten auf `start`.

Der Server plant keine Wellen. Das macht der Wave Director im Client
([WAVE_DIRECTOR.md](../../docs/WAVE_DIRECTOR.md)); der Server ist Transport,
Log und Fernbedienung.

## Ablauf `start`

1. Zustand prüfen: läuft schon was auf 3001/3002/4200? (`manage_server.py status`)
   Bereits laufende Teile nicht doppelt starten.
2. Bot-Server starten (Hintergrund), auf Port 3001 warten.
3. Angular-Dev-Server starten (Hintergrund), auf Port 4200 warten.
4. N Chrome-Tabs auf `http://localhost:4200/?devworld` öffnen
   (Chrome-Automation-Tools, `tabs_create_mcp`). Der User soll die Tabs sehen —
   nicht minimieren, nicht schließen.
5. Dashboard-Tab auf `http://localhost:3002` öffnen und dem User den Link nennen.
6. Warten bis alle Clients verbunden sind (`GET http://localhost:3002/api/status`
   → `clientCount`).
7. Läufe starten: `POST http://localhost:3002/api/control/start`.
8. Bestätigen: `clientCount`, `runState`, Tempo.

## Überwachung

Datenquellen (keine Log-Datei tailen, die Transkripte sind riesig):
- `GET http://localhost:3002/api/status` — `runState`, `clientCount`,
  `runsFinished`, `runsPerHour`, `wavesPerHour`, je Client Welle, lebende
  Gegner, Phase, beste Welle, dazu `errors` und der Pfad der JSONL-Datei.

Bericht an den User pro Check (kurz halten):
- Läufe je Stunde und Wellen je Stunde, Änderung seit dem letzten Check
- je Client: Welle, Phase, beste Welle
- Auffälligkeiten: Clients weg oder `stale`, Fehler in `errors`

Ein Fehlerbild, das von außen wie ein gesunder Lauf aussieht:

**Eingefrorene Tabs.** Chrome friert `requestAnimationFrame` in unsichtbaren
Tabs komplett ein. Der Status-Push läuft auf `setInterval` und meldet die
Clients weiter als gesund, während nichts mehr passiert. Symptom: Die Welle
steht still oder die Clients bleiben in `phase: setup`. Ein Heartbeat-Worker
treibt die Loop inzwischen auch versteckt (`three-tiles-engine.ts`), aber wenn
die Zähler stillstehen, ist das die erste Vermutung. Das Dashboard markiert
einen Client als `stale`, wenn länger als fünf Sekunden kein Status kam.

Wenn `watch`: nach jedem Bericht ein sinnvolles Intervall wählen (ein Lauf
dauert Minuten, nicht Sekunden) und weiter beobachten.

## Regeln

- Bot-Tabs bleiben sichtbar; Rendering nur auf Zuruf einschalten
  (`POST /api/control/set_rendering` mit `value=true`), da es die Laufrate
  stark drückt.
- `reload` schießt alle Tabs neu — nur wenn Clients hängen.
- Logs nicht ungefragt löschen.
- Keine Commits ohne Zuruf.
