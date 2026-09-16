# Run-Dump: Plan

**Status:** Plan, nicht gebaut. Anforderungen des Users vom 2026-09-14, aus TODO.md hierher verschoben (2026-09-16).
Der Eintrag in [TODO.md](../TODO.md) (Gruppe E) verweist hierher.

## Ziel

Ohne Daten je Welle lässt sich die Balance nicht sinnvoll prüfen (Playtest 2026-09-14, alte Liste 4, Balance bis
W30). Gewünscht ist ein vollständiger Dump des ganzen Laufs von Welle 1 bis Game Over, als Datei exportierbar, damit
Claude beim Balancing die Sachlage und den Verlauf auswerten kann:

- eine Zeitleiste aller Ereignisse mit Spielzeit und Welle (Bau, Upgrade, Verkauf, Forschung, Fähigkeit, Held-Befehl,
  Leck, Boss-Spawn, Tod);
- Stichproben im Takt (etwa jede Sekunde Spielzeit: Gold, HQ-HP, lebende Gegner, Gesamt-DPS der Verteidigung);
- je Welle ein Abschluss-Datensatz:
  - Gold: Stand zu Wellenstart und -ende, Einnahmen nach Quelle (Kill-Gold, Abschlussbonus, Meilensteine,
    Cheat-Gold), Ausgaben nach Zweck (Bau, Upgrade, Forschung, Fähigkeiten, Held), Verkäufe;
  - Welle: Nummer, Template und Zusammensetzung, Director-Entscheidung und Fairness-Gate-Werte, Boss-Variante,
    Blutmond, Dauer in Spiel- und Wanduhrzeit, Tempo;
  - Gegner: gespawnt, getötet (nach Quelle: Tower, Held, Fähigkeit), Lecks, HQ-HP vorher und nachher;
  - Tower: Typ, Position, Stufe und Upgrades, Schaden und Kills in dieser Welle, Zielwahl; Forschung, Fähigkeiten
    (Einsatz, Wirkung), Held (Stufe, Munition, Kills);
- ein Lauf-Kopf: Ort, Route, Build und Commit, Director-Modus, Cheats und Wellensprünge, am Ende das Ergebnis
  (erreichte Welle, Grund des Endes).

Dasselbe Format für Bot- und Trainingsläufe, damit Menschen- und Bot-Läufe vergleichbar sind. Vorher prüfen, was schon
erfasst wird, und darauf aufbauen statt ein zweites System daneben zu stellen.

## Richtung (User, 2026-09-14)

- Transport vermutlich über das Trainings-Backend (WebSocket :3001), das die Läufe als Dateien in einen Ordner
  schreibt, den Claude lesen kann.
- Muss in echten Welten genauso gehen wie in DevWorld, mit allen Inhalten (Held, Fähigkeiten, Bosse, Blutmond,
  Forschung).
- Drei Datenquellen fürs Balancing: menschliche Spieler, die Strategie-Bots und der Regel-Director. Das
  PPO/ONNX-Training ist vermutlich obsolet; zuerst sichten, was aus der Trainings-Infrastruktur verwertbar ist
  (WebSocket-Client, Server, Logger, AIDataCollector, Snapshot-Teile, Bot-System, Training-Session, Dashboard). Hängt an
  der Entscheidung zum ONNX-Pfad (TODO.md, B1).

## Bestand (Sichtung 2026-09-14, Pfade unter `src/app/`)

- `ai/core/ai-data-collector.service.ts` `onWaveResult()` meldet jede Welle, auch die tödliche (bei `game:over`
  schließt der Collector sie selbst ab): bester Einhängepunkt. `WaveOutcome` (`ai/core/models/wave-result.ts`) hat
  Spawns, Kills, Lecks, Fähigkeits-Kills, HQ-Schaden, Fortschritt, Gegner je Typ. Lücken: `towerPerformance` wird nie
  gefüllt, `enemyPerformance.totalDamageDealt` bleibt 0, `preWaveSnapshot` wird nie gesetzt, Zeiten sind Wanduhr durch
  Trainings-Tempo statt Spielzeit.
- `GameStateSnapshot` (`ai/core/models/game-state-snapshot.ts`) liefert Gold, HP, Verteidigung (DPS je Rüstung,
  Abdeckung, Tower-Verteilung), Lücken, DPS-Profil entlang der Route, Forschung.
- `services/infrastructure/run-stats.ts` (`RunStatsTracker`): nur Run-Summen und Lecks und HQ-Schaden je Welle, nur im
  Speicher.
- Gold: jede Buchung sendet nur `credits:changed{credits, delta}` ohne Quelle; die Aufteilung des Wellenbonus (Basis,
  Perfect, CloseCall, Milestone, Comeback, Combo, `services/economy.service.ts`) wird nicht gesendet,
  `wave:completed.credits` ist immer 0 (`managers/wave.manager.ts`).
- Director: `WaveConfig` mit Zusammensetzung kommt über `command:start-wave`; die strukturierte Begründung
  (`ai/core/decision-explainer.ts`) wird nicht gespeichert; Fairness-Gate über `gate.status`
  (`ai/core/gate-controller.ts`).
- Backend: `training-backend/utils/logger.py` schreibt `logs/training_*.jsonl` mit `wave_state`, `wave_generated`,
  `wave_result`, nur wenn ein Trainingslauf verbunden ist. Das Feld `perfect` kommt seit `cc1ee892` an, die echte
  Spielversion seit `1b4722cd`.
