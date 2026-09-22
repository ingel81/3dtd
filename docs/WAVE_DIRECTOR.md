# Wave Director

**Stand:** 2026-09-21. Der Wave Director ist regelbasiert, läuft vollständig im Client und ist die einzige
Wellenquelle. Kein Python-Server, kein Modell, keine Runtime. Wie der WaveManager die fertige Welle abspielt, steht
in [WAVE_SYSTEM.md](WAVE_SYSTEM.md); der Umbau, aus dem dieser Stand stammt, in
[BALANCING_PLAN.md](BALANCING_PLAN.md).

## 1. Kurzfassung

Eine Welle entsteht aus fünf Zahlen: einem Template-Index und vier Faktoren in `[0,1]` (Anzahl, Spawn-Abstand, HP,
Mischung). Alles danach ist gemeinsamer Code.

| Rolle | Wer | Datei |
|-------|-----|-------|
| Kandidaten bestimmen | `candidateTemplates()` | `src/app/director/templates.ts` |
| Die fünf Zahlen wählen | `decideWave()` | `src/app/director/director-rules.ts` |
| Überlebbarkeits-Deckel nachführen | `PressureController` | `src/app/director/pressure-controller.ts` |
| Fünf Zahlen zur Welle machen | `buildWaveConfig()` | `src/app/director/wave-config-builder.ts` |
| Das Ganze im Spiel | `WaveDirector` | `src/app/director/wave-director.ts` |

`GameStore.directorEnabled` steht auf `true`. Ist er aus, kommt die Welle aus dem Debug-Panel.

## 2. Warum Regeln und kein Modell

Die Entscheidung stammt aus einer Messung. Über einen Tag A/B-Läufe mit vier Directors, identischen Bots, gleicher
Kampagne und gleichem Deckel war das trainierte Netz dreimal statistisch ununterscheidbar von gleichverteiltem
Zufall (mittlere Runlänge 45,6 [42,49] gegen 44,7 [41,48]), während zwei triviale Heuristiken messbar mehr Spannung
erzeugten (Near-Miss 0,067 bis 0,069 gegen 0,045). Das Netz hatte nie gelernt: `log_std` stand nach Tausenden
Episoden unverändert auf dem Startwert, jeder Faktor-Mittelwert auf `sigmoid(0) = 0.5`.

Die Ursache lag vor dem Lernen: Die Kampagne pinnt das Template auf 49 % der Wellen, der Deckel band auf 63 %, und
der volle Bereich des Anzahl-Faktors bewegte eine Welle von 19 auf 28 Gegner. Es gab fast nichts zu entscheiden und
damit nichts zu lernen.

Messreihe und Herleitung: [archive/HANDOVER_RULE_DIRECTOR.md](archive/HANDOVER_RULE_DIRECTOR.md). ONNX-Modell,
State-Encoder und der Wellen-Pfad des Backends sind am 2026-09-20 entfernt worden.

## 3. Architektur

```
StateSnapshotService ──► GameStateSnapshot
        │                      │
        │ onWaveResult()       ▼
        │            buildWaveContext()  ── Kandidaten, Ranges, Deckel-Vorschau
        │                      │
        ▼                      ▼
  PressureController     decideWave()
  (Druck-Regelkreis)     → templateIdx + 4 Faktoren
        │                      │
        │ pressureMultiplier   ▼
        └────────────► buildWaveConfig()
                       · getTemplate / lerpRange
                       · DPS-Rampe (Anzahl, HP)
                       · endgameHpMultiplier(wave)
                       · survivableCount(..., pressureMultiplier, targetPressure)
                       · Dauer-Deckel (180 s), danach zweiter Pass
                               │
                               ▼
                       adaptDirectorWave ──► WaveManager
```

Der Bot-Server (`bot-server/`, WebSocket `:3001`) ist für Bot-Läufe zuständig und liefert keine Wellen.

## 4. Die Regeln

`director-rules.ts`, zwei bewusste Entscheidungen:

**Abwechslung wird erzwungen, nicht belohnt.** Der Director wählt das **älteste Kandidaten-Template** (Staleness =
Abstand zum letzten Vorkommen in der History, unbenutzte Templates gelten als am ältesten, Gleichstand wird zufällig
gebrochen). Wiederholung wird dadurch unmöglich statt nur teuer.

