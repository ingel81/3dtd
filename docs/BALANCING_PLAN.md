# Balancing: Plan

**Status:** Phase 1 und 2 gebaut (2026-09-20), Phase 3 ist Plan, der Rest ist Plan. Stand 2026-09-20. Ersetzt
`RUN_DUMP_PLAN.md`, dessen Inhalt in Phase 2 aufgegangen ist. Der Eintrag E1 in [TODO.md](../TODO.md) verweist hierher. Entscheidungen stehen in Abschnitt 9.

## Ziel

Eine Partie soll fesseln: Druck, der sich aufbaut und wieder löst, echte Entscheidungen beim Gold und Wellen, die man
als eigene Herausforderung erkennt. Dafür fehlen heute zwei Dinge:

- **Daten.** Niemand sieht, wie eine Partie verläuft: wann welcher Tower gebaut und aufgerüstet wird, wie viel Gold
  wann liegt, wo es knapp wird. Das gilt für menschliche Läufe und für Bot-Läufe.
- **Eine Wellen-Pipeline, die man überblickt.** Begriffe aus dem früheren RL-Training (Curriculum, Slot, Maske) und
  vier Wellenquellen nebeneinander machen es schwer, über Regeln zu reden.

Vom User am 2026-09-19 entschieden:

- Es gibt eine feste Abfolge von Templates. Der Wave Director entscheidet darin nach Regeln.
- Der regelbasierte Director im Spiel ist der einzige Director. PPO-Training, ONNX-Modell und die Python-Directors
  fallen weg.
- Das Trainings-Backend bleibt als Transport (WebSocket `:3001`), Logger und Dashboard für Bot-Läufe.
- Bot-Läufe laufen in vier Browsern auf 75x, eine Headless-Simulation ist nicht nötig.
- Die Datensammlung von Menschen und Bots ist die Grundlage; ohne sie wird nichts getunt.
- Seeds und Determinismus sind ein Kernpunkt, auch mit Blick auf Replay und Multiplayer (Abschnitt 5).

## 1. Begriffe

Vorschlag; die Code-Namen legt Phase 1 fest. Doku auf Deutsch, Code auf Englisch.

| Heute | Neu | Code | Warum |
|---|---|---|---|
| Curriculum, `WAVE_CURRICULUM`, `CurriculumWave` | Kampagne, Kampagnenwelle | `CAMPAIGN`, `CampaignWave` | "Curriculum" stammt aus dem RL-Training (D1) |
| `CURRICULUM_FORCED_THROUGH_WAVE` (30) | Kampagnenlänge | `CAMPAIGN.waves.length` | eine Zahl weniger, die man synchron halten muss |
| Template | Template | `Template` | bleibt: Gegnermischung und Spannen für Anzahl, Abstand, HP, Mischung |
| `RuleDirector`, `WaveDirectorService`, `useAIDirector`, `aiMode`, `modelState` | Wave Director | `WaveDirector`, `directorEnabled` | "AI", "Rule" und "Model" fallen weg, es gibt nur einen |
| Faktoren `count`, `spawn`, `hp`, `variation` | Faktoren | `DirectorFactors` | bleibt, nur gebündelt |
| Maske, Slot, `MAX_TEMPLATE_SLOTS`, `describeTemplateMask` | Kandidaten | `candidateTemplates()` | Maske und 32 Slots gab es nur als Ausgang des Netzes |
| Capability-Gate (`antiAir`, `antiEthereal`) | Voraussetzung | `requires` | "Gate" ist dreifach belegt (auch Leck-Regler und `gate.sh`) |
| Fairness-Cap, `fairMaxCount` | Überlebbarkeits-Deckel | `survivableCount` | sagt, was er misst: wie viele Gegner die Verteidigung noch halten kann |
| `GateController`, `budgetMultiplier` | Druck-Regler | `PressureController`, `pressureMultiplier` | hieß bis 2026-09-21 Leck-Regler und regelte auf die Leck-Quote, siehe [DRAMA_CONTROLLER_PLAN.md](DRAMA_CONTROLLER_PLAN.md) |
| `goldKill`, `goldComplete`, `goldBudgetForWave` | Wellengold (Kill-Gold, Abschlussgold) | `waveGold()` | |
| `aiExplanation`, `AIWaveConfig` | Begründung, Director-Welle | `waveExplanation`, `DirectorWave` | |
| Boss-Variante (Skarnax, Ooze) | Kampagnenwelle | | heute ein Tausch nach der Director-Entscheidung, künftig eine Kampagnenwelle wie jede andere |
| Static Curriculum, `STATIC_WAVE_PROFILES` | entfällt (D5) | | zweite Wellenquelle neben der Kampagne |
| `src/app/ai/` | `src/app/director/`, `src/app/bots/` | | trennt Spiel und Bots |
| `training-backend/`, Skill `/training`, Fenster "AI Training" | Bot-Server | `bot-server/`, `/bots`, Fenster "Bots" | es wird nichts mehr trainiert (D16) |

Namenskollisionen, die dabei aufgelöst werden: zwei `WaveConfig` (Director und `WaveManager`), zwei
`buildWaveConfig` (`wave-config-builder.ts` und Debug-Helfer in der Facade), `SpawnPattern` neben
`TemplateSpawnPattern`. UI-Texte ziehen mit: "Curriculum: wave N is always X" im Wave-Debug-Fenster, das Fenster
"AI Training" und die Dev-Kacheln "AI" und "Static".

## 2. Ist-Stand (Sichtung 2026-09-19)

### Wie eine Welle entsteht

- **Vier Wellenquellen** (`game-loop-facade.service.ts:301`): Static-Profile (Dev-Kachel), Python-Backend (sobald ein
  Trainingslauf verbunden ist), Director im Spiel (Standard), Debug-Fallback nach einem Fehler.
- **W1 bis W30** pinnt das Curriculum das Template. Der Director entscheidet nur die vier Faktoren. `minWave`, die
  Boss-Kadenz 10 und die Voraussetzungen wirken dadurch nicht: eine Luftwelle kommt auch ohne Luftabwehr.
- **Ab W31** nimmt der Director das älteste erlaubte Template, jede fünfte Welle einen Boss. Skarnax und Ooze
  ersetzen W35, W45 usw. erst nach der Entscheidung; das ersetzte Template zählt trotzdem als gespielt.
- **Größe einer Welle:** Spanne des Templates, DPS-Rampe, Fairness-Cap mal Leck-Regler, 180-s-Deckel. In den
  Bot-Läufen vom 2026-08-28 lag die Anzahl auf 63 % der Wellen genau am Deckel; der volle Bereich des
  `count`-Faktors bewegte eine Welle von 19 auf 28 Gegner.
- **Der Python-Spiegel** (`schema.py`, `directors.py`, `server.py`, `ai-schema.json`) rechnet Maske, Deckel,
  Leck-Regler und Director ein zweites Mal. Im Training spielten die Bots gegen diese Kopie, ohne Boss-Varianten.

### Economy und Belohnungen

- Startgold 100, HQ 100 HP, keine Heilung. Leck-Schaden 1 bis W10, dann +1 je 10 Wellen, höchstens 18 HP je Welle.
  Endlos, kein Sieg, kein Score.
- **Kill-Gold** ist ein festes Budget je Welle, verteilt nach der Wurzel der Basis-HP je Körper (seit 2026-09-23,
  vorher gleich je Kopf). Ein Herbert zahlt etwa sechs Zombies derselben Welle, ein geleckter Gegner nichts.
- **Abschlussgold** mit Boni: Perfect +35 %, Combo bis +30 %, Close Call +12 %, Comeback höchstens 15 Gold,
  Meilensteine 45 bis 170 Gold. Die Aufteilung sieht der Spieler nirgends, `wave:completed.credits` ist immer 0.
- **Kurve** ohne Boni: W10 7.200, W20 74.000, W30 791.000 Gold kumuliert. Der Ziel-Endausbau (jeder Tower einmal,
  Upgrades L20, alle Forschung, RC 3, Silo, Held) kostet 474.702: 67 % Puffer, bewusst "erst nach dem Playtest"
  nachgesteuert. Seit 2026-09-23 wachsen W21 bis W30 um ×1,2 je Welle (W30 77.400 statt 120.000 Kill-Gold), und
  nach W30 fällt das Wellengold um ×0,85 je Welle statt es zu halbieren, bis auf 5 % des W30-Budgets.
- Upgrades für alle Tower gleich teuer (`50 × 1,25^Stufe`), Verkauf 75 %, Forschung zusammen 19.550 Gold.
- Nichts wird über die Wellennummer freigeschaltet; der Forschungsbaum ist der einzige Weg.

### Daten

- **Bots** (2026-08-28, vier Directors gegen `strategist`): 78 % der Wellen ohne Schaden, alle Directors
  einschließlich Zufall gleichauf. Mit vier Tabs etwa 8.000 Wellen je Stunde (aus den JSONL-Logs gerechnet).
