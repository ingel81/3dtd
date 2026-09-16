# Playtest: offene Nachtests

Stand 2026-09-16, Code-Stand `next`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
warten. Offene Arbeit, Bugs und Entscheidungen stehen in [TODO.md](../TODO.md). Die Punkte bis 748 samt Ergebnissen
liegen in [archive/PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md), ältere Listen in `archive/REVIEW_*.md`.

**So wird ein Punkt abgeschlossen:**
- Antworten reicht so: "K2.1 ok, K3.4 kaputt", bei kaputt ein Satz oder ein Screenshot.
- Das Ergebnis kommt als eine Zeile unter den Punkt (`**ok (Datum)**` oder der Befund).
- Ist ein Paket durch, wandert es ins Archiv; ein Befund wird ein Eintrag in TODO.md.
- Logik prüft der Lead per Szenario-Test, hier stehen nur Augen, Ohren und echte Karten.

## Vorab

- Konsole (F12) offen, Filter leer. Jede Zeile mit `Shader Error` oder `Uncaught` melden.
- **Quick Actions** unten rechts, Namen im Tooltip. "Layers" (drei gestapelte Ebenen) klappt weitere Knöpfe auf:
  "Route Grid Overlay" (vier Quadrate, oberster), "Show streets" (Weg mit zwei Punkten). Ganz rechts "T": "Developer
  options".
- **Developer options:** Kachel "Credits" unter "Cheats" (Klick +1000). Unter "Waves & Inspect": "Waves" öffnet
  "Wave Debug", "Enemies" öffnet "Enemy Debug", "Snapshot" lädt den Korridor als JSON herunter.
- **Custom Wave:** Wave Debug, Knopf "Single", bei "Type" den Gegner, bei "Count" die Anzahl, "Start Custom Wave".
- **Gegner setzen:** Enemy Debug, unter "Placement" den Typ wählen, Stecknadel-Knopf, Klick auf die Route; in "Debug
  Enemies" anklicken, unter "Movement" "Start".
- Orte immer per URL mit F5 kalt laden (`http://localhost:4200/` plus die Parameter unten), keine Tower, keine Welle,
  wenn nicht anders gesagt.

## K2: Laden, Eichung, Rückfall (744, 746)

- **K2.1** Tokyo-URL, F5: 10 Ladeschritte, immer genau einer aktiv, kein "Waiting for 3D Tiles"? Nach `[Corridor]
  build` eine Zeile `[Camera] ... corridor.cameraCorrection`, Kamera nach der Landung über der Route?
  `__corridor.fingerprint()` und `tileSet` aus der Zeile `[CorridorTrace] ... build.tiles` notieren. Zweites F5: beides
  gleich?
- **K2.2** Erlenbach `?l=49.17337,9.26851&s=49.17556,9.26401` laden, Header "Change location", Tab "Showcase", "Tokyo,
  Shibuya Crossing": dreht nach "Loading Street Network" sofort "Placing Headquarters"? Fingerprint und `tileSet` gleich
  K2.1? Dann `__corridor.reset()`, warten auf `[Corridor] Corridor rebuilt`: weiter gleich?
- **K2.3** Rothenburg-URL, F5: keine Zeile `build.fallback what=cells`, in `build.freeze` `cellsWithoutHeight=0` und
  `fallbackMs=0`? Overlay an, am Rathaus `__corridor.pick()` auf die Randreihe vor dem Laubengang: `state: 'filled'`?
  Paris-URL, F5: `build.fallback what=stations` mit 4 gefunden, keine Zeile `what=cells`?
- **K2.4** Straßen aus (Vorgabe), `__raycastStats()` notieren, zoomen, bis Tiles nachladen, erneut: wächst `streets`
  nicht? Layers "Show streets" an: erscheinen gelbe Linien? "Route Grid Overlay" an, F5: erscheint das Overlay mit dem
  Ende von "Measuring the Corridor" und bleibt beim Zoomen gleich?

## K3: Assets nach Runde 22 (734, 735, 736, E18)

Beliebiger Ort, Ton an, Cheat "Credits".

- **K3.1** Custom Wave "Skarnax", Count 1, Kamera an den Kopf: knurrt er ab und zu unregelmäßig statt in gleichmäßiger
  Schleife?
- **K3.2** Gleiche Welle, nah heran: Chitin-Textur, Beine bewegen sich mit dem Boden, Kiefer am Kopf, Schwanzstück am
  letzten Ring? Ein Archer an die Wurmmitte: trägt nach dem Zerfall jedes Teil Kopf und Schwanz?
- **K3.3** Enemy Debug, Tank setzen und starten: Tarnanstrich, abgewetzte Kanten, Staub? Vorschau in der Sidebar ganz
  im Bild?
- **K3.4** Archer wählen, die Bauvorschau so an eine Hochhauskante, dass sie übersteht: gestufte Kragsteine statt
  dünner Streben? Bauen: Kragsteine an der Fassade? Mitte eines Flachdachs: keine? Tower wählen, zweimal Sell:
  Kragsteine weg?

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
