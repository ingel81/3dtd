# Playtest: offene Nachtests

Stand 2026-09-17, Code-Stand `next` @ `923e2ecb`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
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

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
