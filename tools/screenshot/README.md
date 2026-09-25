# Screenshots des laufenden Spiels

Bilder vom Dev-Spiel (`npm start`, http://localhost:4200) aus einem eigenen Browser, zum Prüfen von Oberflächen, ohne
dass jemand vor dem Bildschirm sitzt. Kein Teil des Spiels.

Einmalig: `npm install` in diesem Ordner (Playwright; der Chromium dazu mit `npm run setup`, falls er fehlt).

- `lib.mjs`: `launch()` öffnet einen sichtbaren Chromium (die fotorealistischen Tiles brauchen eine echte GPU, und ein
  eigenes Fenster ist nie ein versteckter Tab, den Chrome einfriert). `openGame()` lädt das Spiel an einem Ort,
  ohne „What's new“ und First-Run-Tipps, wartet, bis der Ladebildschirm weg ist, und überspringt das Intro; jeder
  Aufruf hat seinen eigenen localStorage, also ein zweiter Spieler.
- `coop-dock.mjs`: Host öffnet einen Raum, Gast kommt per Einladungslink, vier Chatzeilen, der Gast ist bereit;
  Screenshot beim Host (`--out`), wahlweise auch beim Gast (`--guest-shot`). Braucht dazu den Relay
  (`npm run coop-server`).
- `coop-rules.mjs`: prüft die Raum-Optionen (PLAYTEST T59 bis T61: Cheats, Pause, Next wave) in zwei Räumen und
  einer Lobby mit `--no-cheats`; startet und stoppt den Relay selbst.
- `coop-look.mjs`: prüft, was sich an der Coop-Oberfläche ablesen lässt (T47, T50, T54, T56, T58, T62, T63), und
  legt Bilder zum Ansehen ab.
- `extras.mjs`: „Pause: Off“ (T60) und der Druck-Regler nach einem Ortswechsel (M5: sieben saubere Wellen öffnen
  ihn, ein neuer Ort startet wieder bei ×1,00).

Beide geben je Prüfung `OK`/`FAIL` aus und enden mit Fehlercode, wenn etwas fehlt. Bausteine in `lib.mjs`:
`coopRoom()` (Host plus Gäste, Optionen, Start), `setOption()`, `devAction()` (Entwicklermenü), `credits()`,
`waveButton()`, `startRelay()`, `checker()`. Jeder Spieler hat ein eigenes Fenster, nebeneinander versetzt; `SLOWMO`
(ms, Standard 120) verlangsamt jede Aktion zum Zusehen.

```bash
cd tools/screenshot
node coop-dock.mjs --out ../../tmp/coop-dock.png
node coop-rules.mjs --dir ../../tmp/checks
SLOWMO=400 node coop-look.mjs
```

Der Kartenschlüssel kommt wie im Browser aus `environment.ts` des Dev-Servers. Ein Lauf dauert ein bis zwei Minuten,
das meiste ist das Laden der Karte.
