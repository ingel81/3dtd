# End-to-End-Tests

Das laufende Dev-Spiel von außen im Browser prüfen: echte Karte, echter Relay, zwei Spieler. Ergänzt die Vitest-Specs
(`npm test`), die Logik ohne Browser prüfen. Stand 2026-09-25.

## Ausführen

```bash
npm start           # Dev-Server, in einem eigenen Terminal; die Tests starten ihn nicht
npm run e2e         # alle Tests, sichtbare Fenster
npm run e2e:report  # HTML-Bericht mit Screenshots und Relay-Log je Test
```

Einmalig: `npm install` in `e2e/` und `npm run setup` dort (Chromium von Playwright). Ein einzelner Test:
`npm run e2e -- tests/coop-lobby.e2e.ts` oder `npm run e2e -- -g "pause off"`. Zum Zusehen `SLOWMO=300 npm run e2e`.
Ein ganzer Lauf dauert rund eine halbe Stunde; das meiste ist das Laden der Karte und Warten auf Wellen.

Kein Relay darf auf Port 3003 laufen: jeder Test startet seinen eigenen (`npm run coop-server`, bei Bedarf
`--no-cheats`) und stoppt ihn danach.

## Kartensitzungen

Die Tile-Anbieter zählen jedes Laden des Tilesets als Sitzung, das freie Kontingent ist begrenzt (User, 2026-09-25).
Darum öffnet ein Lauf die beiden Spieler Ann (Host) und Bob (Gast) nur einmal (`duo` in `support/fixtures.ts`); jeder
Test spielt mit ihnen: Raum im Dock öffnen, Beitritt per Code ohne Neuladen, danach verlassen beide den Raum. Ein
Ortswechsel im Spiel (Würfel) behält das Tileset. Neu geladen wird nur, wo es der Test braucht: der Beitritt per
Einladungslink (D47). Der Gast, der dem Host an einen neuen Ort folgt (T65), wechselt seit 2026-09-25 ohne Neuladen.
Ein Lauf kostet so **3 Sitzungen**;
scheitert ein Test, startet Playwright den Worker neu, und die zwei Spieler laden noch einmal.

## Aufbau

| Datei | Inhalt |
|-------|--------|
| `e2e/playwright.config.ts` | Ein Worker, sichtbar (die Tiles brauchen eine GPU), 15 min je Test, Bericht |
| `e2e/support/fixtures.ts` | `test` mit `duo` (Ann, Bob, einmal je Lauf) und `relay` je Test; `expectNoDesync` |
| `e2e/support/game.ts` | Spiel öffnen und warten, Coop-Raum, Optionen, Entwicklermenü, Credits, Wellen-Knopf, Seite einfrieren |
| `e2e/tests/coop-lobby.e2e.ts` | Einstieg, Gast kommt und lädt (D47), Name und Optionen, Rauswerfen und Sperren, neuer Ort (T65), `&nokey` |
| `e2e/tests/coop-options.e2e.ts` | Cheats, Pause und Next wave nach den Raum-Optionen, Relay ohne Cheats |
| `e2e/tests/coop-game.e2e.ts` | Squad und Chat, Gold senden, zurückgefallener Gast (eingefroren), Game over und Neustart, allein weiter |
| `e2e/tests/solo.e2e.ts` | Rauchtest (Tower, Welle ohne Cheat auf 4x, Dialog, Replay), Druck-Regler nach neuem Ort (M5) |
| `e2e/tests/budget-source.e2e.ts` | Budget-Quelle auf echter Karte (`&waves=budget`, eine Kartensitzung): der Schalter bleibt in der Adresse, die Planung sieht Schaden unter Feuer über echten Sichtlinien |

Jeder Coop-Test mit Spiel prüft am Ende das Relay-Log auf `DESYNC`. Die Nummern (T.., M..) verweisen auf
[PLAYTEST.md](PLAYTEST.md).

## Fallen, die die Tests schon kennen

- Ein Klick auf etwas Verdecktes scheitert nach 30 s (`actionTimeout`), nicht erst am Ende des Tests.
- Was zwischen Finden und Lesen verschwinden kann (Fuß der Squad-Box, der Chat beim Ortswechsel), lesen die Helfer
  direkt aus dem DOM (`chatText`, `evaluate`), ohne zu warten.
- Nach jedem Test räumt `tidyUp` beide Seiten auf (Meldung oben, Raum, Dock, Entwicklermenü).
- HP auf 0 beendet den Lauf sofort; eine Welle mit Cheat (Kill all) bietet kein Replay an; Q öffnet die Forschung nur
  mit Research Center.
- Ein abgebrochener Lauf kann einen Relay auf 3003 hinterlassen; der Lauf bricht dann gleich zu Beginn mit Meldung ab.

