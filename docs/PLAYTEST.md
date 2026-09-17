# Playtest: offene Nachtests

Stand 2026-09-17, Code-Stand `next` @ `1276d1ff`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
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

## K7 Raketensilo

Stand `next` @ `11de208a`. Per Test verifiziert, hier nicht zu klicken: Knopf und Taste K nur mit Silo, Hinweis "Build a
Missile Silo first", nur ein Silo, Einschlag auf Sub-Step 390, Rakete im Silo weg ab dem Befehl und wieder da nach dem
Nachladen (3 Wellen), neu gebautes Silo mit richtigem Zustand, Zielmodus endet beim Verkauf, Bot baut und hält vor.

**Aufbau (für alle Punkte):** Tokyo kalt laden (`l=35.65924,139.70049&s=35.65208,139.69853`). Developer options, unter
"Cheats" zweimal "Credits", dann "Abilities". Research Center ist nicht nötig. In der Build-Leiste die Karte "Missile
Silo" (Stufe 3), neben die Route setzen, vorher R kurz gedrückt halten (dreht die Vorschau). Wave Debug, "Single",
Zombie, Count 30, "Start Custom Wave". Nach jedem Schuss für den nächsten Punkt wieder "Abilities" drücken (füllt die Ladung auf).

**Paket A: Start und Flug**

- **K7.1 Silo im Spiel.** Kamera nah ans Silo. Erwartet: 14 m breit, steht auf dem Boden (oder Plinth), keine Löcher
  in den Wänden, die Rakete steht im offenen Schacht. Die Vorschau auf der Build-Karte ist etwa so groß wie die des
  Research Center.
- **K7.2 Start aus der Nähe.** Kamera unter 80 m vom Silo, K, Klick auf die Route. Erwartet: die Rakete im Silo ist im
  Moment des Klicks weg und die fliegende hebt genau dort mit derselben Drehung ab, kein Sprung, keine doppelte
  Rakete. Blitz über dem Schacht, Feuer und Rauch quellen heraus und rollen am Boden aus, leichter Shake.
- **K7.3 Flug aus der Übersicht.** Übersichtskamera, K, Klick auf die Route etwa 500 m vom Silo. Erwartet: langsames
  Abheben, immer schneller, hoher Bogen, fast senkrechter Sturz, Einschlag genau mit dem Atompilz. Rakete aus der
  Übersicht erkennbar, Rauchspur steht 10 bis 15 s. Wirkt es imposant?
- **K7.4 Ton.** Bei 1x nah am Silo: Zündknall und Tosen, das Triebwerk wandert mit der Rakete, am Ziel etwa 2,5 s ein
  fallendes Pfeifen, das der Knall abschneidet. Lautstärke gegen Sirene und Knall stimmig?

**Paket B: Grenzfälle**

- **K7.5 Kurze und weite Ziele.** Ziel unter 50 m vom Silo, dann eins über 1000 m. Erwartet: nah steigt sie hoch und
  dreht sauber über den Scheitel, weit ist der Bogen hoch genug und nichts schneidet durch Gebäude.
- **K7.6 Effekte Low.** Quick Actions, "Display" (Auge), unter "Effects" "Low", K, Klick. Erwartet: Rakete, Flamme und
  Blitz da, weniger und größere Rauchpuffs, kein Feuer aus dem Schacht. Konsole ohne `Shader Error`.
- **K7.7 Verkauf im Flug.** K, Klick, sofort das Silo anklicken und zweimal auf den Verkaufsknopf. Erwartet: die Rakete
  fliegt weiter und landet, Textur der fliegenden Rakete bleibt korrekt (nicht schwarz, nicht weiß).
- **K7.8 Spielgefühl.** Ein paar Schüsse auf laufende Gruppen. Ist das Vorhalten über 6,5 s spielbar, oder braucht es
  eine Zielhilfe?

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