- Download im Browser nur privat in `services/debug/debug-state-dump.service.ts` (Dev-Knopf "Dump", ohne Spieldaten);
  seit `c551570b` gibt es eine gemeinsame Download-Hilfe für den Korridor-Snapshot.
- Replay-Recorder (`replay/replay-recorder.ts`) sieht über `onAny` alle Events der letzten Welle, speichert aber nichts
  dauerhaft.

## Anforderungen (User, 2026-09-14: "wirklich perfekt")

- Jede Lücke oben ist behoben, nicht umgangen: Speicherung auch ohne Trainingslauf, `towerPerformance` und Schaden je
  Gegnertyp gefüllt, `preWaveSnapshot` gesetzt, Zeiten in Spielzeit, Gold-Buchungen mit Quelle, Aufteilung des
  Wellenbonus gesendet, `wave:completed.credits` korrekt, Director-Begründung strukturiert gespeichert, eine gemeinsame
  Download-Hilfe.
- Die Daten gehen auf: Startgold + Einnahmen − Ausgaben = Endgold je Welle und über den Lauf; gespawnt = getötet +
  geleckt + noch lebend; Schaden und Kills je Tower summieren sich zu den Wellensummen. Diese Abgleiche laufen als
  Specs und im Dump als Prüffelder.
- Gleiche Daten in DevWorld und echten Welten, bei 1x bis 75x, mit Menschen, Bots und Director, mit allen Inhalten
  (Held, Fähigkeiten, Wurm, Ooze, Blutmond, Wellensprung, Cheats markiert).
- Versioniertes, dokumentiertes Format (eigene Doku, z. B. `docs/RUN_LOG.md`) und ein Auswerte-Skript, das einen oder
  viele Läufe zu Kurven und Kennzahlen je Welle zusammenfasst.
- Kein spürbarer Laufzeit-Preis (Budget festlegen und messen), keine Allokationen im Sub-Step.
- Spielstand im Lauf-Kopf, damit nie ein Log eines alten Stands mit einem neuen verglichen wird: Spielversion
  (`BUILD_VERSION` aus `configs/build-info.config.ts`, per Hand mit `package.json` synchron), Git-Commit und
  Dirty-Flag (beim Build eingebettet), ein Hash aller balance-relevanten Configs (Curriculum, Tower, Gegner,
  Schadensmatrix, Forschung, Fähigkeiten, Held, Boss-Varianten, Economy) und die Format-Version. Das Auswerte-Skript
  gruppiert nach diesem Hash und warnt, wenn Läufe verschiedener Stände gemischt werden.

## Balance-Fragen, die auf den Run-Dump warten

Punkte und Entscheidungen in `docs/archive/`:

- REVIEW_SPRINT_2026-09-12: Playtest 4 (Matrix, Boss-Takt, Gold bei W30), 38 (Chaos an W16/W18), Entscheidung 2
  (Chaos-Preis 200, Vorschlag 220 bis 250). Gold-Budget: nach dem Balance-Umbau steigt der Puffer bis W30 von 25 % auf
  83 %; wer W30 mit mehr als 150k Gold oder über 20 Towern erreicht, kürzt das Gold für W16 bis W30 um 20 %
  (`game-design/BALANCE_PROPOSAL_2026-09.md` §2.5).
- REVIEW_SPRINT_2026-09-13: Entscheidung 1 (Atomschlag gegen Golem und Dragon 60 statt 20 %), Befund 6
  (Skeleton-Split ungespielt, Training-`total_count` enthält die Minions).
- REVIEW_SPRINT_2026-09-14: Entscheidungen 2 (Held-Preise), 6 (Wurm 35 HP je Segment, bis 240), 8 (Ooze-Werte), 9
  (Boss-Rotation), 12 (Veteranen-Schwellen aus Bot-Logs vom 2026-08-28), 14 (Sprung-Gold), Befund 4 (Boss-Varianten
  ohne Fairness-Gate; auf Varianten-Wellen speichert der Collector die Wurm- bzw. Ooze-Welle statt der
  Director-Welle), Freischaltzeitpunkte der Fähigkeiten nur geschätzt.
- Bot-Läufe mit den neuen Inhalten (Chaos Tower, `skeleton_swarm`, Split, Nuklearschlag, Frost, EMP, Laser): keine
  Baseline, strategist und meta sind mit Läufen vor `77f3f2d` nicht direkt vergleichbar.
- HANDOVER_TRAINING_REFRESH, "Offene Punkte" (2026-09-07): Die Design-Fragen aus den Abschnitten M und N betreffen
  die Regelkurve des Directors: maximale Wellengröße, erlaubter Schaden je Welle, Ziel-Rundenlänge. In Bot-Läufen
  starben die meisten Runs in Welle 1; der Gate-Controller steuert erst ab `GATE_ADAPT_WINDOW` (4) Wellen.
- Playtest-Eindruck des Users 2026-09-14: Ooze eher zu schwach, Skarnax eher zu stark (erst in einem vollständigen
  Durchlauf bewerten).
- PLAYTEST_2026-09 E3: Wie stark Herbert, Skarnax und Ooze je Welle sein sollen (HP, Tempo, Gold gegen typische
  Tower-DPS), passt laut User nicht; dabei klären, welche Welle mit welcher Boss-Variante ins Log gehört.
- PLAYTEST_2026-09 E11: Gold einer jung getöteten Ooze hängt von der Länge ab (meist weniger, bei manchen Längen etwas
  mehr als vorher).