**Der Zufall ist geseedet.** Faktor-Jitter und der Gleichstand zwischen gleich alten Templates ziehen aus dem
Strom `director` des Laufs (`utils/game-rng.ts`); `getNextWave(random)` bekommt ihn von der Facade. Gleicher Seed
heißt gleiche Wellen, solange der Lauf gleich verläuft: Der Überlebbarkeits-Deckel und der Druck-Regler lesen die
Verteidigung und die verlorenen HP. `director/determinism.spec.ts` prüft das.

**Schwierigkeit ist eine Kurve, keine Entscheidung je Welle.** Der Spieler heilt nie, seine HP sind ein Budget für
den ganzen Run:

```
ramp = clamp01(waveNumber / 60)          // RAMP_FULL_WAVE = 60

count     = jitter(0.45 + 0.40 * ramp)   // wächst über den Run
spawn     = jitter(0.55 - 0.25 * ramp)   // Spawn-Abstand zieht an
hp        = jitter(0.40 + 0.35 * ramp)   // Gegner werden zäher
variation = jitter(0.60)                 // konstante Mischung

jitter(v) = clamp01(v ± JITTER)          // JITTER = 0.12
```

Der Jitter existiert nur, damit aufeinanderfolgende Wellen nicht identisch sind.

**Degenerierter Fall:** Ist die Kandidatenliste leer, liefert der Director Slot 0 mit festen Mittelwerten
`[0.6, 0.4, 0.5, 0.5]`. `candidateTemplates()` gibt nie eine leere Liste zurück; der Zweig ist rein defensiv.

## 5. Kandidaten und Kampagne

`candidateTemplates()` in `templates.ts` liefert die Template-Indizes, die eine Welle nutzen darf, plus die
Begründung:

- **W1 bis W30**: Die Liste kollabiert auf genau das Kampagnen-Template aus `src/app/configs/campaign.config.ts`.
  Der Pin umgeht die Voraussetzungen bewusst: Eine gepinnte Luftwelle kommt auch gegen eine Abwehr ohne Luftziel,
  der Überlebbarkeits-Deckel hält sie überlebbar.
- **Ab W31**: `minWave`, die Voraussetzung `requires` (`antiAir`, `antiEthereal`), der Reuse-Cooldown
  (`TEMPLATE_COOLDOWN_WAVES = 2`) und die Boss-Kadenz (`isBossWave()`: bis W30 jede zehnte Welle, dort gepinnt,
  danach jede fünfte). An Boss-Wellen bleiben nur die Boss-Templates übrig, die die Regeln bestehen
  (`boss_herbert`, `boss_golem`, `boss_dragon`; die Älteste-zuerst-Regel rotiert sie), an allen anderen sind sie
  gesperrt. Vorher waren Bosse an Vielfachen von 10 nur erlaubt: über 2.000 simulierte Läufe kamen zwischen W31
  und W130 0,7 statt 10 Boss-Wellen. Einen Teil der Boss-Wellen ersetzt die Facade danach durch eine Boss-Variante
  (Skarnax, Ooze), siehe [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-waves). Boss-Wellen nach W30 zahlen das doppelte
  Gold (`BOSS_GOLD_MULTIPLIER` in `waveGold`).
- **Fallbacks** in dieser Reihenfolge, damit die Liste nie leer ist: an einer Boss-Welle, deren Boss-Templates alle
  im Cooldown stehen, das erste davon trotz Cooldown; an einer Boss-Welle, die kein Boss-Template bedienen kann
  (`minWave`, Voraussetzung), eine normale Welle; danach das erste zulässige Template trotz Cooldown; zuletzt
  Slot 0.

22 aktive Templates.

## 6. Der Druck-Regler

`pressure-controller.ts`: ein Regelkreis, der die Kill-Schätzung von `survivableCount` über
`pressureMultiplier` (Default 1) korrigiert. Er löst am 2026-09-21 den Leck-Regler ab; die Begründung und die
Messreihe stehen in [DRAMA_CONTROLLER_PLAN.md](DRAMA_CONTROLLER_PLAN.md).

**Warum überhaupt:** `survivableCount` schätzt, wie viele Gegner eine Verteidigung zerstören kann, abgewertet mit
`FAIRNESS_KILL_REALISM = 0.65`. Dieser Abschlag wurde auf W1 bis W10 gemessen und ist ab W11 falsch. Der Deckel
landet damit auf "genau das, was die Türme töten können", was garantiert, dass sie es töten. Gemessen über 1834
Wellen ohne Korrektur: **70 % der Wellen töteten alles, 80 % machten keinen Schaden**.

**Regelgröße ist der Druck**, also der Anteil des HP-Bestands, den eine Welle kostet:

