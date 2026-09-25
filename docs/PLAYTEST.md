# Playtest: offene Nachtests

Stand 2026-09-25, Code-Stand `coop`. Hier stehen nur Nachtests: Fixes, die gebaut sind und auf das Ergebnis im Spiel
warten. Offene Arbeit, Bugs und Entscheidungen stehen in [TODO.md](../TODO.md). Die Punkte bis 748 samt Ergebnissen
liegen in [archive/PLAYTEST_2026-09.md](archive/PLAYTEST_2026-09.md), ältere Listen in `archive/REVIEW_*.md`.

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
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** sieben Wellen ohne HP-Verlust öffnen den Regler auf ×1,42 (die ersten vier zählt er nicht,
  `PRESSURE_WARMUP_WAVES`); nach dem Würfeln (Essen) steht die erste Welle bei „still collecting (0 of 3 waves), at
  ×1.00“ (`extras.mjs`).

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

## T Coop: Tower bemannen, Spieler-Leiste, Gold, Lobby (2026-09-24, Branch `coop`)

Relay neu starten (`npm run coop-server`, der alte kennt `rename` und die Engine-Angabe nicht), zwei Fenster, Raum wie
beim letzten Test. Nach dem Lauf reicht das Relay-Log (`logs/coop_*.log`).

- **T1 Tower bemannen (C19)**: Im Spiel einen eigenen Archer-Tower wählen, im Tower-Panel den Gamepad-Knopf („Get in and fire it yourself“) oder Taste C.
  Erwartung: Die Kamera springt in den Tower, die Maus ist gefangen, Zielen folgt der Maus ohne Ruckeln, linke Taste
  schießt, rechte zoomt, C oder Esc steigt aus und die Kamera kommt zurück. Das andere Fenster sieht den Turm drehen.
  Dasselbe einmal im Einzelspieler ohne Coop.
  **ok (2026-09-24), mit Befund:** Nach einem kurzen Klick feuerte der Archer weiter, bis die Maus sich bewegte. Ursache:
  Der Abzug wurde mit dem Tower verglichen, der im Coop einen Tick nachläuft, und so ging das Loslassen nie raus.
  Behoben, Nachtest T19. Zielen „etwas hakelig“ ist offen (TODO E29). Das Drehen im anderen Fenster und der
  Einzelspieler sind ungetestet.
- **T2 Name in der Lobby**: Vor dem Start im Dialog „Your name“ ändern, Enter. Erwartung: Das andere Fenster zeigt den
  neuen Namen; beide gleich benannt ergibt „Name 2“. Nach dem Start ist das Feld weg.
  **ok (2026-09-24)**
- **T3 Engine in der Lobby**: In der Spielerliste steht je Spieler Browser, Version und System (z. B. „Chrome 140.0.0.0,
  Windows“). Mit Chrome und Firefox im selben Raum steht darunter der Hinweis auf verschiedene Engines.
  **ok (2026-09-24)**
- **T4 Dialog beim Start**: Der Host drückt Start. Erwartung: Der Dialog geht in beiden Fenstern zu.
  **ok (2026-09-24)**
- **T5 Spieler-Leiste**: Oben mittig unter dem Tempo je Spieler ein Feld mit Lane-Farbe, Name, Gold und zwischen den
  Wellen „building“. Der Wellenknopf heißt im Coop „Ready for wave N“ mit „0/2 ready“ rechts, ohne Auto-Schalter.
  Ein Spieler klickt ihn: Der Knopf bleibt gedrückt („Wave N: ready“, 1/2), bei beiden steht bei ihm „ready“, bei ihm
  selbst zusätzlich „Waiting for …“ mit dem Namen des anderen. In der Welle verschwinden die Zustände.
  **ok (2026-09-24)**, Wunsch: Die Leiste soll untereinander links neben den Fähigkeiten stehen, die Meldungen darunter.
  Umgebaut, Nachtest T16.
- **T6 Gold senden**: Neben dem Mitspieler der kleine Knopf, dann 100. Erwartung: Das eigene Gold sinkt um 100, das des
  anderen steigt in beiden Fenstern gleich, beim Empfänger steht kurz „… sent you 100 gold“. Beträge über dem eigenen
  Gold sind ausgegraut. Im Relay-Log keine `DESYNC`-Zeile.
  **ok (2026-09-24)**, Wunsch: mehrfach senden können. Das Menü bleibt jetzt offen, Nachtest T16.
