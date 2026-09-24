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
es hier. Ein Lauf bis mindestens Welle 30 reicht für M1 bis M4. Am Ende den Lauf über "Runs" speichern: M2 und M3 rechnet der
Lead aus der Datei nach, mitzählen ist nicht nötig.

- **M1 Die HP-Zahl**: Der Spieler startet jetzt mit **500 HP** statt 100, ein durchgekommener Gegner kostet 1
  (bis W30), 2 (bis W60), 3 (bis W90). Erwartung: Die Anzeige bleibt lesbar, der Balken fühlt sich nicht
  belanglos an, und ein einzelner Durchbruch tut weh, ohne den Lauf zu entscheiden. Wenn 500 als Zahl komisch
  wirkt: Es geht nur um die Auflösung, jede andere Zahl mit demselben Verhältnis täte es auch.
  **ok (2026-09-23)**
- **M2 Keine toten Strecken**: Über die Wellen 10 bis 30 mitzählen, wie viele gar nichts kosten. Erwartung:
  keine lange Serie mehr, in der man nur zusieht. Vorher waren es im Schnitt elf Wellen am Stück.
  **Befund (2026-09-23, New York, bis W34)**: W18 bis W29 zwölf Wellen ohne jeden HP-Verlust. Folge von M3: bei 19 HP
  kann der Regler nicht mehr messen (ein Leck sind 5 %, sein Band 1,2 bis 3,7 %).
- **M3 Keine Wand**: Erwartung: Der Lauf endet nicht an einer einzelnen Welle, die plötzlich alles mitnimmt,
  sondern weil es über mehrere Wellen enger wird. Wenn doch eine Welle heraussticht, ihren Namen notieren.
  **Befund (2026-09-23)**, behoben, Nachtest Q1: W15 Golem Squad, 489 Golems, 387 durch, 438 → 51 HP (88 %). Ursache im Code: die
  Anzahl über der Template-Obergrenze (`count × Multiplikator`, `wave-config-builder.ts:211`) wird nicht am
  Überlebbarkeits-Deckel begrenzt. Deckel 221, geschickt 489 bei ×8,15, dazu HP-Hebel ×2,85. Der Regler öffnete
  von W10 bis W15 je Welle um ×1,42, obwohl die Wellen 0,9 bis 1,5 % kosteten, knapp unter dem Band.
- **M4 "Why this wave"**: Im Wave-Debug-Fenster steht jetzt "Pressure loop: waves cost X % of HP on average,
  ... so it opened/closed to ×Y" statt der alten Leck-Zeile. Erwartung: Die Zahlen passen zu dem, was man
  gerade erlebt hat.
- **M5 Nach einem Ortswechsel**: Der Regler ist Zustand pro Lauf. Erwartung: Ein neues Spiel startet wieder bei
  ×1,00, also mit normal großen Anfangswellen, egal wie der Lauf davor lief.
  Vor dem Test gefunden (2026-09-23): Ein Ortswechsel setzte den Director gar nicht zurück, nur der
  Neustart-Knopf. Behoben, der Director hängt jetzt an `game:reset`.

## Q Balance-Runde nach dem New-York-Lauf (2026-09-23)

Aus M2/M3 und der Gold-Auswertung. Ein Lauf bis mindestens W31, am Ende über "Runs" speichern.

- **Q1 Keine Wand in W15**: Golem Squad bleibt beim Überlebbarkeits-Deckel. Erwartung: keine Welle, die auf einen
  Schlag den Großteil der HP nimmt. Im Wave Debug steht bei W15 keine Anzahl über dem Deckel.
- **Q2 Ein Herbert in W10**: Erwartung: genau ein Herbert, dazu Tanks und Zombies.
  **ok (2026-09-23)**
- **Q3 Bosse der Kampagne**: W20 der Ooze, W30 Skarnax (per "Jump to wave" 20 und 30 prüfbar). Erwartung:
  beide schaffbar, aber spürbar. Ihre HP entsprechen der Welle, die der Director dort geplant hätte.
  **ok (2026-09-23)**
- **Q4 Gold**: Ein Herbert, Mammut oder Golem bringt sichtbar mehr als ein Zombie derselben Welle (Kopfgeld nach
  Wurzel der Basis-HP). W21 bis W30 wachsen je Welle um ×1,2, nach W30 fällt das Einkommen je Welle nur noch
  um ×0,85 statt ×0,5. Die Auswertung macht der Lead aus der Datei.