```
pressure(w) = hpLost(w) / hpAtWaveStart(w)
```

Drei Gründe, warum nicht mehr die Leck-Quote. Alle drei sind an 360 Könner-Läufen gemessen:

- **Auflösung.** Das alte Zielband war eine Leck-Quote von 8 bis 16 %. Bei sieben gespawnten Gegnern sind nur
  0 %, 14 % und 29 % darstellbar. Der Regler fuhr sich selbst in den Bereich, in dem er nicht mehr messen konnte.
- **Windup.** Die Wellen 1 bis 3 lecken 71, 37 und 10 %, weil der Spieler noch keine Türme hat. Nach zwei Wellen
  stand der Multiplikator auf dem unteren Anschlag; über alle Wellen klebte er zu 34,6 % dort.
- **Ausreißer.** Die Kampagne pinnt Luftwellen auf W7, W8, W12, W16 und W21. Gegen eine Abwehr ohne Luftziel
  lecken sie stark, und ein Mittelwert über vier Wellen schrumpfte danach auch jede Bodenwelle.

Das Ergebnis war ein Oszillator: zwölf Wellen am Stück ohne HP-Verlust, dann ein Überschwingen auf 365 Gegner
und eine Wand bei W27, an der 75 % der Läufe starben.

**Der Bezug ist der Stand zu Wellenbeginn, nicht das Maximum.** Das ist die Stelle, an der der Regler
heilungsfest wird: Heilt der Spieler künftig über Pickups oder Käufe, steigt der Nenner, die Welle darf absolut
mehr kosten, und der relative Druck bleibt gleich. Geheilte HP sind dann echter Fortschritt in Form überlebter
Wellen, ohne dass die Spannungskurve verflacht.

**Der Sollwert kommt aus der gewünschten Lauflänge.** Kostet jede Welle im Mittel den Anteil `p`, sind nach `N`
Wellen noch `(1 - p)^N` übrig:

```
BASE_PRESSURE = 1 - TARGET_RESIDUAL_HP ^ (1 / TARGET_RUN_WAVES)   // 3,67 % bei 80 Wellen und 5 % Rest
shape(w)      = 0.5 + 1.0 * clamp01(w / TARGET_RUN_WAVES)          // mild am Anfang, hart am Ende
target(w)     = BASE_PRESSURE * shape(w)
```

Dieselbe Zahl steuert beide Stellen, die vorher getrennt liefen: den Sollwert des Reglers und den Leck-Spielraum
im Deckel (früher feste `FAIRNESS_WAVE_HP_BUDGET = 0.06`).

**Der Regler selbst:**

```
PRESSURE_WARMUP_WAVES = 4      // Wellen, die gar nicht erst ins Fenster kommen
PRESSURE_WINDOW       = 5      // Wellen, über die der Median läuft
PRESSURE_GAIN         = 0.5    // auf den logarithmischen Fehler
PRESSURE_MAX_STEP     = 0.7    // höchstens ×1,42 je Welle
PRESSURE_BAND_LO/HI   = 0.5 / 1.5
PRESSURE_MULT_MIN/MAX = 0.5 / 20

measured = median(pressure über das Fenster)
error    = ln(target / max(measured, PRESSURE_FLOOR))
mult    *= exp(PRESSURE_GAIN * clamp(error, ±PRESSURE_MAX_STEP))
```

- **Median statt Mittel** gegen die gepinnten Luftwellen.
- **Logarithmischer Fehler**, damit "halb so viel" und "doppelt so viel" gleich schwer wiegen. Der alte relative
  Fehler war nach oben auf +1 begrenzt und nach unten unbegrenzt.
- **Warmup** als Anti-Windup: die Aufbauwellen messen einen Spieler ohne Türme.
- **Kein Sonderfall für den Tod.** Der alte `backed-off`-Zweig wirkte erst nach dem Ende des Laufs und war für
  dessen Verlauf ohne Wirkung.

Weiter gelten unverändert:

- **State ist per Run.** `reset()` über `WaveDirector.resetForNewGame()`. Ließ man den Multiplikator stehen,
  wurde er zur Ratsche: mediane Runlänge 6 Wellen gegen ein Ziel von 80.
- **Verdrahtung:** Der Regler hängt an `StateSnapshotService.onWaveResult()`, nicht am `wave:completed`-Event.
  `pressure-wiring.spec.ts` existiert genau dagegen.
- **Der Held zählt als Verteidigung** (`analyzeDefense`, Präsenzfaktor 0,5). Details in [HERO.md](HERO.md).

