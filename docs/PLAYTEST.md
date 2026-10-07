# Playtest: offene Nachtests

Stand 2026-10-07, Code-Stand `next`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
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

## W Simulation im Worker (seit 2026-09-30 auf `next`)

Die Simulation läuft in einem Web Worker ([SIM_WORKER.md](SIM_WORKER.md)). Geprüft per Spec, E2E und Bot-Lauf; offen
ist, wie es sich spielt. Dev-Server auf `next`, `http://localhost:4200/`, Konsole offen. Jede `Uncaught`- oder
`[Sim]`-Fehlerzeile melden.

Paket W1, allein auf einer echten Karte:

- **W1.1 Ein normaler Lauf:** Ort wählen, bis mindestens Welle 10 spielen, zwischendurch Tempo 4. Erwartung: nichts
  anders als auf `next`; Tower treffen, Gegner laufen flüssig, Töne und Effekte kommen zur Zeit.
  **ok (2026-10-04)**
- **W1.2 FPS-Anzeige:** Den FPS-Zähler oben links anklicken, dann noch einmal. Erwartung: erst „Speed x / y · Sim
  n %“ und „Sounds/s“, dann rechts daneben Ticks/s, „Memory shared“, „Packet … ms“, Gegnerzahl und kleine Kurven.
  Sinkt das Tempo unter das eingestellte, ist die erste Zahl rot.
  **ok (2026-10-04)**
- **W1.3 Tab im Hintergrund:** Während einer Welle zwei Minuten in einen anderen Tab, dann zurück. Erwartung: die
  Welle lief weiter (Wellenzähler und Gold passen), kein Standbild, keine Fehlermeldung.
  **ok (2026-10-04)**
- **W1.4 Vorschau der Seitenleiste:** Tower-Karten und Gegnergruppen im Wellen-Panel ansehen, auch gesperrte Tower.
  Erwartung: alle drehen sich gleichmäßig ab dem ersten Bild, eine Umdrehung in etwa 6 Sekunden, gesperrte als
  dunkle Silhouette.
  **ok (2026-10-04)**

Paket W2, Replay und Werkzeuge:

- **W2.1 Replay-Effekte:** Eine Welle mit Atombombe (Fähigkeit) spielen, danach das Replay der Welle öffnen und
  verlassen, während die Bombe im Replay noch wirkt. Erwartung: im Live-Spiel ist nichts mehr von ihr zu sehen.
  **ok (2026-10-04)**
- **W2.2 Replay springen:** Das Replay einer großen Welle öffnen, weit nach vorn klicken, dann zurück. Erwartung:
  beim ersten Sprung „Jumping n %“ in der Leiste, der Rücksprung ist fast sofort da.
  **ok (2026-10-04)**
- **W2.3 Benchmark:** Esc (Menü), „Benchmark“, „Run“. Erwartung: die Seite lädt in eine Testwelt, misst rund
  3 Minuten, zeigt dann eine Tabelle und „Copy results“; kopieren und hier einfügen.
  **kaputt (2026-10-04)**: Läuft (RTX 5080, 10 000 Gegner bei 4x: 144 FPS, Worker 19 %, Apply 3,5 ms), aber danach kam man nicht an den vorherigen Ort zurück. Gefixt: „Back to your place“ lädt die Seite vom Start des Benchmarks. Nachtest.
  **Nachtest ok (2026-10-04)**
- **W2.4 Performance-Fenster:** Unten rechts „T“ (Developer options), „Performance“. Erwartung: Zeiten des Workers
  je Teil, Einräumen je Paket, Spielschleife und Zeichnen; die Zahlen bewegen sich mit der Gegnerzahl.
  **ok (2026-10-04)**

Paket W3, Coop über zwei Rechner und Desktop-App:

- **W3.1 Coop im LAN:** Relay neu starten (`npm run coop-server`), auf beiden Rechnern der Branch, ein Raum, bis
  mindestens Welle 8 zu zweit. Erwartung: keine `DESYNC`-Zeile im Relay-Log (`logs/coop_*.log`), beide sehen dieselben
  Gegner an denselben Stellen.
  **ok (2026-10-04)**