- **Log heute** (`training-backend/utils/logger.py`): Summen je Welle. Es fehlen Tower-Liste, Upgrades, Forschung,
  Fähigkeiten und Geldflüsse nach Quelle.
- **Menschliche Läufe:** nichts. `RunStatsTracker` hält nur Summen im Speicher, der Replay-Recorder nur die letzte
  Welle.
- **Bots:** Stufen beginner, casual, strategist, meta; casual und meta haben identische Strategien, für den Helden
  gibt es keine. Nichts ist geseedet.

## 3. Soll: Kampagne und Director

- **Ausgangspunkt:** Die 22 Templates und die heutige Folge der Wellen 1 bis 30 bleiben. Sie werden umbenannt und
  auf Grundlage der Daten verbessert, nicht neu geschrieben.
- **Kampagne:** feste Folge von Kampagnenwellen. Eine Kampagnenwelle trägt Template, Wellengold, Rolle (Einführung,
  Druck, Atempause, Boss) und den Spielraum des Directors (Grenzen je Faktor). Boss-Varianten sind Kampagnenwellen
  wie alle anderen.
- **Zyklus (D2):** Nach der letzten Kampagnenwelle wiederholt sich ein Block der Kampagne mit steigender
  Skalierung. Der Director wählt nirgends mehr frei, er hat überall dieselbe Rolle. Blocklänge und Skalierung werden
  nach der Baseline festgelegt; bis dahin bleibt das heutige Verhalten ab W31.
- **Rhythmus (D17):** Die Rolle der Kampagnenwelle steuert den Director: Atempause heißt Faktoren unten im
  Spielraum, Druck oben. Der Rhythmus ist damit geplant und im Bericht nachprüfbar.
- **Wave Director (D3):** entscheidet innerhalb der Kampagnenwelle nur die Faktoren: Anzahl, Spawn-Abstand, HP,
  Mischung, jeweils in den Grenzen der Kampagnenwelle. Das Template wählt er nicht. Regeln: Rampe über den Lauf,
  Leck-Regler, Überlebbarkeits-Deckel, Dauer-Deckel. Jede Entscheidung trägt ihre Begründung, im Wave-Debug-Fenster
  wie im Run-Log.
- **Eine Wellenquelle (D5).** "Director aus" spielt die Kampagne mit festen Mittelwerten. Das Backend liefert keine
  Wellen mehr.

## 4. Phase 1: Aufräumen und Begriffe

Ziel: eine Wellenquelle, keine RL-Reste, neue Namen, geseedeter Zufall. Die Wellen bleiben dabei gleich (Abnahme
unten). Vier Pakete; 1a bis 1c bauen aufeinander auf, 1d betrifft nur das Backend.

### 1a Eine Wellenquelle, ONNX und Static-Profile raus

- **ONNX:** `onnx-policy.ts` samt Spec, die ONNX-Teile von `wave-director.ts` (Modellzustand, Laden,
  Inferenz, `setEnabled`, `forceRuleMode`), die Begründung `by: 'model'` in Director und Explainer,
  `public/assets/ai/wave-director/` (in Git), `onnxruntime-web` in `package.json` samt Postinstall-Kopie der
  WASM-Dateien und Skript `export-ai`, der Ausschluss in `angular.json`, die Zeilen in `.gitignore`.
- **Encoder:** `game-state-encoder.ts`, `ai-schema.ts`, `tools/ai-schema/` (läuft heute in jedem `npm test` und
  schreibt `ai-schema.json` ins Backend), Skript `ai-schema`. Was daran hängt: `computeDpsByDamageType` zieht in die
  Verteidigungsanalyse um, das Run-Log braucht DPS je Schadensart; `calculateWaveThreat` und
  `recentHistory.lastWaveThreat` fallen mit weg, gelesen haben sie nur Encoder und Server; `AI_ENEMY_ORDER` im
  Boss-Varianten-Spec wird ersetzt.
- **Python-Wellenpfad:** der Zweig in `game-loop-facade.service.ts` (`requestWaveConfig`), die Nachrichten `state`,
  `wave_config`, `reset` und `model_exported` in `training-session.ts`, die Aliasliste in `wave-config-adapter.ts`, der
  Sperrgrund `trainingConnected` im Boss-Intro.
- **Static-Profile (D5):** `STATIC_WAVE_PROFILES` und Helfer in `wave-curriculum.config.ts`, Zweig und Umschalter in
  der Facade, `useStaticCurriculum` im Store, Dev-Kachel "Static". `tools/model-budget` liest die Profile für eine
  Spalte in `ENEMY_MODEL_BUDGET.md`; die Spalte liest künftig die Kampagne.
- **Fenster "AI Training":** ONNX-Teile und "Training Stats" fallen weg; Tempo, Verbindung, Leck-Regler, DPS-Bins
  und Bot-Steuerung bleiben.

### 1b Umbenennung

- Namen nach Abschnitt 1 in Code, Specs, UI-Texten und Doku; `src/app/ai/core` wird `src/app/director/`,
  `src/app/ai/training` wird `src/app/bots/`.
- Weitere Namen, die Bots oder das Spieltempo meinen: `TrainingClientService`, `TrainingSession` und Verwandte
  bekommen Bot-Namen; `trainingTimescale` ist das allgemeine Spieltempo (`gameSpeed`), der localStorage-Schlüssel
  `training-timescale` wird einmal übernommen; `AIDataCollectorService` liefert nur noch den Verteidigungs-Schnappschuss
  für Director und Bots und heißt danach so; das Chunk-Budget `training-session` in `angular.json` zieht mit.
- Doku: `AI_WAVE_DIRECTOR_PLAN.md` wird `WAVE_DIRECTOR.md` ohne die RL-Geschichte; `STATIC_WAVE_FALLBACK.md` und die
  Trainings-Doku im Backend entfallen; `BOT_SYSTEM.md` folgt in 2b; `CLAUDE.md`, `INDEX.md`, `README.md`,
  `ARCHITECTURE.md`, `DEVWORLD.md`, `WAVE_SYSTEM.md` und die übrigen Fundstellen ziehen mit. `docs/archive/` bleibt
  Historie.
- TODO: B1 ("ONNX-Modell und Training bleiben") ist mit diesen Entscheidungen überholt.

### 1c Seeds

- `GameRng` (mulberry32) mit benannten Strömen `director`, `spawn`, `enemy`, `bot`; ein Lauf-Seed je Partie. VFX und
  Audio behalten `Math.random`.
- Umgestellt werden Spawnpunkt, Seitenversatz, Höhe der Luftgegner, Spawn-Plan (Jitter, Mischen), Director
  (Faktor-Jitter, Gleichstand), Bot-Strategien und der Jitter der Bot-Konfiguration.
- `GameClock` bekommt einen fortlaufenden Sub-Step-Zähler; heute gibt es nur die Spielzeit als Summe von 16,667 ms.
- Determinismus-Spec: derselbe Seed zweimal, Prüfsumme der Wellen und Spawns je Welle.

### 1d Backend wird `bot-server/`

- **Weg:** `core/` (Modell, PPO, Reward), `directors.py`, `schema.py`, `generated/ai-schema.json`, das Export-Skript,
  der PPO-Teil von `config.py` und `server.py` (Encoder, Decoder, Kopie des Leck-Reglers, Checkpoints), die
  Trainings-Metriken im Dashboard ("NN Internals", Reward), die Pytests für Director, Encoder, Leck-Regler, Reward und
  Schema. `torch`, `numpy` und `onnx` fallen aus `requirements.txt`.
- **Löschen (D12):** `checkpoints/` und die alten `logs/training_*.jsonl`. `venv` bleibt.
- **Bleibt:** WebSocket-Server mit `connect`, `result`, `game_start`, `game_over`, `status` und `control`;
  `manage_server.py`, Start-Skripte, Logger, Dashboard mit Clients, Status und Steuerung.
- **Umbenennen:** Ordner, Skill `/training` wird `/bots`, `scripts/start-training.*`, Konsolen-Tags `[Training]`.

**Stand 1a (2026-09-20, gebaut):** ONNX-Policy, State-Encoder, `ai-schema.ts`, `tools/ai-schema/`, die Skripte
`export-ai` und `ai-schema`, `onnxruntime-web` samt Postinstall und WASM-Ordner, der Wellen-Pfad des Backends
(`state`, `wave_config`, `reset`, `model_exported`, `stats`), die Gegner-Aliase des Adapters, der Sperrgrund
`trainingConnected` im Boss-Intro und die Static-Profile samt Dev-Kachel und `useStaticCurriculum` sind entfernt.
`computeDpsByDamageType` liegt jetzt in `defense-analyzer.ts` und liefert rohe DPS statt des auf 0..1 normierten
Werts, den nur das Netz brauchte. Mit `calculateWaveThreat` sind auch `lastWaveThreat` und die Forschungsquote
(`ENCODER_RESEARCH_IDS`, `completedCount`, `totalCount`) gefallen, die nur der Encoder las. `tools/model-budget`
zeigt statt des Static-Maximums das Maximum je Kampagnenwelle. `STATIC_WAVE_FALLBACK.md` ist gelöscht.