- **Q5 Alt**: Option "Health Bars" aus, Alt halten: Balken erscheinen, loslassen: weg. Option an: Alt blendet
  sie aus. Danach tippt die nächste Taste ins Spiel, nicht in die Menüleiste des Browsers.
  **ok (2026-09-23)**

## R Replay als Neu-Simulation und Determinismus (2026-09-24, Branch `simulator`)

Das Replay rechnet eine Welle jetzt noch einmal, statt eine Aufnahme abzuspielen ([REPLAY.md](REPLAY.md)). Dazu
drehen sich Turrets in der Simulation, und die Sichtlinie kommt nur noch aus den gespeicherten Zellen
([SIMULATOR_PLAN.md](SIMULATOR_PLAN.md)). Eine echte Karte, drei, vier Wellen mit ein paar Towern und dem Helden, dabei
mitten in einer Welle upgraden, Zielwahl ändern, eine Fähigkeit werfen.

Paket 1, das Replay selbst:
- **R1 Abspielen**: Nach einer Welle "replay W3" unter dem Wellen-Knopf. Erwartung: Die Welle läuft wie gespielt,
  mit Schadenszahlen, Gold, Sounds, Upgrades zur richtigen Zeit. In der Leiste steht **kein** "differs from".
  **ok (2026-09-24)**
- **R2 Springen**: Im Fortschrittsbalken nach vorn und zurück ziehen. Erwartung: Nach dem Loslassen steht das Feld
  sofort richtig da (höchstens etwa eine Sekunde Warten), kein Knall von hundert Sounds auf einmal.
  **Befund (2026-09-24)**: Springen selbst ok, aber durch mehrfaches Hin und Her ließen sich die Effekte der
  Fähigkeiten (Orbital-Laser) mehrfach auf den Schirm bringen. Behoben: das Replay räumt beim Betreten, Verlassen und
  Springen alle Schlag-Effekte ab (`clearStrikeEffects`). Nachtest **ok (2026-09-24)**.
- **R3 Wellen wechseln**: In der Leiste die Pfeile neben "Wave 3". Erwartung: Welle 2 und 1 spielen ebenso.
  **Befund (2026-09-24)**: Wechsel klappt, aber Tower aus Welle 3 standen auch in Welle 2 und 1 (ohne
  mitzukämpfen). Die Snapshots waren richtig (Replay-Datei geprüft: 2, 4, 5 Tower); Modelle, die erst nach dem
  Entfernen ihres Towers fertig luden, blieben verwaist stehen. Behoben im Tower-Renderer. Nachtest **ok (2026-09-24)**.
- **R4 Zurück ins Spiel**: Esc. Erwartung: Tower, Credits, HP, Forschung, Held, Kamera wie vorher; die nächste Welle
  startet normal; das HUD zeigt dieselben Zahlen wie vor dem Replay.
  **ok (2026-09-24)**

Nachgebaut nach R2 und R3 (2026-09-24), zusammen mit R2 und R3 nachtesten. Ein Review fand weitere Reste derselben
Art, alle behoben: Nach Springen oder Verlassen soll stimmen, was man sieht und hört.
- **R2b Nach dem Springen**: Während Feuer-Tower brennen, Gegner eingefroren oder vergiftet sind, hin und her
  springen. Erwartung: Die Glut in den Feuer-Towern bleibt, Frost- und Giftauren sind da, das HQ-Feuer (unter 50 % HP)
  brennt, kein Glöckchen beim Zurückspringen über eine Fähigkeit.
  **ok (2026-09-24)**
- **R4b Nach dem Verlassen**: Mitten in der Welle Esc. Erwartung: Aufbau-Musik statt Wellenmusik, kein roter Himmel
  nach einer Blutmondwelle, ein Tower auf Feuerpause ist grau mit Pausenzeichen, Reichweitenringe nach
  Reichweiten-Upgrade stimmen, kein Grollen eines Atomschlags aus dem Replay.
  **ok (2026-09-24)**
- **R4c Aus dem bemannten Tower**: In einem Tower sitzen (C), dann "replay". Erwartung: Das Replay startet mit freier
  Kamera; nach Esc steht man draußen.
  **entfällt (2026-09-24)**: In der Egoperspektive ist der Replay-Einstieg nicht erreichbar; der Ausstieg im
  Code bleibt als Absicherung.