- **W3.2 Coop mit Tempo 4 und vielen Gegnern:** Host setzt Tempo 4, eine Custom Wave mit 2000 Zombies. Erwartung:
  beide Rechner halten Schritt, kein „waiting for …“ über Sekunden, kein `DESYNC`.
  **ok (2026-10-04)**
- **W3.3 Desktop-App:** Installer aus dem Branch (`desktop/`, [ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md)),
  App starten, FPS-Zähler zweimal aufklappen. Erwartung: „Memory shared“; ein Lauf bis Welle 5 wie im Browser.
  **ok (2026-10-04)**
- **W3.4 Coop Browser gegen App:** Ein Spieler im Browser, einer in der App, ein Raum bis Welle 5. Erwartung: kein
  `DESYNC`.

## M Druck-Regler und HP-Budget (2026-09-22)

Gemessen ist der Regler an Bot-Läufen; was Bots nicht prüfen können, ist wie es sich anfühlt. Genau darum geht
es hier. Ein Lauf bis mindestens Welle 30, am Ende über "Runs" speichern.

- **M4 "Why this wave"**: Im Wave-Debug-Fenster stehen statt der Zeile "Pressure loop …" seit 2026-10-05 zwei Zeilen
  in Worten: "Measured" (was die letzten Wellen an HP gekostet haben, gegen das Ziel) und "Loop" (Budget steigt, fällt
  oder hält, um welchen Faktor und warum). Erwartung: liest sich ohne Erklärung, die Zahlen passen zum Erlebten.

  **kaputt (2026-10-04)**: „verwirrend, sagt mir alles nichts“. Neu gefasst am 2026-10-05, Nachtest als S2.3.
## Q Balance-Runde nach dem New-York-Lauf (2026-09-23)

Aus M2/M3 und der Gold-Auswertung (beide im Archiv). Ein Lauf bis mindestens W31, am Ende über "Runs" speichern.

- **Q1 Keine Wand in W15**: Golem Squad bleibt beim Überlebbarkeits-Deckel. Erwartung: keine Welle, die auf einen
  Schlag den Großteil der HP nimmt. Im Wave Debug steht bei W15 keine Anzahl über dem Deckel.
  **ok (2026-10-04)**
- **Q4 Gold**: Ein Herbert, Mammut oder Golem bringt sichtbar mehr als ein Zombie derselben Welle (Kopfgeld nach
  Wurzel der Basis-HP). W21 bis W30 wachsen je Welle um ×1,2, nach W30 fällt das Einkommen je Welle nur noch
  um ×0,85 statt ×0,5. Die Auswertung macht der Lead aus der Datei.
  **ok (2026-10-04)**

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
  Vorab per Probe (2026-09-26, zwei Browser, echte Karte): die Box bleibt 208,6 px hoch über Bereit, Welle und Wellenende; sie rückt je Chat-Zeile (Systemzeilen wie „Bob is ready“) um eine Zeile höher, bis der Chat voll ist. Offen: ob das stört.
  **ok (2026-10-04)**
- **T69 Tastenleiste unter dem Chat lesbar** (User, 2026-09-25): „Enter chat · X mark · Tab room“ auf heller Karte.
  Erwartung: eigene dunkle Fläche, gut lesbar.
  **ok (2026-10-04)**
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
  **ok (2026-10-04)**
- **T67 Held des Partners (R15)**: Im Coop-Spiel heuern beide ihren Helden an. Erwartung: jeder sieht auch den Helden
  des anderen laufen und schießen, mit einem Ring in dessen Lane-Farbe unter den Füßen; ein Klick auf ihn wählt nichts
  aus. Bisher nur per Spec geprüft.
  Vorab per Probe (2026-09-26): beide Clients haben beide Helden im Spiel. Offen: Ring in Lane-Farbe und Klick ohne Auswahl, nur heranzoomend zu sehen.
  **ok (2026-10-04)**
- **T73 Standortdialog neu (COOP_UI_REWORK_PLAN P3)**: App ohne Ort starten, dann mit Ort über den Kopf öffnen.
  Erwartung: beim Start „Choose a place“ ohne Cancel, mit Ort „Change place“; die Tabs Place, World, Coop bleiben beim
  Wechseln stehen; „Load place“ erst nach einer Suche, die Spawn-Zeile klappt auf; „Move the spawn by address…“ setzt
  nur den Spawn. Logik per Spec geprüft, offen nur: Wirkt es aufgeräumt, passt es zum Rest?
  **kaputt (2026-10-04)**: Serifenschrift im Kopf des Dialogs. Gefixt: Cinzel und `serif` aus `--td-font-display`. Nachtest: Kopf in Inter Tight.
  **Nachtest ok (2026-10-04)**