**Stand 1b (2026-09-20, gebaut):** Die Namen aus Abschnitt 1 sind im Code, in den UI-Texten und in der Doku
umgesetzt. `src/app/ai/core` ist `src/app/director/`, `src/app/ai/training` ist `src/app/bots/`. Die Maske aus 32
Slots ist eine Kandidatenliste (`candidateTemplates()` liefert Indizes plus Begründung), `MAX_TEMPLATE_SLOTS` ist
weg. `RuleDirector` ist die Funktion `decideWave()` in `director-rules.ts`, die vier Faktoren sind als
`DirectorFactors` gebündelt. `WaveDirectorService` heißt `WaveDirector`, `AIDataCollectorService` heißt
`StateSnapshotService` (er liefert den ganzen Snapshot, nicht nur die Verteidigung), `TrainingClientService` und
`TrainingSession` heißen `BotClientService` und `BotSession`, `trainingTimescale` heißt `gameSpeed` (localStorage
`game-speed`), das Debug-Fenster heißt "Bots". `WAVE_DIRECTOR.md` ist als `WAVE_DIRECTOR.md` neu
geschrieben, ohne die RL-Geschichte. Offen aus 1b: das Backend und der Skill `/training` folgen in 1d.

**Stand 1c (2026-09-20, gebaut):** `utils/game-rng.ts` (mulberry32) mit den Strömen `director`, `spawn`, `enemy`
und `bot`; ein Lauf-Seed je Partie liegt als `GameStateManager.rng` und wird bei jedem Reset neu gezogen. Geseedet
sind jetzt: Spawnpunkt (`WaveManager.setRandom`), Seitenversatz und Flughöhe (`EnemyManager.setRandom`), Jitter und
Mischen im Spawn-Plan (`adaptDirectorWave(config, random)`), die Entscheidung des Directors
(`getNextWave(random)`) und die Bot-Strategien samt Konfigurations-Jitter (`gameState.rng.stream('bot')`). VFX und
Audio behalten `Math.random`. `GameClock` zählt Sub-Steps fortlaufend (`subStep`), weil die Spielzeit als Summe von
16,667 ms driftet und als Index nicht taugt. Zwei Specs sichern das ab: `utils/game-rng.spec.ts` (Ströme
unabhängig, Sequenz von mulberry32 gepinnt) und `director/sources/adaptive/determinism.spec.ts` (gleicher Seed, gleiche Wellen und
Spawns; anderer Seed, andere Wellen; der Bot-Strom bewegt die Gegner nicht). Nicht geseedet und bewusst offen: die
Auswahl der Spawnpunkte beim Laden eines Orts (`osm-street.service.ts`) und der Zufallsort im Würfel, beides
Weltaufbau vor dem Lauf.

**Stand 1d (2026-09-20, gebaut):** Aus `training-backend/` ist `bot-server/` geworden. Weg sind `core/` (Modell,
PPO, Reward), `directors.py`, `schema.py`, `generated/ai-schema.json`, der ONNX-Export, der Trainings-Inspector,
die Log-Analyse (die auf Reward-Einträgen rechnete; die neue kommt in 2c) und die Pytests für Director, Encoder,
Leck-Regler, Reward und Schema. `torch`, `numpy` und `onnx` sind aus `requirements.txt`. `server.py` ist von 1573
auf rund 260 Zeilen geschrumpft und nur noch Transport, Log und Fernbedienung: `connect`, `result`, `game_start`,
`game_over`, `status` herein, `connected` und `control` hinaus. Das Dashboard zeigt Clients, Bot, Welle, lebende
Gegner, Phase, Läufe je Stunde und Fehler, ohne Kurven (D13). Der Skill `/training` heißt `/bots` und beschreibt
keinen Trainingslauf mehr. Im Protokoll heißt `trainingState` jetzt `runState`, und `game_start` trägt die
Basis-HP der Gegner nicht mehr mit, die nur der Server-Decoder brauchte.

### Abnahme Phase 1

- `director/wave-reference.spec.ts` schreibt und prüft `wave-reference.json`: Wellen 1 bis 60 aus festen
  Zuständen mit fest injiziertem Zufall, inklusive Boss-Rotation. Nach jedem Paket liefert derselbe Spec dieselben
  Wellen; neu erzeugt wird die Datei nur mit `UPDATE_WAVE_REFERENCE=1`, der Diff ist dann das Review.
- Specs, Build und Lint grün; `npm test` schreibt nichts mehr ins Backend.
- Im Spiel: eine Partie mit Director, eine mit "Director aus", DevWorld mit Bot am Bot-Server.

## 5. Seeds und Determinismus

Ein Kernpunkt über das Balancing hinaus: dieselben Grundlagen tragen später ein Replay als Neu-Simulation (E2,
[REPLAY.md](REPLAY.md)) und Multiplayer im Lockstep ([MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md), Abschnitt 2).

**Gameplay-Zufall heute** (die übrigen rund 180 `Math.random`-Aufrufe sind VFX und Audio und bleiben):
Spawnpunkt (`wave.manager.ts`), Seitenversatz und Höhe der Luftgegner (`enemy.manager.ts`), Jitter und Mischen im
Spawn-Plan (`spawn-schedule-builder.ts`), Director (Faktor-Jitter und Gleichstand; `RuleDirector.decide` nimmt die
Quelle schon als Parameter) und die Bot-Strategien (Platzierung, Upgrades).

**Aufbau:** Ein Lauf-Seed im Run-Log-Kopf; daraus je System ein eigener Strom (Director, Spawn, Gegner, Bot). Getrennte
Ströme sind wichtig: Trifft ein Bot eine andere Entscheidung, darf das die Gegner nicht verschieben, sonst misst ein
A/B-Vergleich den Zufall statt der Regel. Befehle kommen im Run-Log mit dem Sub-Step, in dem sie wirken, nicht mit
Wanduhrzeit; die Simulation läuft schon heute in festen Sub-Steps.

**Drei Stufen:**

| Stufe | Was gleich bleibt | Braucht | Wofür |
|---|---|---|---|
| 1 | Wellen und Spawns aus demselben Seed, solange der Verlauf gleich ist | geseedete Ströme | Balancing: A/B mit weniger Streuung (dieser Plan) |
| 2 | ein ganzer Lauf im selben Client | Stufe 1, dazu Sichtlinie, Turmdrehung und Zellhöhen unabhängig von Frame und Tile-Streaming | Replay als Neu-Simulation (E2) |
| 3 | ein Lauf über mehrere Clients | Stufe 2, dazu Sichtlinie vom Host, eingefrorene Welt, Umgang mit Float-Abweichungen | Multiplayer im Lockstep |

Weil die Anpassung adaptiv bleibt (D8), hängen die Wellen am Spielverlauf: Überlebbarkeits-Deckel und Leck-Regler
lesen Verteidigung und Lecks. Gleicher Seed heißt deshalb gleiche Wellen, solange der Spielverlauf gleich ist; für
Replay und Multiplayer ist das kein Hindernis, weil dort auch der Verlauf gleich ist. Der Seed bleibt intern (D11).

Welche Pakete dieses Plans zugleich das Fundament für Coop im Lockstep sind, steht in
[MULTIPLAYER_CONCEPT.md](MULTIPLAYER_CONCEPT.md), Abschnitt "Bezug zum Balancing-Plan".

Dieser Plan baut Stufe 1 und legt das Run-Log so an, dass es für Stufe 2 und 3 als Eingabe taugt (Seed, Weltbezug,
Befehle je Sub-Step). Damit das Befehls-Log als Eingabe taugt, laufen alle Aktionen über `command:*`, die der Bots
eingeschlossen. Stufe 2 ist auf dem Branch `simulator` gebaut ([SIMULATOR_PLAN.md](SIMULATOR_PLAN.md)).

Einschränkung: Der Kampf hängt bis Stufe 2 an der GPU-Sichtlinie, auch in DevWorld (`DEVWORLD.md`): Wann ein Tower
schießen darf, hängt am Frame. Gleiche Seeds geben deshalb gleiche erste Wellen, aber nicht sicher gleiche Ausgänge;
weil der Leck-Regler auf Ausgänge reagiert, laufen zwei Läufe ab dem ersten Unterschied auseinander. Ein A/B-Vergleich
braucht darum mehrere Läufe je Parametersatz; feste Seeds senken nur die Streuung. Bit-gleiche Läufe gibt es bis
Stufe 2 nur in Specs. Ein Determinismus-Spec (gleicher Seed zweimal, Prüfsumme je Welle) schützt Stufe 1 vor
Rückfällen.

## 6. Phase 2: Datensammlung

### 2a Run-Log im Spiel

