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

## K8 Desktop-Build (Branch `electron`)

Gebaut und per Smoke-Test geprüft (Protokoll, Fenster, Tasten, Downloads, Fehlerseite, Log, Update-Durchlauf
0.3.0 → 0.3.1 beim Beenden und 0.3.1 → 0.3.2 über "Restart now", Deinstallieren), siehe
[ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md), Abschnitt "Abnahme". Offen ist, was nur ein echter Rechner zeigt.
Installer lokal: `cd desktop && npm run dist`, dann `desktop/release/3DTD-Setup-<Version>.exe`.

- **K8.1 SmartScreen:** den Installer aus dem ersten Release-Entwurf auf GitHub herunterladen (nicht den lokalen, der
  trägt keine Download-Markierung) und starten. Erwartung: "Der Computer wurde durch Windows geschützt", unter
  "Weitere Informationen" der Knopf "Trotzdem ausführen", danach Installation ohne Admin-Abfrage.
- **K8.2 Eine Partie in der installierten App:** Ort laden, Tower setzen, zwei Wellen. F12, Konsole: keine Zeile mit
  "Content Security Policy". Danach Ctrl+Shift+L, `main.log` öffnen: dein Token kommt darin nicht vor.
  **ok (2026-09-19)**, mit Installation per Doppelklick, Update auf 0.3.1 über den lokalen Feed und Deinstallation.
- **K8.3 Kleines Fenster:** das Fenster auf die Mindestgröße ziehen (1024 × 600). Erwartung: Sidebar, Header und
  Schnellaktionen bleiben bedienbar, nichts überlappt so, dass ein Knopf nicht mehr erreichbar ist.
  **ok (2026-09-19)**
- **K8.4 Hybrid-Laptop** (nur falls einer da ist): App starten, Task-Manager, Spalte "GPU-Modul" beim 3DTD-Prozess.
  Erwartung: die dedizierte GPU (E14). Die GPU-Zeile im Log (`[info] GPU: ... (active)`) nennt sie ebenfalls.

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