- **T74 Coop-Einstieg neu (P4)**: In der App Coop öffnen. Erwartung: Umschalter Online / Same network, nur ein Weg zu
  sehen, beim nächsten Öffnen der zuletzt gewählte; die Lobby als Auswahl im Kopf von „Open rooms“, „Add lobby…“ öffnet
  die Felder; ein Knopf „Host a room“. Per Spec und E2E geprüft, offen nur der Eindruck.
  **ok (2026-10-04)**
- **T75 Raum als Tabelle (P5)**: Zu zweit einen Raum öffnen. Erwartung: eine Zeile je Lane mit Spieler, Haken für
  Ready, Ping und Werkzeugen; Spieler ohne Lane darunter; bei mehreren Warnungen nur die schwerste mit „+n“. Tab im
  Dock wandert durch die Knöpfe, Esc schließt es, ein Klick auf einen Knopf und dann Enter öffnet im Spiel den Chat.
  Vorab per Probe (2026-09-26): Tab wandert durchs Dock (PvE, Versus, Chat, Send, Leave, More, Start match) und verlässt es nach dem letzten Knopf in die Sidebar (kein Fokus-Käfig); Esc schließt es aus dem Dock; Klick auf einen Knopf, dann Enter öffnet im Spiel den Chat. Offen: der Eindruck der Tabelle.
  **kaputt (2026-10-04)**: Tabelle passt, aber der eigene Name war in beiden eigenen Spuren änderbar. Gefixt: nur noch in der ersten. Nachtest.
  **Nachtest ok (2026-10-04)**, per Browser-Probe: Namensfeld nur in der ersten Zeile.
- **T76 Coop-Skalierung (E34)**: Zu zweit bis W8 spielen. Erwartung: Kill-Gold je Spieler wie allein (W6 Spinnen
  nicht mehr ~26 Gold), W6 keine ~1000 Spinnen mehr, die Vorschau zeigt „per lane“ und im Tooltip die Lanes; das
  Run-Log nennt nur eigene Tower und `killsByPartner`.
  **ok (2026-10-04)**
- **T77 Tower des Mitspielers ansehen (E39)**: Auf einen Tower des anderen klicken. Erwartung: Panel „NOAH'S …“ mit
  „view only“, Werte und Upgrade-Stufen sichtbar, keine Kosten, kein Verkauf; Zielmodus, Upgrades, U, Entf und C tun
  nichts. Sein Research Center lässt sich nicht auswählen.
  **ok (2026-10-04)**
- **T78 Gold frei senden (E36)**: Im Gold-Menü der Squad-Box einen Betrag tippen, Send. Erwartung: genau der Betrag
  kommt an; mehr als man hat, 0 oder Kommazahl geht nicht.
  **ok (2026-10-04)**
- **T79 Run-Log ans Relay (E38)**: Relay mit `RELAY_COLLECT_RUNS=1`, ein Coop-Spiel bis Game Over. Erwartung: einmal
  die Frage „Help improve 3DTD?“, nach „Yes“ im Chat „Run log sent. Thanks!“; auf der Statusseite nach Unlock
  „Run logs“ mit beiden Logs des Raums, Download geht. Runs-Dialog: Haken ändert die Antwort.
  **ok (2026-10-07)**, per Browser-Probe: beide gefragt, nach „Yes, send it“ „Run log sent. Thanks!“, auf der Statusseite beide Logs des Raums, Download geht. Der Haken im Runs-Dialog ist nicht geprüft.
- **T80 Statusseite (E33)**: Token eintragen, Unlock. Erwartung: „unlocked“ bzw. „wrong token“, Knöpfe nur mit
  gültigem Token; Logo und Favicon da; das Log schreibt `metrics:` nur bei Änderung.
  **ok (2026-10-07)**, per Browser-Probe: „wrong token, locked“ bzw. „unlocked …“, Run logs nur mit Token, Logo und Favicon da. `metrics:` kam im Spiel jede Minute, die Zahlen änderten sich jedes Mal; eine ruhige Minute ohne Zeile ist nicht geprüft.