Ein Format für Menschen und Bots, versioniert und dokumentiert (`docs/RUN_LOG.md`), mit den Namen aus Abschnitt 1.

**Inhalt:**

- **Kopf:** Ort, Route (Korridor-Fingerprint), Spielversion, Git-Commit mit Dirty-Flag, Hash aller
  balance-relevanten Configs (Kampagne, Templates, Tower, Gegner, Schadensmatrix, Forschung, Fähigkeiten, Held,
  Boss-Varianten, Economy), Format-Version, Seed, Director-Parametersatz, Spieler (Mensch oder Bot), Karte (DevWorld
  oder echt).
- **Zeitleiste:** jedes Ereignis mit Sub-Step, Spielzeit und Welle: Bau, Upgrade, Verkauf, Forschung, Fähigkeit,
  Held, Leck, Boss-Spawn, Tod, Tempo, Pause, Cheat, Wellensprung.
- **Stichproben** jede Sekunde Spielzeit: Gold, HQ-HP, lebende Gegner, Gesamt-DPS der Verteidigung.
- **Je Welle:** Gold zu Start und Ende, Einnahmen nach Quelle (Kill-Gold, Abschlussgold und jeder Bonus,
  Meilenstein, Cheat), Ausgaben nach Zweck (Bau, Upgrade, Forschung, Held), Verkäufe; Kampagnenwelle,
  Zusammensetzung, Director-Entscheidung mit Begründung, Deckel und Leck-Regler; Gegner gespawnt, getötet nach Quelle
  (Tower, Held, Fähigkeit), geleckt, HQ-HP vorher und nachher; je Tower Typ, Position, Stufen je Zweig, Schaden,
  Kills; Dauer.
- **Ende:** erreichte Welle, Grund (Niederlage, Neustart, Ortswechsel, abgebrochen).
- **Abgleiche** als Specs und als Prüffelder im Log: Startgold plus Einnahmen minus Ausgaben gleich Endgold;
  gespawnt gleich getötet plus geleckt plus lebend; Schaden und Kills der Tower summieren sich zu den Wellensummen.
- **Überall gleich:** dieselben Daten in DevWorld und echten Welten, bei 1x bis 75x, mit allen Inhalten (Held,
  Fähigkeiten, Wurm, Ooze, Blutmond, Wellensprung; Cheats markiert).
- **Kein spürbarer Preis:** Budget festlegen und bei 5000 Gegnern messen, keine Allokationen im Sub-Step.

**Aufbau:**

- Ein Run-Log-Dienst hört auf den Event-Bus, stempelt jeden Eintrag mit Sub-Step und Spielzeit (heute trägt kein
  Ereignis eine Zeit) und schreibt je Welle einen Block weg.
- Er ersetzt `RunStatsTracker` und die Wellenauswertung im `AIDataCollectorService`; heute zählen drei Stellen
  Kills, Lecks, HP und Gold. Die Game-Over-Übersicht liest danach das Run-Log.
- **Lauf öffnen und schließen:** Ein Ereignis für den Lauf-Start fehlt: `game:started` kommt erst mit Welle 1,
  `game:reset` erst am Ende des Resets, und davor bucht der Reset noch Gold des alten Laufs. Neu: ein Ereignis beim
  Öffnen (nach `initialize` und nach jedem Reset, mit Ort). Geschlossen wird bei Game Over, Neustart, Ortswechsel und
  DevWorld-Neubau. Nach Game Over läuft die Spielzeit heute weiter; das Log endet beim Game Over.

**Ereignisse, die ergänzt werden:**

- `credits:changed` mit Quelle: Kill, Abschluss, Bau, Upgrade, Verkauf, Forschung, Erstattung, Held, Cheat, Sprung.
  Das baut `CreditsLedger` um; Gold je Spieler (Coop, `MULTIPLAYER_CONCEPT.md`) dabei gleich mitdenken, damit das
  Ledger nur einmal umgebaut wird.
- Aufteilung des Abschlussgolds (Basis, Perfect, Combo, Close Call, Comeback, Meilenstein);
  `wave:completed.credits` mit dem echten Betrag.
- `tower:upgraded` mit Zweig; `research:started` mit "aus der Warteschlange"; `research:completed` mit "Cheat".
- `enemy:died` mit Ursache und Verursacher (Tower, Held, Fähigkeit, Debug); `debug:remove-enemy` bucht wie ein
  Debug-Tod.
- Schaden je Tower und Welle als Differenz der vorhandenen Zähler (`CombatComponent.damageDealt`, `kills`).
  Schaden von Held und Fähigkeiten zählt heute nirgends und kommt dazu.
- `hero:hired`, Tempo und Pause als Ereignisse. Boss-Spawn und Blutmond leitet das Log ab.

**Kopf-Felder, die es noch nicht gibt:** Git-Commit (beim Build einbetten), Hash der Balance-Configs (fnv1a wie beim
Korridor-Fingerprint), Format-Version, Seed.

**Format:** JSONL, eine Zeile je Datensatz (Kopf, Ereignis, Stichprobe, Welle, Ende).

### Speichern und Export (Menschen)

- Browser: die letzten 20 Läufe in IndexedDB, je Welle fortgeschrieben. Ein geschlossener Tab verliert höchstens die
  laufende Welle; einen `beforeunload`-Haken gibt es nicht, und er soll nicht der einzige Weg sein.
- Export: Knopf im Game-Over-Dialog und eine Liste der gespeicherten Läufe im Menü, Download als Datei.
- Desktop: zusätzlich automatisch in den Ordner `runs` neben dem Log-Ordner der App (`%APPDATA%/3DTD/`), über eine
  neue Preload-Funktion; heute gibt die App dem Spiel nur Version und Update-Hinweis.
- Kein Upload (D6). Andere Spieler exportieren ihren Lauf und schicken die Datei.

**Stand 2a (2026-09-20, gebaut):** Das Run-Log liegt in `src/app/run-log/`, das Format in
[RUN_LOG.md](RUN_LOG.md). Der Sammler hängt am Event-Bus, stempelt jeden Eintrag mit dem Sub-Step und schreibt je
Welle einen Block; die Welle, in der die Basis fällt, bekommt ihren Block beim Game Over. Ein Block läuft vom Ende
der letzten Welle bis zum Ende der nächsten, damit die Ausgaben der Aufbauphase zu der Welle gehören, die sie
vorbereitet. Erweitert wurden `credits:changed` (Quelle), `enemy:died` (Verursacher), `tower:upgraded` (Zweig) und
`wave:completed` (echter Betrag plus Aufteilung); Tempo und Pause liest das Log aus den Store-Signalen. Die
Abgleiche (Gold, Körper, Tower) stehen als `mismatches` im Block, statt zu werfen. Gespeichert wird nach jeder
Welle in IndexedDB (letzte 20 Läufe), auf dem Desktop zusätzlich als Datei in `%APPDATA%/3DTD/runs/`; Export über
den Game-Over-Bildschirm und die Liste "Runs" in der Sidebar. `RunStatsTracker` ist entfallen, die
Game-Over-Zahlen werden aus dem Log gefaltet (`run-summary.ts`). Der Commit im Kopf kommt aus
`public/build-info.json` (`tools/build-info.mjs`, läuft vor `npm run build` und `npm start`).

Offen aus 2a: Korridor-Fingerprint und Director-Parametersatz sind im Kopf vorgesehen, aber noch nicht gefüllt.

### 2b Bots und Bot-Server

- **Zwei Bots (D15)** aus den heutigen Strategien:
  - Einsteiger aus beginner: langsame Reaktion, wenige Tower, wenig Forschung.
  - Könner aus strategist und meta: volle Forschung, Fähigkeiten, dazu eine neue Held-Strategie (anheuern, Munition,
    an Brennpunkte stellen); heute nutzt kein Bot den Helden.
  - casual und meta entfallen.
- Bots handeln nur noch über `command:*`; heute gehen Bau und Verkauf direkt, das Log ihrer Befehle wäre sonst
  unvollständig.
- **Protokoll:** `control start` trägt Bot, Seed und Parametersatz. Der Client schickt sein Run-Log je Welle
  (`run_log`, ein Block Zeilen) und am Ende. Der Server schreibt `bot-server/runs/<config-hash>/<lauf>.jsonl`.
  `result` und `game_start` gehen darin auf. Der Server vergibt die Seeds je Batch, damit ein Batch wiederholbar ist.
- **Parametersätze:** benannte Überschreibungen von Director-Konstanten (Rampe, Leck-Band, Deckel), nur im Bot-Modus
  wirksam und im Run-Log-Kopf vermerkt.
- **Dashboard (D13):** Clients, laufender Bot, Welle, Läufe je Stunde, Fehler. Keine Kurven.
- `BOT_SYSTEM.md` neu schreiben.