- **T7 Zusammenfinden**: Host öffnet den Raum, Gast kommt per Einladungslink. Erwartung: Beim Gast öffnet sich der
  Dialog sofort mit „Loading the host's map…“. Beide bekommen von selbst eine freie Lane. Der Host hat keinen
  Bereit-Knopf, der Gast einen großen „I am ready“. Unter der Liste steht, worauf der Start wartet („Waiting for …
  to be ready“, dann „Everyone is ready“). Der Coop-Knopf in der Seitenleiste zeigt „Coop“ plus Raumcode.
  **ok (2026-09-24)**. Offene Fragen in TODO E29: Soll man einen Raum allein starten können, soll der Host einen freien
  Extra-Spawn bereithalten, und wo sitzt der Coop-Knopf?
- **T8 Meldungen im Spiel**: Unter der Spieler-Leiste erscheinen für ein paar Sekunden: Chat aus dem Dialog des
  anderen, „… left the game“, wenn ein Fenster geschlossen wird, „… is the host now“. Relay beenden (Strg+C):
  „Connection to the coop server lost“ bleibt stehen.
  **ok (2026-09-24)**, Wunsch: Chat links unten. Die Meldungen stehen jetzt links unter der Spieler-Leiste, Nachtest T16.
- **T9 Relay aus**: Relay nicht starten, „Open a room“. Erwartung: „Found no coop server (tried ws://localhost:3003)…“.
  **ok (2026-09-24)**
- **T10 Neustart im Coop (R1)**: Game over herbeiführen (HQ fallen lassen). Beim Gast steht „The host starts the next
  run“ statt RESTART, beim Host RESTART. Danach bei beiden Welle 0, Startgold, unter der Leiste „New run started“,
  eine Welle spielen, im Relay-Log keine `DESYNC`-Zeile.
  **ok (2026-09-24)**. Die Welle danach ist ungeprüft.
- **T11 Aufholen (R2)**: Im Spiel das Fenster des Gasts 20 s minimieren, dann zurück. Erwartung: Das Spiel läuft kurz
  schneller und ist nach wenigen Sekunden wieder gleichauf; in der Statusseite des Relays liegen die Prüfsummen-
  Ticks beider Spieler danach wieder dicht beieinander.
  **kaputt (2026-09-24):** Danach Abweichungen, Gegner unsichtbar. Das Log zeigt: Das Aufholen selbst klappte, der Gast
  stand 2 min und war nach etwa 45 s gleichauf, danach stimmten die Prüfsummen noch 2 min. Die Abweichungen kamen später
  von zwei Stellen am Kommando vorbei: Der Plan der eigenen Welle zog beim Absender aus dem Spawn-Zufall, und Kill all,
  Gegner-Spawn und Gegner-Entfernen wirkten nur im eigenen Fenster. Beides behoben, Nachtest T15. „Gegner unsichtbar“
  ist ungeklärt und kommt in T15 mit.
- **T12 Sperren (R3 bis R5)**: Im Coop-Spiel Developer options „+1000 Credits“: nichts passiert, bei beiden. Ortsname,
  Würfel, HQ, Spawn und „+“ im Kopf sind ausgegraut (für den Gast schon in der Lobby). Beim Gast Tempo und Pause
  ausgegraut, Tooltip „The host sets speed and pause“. Kein Replay-Link unter dem Wellenknopf.
  **ok (2026-09-24)**, Wünsche: Cheats im Coop, der Relay soll das erlauben. Gäste sollen pausieren dürfen, das Tempo
  ist offen (TODO E29). Beides gebaut, Nachtest T17 und T18. Kill all ging, weil es am Kommando vorbeilief (siehe T11).
- **T13 Relay per LAN (R6)**: `npm start -- --host 0.0.0.0`, der Host öffnet das Spiel selbst über `http://<IP>:4200`
  (nicht localhost, sonst zeigt der Einladungslink auf localhost), zweiter Rechner nimmt den Einladungslink. Erwartung: Der Gast findet den Relay unter `ws://<IP>:3003` von selbst; im Dialog steht
  „Server <IP>:3003“.
- **T14 Server von Hand (R6)**: Startbildschirm des Dialogs, „Server“ aufklappen, Unsinn eintragen: Hinweis „no ws://
  or wss:// address“. Eine gültige, aber tote Adresse: „Can't reach the coop server at …“. Feld leeren: wieder
  automatisch.
  **ok (2026-09-24)**, Wunsch: gleich beim Eintragen prüfen, dazu ein Test-Knopf. Gebaut, Nachtest T20.

Nach dem Test vom 2026-09-24 (Relay neu starten, er kennt die Cheats und die Gast-Pause sonst nicht):

- **T15 Viele Gegner bleiben gleich**: Im Coop eine Custom Wave mit vielen Gegnern starten (Wave Debug, „Start Custom
  Wave“). Mitten darin einmal Kill all, dann noch eine Custom Wave, dazu einmal das Gast-Fenster 20 s minimieren.
  Erwartung: In beiden Fenstern gleiche Abstände und gleiches Tempo der Gegner, Kill all wirkt in beiden, im Relay-Log
  keine `DESYNC`-Zeile, nach dem Minimieren sind die Gegner sichtbar.
  **ok (2026-09-25)**, Relay-Log: 1297 s, 1353 Kommandos, 0 Abweichungen.
- **T16 Spieler-Leiste links**: Die Spieler stehen untereinander links neben der Fähigkeitenleiste, darunter „Waiting
  for …“ und die Meldungen, Chat eingeschlossen. Nichts überdeckt das Info-Overlay oben links. Im Gold-Menü dreimal auf
  100 klicken: 300 kommen an, das Menü bleibt offen, der Gold-Knopf schließt es.
  **ok (2026-09-25)**; Position und Anordnung geht an einen Designer (TODO E29).
- **T17 Cheats übers Relay**: Beim Start schreibt der Relay „cheats allowed“. Im Coop „+1000 Credits“: Gold +1000 bei
  beiden gleich. Kill all, Max upgrade, Research: wirken in beiden Fenstern. Relay mit
  `npm run coop-server -- --no-cheats`: Die Knöpfe tun nichts.
  **ok (2026-09-25)** mit Cheats; der Teil mit `--no-cheats` später.
- **T18 Pause für Gäste**: Der Gast drückt Pause (oder P): Beide stehen, im Relay-Log „paused by …“. Der Gast drückt
  wieder: Es läuft im Tempo des Hosts weiter. Der Tempo-Knopf bleibt beim Gast gesperrt.
  **ok (2026-09-25)**
- **T19 Abzug im Coop**: Archer bemannen, einzelne kurze Klicks: je ein Schuss, kein Dauerfeuer. Gedrückt halten:
  Dauerfeuer, Loslassen stoppt. Zum Vergleich einmal Gatling.
  **teilweise (2026-09-25):** Bewegung und Gefühl in der Egoperspektive sind im Coop deutlich zäher und verzögerter. Verdacht
  (unbelegt): Der Client hängt ohne Puffer an der Tick-Sperre und läuft in 4er-Sprüngen. Offen in TODO E29.
- **T20 Server-Feld prüft sofort**: Im Dialog „Server“ aufklappen, `ws://localhost:3003` eintragen, Enter: „The coop
  server at ws://localhost:3003 answers.“ `ws://localhost:9999`: „Can't reach …“. Feld leer, „Test“: prüft die
  automatische Suche.
  **ok (2026-09-25)**, Wunsch: grüner Haken bei Erfolg. Gebaut, sieht man beim nächsten Mal.
- **T21 Nicht allein starten, freier Spawn**: Auf einer Karte mit einem Spawn einen Raum öffnen: Ein zweiter Spawn
  kommt von selbst dazu. Allein ist Start ausgegraut, der Hinweis sagt „send the invite link to a second player“.
  **ok (2026-09-25)**
- **T22 Coop-Knopf im Kopf**: Rechts neben den Spawn-Knöpfen das Zwei-Personen-Icon, im Raum mit dem Raumcode
  daneben. In der Seitenleiste ist der alte Knopf weg. Einladungslink öffnet das Panel weiterhin von selbst.
  **ok (2026-09-25)**
- **T23 Panel links, Karte frei**: Vor dem Start steht das Raum-Panel links ohne Abdunklung. Daneben klappen: auf
  die Karte klicken, Kopfknöpfe, Hotkeys, Esc bricht ein Platzieren ab (und schließt das Panel nicht). Close schließt
  es. Im Spiel öffnet der Kopf-Knopf es als normalen Dialog.
  **ok (2026-09-25)**; das Panel überdeckt die FPS-Anzeige (TODO E29).
- **T24 Spawn versetzen**: Host, zwei Spawns. Im Panel bei Spawn 2 die Flagge, auf der Karte neu setzen: Spawn 1 bleibt
  stehen. Im Kopf öffnet die Flagge ein Menü „Move spawn 1/2“ und „One spawn in place of all“; mit nur einem Spawn
  setzt sie direkt, ohne Menü.
  **ok (2026-09-25)**
- **T25 Gäste ziehen mit**: Host versetzt einen Spawn oder fügt mit + einen hinzu: Beim Gast ändern sich die Spawns
  ohne Neuladen, er behält seine Lane, „ready“ ist wieder aus. Host würfelt einen neuen Ort: Der Gast lädt neu, ist
  wieder im Raum und auf seiner alten Lane. Im Relay-Log kein `DESYNC` im Spiel danach.
  **kaputt (2026-09-25):** Beim Würfeln flog der Host aus dem Raum, der Gast wurde Host. Ursache: Der Würfel lud die ganze
  Seite neu. Er wechselt jetzt ohne Neuladen wie die Ortssuche; nochmal testen. Wunsch: Lanes auch wieder entfernen
  können, gebaut (× je Lane im Panel). Nochmal testen: Spawn versetzen, +, ×, würfeln.
  **ok (2026-09-25):** Wunsch: der Gast soll vorher hören, was passiert. Gebaut: der Host meldet den Wechsel sofort
  (Relay-Nachricht `moving`), der Gast sieht „… is changing the map, it comes here next“ und im Panel einen Hinweis bis
  zur neuen Karte.
- **T26 Lane-Länge**: Im Panel je Lane Balken, Meter und Laufzeit (m:ss). Die kürzere Lane hat den kürzeren Balken.
  **ok (2026-09-25)**
- **T27 Ping**: In Panel und Spieler-Leiste je Spieler „… ms“; beim eigenen Tooltip „round trip to the coop server“,
  beim Mitspieler „about“. Zweimal Chrome lokal: wenige ms.
  **kaputt (2026-09-25):** Im Panel keine ms. Ursache: Lokal misst der Relay 0 ms, und das Panel hat die 0 als „nichts“
  behandelt. Behoben, nochmal testen.
  **ok (2026-09-25)**
- **T28 Messlauf Ruckeln (T19)**: Relay neu starten (Protokoll 4), zwei Fenster, Coop starten. 1 min eine Welle
  zuschauen, dann 1 min einen Tower bemannen, zielen und schießen. Nichts melden, der Relay loggt je Fenster alle 10 s
  eine `stats`-Zeile (Frames an der Sperre, Sub-Steps je Frame, Rückstand, Tick-Abstand, Eingabe-Verzögerung).
  **gemessen (2026-09-25):** Host an der Sperre in 62 bis 73 % der Frames, rechnet in 4er-Paketen (15 Hz), Rückstand 0;
  Gast nie an der Sperre, aber 1 bis 2 Ticks zurück, Eingabe 112 bis 195 ms. Tick-Abstand bei beiden 67 ± 7 ms. Gebaut:
  jeder Client hält einen Tick Vorrat (Tempo ±10 %), und das Auge im bemannten Tower folgt der eigenen Maus statt dem
  verzögerten Tower. Nachtest T29.
- **T29 Glatter im Coop (nach T28)**: Relay neu starten, derselbe Lauf wie T28 (1 min Welle, 1 min Tower, als Host
  und als Gast). Erwartung: Gegner laufen bei beiden gleichmäßig, im Tower dreht die Sicht direkt mit der Maus ohne
  Nachziehen. Im Log bei beiden `blocked` nahe 0 %, `behind` um 1, `input` bei beiden etwa 100 bis 130 ms.
  **ok (2026-09-25):** „deutlich besser“, Gegner ruckeln nicht mehr, der Tower nur „etwas besser“. Log: bei beiden
  `blocked` 0 %, `behind` 0,9, Eingabe 83 bis 98 ms bei Tempo 1, 0 Abweichungen.

Nach der Nacht zum 2026-09-25 (Relay neu starten, Protokoll 5; beide Fenster neu laden). Offen von oben: T25, T27.

- **T30 Kürzere Ticks**: Coop mit zwei Fenstern, 1 min Welle, 1 min Tower bemannen. Erwartung: flüssig wie in T29, der
  Tower spürbar direkter. Im Relay-Log in den `stats`-Zeilen `input` etwa 40 bis 70 ms (vorher ~95).
  **ok (2026-09-25):** Log: `input` 46 bis 63 ms (vorher ~95), `blocked` 0 bis 2 %.
- **T31 Schuss beim Klick**: Im Coop einen Tower bemannen, einzelne Klicks. Erwartung: Mündungsfeuer, Ton und Rückstoß
  sofort beim Klick, nicht doppelt; Projektil und Treffer kurz danach.
  **ok (2026-09-25)**
- **T32 Panel unter der FPS-Anzeige**: Raum öffnen: Das Panel steht links unter dem Info-Overlay oben links, auch wenn
  man das Overlay auf- und zuklappt; es reicht nicht unter den Fensterrand.
  **teils (2026-09-25):** steht unter der FPS-Anzeige; Wunsch: „einfach darunter, bottom-left quasi“. Gebaut: das Panel
  dockt unten links über der Logo-Zeile an, ein hohes reicht bis unter die FPS-Anzeige. Nachtest T46.
- **T33 Du oben in der Leiste**: Im Spiel steht man selbst oben in der Spieler-Leiste, etwas größer, mit „you“; der
  Host trägt „host“. Beim Gast: der Host steht an zweiter Stelle.
  **ok (2026-09-25)**
- **T34 Warten auf den Langsamsten (R2)**: Im Spiel das Gast-Fenster 10 s minimieren. Erwartung: Nach etwa 3 s steht
  das Spiel beim Host, „Waiting for … to catch up“, in der Leiste beim Gast „catching up“; nach dem Zurückholen läuft
  es weiter. Im Relay-Log „waiting for … to catch up“.
  **ok (2026-09-25):** Log „waiting for … to catch up“ mehrfach.
- **T35 Hinweis beim Beitritt (R11)**: Startbildschirm des Panels: unter dem Raum-Feld der Satz, dass die Seite beim
  Beitritt neu laden kann.
  **ok (2026-09-25)**
- **T36 Rauswerfen und Schließen (R9)**: Host drückt in der Lobby das × beim Gast: Der Gast ist raus mit „The host took
  you out of the room.“. Host hakt „Closed to new players“ an, ein weiterer Beitritt bekommt „The host closed the room
  to new players.“.
  **ok (2026-09-25)**
- **T37 Ohne Kartenschlüssel (R8)**: Einladungslink in einem Inkognito-Fenster öffnen. Erwartung: Token-Bildschirm mit
  dem Satz zum Coop-Raum, Panel sagt „Enter your map key first“. Schlüssel eintragen: Karte lädt, Beitritt von selbst.
  **nicht testbar (2026-09-25):** Inkognito hat den Schlüssel auch, er kommt aus `environment.ts`, das im Build steckt.
  Gebaut: `?nokey` in der URL lässt die Schlüssel des Builds weg. Nachtest T47.
- **T38 Allein weiter (R10)**: Im Spiel den Relay beenden (Strg+C). Unter der Meldung „Continue alone“: Klick, das Spiel
  läuft als Einzelspieler weiter, die Lane des anderen ist zu.
  **kaputt (2026-09-25):** danach keine Welle, kein Tower, keine Cheats. Ursache: ohne Relay liefen Befehle als
  Spieler `local`, im Lauf heißen die Spieler aber wie im Coop (`p8`); jeder Befehl fiel weg. Behoben (Befehle des
  lokalen Spielers), dazu zählt so ein Lauf nicht mehr als Rekord. Nochmal testen.
- **T39 Chat unten links (R12)**: Im Spiel Enter: Eingabezeile unten links, Text, Enter schickt, Esc schließt. Beim
  anderen erscheint die Zeile unten links, nicht mehr unter der Spieler-Leiste.
  **ok (2026-09-25):** Wunsch: weiter links, unter der Spieler-Leiste. Gebaut: der Chat steht jetzt direkt unter der
  Leiste. Nochmal ansehen.
- **T40 Karten-Ping (R13)**: Im Spiel X, dann auf die Karte klicken: Bei beiden steht dort „▼ Name“ in der Lane-Farbe
  mit Ton, beim anderen die Meldung „… marked a place on the map“. X und Esc bricht ab.
  **ok (2026-09-25):** Wunsch: deutlicher, größer, Kreis außen herum, Hinweis am Rand. Gebaut: größere Schrift, drei
  Ringe in Lane-Farbe wachsen auf 45 m, Pfeil mit Namen am Bildrand, solange die Kamera woanders ist (Klick fährt hin).
  Nochmal ansehen.
- **T41 Tower des Partners (R14)**: Der Partner baut einen Tower: Bei dir trägt er einen Ring in seiner Lane-Farbe.
  Klick darauf: „That is …'s tower“.
  **kaputt (2026-09-25):** Ring nicht in Lane-Farbe. Ursache: der Ring wurde gesetzt, bevor das Modell geladen war, und
  fiel weg. Behoben, nochmal testen.
- **T42 Lecks je Lane (R15)**: Gegner durchlassen: In der Leiste beim Spieler, dessen Lane es war, „N through“ in
  Orange; mit der nächsten Welle wieder weg.
  **ok (2026-09-25)**
- **T43 Game over im Coop (R16)**: HQ fallen lassen: unter der Zusammenfassung eine Tabelle je Spieler (Kills, Leaks,
  Towers, Gold given, Gold). In „Runs“ steht der Lauf als „coop: Ann, Bob“; die Weltkarte zeigt keinen neuen Rekord
  aus dem Coop-Lauf.
  **ok (2026-09-25)**

Nach den Nachtests vom 2026-09-25 vormittags (Relay neu starten; beide Fenster neu laden). Im ersten Raum des Morgens
(09:36) gab es einen `DESYNC` nach 3 Befehlen, Ursache offen: der Relay schreibt jetzt bei der ersten Abweichung die
Befehle davor ins Log. Kommt wieder einer, das Log melden.

- **T44 Raumcode kopieren**: Raum öffnen, oben im Panel auf den Code klicken. Erwartung: Häkchen, der Code ist in der
  Zwischenablage.
- **T45 Gast hört den Kartenwechsel (T25)**: In der Lobby würfelt der Host einen neuen Ort (oder setzt einen Spawn).
  Erwartung: beim Gast im Panel sofort „The host is changing the map“, bis die neue Karte da ist.
  **ok (2026-09-25):** danach beim Gast der volle Ladebildschirm. So gewollt, wo der Host den Ort wechselt (der Gast lädt
  den neuen Ort); bei geänderten Spawns am selben Ort lädt nichts.
- **T46 Panel unten links (T32)**: Raum öffnen: das Panel steht unten links über der Logo-Zeile; wird es hoch, reicht
  es bis unter die FPS-Anzeige und scrollt.
- **T47 Ohne Kartenschlüssel (T37)**: Einladungslink im Inkognito-Fenster öffnen und `&nokey` anhängen. Erwartung:
  Token-Bildschirm mit dem Satz zum Coop-Raum, Panel „Enter your map key first“. Schlüssel eintragen: Karte lädt,
  Beitritt von selbst.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Token-Bildschirm nennt den Raum (`coop-look.mjs`).
- **T48 Allein weiter (T38)**: Im Spiel den Relay beenden, „Continue alone“. Erwartung: Welle starten, Tower bauen und
  Cheats gehen; die Lane des anderen bleibt zu. Game over danach: kein neuer Rekord auf der Weltkarte.
  **ok (2026-09-25)**
- **T49 Chat unter der Leiste (T39)**: Im Spiel Enter, Text, Enter. Erwartung: Eingabe und Zeilen direkt unter der
  Spieler-Leiste.
- **T50 Karten-Ping deutlicher (T40)**: X, Klick auf die Karte. Erwartung: größeres „▼ Name“, drei Ringe in
  Lane-Farbe wachsen aus dem Punkt. Beim anderen, Kamera woanders: Pfeil mit Namen am Bildrand, Klick fährt hin.
  **ok (2026-09-25):** der Hinweis nach X war unten links kaum zu sehen. Gebaut: eigene Fläche mit Goldrand wie die
  Chat-Eingabe. Nochmal ansehen.
- **T51 Partner-Ring (T41)**: Der Partner baut einen Tower. Erwartung: Ring in seiner Lane-Farbe, auch beim ersten
  Tower eines Typs.
  **ok (2026-09-25):** der Ring soll nur bei Hover da sein, immer an nervt. Gebaut: Lane-Farbe bei Hover und Auswahl.
  Nochmal ansehen.
  **Nachtest offen (Auge):** „nur bei Hover“ ist per Renderer-Spec gesichert; im Browser-Lauf fanden die Kameras
  von Host und Gast nicht verlässlich dieselbe Stelle.
- **T52 Chat in der Lobby**: Vor dem Start im Panel unten „Say something“, Text, Enter. Erwartung: die Zeile steht bei
  beiden im Panel, die neueste unten sichtbar.
  **ok (2026-09-25):** doppeltes Scrollen (Dock und Chat) war das Schlimmste. Gebaut: das Dock im Raum zweispaltig
  (820 px), links Raum, Spieler, Lanes, Optionen, rechts der Chat über die volle Höhe; nur der Chat scrollt,
  links nur bei Platzmangel. Nochmal ansehen.
- **T53 Fähigkeiten oben**: Die Fähigkeitenleiste steht links direkt unter der FPS-Anzeige (nicht mehr mittig) und rückt
  mit, wenn man das Overlay auf- und zuklappt.
  **ok (2026-09-25)**

Nach dem Design-Handover vom 2026-09-25 (Plan C8, D37 bis D46; Relay neu starten, Protokoll 6; beide Fenster neu
laden). T46 (Panel unten links), T49 (Chat unter der Leiste) und T53 (Fähigkeiten oben) sind damit überholt: das
Dock steht jetzt rechts neben der Fähigkeitenleiste, Squad und Chat unten links; T53 gilt weiter.

- **T54 Dock, Einstieg**: Ohne Raum das Zwei-Personen-Icon im Kopf. Erwartung: Dock rechts neben der
  Fähigkeitenleiste, oben auf ihrer Höhe, ohne Schleier; Name, Karte „Host this map“ mit „Open room“, „OR“, Karte
  „Join a room“ mit Code-Feld, unten „SERVER · …“ zum Aufklappen mit Test. X schließt.
  **ok (2026-09-25):** das Fenster scrollte quer (Eingabefeld 100 % plus Rand). Behoben (`box-sizing`).
- **T55 Beitritt als Schrittliste**: Gast öffnet den Einladungslink. Erwartung: Dock „Joining <Code>“, Schritte
  Connected, Room found, Loading the host's map (mit % und Balken, solange geladen wird), Taking a seat; danach die
  Lobby. „Cancel“ bricht ab.
  **ok (2026-09-25):** nur, wenn man schon im Spiel war; beim frischen Einladungslink steht zuerst der Ladebildschirm
  davor, das Dock kommt danach.
- **T56 Lobby als Host**: Raum öffnen. Erwartung: großer Code, „Code“ und „Invite link“ kopieren mit „Copied“,
  Schalter „Open to new players“/„Locked“, Statuszeile „Waiting for a second player“, leerer Platz mit „Copy
  invite“; „Start match“ grau, Tooltip nennt den Grund. Mit Gast: der Host steht auf „✓ Ready“, ohne Knopf.
  **ok (2026-09-25):** der eigene Name war nicht als änderbar zu erkennen. Gebaut: vertieftes Feld mit Stift.
- **T57 Lanes im Dock**: Je Lane Farbe, Balken, „m · m:ss“, „You“, Name oder „Free · take“ (Klick nimmt sie).
  Fliegen (Nadel), beim Host Versetzen (Flagge) und Entfernen (×).
  **ok (2026-09-25)**
- **T58 Mode & options**: Host klappt „Mode & options“ auf, setzt Pause auf „Anyone“. Erwartung: beim Gast fällt
  „Ready“, in beiden Chats „<Host> set Pause: Anyone“; der Gast sieht die Werte nur zum Lesen mit Schloss-Hinweis.
  Zugeklappt Chips. Game mode: PvE Coop aktiv, Versus grau mit SOON.
  **ok (2026-09-25):** unklar, dass „edit“ aufklappt. Gebaut: Knopf „Edit“/„Hide“ mit Pfeil; für den Host von Anfang
  an offen.
- **T59 Cheats nach Regel**: Relay mit Cheats. Host setzt Cheats „Host only“, Start. Erwartung: „+1000 Credits“ des
  Hosts wirkt bei beiden, der des Gasts nirgends; Squad zeigt „CHEATS ON“. Mit `-- --no-cheats` sind „Host only“ und
  „Everyone“ grau.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Host 100 → 1100 bei beiden, Gast-Cheat ohne Wirkung, CHEATS ON; mit `--no-cheats` beide
  Cheat-Knöpfe grau (`coop-rules.mjs`, Bilder `tmp/checks/t59-*`).
- **T60 Pause nach Regel**: Standard (Host only): der Gast kann nicht pausieren, Knopf gesperrt mit Tooltip, P tut
  nichts. „Anyone“: der Gast kann. „Off“: niemand.
  **übersprungen (2026-09-25)**
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Standard: Gast gesperrt, sein Klick tut nichts, Host pausiert beide; „Anyone“: Gast pausiert und
  setzt fort. „Off“ nicht geprüft.
  **„Off“ ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** bei Host und Gast gesperrt, Klick und P pausieren nichts (`extras.mjs`).
- **T61 Next wave**: „Host starts“: beim Host heißt der Knopf „Start wave N“ und startet sofort. „Auto 10 s“: nach
  einer Welle zählt der Knopf bei beiden herunter und die Welle startet von selbst; sind vorher alle bereit, sofort.
  **ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** „Host starts“: Host-Knopf „Start wave 1“, startet sofort; „Auto 10 s“: Gast zählt „· 8s“,
  Welle 2 startet von selbst; alle bereit startet Welle 1.
- **T62 Squad und Chat unten links**: Im Spiel. Erwartung: Squad-Box mit dir oben (YOU, HOST), „SPAWN n · BUILDING“
  oder „READY“, Credits, Ping-Balken; das Häkchen setzt dich bereit, beim Partner öffnet die Münze das Gold-Menü; Fuß
  „Waiting for …“ bzw. „waiting for you“ mit Space. Minus klappt auf eine Zeile „1/2 READY“. Darunter der Chat auf
  einem Schleier, alte Zeilen blasser, Systemzeilen in Mono; Enter schreibt, X markiert, Tab öffnet das Dock.
  **ok (2026-09-25):** „waiting for you“ irreführend. Jetzt „Ready up for the next wave“ mit Space.
  **Nachtest ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** Fuß „Ready up for the next wave“ mit Space; X zeigt den Hinweis auf eigener Fläche
  (T50). Dabei gefunden und behoben: Credits in der Squad-Box mit Tausenderpunkt („1.100“), im Kopf ohne.
- **T63 Raum-Chip und Dock im Spiel**: Im Kopf Code, ein Quadrat je Spieler in Lane-Farbe, „2/4“. Klick oder Tab
  öffnet das Dock auch im Spiel: Optionen nur lesen, unten nur „Leave“; das Spiel läuft daneben weiter.
  **ok (2026-09-25):** der Chip passte nicht in den Kopf und blieb nach dem Klick im Fokus. Gebaut: der Coop-Knopf im
  Stil der Kopf-Knöpfe (aktiv), kein Fokus nach dem Klick.
  **Nachtest ok (Browser-Lauf `tools/screenshot`, 2026-09-25):** nach dem Klick kein Fokus auf dem Knopf; Einstieg scrollt nicht quer (T54), eigener
  Name als Feld (T56), Optionen beim Host offen, beim Gast „Show all“ (T58).
- **T64 Mono-Schrift**: Zahlen, Codes und Tasten stehen jetzt in JetBrains Mono (vorher Consolas). Erwartung: Kopf-
  Leiste, Sidebar und Dialoge ohne abgeschnittene oder umbrechende Werte.
  **ok (2026-09-25)**

- **T65 Der Host sieht den Gast kommen (D47)**: Gast öffnet den Einladungslink, danach würfelt der Host einen neuen Ort.
  Erwartung: beim Host sofort „Bob joined“, in Bobs Zeile „Loading the map…“, Statuszeile „Waiting for Bob to load the
  map“, danach „Bob's map stands“. Beim Würfeln „Bob reloads for the new place, back in a moment“ statt „Bob left“.
  **ok (E2E, 2026-09-25):** Beitritt per Einladungslink und das Neuladen beim Würfeln; der Gast landet wieder auf
  seiner Lane, kein „Bob left“ (`e2e/tests/coop-lobby.e2e.ts`). Seit 2026-09-25 lädt der Gast dabei nicht mehr neu, er
  wechselt den Ort in der Seite (Chat „Bob is loading the map“); E2E ok, dieselbe Seite, dieselbe Lane.

- **T66 LAN-Spiel zu Hause (C4d)**: Zwei Rechner mit der Desktop-App aus diesem Stand (`cd desktop && npm run dist`,
  oder `npm run dev` auf beiden). Rechner A: Tab, „Host LAN game“, die Windows-Firewall fragt einmal, „Private
  Netzwerke“ erlauben. Rechner B: Tab. Erwartung: unter „Games on this network“ binnen zwei Sekunden „A · 1/4
  players · 192.168.x.y · CODE“, „Join“ bringt B in den Raum, Spiel läuft wie im Browser. Dann gegenprüfen: A im WLAN,
  B am Kabel; einer mit VPN an. Findet B nichts: nach 4 s kommt das Feld „Host IP“, A zeigt seine Adresse im Raumkopf
  hinter „LAN“. Schon geprüft (2026-09-25, ein Rechner): Relay startet aus `app.asar`, die Suche findet ihn über alle
  drei Adapter, „Leave“ beendet ihn.
  **ok (2026-09-25, zwei Rechner, Firewall am Host aus):** Liste findet den Raum ohne IP, Beitritt, Karte zieht zum Ort
  des Hosts, Match mit einer Welle und Towern auf beiden Seiten, Tick 5734 ohne Abweichung, Laufzeit unter 1 ms.
  „Ask“ mit IP findet den Raum über `/status`. Gefunden und behoben: eine zweite Suche beendete die der Liste (danach
  „No game answered“ trotz Eintrag), das IP-Feld blieb bei gefüllter Liste stehen; neu ein Knopf „Search again“.
  Offen: die Frage der Windows-Firewall beim Hosten; der Weg vom Start der App bis in den Raum (E30), die Wege übers
  Internet (E31).
- **T68 Squad-Box springt nicht mehr** (User, 2026-09-25): Im Coop-Spiel die Welle abwarten, bereit setzen, die nächste
  starten. Erwartung: Der Fuß der Squad-Box („Ready up for the next wave“, „Waiting for …“) bleibt als Zeile stehen,
  auch leer; Box und Chat darunter verschieben sich nicht mehr.
- **T69 Tastenleiste unter dem Chat lesbar** (User, 2026-09-25): „Enter chat · X mark · Tab room“ auf heller Karte.
  Erwartung: eigene dunkle Fläche, gut lesbar.
- **T70 Beitreten ohne eigenen Ort und das neue Dock (E30, E31 Schritt 1)**: App frisch starten (Standortdialog).
  Reiter „Coop“: „Same network“ mit Liste und „Online“ mit Code. Auf dem anderen Rechner „Host LAN game“, hier in
  der Liste „Join“. Erwartung: der Dialog schließt, der Ort des Hosts lädt einmal, danach geht das Dock mit der Lobby
  auf. Im Dock: keine Server-Adresse mehr, Raumkopf „LAN“; Zahnrad unter „Online“ zeigt die Lobbies. Geprüft per
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