- **T81 Start ohne Route (E34 Punkt 7)**: nur wenn ein Spawn keine Route findet. Erwartung: „Start match“ gesperrt mit
  „Spawn N has no route“.
  **ok (2026-10-04)**
- **T83 Forschung des Mitspielers (E35)**: Der andere forscht etwas; bei dir in der Squad-Box den Kolben an seiner
  Zeile klicken. Erwartung: Forschungsfenster auf seinem Reiter, „VIEW ONLY“, sein Fortschritt läuft mit, keine
  Knöpfe; Reiter „You“ zeigt deine Forschung wie gewohnt. Allein keine Reiter.
  **ok (2026-10-04)**
- **T82 Downloads in der App (E37)**: Run-Log speichern und Screenshot. Erwartung: Speichern-Dialog für das Log, der
  Screenshot geht still nach Downloads und die Foto-Leiste nennt die Datei.
  **ok (2026-10-04)**
- **T84 Verbindung weg (E40)**: Im Coop-Spiel den Relay stoppen. Erwartung: Dialog „Connection lost“ mit „Continue
  alone“ und „Start over alone“; beides spielt allein weiter. Stirbt das HQ ohne Verbindung: Hinweis auf dem
  Game-Over-Screen, Restart spielt allein.
  **ok (2026-10-04)**
- **T85 Upgrades ×5/×10 (E45)**: Tower wählen, Shift+U und Ctrl+U, Shift-/Ctrl-Klick auf eine Kachel. Erwartung: bis
  5 bzw. 10 Stufen, so weit das Gold reicht, über dem Tower „DAMAGE +5“ oder „N UPGRADES“; im Coop genauso.
  **ok (2026-10-04)**
- **T86 Game Over (E46)**: Lauf bis Game Over, allein und im Coop. Erwartung: vier kleine Charts je Welle (Kills,
  Towers, Gold earned, HQ health), im Coop je Spieler in Lane-Farbe mit Strichmuster und Legende, Spalte „Earned“.
  **ok (2026-10-04)**
- **T87 Leckschaden (E49)**: Welle durchlassen. Erwartung: über dem HQ steigt „−2“ für einen Zombie, „−4“ für einen
  Golem; die laufende Welle zeigt „Max HQ damage“ und je Typ „HQ −N“, NEXT-Tooltip „At the HQ each costs“.
  **kaputt (2026-10-04)**: Über dem HQ stieg nichts sichtbar auf (Rest passt). Der Text war 3 m groß, aus Übersichtshöhe ein paar Pixel. Gefixt: 12 m, helleres Rot, über dem Kristall. Nachtest.
  **Nachtest ok (2026-10-04)**: Ursache war das fehlende HQ in der Darstellung seit dem Worker-Umbau (bb775d7c).
- **T88 Lightning (E43)**: Lightning an einer Gasse. Erwartung: kein Blitz mehr in die Gasse, wenn der Gegner um die
  Ecke ist; keine Sprünge zu Bodengegnern, die der Tower nicht sieht.
  **ok (2026-10-04)**

## B Budget-Quelle: Laufplan mit HP gegen die Abwehr (2026-09-29)

Wellenquelle nach [WAVE_RUN_PLAN.md](WAVE_RUN_PLAN.md), **seit 2026-09-29 Standard** (die Adresse braucht
`waves=budget` nicht mehr). B1 ist mit dem Solo-Lauf bis W60 (2026-10-01) erledigt, die Befunde stehen in E95; der
Stand danach wird unter N geprüft. Die Bots
kommen mit ihr bis W37 bis W40, mit dem heutigen Director bis W30 bis W36 (Bot-Werte, je 6 Läufe); Bots bauen aber
anders als Menschen, darum diese Läufe. Im Coop bestimmt der Host die Quelle. Jeden Lauf am Ende über "Runs" speichern und exportieren: das Log hat je Welle Budget, Zeitfenster und
welche Gegner an ihrer Grenze hängen.

