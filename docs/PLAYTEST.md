# Playtest: offene Nachtests

Stand 2026-09-22, Code-Stand `balancing`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
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

## M Druck-Regler und HP-Budget (2026-09-22)

Gemessen ist der Regler an Bot-Läufen; was Bots nicht prüfen können, ist wie es sich anfühlt. Genau darum geht
es hier. Ein Lauf bis mindestens Welle 30 reicht für M1 bis M4.

- **M1 Die HP-Zahl**: Der Spieler startet jetzt mit **500 HP** statt 100, ein durchgekommener Gegner kostet 1
  (bis W30), 2 (bis W60), 3 (bis W90). Erwartung: Die Anzeige bleibt lesbar, der Balken fühlt sich nicht
  belanglos an, und ein einzelner Durchbruch tut weh, ohne den Lauf zu entscheiden. Wenn 500 als Zahl komisch
  wirkt: Es geht nur um die Auflösung, jede andere Zahl mit demselben Verhältnis täte es auch.
- **M2 Keine toten Strecken**: Über die Wellen 10 bis 30 mitzählen, wie viele gar nichts kosten. Erwartung:
  keine lange Serie mehr, in der man nur zusieht. Vorher waren es im Schnitt elf Wellen am Stück.
- **M3 Keine Wand**: Erwartung: Der Lauf endet nicht an einer einzelnen Welle, die plötzlich alles mitnimmt,
  sondern weil es über mehrere Wellen enger wird. Wenn doch eine Welle heraussticht, ihren Namen notieren.
- **M4 "Why this wave"**: Im Wave-Debug-Fenster steht jetzt "Pressure loop: waves cost X % of HP on average,
  ... so it opened/closed to ×Y" statt der alten Leck-Zeile. Erwartung: Die Zahlen passen zu dem, was man
  gerade erlebt hat.
- **M5 Nach einem Ortswechsel**: Der Regler ist Zustand pro Lauf. Erwartung: Ein neues Spiel startet wieder bei
  ×1,00, also mit normal großen Anfangswellen, egal wie der Lauf davor lief.

## K8 Desktop-Build

K8.1 bis K8.3 und K8.5 sind ok und im [Archiv](archive/PLAYTEST_2026-09.md). Offen nur, was ein Rechner mit zwei
GPUs zeigt. Installer: [Releases](https://github.com/ingel81/3dtd/releases/latest).

- **K8.4 Hybrid-Laptop** (nur falls einer da ist): App starten, Task-Manager, Spalte "GPU-Modul" beim 3DTD-Prozess.
  Erwartung: die dedizierte GPU (E14). Die GPU-Zeile im Log (`[info] GPU: ... (active)`) nennt sie ebenfalls.

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