Paket 2, Datei und Grenzfälle:
- **R5 Speichern und Laden**: Im Replay "Save". Seite neu laden (F5), denselben Ort, dann "load" im WAVE-Panel und die
  Datei wählen. Erwartung: Das Replay läuft, in der Leiste "from file", kein "differs from".
  **ok (2026-09-24)**
- **R6 Andere Karte**: Einen anderen Ort laden, dieselbe Datei laden. Erwartung: Unter den Knöpfen steht, dass das
  Replay auf einer anderen Karte gespielt wurde; nichts startet.
  **ok (2026-09-24)**
- **R7 Game Over**: Einen Lauf verlieren, "Replay wave N" auf dem Game-Over-Screen. Erwartung: Die letzte Welle bis
  zum Fall des HQ; Esc führt zurück auf den Game-Over-Screen.
  **ok (2026-09-24)**
- **R8 Klick direkt nach der Welle**: Sofort nach dem Wellenende auf "replay" klicken, während noch Schüsse fliegen.
  Erwartung: Das Replay startet nach spätestens ein paar Sekunden von selbst.
  **im Spiel schwer zu treffen (2026-09-24)**; per Spec abgedeckt (`replay.service.spec.ts`: wartet, startet von
  selbst, gibt nach 5 s auf).

Paket 3, Spielgefühl nach dem Umbau:
- **R9 Turrets**: Einen Cannon bauen, während sein Modell noch lädt. Erwartung: Er schießt erst, wenn der Turm zum
  Ziel gedreht ist (vorher schoss er in dieser Zeit sofort).
  **ok (2026-09-24)**
- **R10 Reichweitenrand**: Mit "Route Grid Overlay" einen Tower wählen. Erwartung: Die Sichtzellen reichen bis an den
  Rand des Reichweitenkreises; der Tower schießt auf Gegner am Rand wie bisher.
  **ok (2026-09-24)**
- **R11 Luft nach Forschung**: AA-Retrofit erforschen, während Fledermäuse laufen. Erwartung: Die Dual Gatling nimmt
  sie nach kurzer Zeit ins Ziel.
  **ok (2026-09-24)**
- **R12 Bemannter Tower**: Einen Archer bemannen (C), zielen, schießen, danach ein Replay dieser Welle. Erwartung:
  Die Schüsse im Replay gehen dorthin, wohin gezielt wurde.
  **ok (2026-09-24)**

## S Vor dem Release (2026-09-24)

- **S1 Signale zur Musik**: Wellen bei 1x und bei 4x starten und beenden. Erwartung: Erst blendet die Musik aus,
  dann kommt das Start-Signal oder das Horn in die Stille, danach die neue Musik. Bei 4x kommt das Signal, bevor die
  ersten Gegner weit gelaufen sind. Der Anfang der Signale klingt nicht mehr abgeschnitten.
  **ok (2026-09-24)**
- **S2 Bauen vor oder nach dem Start**: Neues Spiel, vor Welle 1 viele Tower bauen, Welle 1 starten, Anzahl der
  Gegner im WAVE-Panel merken. Neues Spiel am selben Ort, Welle 1 sofort starten, dann dieselben Tower bauen.
  Erwartung: dieselbe Anzahl. Ebenso ab Welle 2: Was in der Pause gebaut wird, macht die kommende Welle nicht größer.
  **ok (2026-09-24)**

## T Coop: Tower bemannen, Spieler-Leiste, Gold, Lobby (2026-09-24, Branch `coop`)

Relay neu starten (`npm run coop-server`, der alte kennt `rename` und die Engine-Angabe nicht), zwei Fenster, Raum wie
beim letzten Test. Nach dem Lauf reicht das Relay-Log (`logs/coop_*.log`).

- **T1 Tower bemannen (C18)**: Im Spiel einen eigenen Archer-Tower wählen, im Tower-Panel den Gamepad-Knopf („Get in and fire it yourself“) oder Taste C.
  Erwartung: Die Kamera springt in den Tower, die Maus ist gefangen, Zielen folgt der Maus ohne Ruckeln, linke Taste
  schießt, rechte zoomt, C oder Esc steigt aus und die Kamera kommt zurück. Das andere Fenster sieht den Turm drehen.
  Dasselbe einmal im Einzelspieler ohne Coop.
- **T2 Name in der Lobby**: Vor dem Start im Dialog „Your name“ ändern, Enter. Erwartung: Das andere Fenster zeigt den
  neuen Namen; beide gleich benannt ergibt „Name 2“. Nach dem Start ist das Feld weg.
