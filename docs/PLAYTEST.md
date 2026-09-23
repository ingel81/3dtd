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

## L Forschung und die Sitzung vom 2026-09-21

Alles hier ist gebaut, gemessen und durch das Gate; was fehlt, sind Augen im Spiel. Reihenfolge egal,
L1 bis L4 gehen in einem Lauf.

- **L1 Forschungsbaum als Dialog** (G3): Research Center bauen, anklicken, im Panel "Research tree", oder Taste
  `Q`, oder den Knopf im Header neben dem Würfel. Erwartung: Vollbild, drei Wurzeln oben (Gatling, Ice Magic,
  Biology), Tier-Marken links auf Höhe ihrer Reihe, unten Legende und die Zählung je Strang. Ziehen mit der Maus
  verschiebt den Graphen, ein Klick auf einen offenen Knoten startet ihn trotzdem.
  **ok (2026-09-23)**. Befund: der Header-Knopf passt nicht zu seinen Nachbarn (Ort, Würfel, HQ). Umgezogen, Nachtest O1.
- **L2 Zustände am Knoten**: eine Forschung starten und eine zweite anklicken, während der Slot belegt ist.
  Erwartung: die laufende teal mit Balken und Restzeit, die zweite gestrichelt gold mit Nummer in der Ecke, die
  Warteschlange rechts mit derselben Reihenfolge. Credits unter den Preis bringen (nichts kaufen, warten):
  offene Knoten färben sich orange (`poor`), der Detailknopf sagt, wie viel fehlt.
  **ok (2026-09-23)**. Befund: erforschte Knoten optisch deutlicher absetzen. Umgebaut, Nachtest O2.
- **L3 Kette und Detail**: mit dem Zeiger auf einen tiefen Knoten (etwa Transcendent Tech). Erwartung: der Weg
  bis zur Wurzel leuchtet gold, alles andere blendet ab, und rechts steht Zustand, Wirkung, Kosten, Zeit und die
  Vorbedingungen mit Haken.
  **ok (2026-09-23)**
- **L4 Warteschlange umsortieren**: zwei Forschungen vormerken, im rechten Panel die Pfeile benutzen. Erwartung:
  die Reihenfolge ändert sich, nichts wird abgebucht, und die frei werdende Slot nimmt den, der oben steht.
  **ok (2026-09-23)**
- **L5 Biology-Tor**: am Anfang stehen nur Gatling Technology, Ice Magic und Biology offen. Tentacle und Toxic
  öffnen sich erst, wenn Biology fertig ist (120, 8 s).
  **ok (2026-09-23)**
- **L6 Raketen-Pfad** (Form B): `aa-retrofit` hängt jetzt direkt an `gatling-tech`, `rocketry` unter
  `siege-engineering`. Erwartung im Spiel: die Flugabwehr fürs Gatling ist ab 850 erreichbar, die Rakete kostet
  1500 und liegt beim Drachen in W12, nicht bei den Fledermäusen in W7. Ob die Rakete damit stark genug ist, ist
  **nicht** geprüft, das ist ein eigener Punkt in TODO.md.
  **ok (2026-09-23)**
- **L7 Panel des Research Centers**: Center anklicken, ohne dass etwas läuft. Erwartung: "n/21 researched",
  Slots, eine Zeile wie "5 researches are open right now", darunter der goldene Knopf. Läuft etwas, steht dort
  die laufende Forschung mit Balken und Abbrechen.
  **ok (2026-09-23)**
- **L8 Schaden je Gold je Typ** (E10): einen Lauf spielen, zwei Tower-Typen bauen, einen zweimal aufrüsten, Lauf
  exportieren. Erwartung: `"format":2` im Kopf, `"towerSpending":{...}` in jeder Wellenzeile, und die Summe
  darin gleich `spending.build + spending.upgrade` derselben Zeile.
  **ok (2026-09-23)**: Kopf zeigt `"format":3`, richtig: seit `26100153` (2026-09-22) ist es 3, der Punkt war älter. W1 `towerSpending` 481 = build + upgrade 481.
- **L9 Kein Kill zu viel** (E11): Devworld, einen Archer ans HQ-Ende der Route, Welle laufen lassen, bis ein
  Gegner durchkommt. Erwartung: das HQ nimmt einmal Schaden, der Tower bekommt dafür keinen Kill, und im
  Wellenblock steht kein `bodies:`-Eintrag unter `mismatches`.
  **ok (2026-09-23)**: W1 14 geleckt, kein `mismatches` in der Wellenzeile (`tmp/runs/3dtd-run-2026-09-23T07-42-07-418Z-devworld.jsonl`).
- **L10 Straßensuche nach Ortswechsel** (H14): Ort laden, Spawn setzen, dann über den Standort-Dialog in eine
  andere Stadt wechseln und wieder einen Spawn setzen. Erwartung: das Portal sitzt an einer Straße der **neuen**
  Stadt, nicht an einer der alten (der Raumindex wird je Netz neu gebaut).
  **ok (2026-09-23)**. Frage: warum mal "Spawn", mal ein Straßenname über dem Portal (siehe Antwort im Chat, noch keine Arbeit).
- **L11 Nur für Screenreader** (H9, optional): die Dev-Kacheln der Quick Actions melden jetzt ihren Zustand
  (`aria-pressed`). Optisch ändert sich nichts, also nur zu prüfen, wenn du magst.

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