**Stand 2b (2026-09-20, gebaut):** Aus vier Bots sind zwei geworden, `beginner` und `expert`
(`bots/bots/tower-bot.interface.ts`); `casual` und `meta` hatten dieselben Strategie-Sets wie ihre Nachbarn. Der
Könner hat eine neue Held-Strategie (`bots/strategies/hero/hero.strategy.ts`): anheuern, sobald der Vertrag
erforscht und bezahlbar ist, Munition nach dem Rüstungsmix der Welle, Stellung beim dichtesten Pulk. Der Bot
handelt nur noch über `command:*`, auch Bau, Verkauf und Held. Das Protokoll trägt jetzt `run_log` (Client zum
Server, je Welle und am Ende) und `run_config` (Server zum Client: Bot, Seed, Parametersatz); `result` und
`game_start` sind entfallen. Der Server schreibt die Zeilen nach `bot-server/runs/<config-hash>/<lauf>.jsonl` und
vergibt vor jedem Lauf einen eigenen Seed je Client. Die Parametersätze stehen in `director/director-params.ts`
(`default`, `steep-ramp`, `wide-band`, `fast-loop`); der Leck-Regler und die Rampe lesen sie, eine Partie eines
Spielers läuft immer auf `default`.

Abweichung vom Plan: Der Seed kommt nicht mit `control start`, sondern in einer eigenen Nachricht `run_config`.
`control` ist ein Broadcast an alle Clients; ein Seed darin wäre für alle derselbe, und ein Batch hätte vier
identische Läufe.

### 2c Auswertung

- Ein Skript in `bot-server/` liest Bot-Läufe und exportierte menschliche Läufe gleich. Es gruppiert nach
  Config-Hash (warnt bei gemischten Ständen) und nach Parametersatz.
- Es schreibt einen HTML-Bericht (D13) mit Kurven je Welle: erreichte Welle, HP-Verlust, Leck-Quote, Bindung an den
  Deckel, ungenutztes Gold, Ausgaben nach Zweck, Anteil und Schaden je Gold je Tower-Typ, Wellendauer, Entscheidungen
  je Welle.
- **Baseline:** Einsteiger und Könner mit je etwa 50 festen Seeds in DevWorld, dazu deine Läufe auf echten Karten.

**Stand 2c (2026-09-20, gebaut):** `bot-server/analyze_runs.py` macht aus einem Stapel Läufe einen HTML-Bericht.
Es liest Bot-Läufe und exportierte Spieler-Läufe gleich (`analysis/run_reader.py`), gruppiert nach Balance-Stand,
Parametersatz und Spieler, und nennt zwei Balance-Stände im Stapel oben im Bericht, statt sie zu mitteln. Der
Bericht (`analysis/report.py`) ist eine Seite ohne Netz und ohne Skript, die Kurven sind eingebettetes SVG: HP-
Verlust, Anteil der Wellen mit Schaden, Leck-Quote, Golddruck, Ausgaben, Entscheidungen, Wellendauer und
überlebende Läufe je Welle, dazu die Tower-Anteile je Gruppe. Die Abgleiche aus dem Run-Log stehen als Spalte in
der Übersicht, damit ein Lauf mit Loch in der Buchführung auffällt.

**Nachtrag 2026-09-21 (E10):** Schaden je Gold je Tower-Typ steht jetzt im Bericht. Der Wellenblock trägt die
Bau- und Upgrade-Ausgaben je Typ (`towerSpending`, Run-Log-Format 2); die Tower-Tabelle zeigt Gold je Lauf,
Gold-Anteil, Schadens- und Kill-Anteil und Schaden je Gold. Läufe aus Format 1 werden aus ihren Bau- und
Upgrade-Ereignissen gelesen, damit die erste Baseline nicht verloren ist.

Gemessen über die 248 lesbaren Läufe in `bot-server/runs/` (Balance 78e12fc6): Der Könner steckt 25,3 % des
Tower-Golds in die Kanone und holt daraus 52,8 % des Schadens, also 3,56 Schaden je Gold. Dahinter Gift mit 3,17
bei 5,5 % des Golds, Dual-Gatling 1,54, Bogenschütze 0,85, Eis 0,79, Tentakel 0,60, Rakete 0,27. Die Kanone wird
also nicht nur oft gewählt, sie ist je Gold gut doppelt so ergiebig wie der nächste Breitband-Tower (E13).

**Die Baseline selbst ist keine Codeaufgabe:** Einsteiger und Könner je etwa 50 Läufe in DevWorld (`/bots`), dazu
Läufe auf echten Karten, dann `analyze_runs.py`. Das ist der nächste Schritt vor Phase 3.

**Erster Probelauf (2026-09-20, 15 Läufe):** Der Stapel war unbrauchbar, hat aber drei echte Fehler gezeigt, alle
drei sind behoben:

1. **Jedem Bot-Lauf fehlten seine letzte Welle und sein Ende.** Das Game Over erreicht zwei Zuhörer: Die Facade
   schließt den Lauf, die Bot-Session schickt den Rest. Der Sammler setzte beim Schließen seinen Kopf auf `null`,
   also fand die Session nichts mehr und schickte gar nichts. Kein Lauf auf dem Server hatte einen `end`-Datensatz,
   also war auch nicht zu sehen, ob er gewonnen oder verloren hat. Ein geschlossener Lauf bleibt jetzt lesbar, bis
   der nächste öffnet.
2. **Der Kopf beschriftete den Lauf falsch.** Der Client startete nach dem Game Over sofort neu, das `run_config`
   des Servers kam erst danach: Der Kopf trug den Bot des vorigen Laufs, und der Seed im Kopf war nicht der, mit
   dem gespielt wurde, weil `rng.reset` ihn gleich darauf überschrieb. Die ersten vier Läufe je Tab hatten gar
   keinen Bot. Damit war weder die Gruppierung nach Bot noch die Wiederholbarkeit zu gebrauchen. Der Client wartet
   jetzt auf das `run_config`, und der Seed wird als Wunsch hinterlegt (`GameRng.useNextSeed`), den erst der
   Neustart einlöst.
3. **Der Körper-Abgleich zählte eine Leiche zu viel.** Ein Block läuft über das Wellenende hinaus, Gegner leben
   über diese Naht. Was die letzte Welle übrig ließ, starb in der nächsten, und die meldete `killed = spawned + 1`.
   Acht Meldungen in 15 Läufen, alle falsch. Der Block hält jetzt `enemiesAtStart` fest und rechnet damit.

Der Parametersatz stand außerdem in keinem Kopf: Die Facade reichte ihn nie durch, die Auswertung sah überall
`default`. Jetzt steht `directorParamsName()` im Kopf.

Weitere vier Fehler zeigten sich erst in den Stapeln danach, alle im Zusammenhang mit dem Ende eines Laufs und
dem, was er über sich schreibt: das `end` erreichte den Server auch nach dem ersten Fix nicht, weil die Reihenfolge
zweier Zuhörer entschied (jetzt beendet die Bot-Session den Lauf selbst, `endRun()`); die Todeswelle verlor ihre
Gegner, weil `triggerGameOver()` das Feld räumte, bevor es `game:over` meldete; Gegner in der Sterbeanimation
zählten als lebend **und** als Kill (jetzt `getAliveCount()`); und der erste Lauf jedes Tabs stand als
`player: human` im Kopf, weil das Bot-Modul noch lud. Der letzte wäre der teuerste gewesen: Bot-Läufe in der
Spielergruppe.

### Baseline (2026-09-20, 113 Läufe, ohne Leck-Deckel)

| | Einsteiger | Könner |
|---|---|---|
| Läufe | 60 | 53 |
| Erreichte Welle, Median | **28** | **25** |
| Spanne | 15 bis 42 | 15 bis 52 |
| Golddruck bei W25 | 4,34 | 0,51 |

**Das Können-Gefälle steht auf dem Kopf.** Der schwächere Bot kommt weiter. Ursache ist der
Überlebbarkeits-Deckel: Er bemisst jede Welle an der Verteidigung, die dasteht, also bekommt eine schwache
Verteidigung kleine Wellen und eine starke große. Beim Einsteiger lecken in Welle 25 rund 30 % der Gegner und
kosten 4,4 HP, beim Könner lecken 8,5 % und kosten 18,8 HP. Ein Wellenblock zeigt es in Reinform (W12, Einsteiger,
Dragon Elite): *"Survivability cap holds the count at 5"*, dazu der Leck-Regler auf ×0,61, und von fünf Gegnern
kommen drei durch, weil dem Bot die Luft-Antwort fehlt. Zwei Regler arbeiten gegen eine Lücke, die sie nicht
schließen können.

**Die Todeszone ist ein Konter-Block bei Welle 22 bis 26.** Wo die Läufe des Könners enden: Ghost Surge (W23, 14
Läufe), Hornet Strike (W26, 14), Mammoth Siege (W25, 11), Tank Column (W22, 8), Dragon Elite (W24, 7). Fünf
Wellen, die je eine andere Antwort verlangen, direkt hintereinander. Ohne Leck-Deckel kostet eine fehlende Antwort
dort nicht eine Welle, sondern den Lauf: W26 nimmt im Mittel 46,6 HP.

