# Balancing: Plan

**Status:** Plan, nicht gebaut. Stand 2026-09-19. Ersetzt `RUN_DUMP_PLAN.md`, dessen Inhalt in Phase 2 aufgegangen
ist. Der Eintrag E1 in [TODO.md](../TODO.md) verweist hierher. Entscheidungen stehen in Abschnitt 9.

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
| `GateController`, `budgetMultiplier` | Leck-Regler | `LeakController`, `leakMultiplier` | das Wave-Debug-Fenster nennt ihn schon "Leak loop" |
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
- **Kill-Gold** ist ein festes Budget je Welle, gleichmäßig auf die Körper verteilt. Ein Boss zahlt so viel wie ein
  Zombie derselben Welle, ein geleckter Gegner nichts.
- **Abschlussgold** mit Boni: Perfect +35 %, Combo bis +30 %, Close Call +12 %, Comeback höchstens 15 Gold,
  Meilensteine 45 bis 170 Gold. Die Aufteilung sieht der Spieler nirgends, `wave:completed.credits` ist immer 0.
- **Kurve** ohne Boni: W10 7.200, W20 74.000, W30 791.000 Gold kumuliert. Der Ziel-Endausbau (jeder Tower einmal,
  Upgrades L20, alle Forschung, RC 3, Silo, Held) kostet 474.702: 67 % Puffer, bewusst "erst nach dem Playtest"
  nachgesteuert. Nach W30 halbiert sich das Wellengold je Welle, ab W35 bleibt es bei 9.000 (Boss 18.000).
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

- **ONNX:** `onnx-policy.ts` samt Spec, die ONNX-Teile von `wave-director.service.ts` (Modellzustand, Laden,
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

### Abnahme Phase 1

- Vor dem Umbau schreibt ein Spec eine Referenzdatei: Wellen 1 bis 60 aus festen Zuständen mit fest injiziertem
  Zufall. Nach jedem Paket liefert derselbe Spec dieselben Wellen.
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
Befehle je Sub-Step). Damit das Befehls-Log als Eingabe taugt, laufen alle Aktionen über `command:*`; heute setzen
und verkaufen Bots Tower direkt am `GameStateManager` vorbei (2b).

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

### 2c Auswertung

- Ein Skript in `bot-server/` liest Bot-Läufe und exportierte menschliche Läufe gleich. Es gruppiert nach
  Config-Hash (warnt bei gemischten Ständen) und nach Parametersatz.
- Es schreibt einen HTML-Bericht (D13) mit Kurven je Welle: erreichte Welle, HP-Verlust, Leck-Quote, Bindung an den
  Deckel, ungenutztes Gold, Ausgaben nach Zweck, Anteil und Schaden je Gold je Tower-Typ, Wellendauer, Entscheidungen
  je Welle.
- **Baseline:** Einsteiger und Könner mit je etwa 50 festen Seeds in DevWorld, dazu deine Läufe auf echten Karten.

## 7. Phase 3: Kampagnenende und Tuning

### 3a Kampagnenende (D2, D9)

Sieg-Bildschirm nach der letzten Kampagnenwelle, danach Weiterspielen im Zyklus. Blocklänge und Skalierung des
Zyklus kommen aus der Baseline; bis dahin gilt ab W31 das heutige Verhalten.

### 3b Zielwerte und Tuning

**Kennzahlen, Entwurf** (Zielbänder legt der User nach der Baseline fest):

| Kennzahl | Messung | Richtung |
|---|---|---|
| Druck | Anteil der Wellen mit HQ-Schaden (Bots am 2026-08-28: 22 %) | deutlich höher, ohne frühen Tod |
| Beinahe-Niederlagen | Wellen, die mehr als die Hälfte des Leck-Deckels (18 HP) kosten | ab und zu, nicht nie |
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
- **D8 Anpassung an den Spieler:** bleibt adaptiv wie heute; Überlebbarkeits-Deckel und Leck-Regler behalten ihre
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

Offen:

- **D7 Arbeitsweise:** Der User liest zuerst den ganzen Plan; danach wird entschieden, wie gebaut wird.