- **B1 Solo auf einer echten Karte:** `http://localhost:4200/?waves=budget`, Ort wählen, normal spielen bis zum Ende.
  Erwartung: keine Welle, die aus dem Nichts ein Drittel der HP kostet; Boss-Wellen (10, 20, 30, 40 …) fordernd,
  aber nicht tödlich; nach einem Boss eine leichtere Welle. Welle und HP-Verlust jeder auffälligen Welle notieren.
- **B2 "Why this wave":** Wave-Debug-Fenster während einer Welle. Erwartung: "Run plan, row N", das Budget in
  Sekunden, bei gekürztem Budget das Zeitfenster, bei Gegnern an ihrer Grenze deren HP-Faktor. Liest es sich
  verständlich?
  **ok (2026-10-04)**
- **B3 Vorschau:** Wellen-Panel zwischen zwei Wellen. Erwartung: Name und Anzahl der nächsten Wellen stehen fest
  und stimmen mit dem, was dann kommt; Luftwarnung vor Luftwellen (7, 8, 12 …).
  **kaputt (2026-10-04)**: Name und Anzahl stimmen, aber der Tooltip der Detailzeile war ein ungegliederter Fließtext. Erst Blöcke mit Leerzeile, „hübsch ist es nicht“; seit 2026-10-05 ein Detailkasten in zwei Zeilen und eine Tooltip-Karte (Stats, Mutator-Banner, Gegnerliste mit HQ-Kosten, Konter je Rüstung). Nachtest: Kasten und Karte an W7, W10 und W14 lesen.
  Nachtest des Kastens als S2.4.
- **B4 Coop:** Host öffnet mit `?waves=budget` einen Raum, der Gast kommt über den normalen Einladungslink (ohne
  `waves`). Erwartung: beide spielen denselben Plan (gleiche Wellennamen), keine Abweichung, Lauf bis zum Ende.
  **ok (2026-10-04)**

## N Balance-Nacht und Spuren (2026-10-02, auf `next`)

Nach dem Solo-Lauf bis W60 (TODO E95) neu abgestimmt, dazu die Spuren (jeder Spawn eine Spur, Gold und Forschung je
Spur). Ein Lauf mit zwei Spawns, gern über W20 hinaus; am Ende über "Runs" Run-Log und Replay exportieren.

- **N1 Bemessung beim Start:** vor einer Welle in der Pause Tower kaufen, dann starten. Erwartung: die Gegnerzahl wie
  in der Vorschau, die HP höher ("Why this wave" im Wave-Debug).
  **ok (2026-10-04)**
- **N2 Herbert (W10):** Boss-Leiste und Intro, hält deutlich länger; unter 50 % HP "ENRAGED", rot, schneller.
  **ok (2026-10-04)**
- **N3 Eliten:** etwa jeder zwanzigste Gegner einer Art gold und größer, z. B. 3 von 62 Ratten in W2; Schüsse treffen
  ihn in der Mitte.
  **ok (2026-10-04)**
- **N4 Projektile bei Tempo 4:** Gatling oder Rakete: die Geschosse fliegen sichtbar bis zum Gegner.
  **ok (2026-10-04)**
- **N5 Gelber Punkt:** auf der Route nicht mehr zu sehen; mit dem Layer "Route Grid Overlay" ist er da.
  **ok (2026-10-04)**
- **N6 Zombie Soldier (W9 Tank Column):** Vorschau im Wellen-Panel gut zu erkennen.
  **ok (2026-10-04)**
- **N7 Forschung:** Advanced Weaponry zeigt "Wave 7" und ist bis dahin gesperrt; mit zwei Spuren kostet jede
  Forschung das Doppelte (Preis im Baum).
  **ok (2026-10-04)**
- **N8 Mutatoren:** W14 Swift (Tag in der NEXT-Leiste, Banner, schnellere Mammuts), W21 Swarm (anderthalbmal so viele),
  W28 Regeneration (brennende Mechs heilen nicht), W35 Bounty (doppeltes Kill-Gold).
  **ok (2026-10-04)**
- **N9 W20 Ooze:** mit Brut, zerfällt beim Tod in zähe Klumpen.
  **ok (2026-10-04)**
- **N10 Tentacle:** an einer Engstelle Schadenszahlen auch an den Nachbarn des Ziels.
  **ok (2026-10-04)**