**Der Deckel hielt das vorher zusammen.** Mit ihm lag der Median des Könners bei 36 und der weiteste Lauf bei 49;
ohne ihn bei 25 und 26. Die langen Läufe gibt es nicht mehr.

**Was daraus folgt, in dieser Reihenfolge:**

1. **`survivableCount` in den Wellenblock schreiben.** Er steht heute nur als Fließtext in `reason`, weil
   `DecisionExplanation` nur `summary` und `reasons` durchreicht und die `sizing`-Daten verwirft. Ohne die Zahl
   ist "wie oft bindet der Deckel" nicht zählbar und keine Tuning-Runde beurteilbar.
2. **Der Deckel hört auf, die Wellengröße zu bestimmen, und wird zum Notnagel.** Die Größe kommt aus der
   Kampagnenkurve; der Deckel greift nur noch gegen die nachweislich unspielbare Welle, mit Luft dazwischen. Erst
   dann zahlt sich gutes Bauen in Fortschritt aus statt in einer proportional größeren Welle, und erst dann sind
   Zielbänder überhaupt sinnvoll.
3. **Den Konter-Block bei 22 bis 26 auseinanderziehen.** Kampagnenarbeit, kein Director. Nach Punkt 2, weil ein
   Konter-Block sich anders anfühlt, sobald ein passendes Roster belohnt wird.
4. Erst danach die Zielbänder (3b), nach jeder Runde mit demselben Stapel gemessen.

### Tuning-Runde 1 (2026-09-21): Luft über dem Überlebbarkeits-Deckel

749 Läufe über vier Einstellungen von `capSlack`, dem Faktor, mit dem der Deckel multipliziert wird, bevor er die
Wellengröße beschneidet.

| `capSlack` | Einsteiger | Könner | Abstand | Wellen W10-20 mit Schaden (Könner) | Partiedauer Könner |
|---|---|---|---|---|---|
| 1,0 (vorher) | 27 | 25 | **−2** | 17 % | 47 min |
| 1,25 | 24 | 25 | +1 | 19 % | 49 min |
| **1,5 (neu)** | **19** | **26** | **+7** | **27 %** | **50 min** |
| 2,0 | 13 | 13 | 0 | 32 % | 29 min |

Bei 1,5 stimmen die Kennzahlen des Plans zum ersten Mal gleichzeitig: Das Können-Gefälle zeigt in die richtige
Richtung, das Mittelspiel kostet mehr als die angepeilten 22 %, die Partie wird dabei nicht kürzer, und der
Golddruck bleibt bei 0,45. Bei 2,0 bricht auch der Könner ein.

**Was die Runde nebenbei ergab:**

- Der Deckel bindet in **nahezu jeder Welle** (100 % bis Welle 25). Die Wellengröße war damit keine
  Designentscheidung mehr, sondern das Ergebnis einer Formel über die Verteidigung.
- `dpsRampWeight` ist deshalb ein Knopf an nichts: Die DPS-Rampe legt eine Obergrenze fest, die der Deckel ohnehin
  unterschreitet. Der Parametersatz `campaign-size` bleibt für die Runde, in der der Deckel lockerer sitzt.
- Der Konter-Block bei Welle 22 bis 26 bewegte sich in **keiner** Einstellung. Er hängt an fehlenden Kontern, nicht
  an der Wellengröße, und ist der nächste Punkt.

**Revidiert D8** ("Überlebbarkeits-Deckel und Leck-Regler behalten ihre volle Wirkung"): Der Deckel behält seine
Wirkung, bekommt aber Luft. Entschieden vom User am 2026-09-21 auf diese Zahlen hin.

### Tuning-Runde 1, bestätigt (190 Läufe)

Die dünne Stichprobe von 37 und 39 Läufen durch je 83 und 107 ersetzt, alles auf `capSlack: 1,5`:

| | Einsteiger | Könner |
|---|---|---|
| Läufe | 83 | 107 |
| Median | 18 | 25 |
| Spanne | 1 bis 26 | 17 bis 36 |
| Wellen W10-20 mit Schaden | 43 % | **26 %** |
| Entscheidungen je Welle | 6,0 | 17,8 |
| Partiedauer | 30 min | 49 min |

Der Abstand von sieben Wellen hält, das Mittelspiel des Könners kostet 26 % statt 17 %, und die Partie bleibt bei
49 Minuten. Der Überlebbarkeits-Deckel bindet weiterhin in 92 bis 100 % der Wellen.

**Woran die Läufe enden** (neue Tabelle im Bericht):

| Könner | Einsteiger |
|---|---|
| W26 Hornet Strike, 31 Läufe | W21 Bat Swarm, 28 Läufe |
| W24 Dragon Elite, 26 | W17 Wraith Storm, 19 |
| W25 Mammoth Siege, 20 | W15 Golem Squad, 17 |
| W23 Ghost Surge, 14 | W24 Dragon Elite, 7 |

**85 % der Könner-Läufe enden in den Wellen 23 bis 26.** Der Einsteiger stirbt an Luft und Ethereal, also genau an
den beiden Antworten, die er per Definition nicht erforscht. Das ist bei ihm gewollt; beim Könner nicht.

### Tuning-Runde 2 (2026-09-21): Rhythmus der Kampagne ab W21

W21 bis W29 waren neun Spezialwellen hintereinander, jede mit einer anderen Anforderung, und keine Welle
dazwischen, in der nur gebaut wird. Neu, mit zwei Atempausen und ohne zwei gleiche Anforderungen in Folge:

| Welle | vorher | neu | verlangt |
|---|---|---|---|
| 21 | Bat Swarm | Bat Swarm | Luft |
| 22 | Tank Column | Tank Column | schwer |
| 23 | Ghost Surge | **Spider Swarm** | nichts |
| 24 | Dragon Elite | **Ghost Surge** | ethereal |
| 25 | Mammoth Siege | Mammoth Siege | fortified |
| 26 | Hornet Strike | **Zombie Horde** | nichts |
| 27 | Wraith Storm | **Dragon Elite** | Luft, schwer |
| 28 | Mech Army | Mech Army | schwer |
| 29 | Chaos Wave | Chaos Wave | Mix |

Hornet Strike und Wraith Storm entfallen in diesem Block; Luft bleibt bei 21, 27 und 29, Ethereal bei 24 (und bei
W13 und W17 davor), schwer bei 22, 25 und 28. Das Wellengold je Wellennummer bleibt unverändert, es ist eine Kurve
über die Wellennummer, nicht über das Template.

### Tuning-Runden 2 bis 4 (2026-09-21): der späte Kampagnenblock

Gemessen wird nach jeder Änderung mit mindestens 80 Läufen je Bot, bei 50x und abgeschaltetem Rendering.

| | Runde 1 | Runde 2 (Rhythmus) | Runde 3 (Intensität) | Runde 4 (nachgezogen) |
|---|---|---|---|---|
| Könner, Median | 25 | 25 | 25 | 25 |
| Könner, weitester Lauf | 36 | 27 | 34 | **36** |
| Läufe ab W30 | 0 | 0 | 3 (3 %) | **3 (4 %)** |
| häufigstes Ende | W26, 29 % | W25, **45 %** | W24, 25 % | W24, **20 %** |
| Wellen W10-20 mit Schaden | 26 % | 25 % | 24 % | 23 % |
| Einsteiger, Median | 18 | 21 | 19 | 19 |

**Runde 2, Rhythmus:** Zwei Atempausen in den Block W21-29 gelegt. Halb gelungen. Spider Swarm bei W23 kostete den
Könner **0,0 HP**, genau wie gedacht. Zombie Horde bei W26, als dieselbe Art Pause gemeint, kostete **15,4 HP**.
Der Grund ist der Überlebbarkeits-Deckel: Eine Welle, die keinen Konter verlangt, bekommt von ihm einfach eine
größere Zahl, bis sie wieder wehtut. 458 Zombies sind keine Pause. Die Wand wanderte auf W25 und wurde dort
schlimmer als vorher (45 % aller Enden auf einer einzigen Welle).

**Runde 3, Intensität je Kampagnenwelle (D3).** Ein Faktor auf die Gegnerzahl, ganz zum Schluss angewendet, also
auch auf eine Zahl, die der Deckel gesetzt hat. Damit kann die Kampagne zum ersten Mal sagen "diese Welle ist
leichter gemeint". W25 fiel von 16,3 auf 9,0 HP, die Enden verteilten sich wieder über fünf Wellen, und drei Läufe
erreichten überhaupt das Kampagnenende.

**Runde 4:** W24 auf 0,85, W26 auf 0,5, W27 auf 0,7. Die Enden verteilen sich weiter (kein Ende über 20 %), die
Kosten des Blocks W24-27 fallen von 47 auf 40 HP, der weiteste Lauf steigt auf 36.

