# Playtest: offene Nachtests

Stand 2026-10-13, Code-Stand `next` (= Release 0.7.0). Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
warten. Offene Arbeit, Bugs und Entscheidungen stehen in [TODO.md](../TODO.md). Die erledigten Punkte samt Ergebnissen
(bis 748, dazu M, Q, R, T bis 2026-09-26) liegen in [archive/PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md), die Pakete
T bis Z bis Release 0.7.0 in [archive/PLAYTEST_2026-10.md](archive/PLAYTEST_2026-10.md), ältere Listen in `archive/REVIEW_*.md`.

**So wird ein Punkt abgeschlossen:**
- Antworten reicht so: "K2.1 ok, K3.4 kaputt", bei kaputt ein Satz oder ein Screenshot.
- Das Ergebnis kommt als eine Zeile unter den Punkt (`**ok (Datum)**` oder der Befund).
- Ist ein Paket durch, wandert es ins Archiv; ein Befund wird ein Eintrag in TODO.md.
- Logik prüft der Lead per Szenario-Test, hier stehen nur Augen, Ohren und echte Karten.
- Was ein Browser prüfen kann, prüfen die End-to-End-Tests (`npm run e2e`, [E2E.md](E2E.md)); welcher Punkt dort
  abgedeckt ist, steht in den Testnamen (T.., M..).

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

## R Rest nach Release 0.7.0 (2026-10-13)

Was nach dem Aufräumen offen ist; alles andere aus T bis Z ist abgehakt oder überholt (Archiv). Coop nur in der
Desktop-App über die echte Lobby, der Browser auf `/play/` zeigt dafür nur den Hinweis auf die App.

Paket R1, Coop App gegen App (zwei Rechner, echte Lobby):

- **R1.1 Raumliste (war T71):** A hostet online, B öffnet Coop. *Unter „Online“ steht „Open rooms“ mit dem Raum
  (Titel, Host, Stadt ohne Straße, 1/4, „Lobby“, Ping); privat oder gesperrt verschwindet er; nach dem Start grau
  „In game · Wave n“.*
- **R1.2 Einladungslink und Beitritt ohne Ort (war H3.1, H3.3):** B frisch gestartet, ohne Ort, tritt über den Link
  bzw. den Code bei. *Das Menü bleibt, die Karte des Hosts lädt dahinter, danach Spiel und Dock mit dem Raum.*
- **R1.3 Same network (war H3.4):** A „Host on this network“ (Firewall erlauben), B „Same network“. *Das Spiel von A
  steht mit Spielerzahl in der Liste, „Join“ führt in den Raum; ohne Spiel im Netz nach rund 4 s „Host IP“.*
- **R1.4 Coop nach Solo-Lauf (war N18):** allein ein paar Wellen, dann „Host a room“, einmal an einem Ort mit einem
  Spawn, einmal mit zwei. *Vorher die Frage „This ends your solo run (wave N)“, Cancel lässt den Lauf.*
- **R1.5 Forschungspreise des Partners (war S3.2):** zwei Spuren je Spieler, beim Partner forschen. *Sein Preis im
  Baum ist das, was ihm abgebucht wird.*
- **R1.6 Resync (war S3.4):** im Spiel ein Fenster lange hängen lassen (Debugger-Pause o. ä.). *Resync läuft, danach
  gleiche Prüfsummen, kein Abbruch.*

Paket R2, App und Web:

- **R2.1 Quit und Links (war H4):** App ohne Lauf „Quit 3DTD“ beendet; mit Tower fragt Esc, „Quit 3DTD“ erst „Quit
  3DTD? The run ends.“. Extras, „Legal & privacy“ und „Source on GitHub“ öffnen den System-Browser.
- **R2.2 Datei laden im Lauf (war S1.4):** „Load game“, Download-Symbol am Platz, im laufenden Lauf „Load from a
  file“ mit der Datei. *Die Rückfrage, danach lädt sie wie ein Platz.*
- **R2.3 Konsole auf `/play/` (war S3.3):** Header live geprüft (2026-10-13). Offen: ein Spiel in Chrome und Firefox
  mit offener Konsole, *keine CSP-Verletzung* bei Ortssuche, Straßen, Tiles, Schlüsselprüfung, Globus.
- **R2.4 Globus Low/Off (war G3.1):** Settings, Graphics, „Menu globe“ Low und Off; auf einem schwächeren Rechner
  High. *Low weicher, gleicher Ablauf; Off dunkler Grund, kein Abtauchen; flüssig.*

Nur wenn es passiert oder ein Gerät da ist:

- **R3.1 Kartenserver lehnt ab (war Y5):** bei 429 oder ohne Netz. *„The map server is busy or out of reach …“, Play
  wartet, nach 15 s bis 2 min lädt es von selbst weiter.*
- **R3.2 AppImage (war S5.1):** auf einem Linux-Desktop starten, einen Ort spielen.
- **R3.3 Hybrid-Laptop (war K8.4):** Task-Manager, Spalte „GPU-Modul“ beim 3DTD-Prozess. *Die dedizierte GPU, ebenso
  im Log `[info] GPU: ... (active)`.*

Offen als Entscheidung, kein Nachtest: **M4/S2.3** „Why this wave“ in Worten war dir „verwirrend, sagt mir alles nichts“
(2026-10-04); neu gefasst am 2026-10-05, seitdem nicht wieder angesehen. Gehört in TODO.md, falls es bleiben soll.

## Eichtabelle

Fingerprints aus `__corridor.fingerprint()` für K2.1 und K2.2. Alle Werte vor 748 (Rothenburg `d8050177`, Tokyo
`efc7362a` usw.) gelten nicht mehr. Ein neuer Wert gilt, bis ein Commit den Korridor ändert; dann hier leeren.

| Ort | URL-Parameter | Fingerprint | `tileSet` | Datum |
|---|---|---|---|---|
| Tokyo | `l=35.65924,139.70049&s=35.65208,139.69853` | | | |