## Was die Tests nicht können

Gefühl und Ton (Egoperspektive, Sound), ob etwas gut aussieht (die Screenshots im Bericht sind dafür da), Firefox,
ein echter zweiter Rechner, Hardware. Und alles, wofür beide Kameras dieselbe Stelle zeigen müssten (T51).

## Lastmessung (`e2e/perf/sim-load.ts`)

Kein Test, ein Messlauf: eine DevWorld-Szene mit Towern und vielen Gegnern im Produktions-Build, gemessen werden
Bilder pro Sekunde, langsamste 5 %, erreichtes Tempo, Ticks und Auslastung des Workers, Kosten je Paket. Einordnung und
Ergebnisse in [SIM_WORKER.md](SIM_WORKER.md#kennzahlen), das Vorhaben als Funktion im Spiel in TODO E74.

```bash
npm run build                                   # schreibt build-info.json: Version und Commit gehen in jedes Ergebnis
node e2e/perf/serve.mjs dist/3DTD/browser 4244 --isolate
node e2e/perf/sim-load.ts --url http://localhost:4244 --browser firefox --headed --enemies 5000 --speed 4
node e2e/perf/sim-load.ts --url http://localhost:4244 --browser chromium --headed   --steps 3000,5000,8000,12000,16000,20000,25000 --speeds 4,1 --machine A --dpr 1
```

- `--uncapped` misst Chromium ohne Bildratenbremse, sonst begrenzt der Monitor (144 Hz sind 144 FPS).
- Gegner haben 1 000 000 HP (`--hp`) und starten auf den ersten 70 % der Routen: keiner stirbt, keiner läuft durch.
- Vor jeder Messung pendelt der Lauf ein (mindestens 5 s, dann bis zwei 2-s-Fenster weniger als 5 % auseinander).
- Jedes Ergebnis nennt Rechner (`--machine`, nie den Hostnamen), CPU, Speicher, Browser, GPU und Pixeldichte. Firefox
  übernimmt sichtbar die Windows-Skalierung; `--dpr 1` setzt sie für beide Browser gleich.
- `--hide-enemies` misst jede Stufe ein zweites Mal ohne Gegner und Lebensbalken im Bild (Anteil der GPU).
- Der Vergleich mit `next` braucht dort denselben Handle `__load` als lokalen Patch nur für die Messung.

## Coop-Läufe mit Bots (`e2e/coop-bots/run.ts`)

Kein Test, ein Messwerkzeug (TODO E53): N headless Tabs eines statischen Dev-Builds in DevWorld
(`?devworld&spawns=N&bot=coop`), ein Raum auf einem lokalen Relay, ein Bot je Platz. Der Host öffnet den Raum im
Dock, die anderen treten per Code bei und melden bereit, der Host startet und stellt das Tempo (höchstens 4). Jeder
Bot spielt nur seine Lane, seine Tower und sein Gold (`bots/bot-world.ts`), seine Befehle gehen den normalen Weg über
den Lockstep; seine Würfel sind eigene, denn der `bot`-Strom der Runde geht in die Prüfsumme. Kein Bot-Server, kein
Dev-Server, keine Karten-Tiles.

```bash
npx ng build --configuration development          # dann dist/3DTD/browser mit python -m http.server 4213 ausliefern
npm run coop-server -- --port 3013 --log-dir <dir>
node e2e/coop-bots/run.ts --url http://localhost:4213 --relay ws://localhost:3013 --relay-log <dir> --out <out> --runs 20 --parallel 3
```

Je Welle eine Zeile in `<out>/runs.jsonl` (Gold, Kill-Gold und Ausgaben je Spieler, Gegner, Kills, Kill-Gold und
Lecks je Lane, HQ-Verlust, Tower je Spieler und Lane), je Lauf eine mit Ende, Laufzeit und den Prüfsummen-Abweichungen
(Tick je Tab, `DESYNC`-Zeilen des Relays). `--players N` (bis 4), `--max-waves`, `--minutes`. Ein Browser je Lauf auf der Grafikkarte des Rechners: Die
Sichtlinien sind Würfel-Renderings, auf SwiftShader (`--swiftshader`) teilten sich alle Tabs einen GPU-Prozess, und
ein Raum lief mit halbem Tempo. Das Relay nimmt höchstens 8 Verbindungen je Adresse (`MAX_PER_ADDRESS`), also `--parallel` mal `--players` höchstens 8; für mehr das Relay mit `--max-per-address N` starten. `--solo` spielt einen
Bot allein im ausgelieferten DevWorld als Vergleich (dann darf kein Bot-Server auf :3001 laufen).