- **T3 Engine in der Lobby**: In der Spielerliste steht je Spieler Browser, Version und System (z. B. „Chrome 140.0.0.0,
  Windows“). Mit Chrome und Firefox im selben Raum steht darunter der Hinweis auf verschiedene Engines.
- **T4 Dialog beim Start**: Der Host drückt Start. Erwartung: Der Dialog geht in beiden Fenstern zu.
- **T5 Spieler-Leiste**: Oben mittig unter dem Tempo je Spieler ein Feld mit Lane-Farbe, Name, Gold und zwischen den
  Wellen „building“. Der Wellenknopf heißt im Coop „Ready for wave N“ mit „0/2 ready“ rechts, ohne Auto-Schalter.
  Ein Spieler klickt ihn: Der Knopf bleibt gedrückt („Wave N: ready“, 1/2), bei beiden steht bei ihm „ready“, bei ihm
  selbst zusätzlich „Waiting for …“ mit dem Namen des anderen. In der Welle verschwinden die Zustände.
- **T6 Gold senden**: Neben dem Mitspieler der kleine Knopf, dann 100. Erwartung: Das eigene Gold sinkt um 100, das des
  anderen steigt in beiden Fenstern gleich, beim Empfänger steht kurz „… sent you 100 gold“. Beträge über dem eigenen
  Gold sind ausgegraut. Im Relay-Log keine `DESYNC`-Zeile.
- **T7 Zusammenfinden**: Host öffnet den Raum, Gast kommt per Einladungslink. Erwartung: Beim Gast öffnet sich der
  Dialog sofort mit „Loading the host's map…“. Beide bekommen von selbst eine freie Lane. Der Host hat keinen
  Bereit-Knopf, der Gast einen großen „I am ready“. Unter der Liste steht, worauf der Start wartet („Waiting for …
  to be ready“, dann „Everyone is ready“). Der Coop-Knopf in der Seitenleiste zeigt „Coop“ plus Raumcode.
- **T8 Meldungen im Spiel**: Unter der Spieler-Leiste erscheinen für ein paar Sekunden: Chat aus dem Dialog des
  anderen, „… left the game“, wenn ein Fenster geschlossen wird, „… is the host now“. Relay beenden (Strg+C):
  „Connection to the coop server lost“ bleibt stehen.
- **T9 Relay aus**: Relay nicht starten, „Open a room“. Erwartung: „Found no coop server (tried ws://localhost:3003)…“.
- **T10 Neustart im Coop (R1)**: Game over herbeiführen (HQ fallen lassen). Beim Gast steht „The host starts the next
  run“ statt RESTART, beim Host RESTART. Danach bei beiden Welle 0, Startgold, unter der Leiste „New run started“,
  eine Welle spielen, im Relay-Log keine `DESYNC`-Zeile.
- **T11 Aufholen (R2)**: Im Spiel das Fenster des Gasts 20 s minimieren, dann zurück. Erwartung: Das Spiel läuft kurz
  schneller und ist nach wenigen Sekunden wieder gleichauf; in der Statusseite des Relays liegen die Prüfsummen-
  Ticks beider Spieler danach wieder dicht beieinander.
- **T12 Sperren (R3 bis R5)**: Im Coop-Spiel Developer options „+1000 Credits“: nichts passiert, bei beiden. Ortsname,
  Würfel, HQ, Spawn und „+“ im Kopf sind ausgegraut (für den Gast schon in der Lobby). Beim Gast Tempo und Pause
  ausgegraut, Tooltip „The host sets speed and pause“. Kein Replay-Link unter dem Wellenknopf.
- **T13 Relay per LAN (R6)**: `npm start -- --host 0.0.0.0`, der Host öffnet das Spiel selbst über `http://<IP>:4200`
  (nicht localhost, sonst zeigt der Einladungslink auf localhost), zweiter Rechner nimmt den Einladungslink. Erwartung: Der Gast findet den Relay unter `ws://<IP>:3003` von selbst; im Dialog steht
  „Server <IP>:3003“.
- **T14 Server von Hand (R6)**: Startbildschirm des Dialogs, „Server“ aufklappen, Unsinn eintragen: Hinweis „no ws://
  or wss:// address“. Eine gültige, aber tote Adresse: „Can't reach the coop server at …“. Feld leeren: wieder
  automatisch.

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