**Der Deckelboden.** `FAIRNESS_MIN_COUNT = 5` war der Grund, warum der Regler in der toten Mitte blind wurde:
Der Deckel konnte nicht unter fünf Gegner, und bei sieben gespawnten ist über den Druck nichts mehr auszusagen.
Der wirksame Boden ist jetzt die halbe Template-Untergrenze
(`FAIRNESS_MIN_COUNT_TEMPLATE_SHARE = 0.5`), die feste Fünf nur noch der Notnagel.

## 7. Von fünf Zahlen zur Welle

`buildWaveConfig()` in `wave-config-builder.ts`. Die Reihenfolge ist relevant:

1. **Template-Lookup.** Ungültiger Index gibt Fehlerlog und Slot 0, keine Exception.
2. **Ranges interpolieren** (`lerpRange`): Spawn-Abstand, HP-Multiplikator, Mischung.
3. **DPS-Rampe** auf Anzahl und HP: Der obere Endpunkt wird mit `min(1, totalDPS / DPS_RAMP_*)` skaliert, Floor
   `DPS_RAMP_FLOOR = 0.10` (`DPS_RAMP_COUNT = 500`, `DPS_RAMP_HP_MULT = 1000`).
4. **Endgame-Multiplikator**: `hpMult *= endgameHpMultiplier(wave)`, W1 bis W20 ×1.0, danach +5 % je Welle,
   Deckel ×4.0 ab W80.
5. **Überlebbarkeits-Deckel** (`survivableCount`, mit `pressureMultiplier`), mal `capSlack` (heute **1,5**). Der
   Deckel **interpoliert, statt zu clampen**: Er wird in die Anzahl-Range hineingefaltet, sodass der Faktor "wie
   weit in das aktuell Erlaubte" bedeutet. Liegt der Deckel *unter* `countRange[0]`, gewinnt der Deckel.

   `capSlack` ist die Luft darüber. Bei 1 ist die Welle genau das, was die Verteidigung töten kann, und deshalb
   nie gefährlich: Gemessen über 749 Bot-Läufe kostete das Mittelspiel des Könners zwölf Wellen am Stück gar
   nichts, und der schwächere Bot kam weiter als der stärkere. Bei 2 bricht beides zusammen, beide Bots sterben
   im Median bei Welle 13. 1,5 ist das Maximum dazwischen
   ([BALANCING_PLAN.md](BALANCING_PLAN.md), Tuning-Runde 1).
6. **Dauer-Deckel.** `count × spawnDelay > 180_000 ms` komprimiert den Spawn-Abstand (`MIN_SPAWN_DELAY_MS = 5`).
   Danach **zweiter Pass** über den Überlebbarkeits-Deckel: Eine langsame Mega-Welle passiert ihn gerade *weil* ihr
   langes Spawn-Fenster der Verteidigung Zeit gibt, und die Kompression vervielfacht danach die Spawn-Rate.
7. **Template zu Gegner-Gruppen** über die Anteile, Rest auf die letzte Gruppe.

### Der Überlebbarkeits-Deckel im Einzelnen

`survivableCount()` (`templates.ts`) schätzt, wie viele Gegner die Verteidigung tötet, solange die Welle spawnt und
die Gegner im Feuer stehen, und gibt eine Leck-Toleranz obendrauf:

- **Kills je Sekunde:** das Knappere aus DPS gegen die Gegner-HP (je Rüstung, Boden und Luft getrennt, aus
  `gateDpsPerArmor`) und dem Kill-Durchsatz der Tower (`killThroughput`, ein Ziel je Schuss). Ein Gegner, der sich
  teilt, zählt mit seiner ganzen Linie.
- **Zeit im Feuer:** die Spawn-Dauer plus `FAIRNESS_ENGAGEMENT_REACH_M = 60` m geteilt durch das Tempo der Gegner,
  geklemmt auf 2 bis 40 s.
- **Abschlag:** `FAIRNESS_KILL_REALISM = 0.65`, mal `pressureMultiplier` aus Abschnitt 6.
- **Leck-Toleranz in HP:** `targetPressure(wave)` der Rest-HP (Abschnitt 6), mindestens `FAIRNESS_MIN_LEAK_HP = 1`,
  geteilt durch den Leck-Schaden der Welle (`enemyBaseDamageForWave`) und durch die Lecks, die ein Gegner höchstens
  kostet (`splitLeafCount`).
- **Untergrenze** die halbe Template-Untergrenze, mindestens `FAIRNESS_MIN_COUNT = 5`.