- **N11 W30 Skarnax:** ein durchgekommenes Segment kostet rund 1,3 HP; W40 Golem King, W50 Dragon Matriarch mit
  Boss-Leiste, Intro und Wut.
  **ok (2026-10-04)**
- **N12 W52 Wraiths:** ein Eis-Tower verlangsamt sie nicht (Phasing).
  **ok (2026-10-04)**
- **N13 Spuren:** HQ und Spawns sind ab Welle 1 gesperrt; jede Spur bekommt die ganze Welle; beim Setzen eines Spawns
  zeigt die Leiste die Länge jeder Spur.
  **ok (2026-10-04)**
- **N14 Gesamtgefühl:** HQ fällt gleichmäßig, keine lange Strecke ohne Verlust, kein Absturz am Ende; Forschung erst
  um W38 komplett. Auf W17, W27, W44 und W50 achten (Luft und Geister).
  **ok (2026-10-04)**: Gesamtgefühl passt, releasetauglich für 0.6.
- **N15 Coop über zwei Rechner** (Protokoll 3, Relay und Client neu): Raum, Spuren je Spieler wählen, ein Lauf bis
  mindestens W10, keine Abweichung.
  **ok (2026-10-04)**
- **N16 Münze im bemannten Tower** (2026-10-03): Tower bemannen und eine Welle schießen. Das Kill-Gold klingt so leise
  wie von oben, nicht mehr deutlich lauter (Rückmelde-Sounds jetzt wie aus 400 m statt 150 m).
  **kaputt (2026-10-04)**: „Hört man immer noch viel zu sehr.“ Die Münze war schon gedämpft; laut war vermutlich der Kill-Tick des bemannten Towers (zwei hohe Noten, 0.4, ungedämpft). Gefixt: Kill-Tick 0.15, Treffer-Tick 0.12. Nachtest: ist es das gewesen?
  **Nachtest ok (2026-10-04)**: Ticks entfernt (191d5013), Ton passt.
- **N17 Tentacle-Griff** (2026-10-03): Tentacle Tower bauen, Gegner greifen lassen. Der neue Saugnapf-Griff passt zum
  Zupacken und ist neben Schüssen hörbar, nicht zu laut.
  **ok (2026-10-04)**
- **N18 Coop-Start nach Solo-Lauf** (2026-10-04, mit N15): allein ein paar Wellen spielen, dann einen Raum öffnen.
  Der Lauf läuft weiter, bis der Host „Start match“ drückt; dann fragt der Dock-Fuß „This ends your solo run (wave N)“,
  „Cancel“ lässt den Lauf stehen, „Start anyway“ startet.
  Noch nicht getestet (2026-10-04).
  **kaputt (2026-10-07)**, per Browser-Probe: auf einem Ort mit zwei Spawns wie beschrieben (Lauf bleibt in der Lobby, „This ends your solo run (wave 1).“, Cancel lässt ihn, Start anyway startet). Auf einem Ort mit einem Spawn ist der Solo-Lauf schon beim Öffnen des Raums weg, ohne Frage: `openRoom` setzt einen zweiten Spawn (`addRandomSpawn`), und der neue Spawn setzt den Lauf zurück.
- **N19 Link in die Desktop-App** (2026-10-04): einen 3DTD-Link aus dem Browser (`?l=…&s=…`) im Ortsdialog unter
  „Coordinates“ ins Feld Lat einfügen. Die App lädt HQ und alle Spawns des Links, beim ersten Start wie im laufenden Spiel.
  **ok (2026-10-04)**
- **N20 Favorit mit mehreren Spuren** (2026-10-04): einen Ort mit zwei oder mehr Spawns als Favorit speichern, einen
  anderen Ort laden, den Favoriten wieder wählen. Alle Spuren sind wieder da, die Portale wie gespeichert gedreht.
  **ok (2026-10-04)**
- **N21 Coop-Replay als Datei** (2026-10-04): ein Coop-Spiel bis Game Over. Beim Host steht „Save the replay“, beim Gast
  nicht; die Datei lädt danach allein am selben Ort über „load“ in der Wellen-Leiste.
  Noch nicht getestet (2026-10-04).
  **ok (2026-10-07)**, per Browser-Probe: „Save the replay“ nur beim Host, die Datei lädt danach allein über „load“ (Replay-Leiste „FROM FILE“).

