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
