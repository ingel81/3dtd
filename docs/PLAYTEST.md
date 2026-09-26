# Playtest: offene Nachtests

Stand 2026-09-26, Code-Stand `coop`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
warten. Offene Arbeit, Bugs und Entscheidungen stehen in [TODO.md](../TODO.md). Die erledigten Punkte samt Ergebnissen
(bis 748, dazu M, Q, R, T bis 2026-09-26) liegen in [archive/PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md), ältere Listen in `archive/REVIEW_*.md`.

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

## M Druck-Regler und HP-Budget (2026-09-22)

Gemessen ist der Regler an Bot-Läufen; was Bots nicht prüfen können, ist wie es sich anfühlt. Genau darum geht
es hier. Ein Lauf bis mindestens Welle 30, am Ende über "Runs" speichern.

- **M4 "Why this wave"**: Im Wave-Debug-Fenster steht jetzt "Pressure loop: waves cost X % of HP on average,
  ... so it opened/closed to ×Y" statt der alten Leck-Zeile. Erwartung: Die Zahlen passen zu dem, was man
  gerade erlebt hat.

## Q Balance-Runde nach dem New-York-Lauf (2026-09-23)

Aus M2/M3 und der Gold-Auswertung (beide im Archiv). Ein Lauf bis mindestens W31, am Ende über "Runs" speichern.

- **Q1 Keine Wand in W15**: Golem Squad bleibt beim Überlebbarkeits-Deckel. Erwartung: keine Welle, die auf einen
  Schlag den Großteil der HP nimmt. Im Wave Debug steht bei W15 keine Anzahl über dem Deckel.
- **Q4 Gold**: Ein Herbert, Mammut oder Golem bringt sichtbar mehr als ein Zombie derselben Welle (Kopfgeld nach
  Wurzel der Basis-HP). W21 bis W30 wachsen je Welle um ×1,2, nach W30 fällt das Einkommen je Welle nur noch
  um ×0,85 statt ×0,5. Die Auswertung macht der Lead aus der Datei.

## T Coop: Tower bemannen, Spieler-Leiste, Gold, Lobby (2026-09-24, Branch `coop`)

Relay neu starten (`npm run coop-server`), zwei Fenster, beide neu laden. Nach dem Lauf reicht das Relay-Log
(`logs/coop_*.log`). Kommt ein `DESYNC`, das Log melden.

- **T13 Relay per LAN (R6)**: `npm start -- --host 0.0.0.0`, der Host öffnet das Spiel selbst über `http://<IP>:4200`
  (nicht localhost, sonst zeigt der Einladungslink auf localhost), zweiter Rechner nimmt den Einladungslink. Erwartung: Der Gast findet den Relay unter `ws://<IP>:3003` von selbst; im Dialog steht
  „Server <IP>:3003“.

- **T68 Squad-Box springt nicht mehr** (User, 2026-09-25): Im Coop-Spiel die Welle abwarten, bereit setzen, die nächste
  starten. Erwartung: Der Fuß der Squad-Box („Ready up for the next wave“, „Waiting for …“) bleibt als Zeile stehen,
  auch leer; Box und Chat darunter verschieben sich nicht mehr. Dazu (User, 2026-09-26): die Spielerzeilen wachsen mit Name und
  Tags, die Spawn-Zeile liegt in der Zeile, der Lane-Strich läuft bündig über die ganze Höhe.
- **T69 Tastenleiste unter dem Chat lesbar** (User, 2026-09-25): „Enter chat · X mark · Tab room“ auf heller Karte.
  Erwartung: eigene dunkle Fläche, gut lesbar.
- **T70 Beitreten ohne eigenen Ort und das neue Dock (E30, E31 Schritt 1)**: App frisch starten (Standortdialog).
  Reiter „Coop“: Umschalter „Same network“ mit Liste und „Online“ mit Code. Auf dem anderen Rechner „Same network“ und „Host a room“, hier in
  der Liste „Join“. Erwartung: der Dialog schließt, der Ort des Hosts lädt einmal, danach geht das Dock mit der Lobby
  auf. Im Dock: keine Server-Adresse mehr, Raumkopf „LAN“; die Lobby steht als Auswahl über „Open rooms“. Geprüft per
  Skript (Browser hostet online, App tritt per Code bei). Bekannt: der Ortsname kann beim Gast anders lauten
  (Rückwärtssuche), gleicher Ort.
- **T71 Öffentliche Raumliste (D62, D63)**: Ein Spieler hostet online, ein anderer öffnet Coop. Erwartung: unter
  „Online“ steht „Open rooms“ mit dem Raum (Titel, Host, Stadt ohne Straße, 1/4, „Lobby“, Ping); der Host sieht im
  Raum „In the public list“ mit Titel und dem Hinweis zum Ort; schaltet er auf privat oder sperrt den Raum,
  verschwindet er aus der Liste. Nach dem Start steht er grau als „In game · Wave n“. Geprüft im Dev-Spiel mit zwei
  Browsern über „This machine“; über die echte Lobby offen, bis sie läuft.
- **T72 Tower bemannen in der Desktop-App** (User, 2026-09-25, Online-Test): Im bemannten Tower stand nur „Click
  the map to aim“, Zielen und Schießen gingen nicht. Ursache: die App erlaubte Webseiten-Berechtigungen nur für die
  Zwischenablage und lehnte den Pointer Lock ab (`SecurityError`, im Electron-Test belegt); betrifft auch den
  Einzelspieler in der App und damit v0.4.0. Gebaut: `pointerLock` erlaubt (`desktop/src/security.js`). Nachtest mit
  neuem Installer: Tower bemannen, klicken, Maus zielt, Linksklick schießt; allein und im Coop.
- **T67 Held des Partners (R15)**: Im Coop-Spiel heuern beide ihren Helden an. Erwartung: jeder sieht auch den Helden
  des anderen laufen und schießen, mit einem Ring in dessen Lane-Farbe unter den Füßen; ein Klick auf ihn wählt nichts
  aus. Bisher nur per Spec geprüft.
- **T73 Standortdialog neu (COOP_UI_REWORK_PLAN P3)**: App ohne Ort starten, dann mit Ort über den Kopf öffnen.
  Erwartung: beim Start „Choose a place“ ohne Cancel, mit Ort „Change place“; die Tabs Place, World, Coop bleiben beim
  Wechseln stehen; „Load place“ erst nach einer Suche, die Spawn-Zeile klappt auf; „Move the spawn by address…“ setzt
  nur den Spawn. Logik per Spec geprüft, offen nur: Wirkt es aufgeräumt, passt es zum Rest?
- **T74 Coop-Einstieg neu (P4)**: In der App Coop öffnen. Erwartung: Umschalter Online / Same network, nur ein Weg zu
  sehen, beim nächsten Öffnen der zuletzt gewählte; die Lobby als Auswahl im Kopf von „Open rooms“, „Add lobby…“ öffnet
  die Felder; ein Knopf „Host a room“. Per Spec und E2E geprüft, offen nur der Eindruck.
- **T75 Raum als Tabelle (P5)**: Zu zweit einen Raum öffnen. Erwartung: eine Zeile je Lane mit Spieler, Haken für
  Ready, Ping und Werkzeugen; Spieler ohne Lane darunter; bei mehreren Warnungen nur die schwerste mit „+n“. Tab im
  Dock wandert durch die Knöpfe, Esc schließt es, ein Klick auf einen Knopf und dann Enter öffnet im Spiel den Chat.

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