## S Nach dem Release 0.6 (2026-10-05, auf `next`)

Gebaut in einer Sitzung mit vier Workern; Logik per Spec und Browser-Probe geprüft, hier steht, was Augen, Ohren und
echte Karten brauchen. Dev-Server auf `next`, Konsole offen.

Paket S1, Speichern und Laden (Einzelspiel, [SAVE_LOAD_PLAN.md](SAVE_LOAD_PLAN.md)):

- **S1.1 Autosave und Continue:** Ort laden, Welle 1 spielen, Seite neu laden. Erwartung: unten mittig die Leiste
  „Continue: Ort, wave 2“; Klick lädt den Lauf (Tower, Gold, HP wie vorher). Esc zeigt oben ebenfalls „Continue“.
  **ok (2026-10-07)**, per Browser-Probe: Leiste „Continue: Stuttgart, wave 2“, im Esc-Menü derselbe Eintrag; Tower, Gold, HP, Welle wie vorher. Nebenbefund: der Zähler `towerCount` der Oberfläche bleibt nach jedem Laden auf 0 (die Simulation hat die Tower).
- **S1.2 Platz speichern und laden:** Zwischen zwei Wellen Esc, „Save game“, Platz 1. Einen Tower verkaufen, „Load
  game“, Platz 1. Erwartung: Tower wieder da, Gold und HP wie beim Speichern; danach eine Welle spielen, die Tower
  schießen, Sichtlinien wie vorher.
  **ok (2026-10-07)**, per Browser-Probe: Stand nach dem Laden wie beim Speichern, die Welle danach brachte 147 Kill-Gold. Sichtlinien nicht im Bild geprüft.
- **S1.3 Anderer Ort:** Seite an einem anderen Ort neu laden, Platz 1 laden. Erwartung: das Spiel wechselt an den Ort
  des Spielstands (dauert wie ein Ortswechsel), Lauf geht weiter.
  **ok (2026-10-07)**, per Browser-Probe: von München aus Platz 1 geladen, das Spiel wechselt nach Stuttgart, Stand wie gespeichert.
- **S1.4 Datei:** „Load game“, beim Platz das Download-Symbol; dann „Load from a file“ mit dieser Datei. Erwartung:
  lädt wie S1.2. Während einer Welle ist „Save game“ gesperrt mit Grund.
  **kaputt (2026-10-07)**, per Browser-Probe: Download und Sperre in der Welle gehen („Saving works only between waves.“), aber „Load from a file“ tat bei laufendem Lauf nichts: die Rückfrage ersetzte die Seite samt Datei-Feld, „Pick file“ klickte ins Leere. Gefixt: das Feld steht außerhalb der Seiten (Spec); mit dem Fix lädt die Datei wie S1.2.

Paket S2, Oberfläche:

- **S2.1 Spielmenü (Esc):** Continue, Save, Load, Settings (Regler für Master, Effekte, Musik, Oberfläche; Grafik;
  Tempo), More (Run-Log und Replay jederzeit speichern), Restart here mit Rückfrage. Erwartung: alles wirkt sofort,
  Esc führt von einer Seite zurück und schließt auf der Liste.
  **ok (2026-10-07)**, per Browser-Probe: Einträge wie beschrieben, Regler wirken (Musik 25 → 0,25), Grafik LOW/MEDIUM/HIGH, Tempo 2x auch im Kopf, Run-Log und Replay als Datei, Restart fragt, Esc auf der Rückfrage lässt sie, Esc auf einer Seite zurück und auf der Liste zu. Nebenbefund: steht die Maus nach einem Klick noch auf einem Knopf mit Tooltip (Tempo), nimmt der Tooltip das erste Esc.
- **S2.2 Tastatur:** Munition des Helden anklicken, dann Pfeiltasten. Erwartung: die Kamera schwenkt (die Munition
  wechselt nur, wenn man per Tab dorthin kam). Held gewählt, Karte am NEXT-Kasten per Maus offen, ein Esc: Karte zu und Held abgewählt.
  **ok (2026-10-07)**, per Browser-Probe: nach Klick auf die Munition schwenken die Pfeile die Kamera, per Tab wechseln sie die Munition; ein Esc schließt die NEXT-Karte und wählt den Helden ab, kein Menü.