**Der Ertrag wird klein.** Von Runde 3 auf 4 hat sich der Anteil der Läufe, die W30 erreichen, von 3 % auf 4 %
bewegt. Weiter zu senken macht das späte Spiel folgenlos, statt es gewinnbar zu machen.

### Tuning-Runde 5: ist 1,5 noch der richtige Punkt?

Dieselbe Frage wie in Runde 1, aber mit der neuen Kampagne und enger gesteckt.

| `capSlack` | Einsteiger Median | Könner Median | Abstand | Einsteiger ab W30 | Könner ab W30 | Wellen W10-20 mit Schaden (Könner) |
|---|---|---|---|---|---|---|
| 1,35 | 21 | 25 | 4 | **12 %** | 8 % | 22 % |
| **1,5** | 19 | 25 | 6 | **0 %** | 4 % | 23 % |
| 1,65 | 16 | 25 | 9 | 0 % | 4 % | 24 % |

**Der Median des Könners liegt bei allen drei Werten auf 25.** Seine Grenze ist der Konter-Block, nicht der
Deckel. Was `capSlack` bewegt, ist fast nur der Einsteiger: 21, 19, 16.

Damit ist 1,5 bestätigt, aus zwei Richtungen:

- **1,35 ist zu locker.** Der Einsteiger erreicht das Kampagnenende in 12 % der Läufe, häufiger als der Könner mit
  8 %. Dieselbe Umkehrung wie zu Beginn, nur ans Ende des Laufs verschoben: Wer schwach baut, bekommt kleine
  Wellen und kriecht durch. Ein Ende, das man durch schlechtes Bauen erreicht, ist kein Ziel.
- **1,65 kauft nichts.** Der Könner steht bei Median, W30-Quote und Druck genau wie bei 1,5; nur der Einsteiger
  stirbt drei Wellen früher. Härte ohne Gegenleistung.

### Baseline nach den Runden 1 bis 5 (2026-09-21, 354 Läufe)

Der Stand, der committet ist, mit je 150 Läufen gemessen. Das ist die Zahl, gegen die die nächste Änderung
antritt.

| | Einsteiger | Könner |
|---|---|---|
| Läufe | 152 | 202 |
| Erreichte Welle, Median | **18** | **26** |
| Spanne | bis 28 | bis 37 |
| Läufe am Kampagnenende (W30+) | 0 % | **7 %** |
| Wellen W10-20 mit Schaden | 44 % | **25 %** |
| Entscheidungen je Welle | 6,0 | 17,8 |
| Partiedauer, Median | 30 min | 53 min |
| Golddruck bis W25 | ~2 | 0,45 |

**Woran die Läufe enden:**

| Könner | Läufe | Einsteiger | Läufe |
|---|---|---|---|
| W25 Mammoth Siege | 45 (22 %) | W21 Bat Swarm | 59 (39 %) |
| W26 Zombie Horde | 40 (20 %) | W17 Wraith Storm | 41 (27 %) |
| W24 Ghost Surge | 30 | W15 Golem Squad | 30 |
| W27 Dragon Elite | 30 | W24 Ghost Surge | 8 |
| W29 Chaos Wave | 17 | | |

Beim Könner kommt keine Welle über 22 %; zu Beginn der Nacht lagen 85 % der Enden auf vier Wellen. Der Einsteiger
stirbt an Luft und Ethereal, den beiden Antworten, die er per Definition nicht erforscht.

**HP-Kosten der letzten zehn Wellen (Könner):**

```
W21:2  W22:1  W23:0  W24:5  W25:8  W26:9  W27:17  W28:1  W29:5  W30:0
```

W27 Dragon Elite ist die einzige verbliebene Spitze.

### Tuning-Runde 6: verworfen

W27 von 0,7 auf 0,55, gegen die einzige verbliebene HP-Spitze. Gemessen über 125 Könner-Läufe: **kein Gewinn.**
Die Läufe am Kampagnenende fielen von 7 % auf 5 %, der weiteste Lauf von 37 auf 34, und die Wellen davor wurden
teurer statt billiger (W25 von 8 auf 11 HP, W26 von 9 auf 13), während W27 selbst nur von 17 auf 14 fiel.

Das ist wieder der Deckel: Eine von Hand gesenkte Welle wird woanders aufgefüllt, weil die Last des Blocks vom
Regler kommt und nicht von den Templates. Der Unterschied 5 % zu 7 % ist bei diesen Stichproben nicht belastbar;
belastbar ist, dass es nichts zu behalten gab. Zurückgenommen (`5abe9947` revertiert `cf3f008f`).

**Damit ist die Kampagne für diese Nacht fertig.** Weitere Einzelwellen zu senken bringt nichts mehr; was bleibt,
steht unter "Was das Tuning nicht lösen kann".

### Was das Tuning nicht lösen kann

Der Könner verliert in W24 bis W29 je 8 bis 14 HP, und **nichts heilt**. Bei 100 Start-HP ist damit vorgezeichnet,
dass die letzten zehn Wellen nicht alle überlebt werden können, egal wie die einzelnen Wellen eingestellt sind.
Druck und Erreichbarkeit des Kampagnenendes schließen sich unter dieser Regel gegenseitig aus.

Das ist eine Entwurfsfrage, keine Tuning-Frage, und sie gehört dem User: Der Plan führt Heilung unter den Hebeln
("Belohnungen: sichtbare Boni, Heilung, Score"), und D10 (Partiedauer) ist offen. Drei mögliche Antworten, ohne
Empfehlung bis dahin:

1. **Heilung an Meilensteinen**, etwa nach jeder Boss-Welle ein fester Betrag. Macht den Block überlebbar, ohne
   den Druck je Welle zu senken.
2. **Kürzere Kampagne**, etwa 20 statt 30 Wellen, mit demselben Bogen.
3. **So lassen.** Der Könner-Bot ist ein Bot: 20 Tower, kein Held, keine Sicht auf das, was kommt. Ein guter
   Mensch spielt besser, und 4 % für den Bot können 30 % für einen Menschen heißen. Messbar nur mit deinen
   eigenen Läufen.

### Die Raketen-Falle (2026-09-21, Menschenlauf Binswangen)

Ein Menschenlauf endete in W11 mit 27 % des Gesamtgolds in Raketentürmen, die 1,5 % des Schadens
machten (1299 Gold, 0,08 DPS je Gold). Der Lauf war nicht falsch gespielt, der Forschungsbaum hat
ihn so geführt.

**Die Zahlen.** Luft besteht aus zwei Rüstungsklassen: `light` (Fledermaus W7, Hornisse W8) und
`heavy` (Drache ab W12). Die Rakete macht `siege`, das ist 0,5 gegen light und 1,75 gegen heavy.

| gegen `light` | eff. DPS | Gold | DPS/Gold |
|---|---|---|---|
| dual-gatling (pierce 1,6, mit Retrofit) | 80 | 90 | 0,89 |
| archer (physical 1,0) | 25 | 45 | 0,56 |
| rocket (siege 0,5) | 10 | 120 | 0,08 |

| gegen `heavy` | eff. DPS | Gold | DPS/Gold |
|---|---|---|---|
| rocket (siege 1,75) | 35 | 120 | 0,29 |
| archer (physical 0,5) | 12,5 | 45 | 0,28 |
| dual-gatling (pierce 0,35) | 17,5 | 90 | 0,19 |

**Der Strukturfehler.** `aa-retrofit` (450) setzte `rocketry` (600) voraus. Wer die breite
Flugabwehr wollte, musste erst den Spezialisten kaufen, der gegen die Luftgegner der Wellen 7 und 8
zehnmal schlechter ist als das nachgerüstete Gatling. Dazu hing `rocketry` an `gatling-tech`, also
schaltete Schnellfeuer Lenkraketen frei, während `siege-engineering` (Sprengmunition) am selben
Knoten daneben lag.

**Entschieden (User, 2026-09-21): Form B.** Die Nachrüstung ist die Breite, die Rakete die Spitze.
`aa-retrofit` hängt direkt an `gatling-tech`, `rocketry` unter `siege-engineering`. Beide Pfade
stehen nebeneinander statt hintereinander. Verworfen wurde Form A (Retrofit streichen, Luft als
eigene Investition), weil sie einem Turm eine Fähigkeit wegnimmt, die Spieler schon kennen.

Ebenfalls verworfen: eine eigene Schadensart für die Rakete. Sie hätte `siege` für die Kanone
unangetastet gelassen, aber "explosive" neben einer Kanone, die selbst Splittermunition verschießt
(`splashRadius: 6`), ist ein logischer Bruch, und die Zahlen zeigten, dass die Matrix nicht der
Hebel ist.

**Offen.** Ob die Rakete mit der neuen Position stark genug ist, ist eine Messung und keine
Entscheidung: Sie liegt je Gold auch gegen Drachen nur gleichauf mit einem 45-Gold-Starttower.
Bevor an `damage` oder `cost` gedreht wird, braucht es einen Bot-Lauf gegen die neue Baumform.
Und wenn das nachgerüstete Gatling die leichte Luft ohnehin erledigt, ist die Rakete ein Turm für
zwei Kampagnenwellen (12 und 27) - ob das einen eigenen Turm plus 600 Forschung trägt, ist eine
Entwurfsfrage wie die Heilung oben.