**Matchup-Floor.** Der Deckel liest `gateDpsPerArmor` aus der Defense-Analyse, nicht die rohe Matrix: gegen
Boden-Gegner zählt jeder Tower mindestens `FAIRNESS_MATCHUP_FLOOR = 0.6` seiner DPS. Ohne Floor machte eine
schlechte Paarung die Welle nur kleiner, und die breitere Schadensmatrix wäre im Deckel verschwunden. Ethereal und
Luft bleiben auf der reinen Matrix, dort greifen die Voraussetzungen.

## 8. Erklärung im Wave-Debug-Fenster

Jede Director-Welle trägt ihre Begründung in `WaveConfig.explanation`; die Facade legt sie nach
`GameStore.waveExplanation`, das Wave-Debug-Fenster zeigt sie als "Why this wave". Custom-Wellen aus dem Debug-Panel
setzen `null`.

Die Gründe stammen aus der Entscheidung selbst, nicht aus einer Analyse des Spielzustands:

| Quelle | Liefert |
|--------|---------|
| `candidateTemplates` (`templates.ts`) | Kampagnen-Pin, Boss-Regel, Templates, die eine fehlende Fähigkeit sperrt, Cooldown-Verzicht |
| `DirectorDecision.why` (`director-rules.ts`) | Anzahl der Kandidaten, wann das gewählte Template zuletzt lief, Gleichstand, Rampen-Position |
| `PressureController.status` | Median-Druck über das Fenster, letzter Schritt des Reglers, Multiplikator |
| `buildWaveConfig` | DPS-Rampe, Überlebbarkeits-Deckel (bindet, kollabiert, bindet nicht), Dauer-Deckel, Endgame-HP |

`decision-explainer.ts` formt daraus nur Sätze. Der Druck-Regler wird nur genannt, wenn der Deckel die Welle
tatsächlich begrenzt hat.

## 9. Dateien

| Datei | Zweck |
|-------|-------|
| `director/templates.ts` | 22 Templates mit Ranges, `candidateTemplates()`, `survivableCount()`, DPS-Rampe |
| `director/director-rules.ts` | `decideWave()`: Template-Wahl und die vier Faktoren |
| `director/pressure-controller.ts` | Druck-Regelkreis, `targetPressure()`, `wavePressure()` |
| `director/wave-config-builder.ts` | Fünf Zahlen zur `WaveConfig`, mit Begründung |
| `director/wave-context.ts` | Kandidaten, Ranges und Deckel-Vorschau für eine Welle |
| `director/wave-director.ts` | Angular-Service: plant die Welle, hält History und Druck-Regler |
| `director/decision-explainer.ts` | Begründung als Sätze |
| `director/state-snapshot.service.ts` | `GameStateSnapshot` für Director und Bots, Wellen-History |
| `director/defense-analyzer.ts` | Verteidigungs-Analyse, DPS je Rüstung und Schadensart |
| `director/wave-reference.spec.ts` | Referenzlauf W1 bis W60 gegen `wave-reference.json` |
| `director/determinism.spec.ts` | Gleicher Seed, gleiche Wellen und Spawns |
| `utils/game-rng.ts` | Lauf-Seed und die Ströme `director`, `spawn`, `enemy`, `bot` |
| `configs/campaign.config.ts` | Kampagne W1 bis W30: Template und Wellengold je Welle |

## 10. Offen

- Der Zyklus nach der Kampagne, das Kampagnenende und die Zielbänder für das Tuning stehen in
  [BALANCING_PLAN.md](BALANCING_PLAN.md), Phase 3.
- Der Lauf-Seed steht noch in keinem Log; das kommt mit dem Run-Log (Phase 2a).

## 11. Verwandte Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | WaveManager, Spawner, Boss-Wellen, Blutmond |
| [BALANCING_PLAN.md](BALANCING_PLAN.md) | Umbau der Wellen-Pipeline, Datensammlung, Tuning |
| [DRAMA_CONTROLLER_PLAN.md](DRAMA_CONTROLLER_PLAN.md) | Warum der Druck-Regler den Leck-Regler ablöst, mit Messreihe |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Bots, die gegen den Director spielen |
| [ABILITIES.md](ABILITIES.md) | Fähigkeiten und ihre Wirkung auf den Druck |
| [HERO.md](HERO.md) | Der Held im Verteidigungsmodell |
| [archive/HANDOVER_RULE_DIRECTOR.md](archive/HANDOVER_RULE_DIRECTOR.md) | Messreihe hinter dem Wechsel auf Regeln (2026-09-07) |