- **S2.3 Druck-Regler in Worten:** siehe M4.

Paket S3, Coop und Web:

- **S3.1 Coop im Browser:** auf `/play/` (nicht localhost) den Coop-Knopf. Erwartung: nur der Hinweis „Co-op runs in
  the desktop app“ mit Download-Knöpfen; ein Einladungslink `&room=…` zeigt denselben Hinweis mit Raumcode, auch im
  Dialog für den Kartenschlüssel.
- **S3.2 Forschungspreise des Mitspielers:** Coop mit einem Partner auf zwei Spuren, seine Forschung ansehen.
  Erwartung: seine Preise doppelt so hoch wie im eigenen Baum mit einer Spur.
- **S3.3 CSP der Webversion:** nach dem nächsten Deploy `curl -I …/play/` zeigt Content-Security-Policy, COOP und
  COEP; ein Spiel in Chrome und Firefox mit offener Konsole ohne CSP-Verletzung (Ortssuche, Straßen, Tiles,
  Schlüsselprüfung, Lobby). Bricht etwas: die Zeile aus `public/.htaccess` nehmen.
  Noch nicht prüfbar (2026-10-07): `/play/` liefert COOP und COEP, aber noch keine CSP; die `.htaccess` mit CSP ist erst auf `next`.
- **S3.4 Relay:** nach dem Ziehen des neuen Images eine Lobby anlegen, ein Coop-Spiel; Resync nach Hash-Abweichung
  läuft wie bisher.

Paket S4, Spiel (aus `dev/after-0.6`, Standardwerte in `tmp/plan/PAKET_2026-10-02.md`):

- **S4.1 Bauzeit:** ein gesetzter Tower wächst 5 s im Gerüst und schießt erst danach. Fühlt es sich richtig an?
- **S4.2 Camo ab W22:** getarnte Gegner schimmern, kein Tower zielt auf sie; Forschung „Scouting“ und der Archer-Pfad
  „Scout“ (250) decken sie im Umkreis von 35 m auf. NEXT warnt zwei Wellen vorher.
- **S4.3 Replay:** Replay-Datei ist `.json.gz`, Knopf „orig“ spielt im Originaltempo. Replays von 0.6.0 laden nicht
  mehr (andere Balance).
- **S4.4 Zoom in Płock:** `?l=52.55000,19.70000&s=52.54690,19.69225`, aufs Portal zoomen bis zum Anschlag.
  Erwartung: bis etwa 10 m an die Straße, kein Zurückspringen, kein Rutschen nach Norden.

Paket S6, Straßen und Gebäude (2583ac45, f4e8a2b2, 2026-10-06):

- **S6.1 Straßen laden flott:** einen neuen Ort kalt laden, Netzwerk-Reiter mit Filter „interpreter“. Erwartung: die
  Abfrage geht an overpass-api.de und kommt ohne 4 s Pause; kein Aufruf an kumi.systems.
  **ok (2026-10-07)**, per Browser-Probe (Köln, kalt): eine Abfrage an overpass-api.de, fertig nach 1 bis 2,4 s, kein kumi.systems. Nebenbei: overpass.private.coffee (Rückfall) antwortete am 2026-10-07 mit 500 ohne CORS-Kopf.
- **S6.2 Gebäude an der Route:** Quick Actions, „Layers“, „Show buildings“. Erwartung: die Häuser entlang der Routen
  (etwa die erste Reihe) sind da, weiter weg keine; nach einem neuen Spawn bringt Aus und An die Häuser an der neuen Route.

Paket S5, Linux (vor dem nächsten Release):

- **S5.1 AppImage:** das neue AppImage (statische Laufzeit, ohne libfuse2) auf einem Linux-Desktop starten.
- **S5.2 AUR:** einmalig AUR-Konto, erster Push von Arch mit `makepkg -si` und `namcap`, Secret `AUR_SSH_PRIVATE_KEY`
  ([ELECTRON_DESKTOP_PLAN.md](ELECTRON_DESKTOP_PLAN.md), „AUR-Paket“).

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