## 7. Phase 3: Kampagnenende und Tuning

### 3a Kampagnenende (D2, D9)

Sieg-Bildschirm nach der letzten Kampagnenwelle, danach Weiterspielen im Zyklus. Blocklänge und Skalierung des
Zyklus kommen aus der Baseline; bis dahin gilt ab W31 das heutige Verhalten.

### 3b Zielwerte und Tuning

**Kennzahlen, Entwurf** (Zielbänder legt der User nach der Baseline fest):

| Kennzahl | Messung | Richtung |
|---|---|---|
| Druck | Anteil der Wellen mit HQ-Schaden (Bots am 2026-08-28: 22 %) | deutlich höher, ohne frühen Tod |
| Beinahe-Niederlagen | Wellen, die mehr als 10 HP kosten | ab und zu, nicht nie |
| Gold-Druck | ungenutztes Gold zu Wellenstart gegen das Wellengold | kein Horten über mehrere Wellen |
| Laufdauer | erreichte Welle je Bot, deine Läufe als Maßstab | Einsteiger früh, Könner spät |
| Partiedauer (D10) | Spielzeit bis zum Kampagnenende | ergibt sich aus der Baseline |
| Vielfalt | Anteil eines Tower-Typs an Ausgaben, Schaden und Kills; Schaden je Gold je Typ | kein Typ dominiert |
| Entscheidungen | Wellen mit mindestens einem Bau, Upgrade oder einer Forschung | kaum Wellen ohne Entscheidung |
| Rhythmus | Wechsel von schweren und leichten Wellen | Druck baut sich auf und löst sich |

**Schleife:** Batch laufen lassen (Bot mal Seed mal Parametersatz), Kennzahlen gegen die Zielbänder, Änderung
vorschlagen, A/B auf denselben Seeds, übernehmen oder verwerfen. Deine Läufe prüfen, ob die Bots wie Menschen
spielen; sonst passt sich der Director an die Bots an.

**Hebel**, entschieden wird erst mit Daten:

- Kampagne: Reihenfolge, Rollen, Spielraum je Kampagnenwelle, Wellengold, Blocklänge und Skalierung des Zyklus.
- Director-Regeln: Rampe, Jitter, Zielband des Leck-Reglers (heute 8 bis 16 %), Konstanten des
  Überlebbarkeits-Deckels, Dauer-Deckel.
- Economy: Kill-Gold nach Bedrohung statt je Körper, Puffer bis W30, Gold nach W30, Upgrade-Kurven je Tower,
  Verkaufsquote, Preise.
- Belohnungen: sichtbare Boni, Heilung, Score.

Die offenen Balance-Fragen aus den Reviews (Chaos-Preis, Atomschlag gegen Golem und Dragon, Held-Preise, Wurm und
Ooze, Boss-Rotation, Veteranen-Schwellen, Sprung-Gold, Stärke von Herbert, Skarnax und Ooze, Ooze-Gold) liegen in
`docs/archive/REVIEW_SPRINT_2026-09-1*.md` und `docs/archive/PLAYTEST_2026-09.md` und werden mit der Baseline
beantwortet.

## 8. Reihenfolge

1. Dieses Dokument.
2. Phase 1: 1a, 1b, 1c nacheinander; 1d unabhängig davon.
3. Phase 2a: Run-Log, Speichern und Export.
4. Phase 2b: Bots und Bot-Server (braucht das Format aus 2a).
5. Phase 2c: Auswertung, Baseline.
6. Phase 3a: Kampagnenende und Zyklus; 3b: Zielbänder, Tuning in Runden.

## 9. Entscheidungen

Vom User am 2026-09-19:

- **D1 Name:** Kampagne (`Campaign`), eine Welle darin heißt Kampagnenwelle (`CampaignWave`).
- **D2 Nach dem Ende:** Zyklus, ein Block der Kampagne wiederholt sich mit steigender Skalierung. Welcher Block und
  wie stark, wird nach der Baseline festgelegt.
- **D3 Spielraum:** nur die Faktoren, in Grenzen je Kampagnenwelle; keine Template-Auswahl.
- **D4 Reihenfolge:** erst aufräumen (Phase 1), dann Daten sammeln (Phase 2).
- **D5 Static-Profile:** gestrichen; "Director aus" spielt die Kampagne mit festen Mittelwerten.
- **D6 Menschliche Läufe:** die eigenen automatisch, andere Spieler per exportierter Datei; kein Upload, kein Server.
- **D8 Anpassung an den Spieler:** bleibt adaptiv wie heute; Überlebbarkeits-Deckel und Druck-Regler behalten ihre
  volle Wirkung. Folge für Abschnitt 5: Gleicher Seed ergibt gleiche Wellen nur bei gleichem Spielverlauf.
- **D9 Ziel der Partie:** Sieg am Ende der Kampagne, danach Weiterspielen im Zyklus; gezählt wird die erreichte Welle.
- **D10 Partiedauer:** noch offen, ergibt sich aus der Baseline.
- **D11 Seed:** nur intern (Run-Log, Bots, Auswertung), Spieler sehen und teilen ihn nicht.
- **Templates:** Die bestehenden Templates und die Folge W1 bis W30 sind die Grundlage und werden verbessert, nicht
  verworfen.
- **D12 Alte Trainingsdaten:** Checkpoints und Trainings-Logs im Backend (ungetrackt) werden in Phase 1 gelöscht;
  eine spätere AI ließe sich neu aufsetzen. `venv` bleibt, der Server braucht es.
- **D13 Auswertung:** Das Skript erzeugt einen HTML-Bericht mit Kurven je Welle; das Dashboard `:3002` zeigt nur,
  welche Bot-Läufe gerade laufen. Jede Runde fasse ich kurz zusammen.
- **D14 Karten:** Bots spielen nur in DevWorld. Menschen spielen echte Karten; ihre Läufe sind der Maßstab.
- **D15 Bots:** zwei, Einsteiger und Könner. Keine eigenen Bots für die Suche nach zu starken Towern, das zeigen die
  Daten.
- **D16 Name des Backends:** `bot-server/`, Skill `/bots`, Fenster "Bots".
- **D17 Rhythmus:** Die Kampagne legt je Welle die Rolle fest (Einführung, Druck, Atempause, Boss), der Director
  setzt sie um: Atempause heißt Faktoren unten im Spielraum, Druck oben.

Vom User am 2026-09-20:

- **D7 Arbeitsweise:** Paket für Paket, gebaut im Hauptthread, kein Worker-Team und keine Worktrees. Alles auf
  einem Branch (`next`). Nach jedem Paket ein Zwischenbericht und die Abnahme des Users, bevor das nächste
  beginnt.


## Der Druck-Regler (2026-09-21)

Der Leck-Regler ist durch einen Regler auf den HP-Druck ersetzt. Plan, Messreihe und alle Iterationen stehen in
[DRAMA_CONTROLLER_PLAN.md](DRAMA_CONTROLLER_PLAN.md); das Wesentliche in drei Sätzen:

Der alte Regler schwang, statt zu regeln. Seine Regelgröße, die Leck-Quote, ließ sich bei kleinen Wellen gar
nicht auflösen, die Aufbauwellen trieben ihn in die Sättigung, und eine einzelne gepinnte Luftwelle verzog ihn
für den Rest des Laufs. Gemessen an 360 Könner-Läufen: zwölf Wellen am Stück ohne HP-Verlust, dann ein
Überschwingen auf 365 Gegner und eine Wand, an der drei Viertel der Läufe starben.

Die neue Regelgröße ist der Anteil des **aktuellen** HP-Bestands, den eine Welle kostet. Sie misst Spannung
statt Lecks, löst auch bei fünf Gegnern auf, und sie überlebt Heilung: Wenn Pickups oder gekaufte Heilung
dazukommen, steigt der Nenner, die Welle darf absolut mehr kosten, und der relative Druck bleibt gleich. Der
Sollwert folgt aus der gewünschten Lauflänge (`1 - RESIDUAL_HP^(1/TARGET_RUN_WAVES)`), ist also ein
Design-Parameter statt eines Tuning-Ergebnisses, und steuert zugleich den Leck-Spielraum des Deckels.

Dazu kam eine Änderung an der Ökonomie, ohne die kein Regler etwas ausrichten kann: Bei 100 HP und 1 bis 4 HP
je Leck hatte ein Lauf ein Budget von rund 40 Durchbrüchen, auf 80 Wellen also einen halben je Welle. In jeder
zweiten Welle durfte damit nichts durchkommen. `startHealth` steht jetzt auf 500 und der Leck-Schaden wächst je
30 statt je 10 Wellen; damit sind es drei bis vier Durchbrüche je Welle.
