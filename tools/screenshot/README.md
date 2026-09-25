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

```bash
cd tools/screenshot
node coop-dock.mjs --out ../../tmp/coop-dock.png
```

Der Kartenschlüssel kommt wie im Browser aus `environment.ts` des Dev-Servers. Ein Lauf dauert ein bis zwei Minuten,
das meiste ist das Laden der Karte.
