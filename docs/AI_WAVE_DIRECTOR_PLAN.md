# Wave Director: Gesamtübersicht

> **Stand:** 2026-09-15. Regelbasierter Wave-Director + Fairness-Gate-Regelkreis,
> vollständig clientseitig. Das ONNX-Modell ist **nicht mehr** der Director; es
> bleibt als Opt-in im Debug-Fenster erreichbar, sobald ein Modell mit der
> Eingangsbreite des Encoders exportiert ist (das eingecheckte hat 156 statt 208).
>
> Das Spiel braucht im Betrieb **keinen Python-Server, kein Modell und keine
> ONNX-Runtime**.
>
> Director, Maske, Decoder, Fairness-Cap und Gate-Controller stehen nur in
> diesem Dokument. Wie der WaveManager die fertige Welle abspielt, steht in
> [WAVE_SYSTEM.md](WAVE_SYSTEM.md).

Dieses Dokument beschreibt, was heute Wellen erzeugt, warum das trainierte Netz
dabei ersetzt wurde, und was vom RL-Aufbau übrig bleibt und wofür.

---

## 1. Kurzfassung

Eine Welle entsteht aus fünf Zahlen: einem Template-Index und vier Formfaktoren
in `[0,1]` (`count`, `spawn`, `hp`, `variation`). Alles danach (Maske, Range-
Interpolation, DPS-Ramp, Endgame-Multiplikator, Fairness-Cap, Duration-Cap) ist
gemeinsamer Code und identisch, egal wer die fünf Zahlen liefert.

| Rolle | Wer heute | Datei |
|-------|-----------|-------|
| Die fünf Zahlen wählen | `RuleDirector` | `src/app/ai/core/rule-director.ts` |
| Fairness-Cap nachführen | `GateController` | `src/app/ai/core/gate-controller.ts` |
| Fünf Zahlen → Welle | `buildWaveConfig` | `src/app/ai/core/wave-config-builder.ts` |
| Optional statt Regeln | ONNX-Policy (Opt-in) | `OnnxPolicy` + `decodeModelOutput` in `src/app/ai/core/onnx-policy.ts` |

Der Default in `WaveDirectorService` ist `modelState = 'rules'` / `aiMode =
'rules'`, `GameStore.useAIDirector` steht auf `true`. Beim Start wird **nichts**
geladen; `loadModel()` läuft nur, wenn man im Training-Debug-Fenster auf
„Load ONNX model" klickt, und `forceRuleMode()` („Use rules") schaltet zurück.

Den Knopf zeigt das Fenster nur, wenn `metadata.json` des Modells genau
`ENCODED_STATE_SIZE` Eingänge nennt. `checkModel()` liest das bei jedem Öffnen
des Fensters nach, ohne die Runtime zu laden. Das eingecheckte Modell nennt 156,
der Encoder liefert 208, deshalb fehlt der Knopf heute; nach einem passenden
Export erscheint er beim nächsten Öffnen von selbst. Details:
[AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md#wann-der-opt-in-erscheint).

Den Zustand `'fallback'` gibt es nicht mehr. Er bedeutete früher „Modell fehlt,
Fehler" und führte zu einer Exception; heute ist „kein Modell" der Normalfall.

---

## 2. Warum die Regeln und nicht das Modell

Die Entscheidung stammt aus einer Messung, nicht aus einer Meinung.

### Der A/B-Aufbau

Vier Wave-Designer liefen gleichzeitig gegen dieselben Bots, dasselbe Curriculum
und dasselbe Fairness-Gate. Der Server verteilt sie per Round-Robin über die
verbundenen Clients (`config.DIRECTOR_ROSTER = ["model", "rules", "random",
"maxgate"]`, Implementierung in `training-backend/directors.py`):

| Director | Verhalten |
|----------|-----------|
| `model` | Die trainierte Policy, der Status quo |
| `random` | Gleichverteilt über die erlaubte Maske, gleichverteilte Faktoren: der ehrliche Boden |
| `rules` | Ältestes erlaubtes Template, Faktoren aus einer festen Rampe |
| `maxgate` | Zufälliges Template, aber immer so groß, wie das Gate erlaubt |

Nur `model` schreibt Trainings-Erfahrung (`Director.is_learner`); die anderen
liefern reine Vergleichsläufe.

### Das Ergebnis

- Das trainierte Netz war **dreimal statistisch nicht von uniformem Zufall zu
  unterscheiden**: mittlere Runlänge 45.6 [42, 49] gegen 44.7 [41, 48] bei
  `random`.
- Zwei triviale Heuristiken (`rules`, `maxgate`) erzeugten mehr Spannung:
  near-miss 0.067–0.069 gegen 0.045 beim Modell.
- Das Netz hatte nie gelernt: nach tausenden Episoden stand `log_std`
  unverändert auf dem Initialwert (−0.5001 gegen −0.5), und alle vier
  Faktor-Mittelwerte lagen auf `sigmoid(0) = 0.5`. Statistisch war die Policy
  noch ihre eigene Initialisierung.

### Die Ursache liegt vor dem Lernen

Nicht der Optimierer war das Problem, sondern der Entscheidungsraum:

- Das **Curriculum nagelt das Template auf 49 % der Waves fest** (W1–30 pinnt
  die Maske auf genau ein Slot, siehe Abschnitt 6).
- Der **Fairness-Cap band auf 63 % der Waves**, wählte also faktisch die
  Wellengröße statt des Directors.
- Der volle Regelbereich des `count`-Faktors bewegte eine Welle dadurch von 19
  auf 28 Gegner.

Es gab fast nichts zu entscheiden und damit nichts zu lernen. Jede Verbesserung,
die in dieser Zeit gemessen wurde, kam aus deterministischem Code (ein fehlender
State-Reset, ein korrigiertes Regelsignal), nicht aus dem Training.

**Konsequenz:** Eine Abhängigkeit, die 404 kB ONNX-Runtime, einen Netzwerk-
Roundtrip und einen Ladefehler-Pfad kostet, muss sich das verdienen. Diese tut es
derzeit nicht. Der Pfad bleibt trotzdem erreichbar, für einen späteren Lauf, der
gegen echte Spielerdaten statt gegen ein Skript-Bot trainiert.

---

## 3. Architektur heute

```
┌──────────────────────────────── BROWSER (Angular) ────────────────────────────────┐
│                                                                                   │
│  AIDataCollectorService ──► GameStateSnapshot                                     │
│         │                        │                                                │
│         │ onWaveResult()         ▼                                                │
│         │              buildWaveContext()  ── Maske, Ranges, Fairness-Headroom     │
│         │                        │                                                │
│         ▼                        ▼                                                │
│  GateController          RuleDirector.decide()                                    │
│  (Leak-Regelkreis)       → templateIdx + 4 Faktoren                                │
│         │                        │                                                │
│         │ budgetMultiplier       ▼                                                │
│         └──────────────► buildWaveConfig()                                        │
│                          · getTemplate / lerpRange                                 │
│                          · DPS-Ramp (count, hp)                                    │
│                          · endgameHpMultiplier(wave)                               │
│                          · fairMaxCount(..., budgetMultiplier)                     │
│                          · Wave-Duration-Cap (180 s), danach 2. Pass               │
│                                  │                                                │
│                                  ▼                                                │
│                          WaveConfigAdapter ──► Game (WaveManager)                  │
│                                                                                   │
│  ── Opt-in ───────────────────────────────────────────────────────────────────    │
│  loadModel() ► ONNX-Session ► decodeModelOutput() ─┘  (gleicher buildWaveConfig)   │
└───────────────────────────────────────────────────────────────────────────────────┘

┌────────────── TRAINING BACKEND (Python, optional, nur für Trainingsläufe) ────────┐
│  server.py (WebSocket :3001) · core/: model.py, trainer.py (PPO), reward.py       │
│  directors.py (A/B-Roster) · schema.py ← generated/ai-schema.json                 │
│  dashboard/ (FastAPI :3002)                                                       │
└───────────────────────────────────────────────────────────────────────────────────┘
```

Während eines Trainingslaufs wählt weiterhin der Server die Welle über den
WebSocket; der Client ist dann Umgebung, nicht Entscheider. Im normalen Spiel
existiert diese Verbindung nicht.

---

## 4. Der Regel-Director

`src/app/ai/core/rule-director.ts`: zwei bewusste Entscheidungen, beide gegen
das, was das RL-Setup versucht hatte:

**Abwechslung wird erzwungen, nicht belohnt.** Die Reward-Funktion hatte einen
`variation`-Term und die Maske einen Template-Cooldown, die Wellen kamen
trotzdem repetitiv heraus. Der Regel-Director wählt das **älteste erlaubte
Template** (Staleness = Abstand zum letzten Vorkommen in der History, unbenutzte
Templates gelten als am ältesten; Gleichstand wird zufällig gebrochen).
Wiederholung wird dadurch unmöglich statt nur teuer.

**Schwierigkeit ist eine Kurve, keine Per-Wave-Entscheidung.** Der Spieler heilt
nie, seine HP sind also ein Budget für den ganzen Run. Damit ist Schwierigkeit
etwas, das man aufschreibt, und nicht etwas, das man aus einem skalaren Reward
pro Welle ableitet:

```
ramp = clamp01(waveNumber / 60)          // RAMP_FULL_WAVE = 60

count     = jitter(0.45 + 0.40 * ramp)   // wächst über den Run
spawn     = jitter(0.55 - 0.25 * ramp)   // Spawn-Abstand zieht an
hp        = jitter(0.40 + 0.35 * ramp)   // Gegner werden zäher
variation = jitter(0.60)                 // konstante Mischung

jitter(v) = clamp01(v ± JITTER)          // JITTER = 0.12
```

Der Jitter existiert nur, damit aufeinanderfolgende Wellen nicht identisch sind.

**Degenerierter Fall:** Ist die Maske komplett leer (curriculum-erzwungenes
Template, dessen Slot zugleich vom Capability-Gate blockiert wird), liefert der
Director Slot 0 mit festen Mittelwerten `[0.6, 0.4, 0.5, 0.5]`. Über eine Welle,
die niemand ausliefern wollte, ist keine sinnvolle Schwierigkeitsaussage zu
treffen.

`training-backend/directors.py::RuleDirector` ist dieselbe Logik in Python, die
Referenz, gegen die gemessen wurde. Wer eine Seite ändert, muss die andere
mitziehen, sonst misst der A/B-Lauf etwas anderes als das Spiel.

---

## 5. Der Gate-Controller

`src/app/ai/core/gate-controller.ts`: ein Regelkreis, der vorher nur im Backend
existierte. Er korrigiert die Kill-Schätzung von `fairMaxCount` über den neuen
letzten Parameter `budgetMultiplier` (Default 1).

**Warum überhaupt:** `fairMaxCount` schätzt, wie viele Gegner eine Verteidigung
zerstören kann, abgewertet mit `FAIRNESS_KILL_REALISM = 0.65`. Dieser Abschlag
wurde auf Waves 1–10 gemessen und ist ab Wave 11 falsch: dort erreichen
Verteidigungen praktisch das volle DPS-Modell. Der Cap landet damit auf „genau
das, was die Türme töten können", was garantiert, dass sie es töten. Gemessen
über 1834 Waves ohne Korrektur: **70 % der Wellen töteten alles, 80 % machten
keinen Schaden**, near-miss lag bei 0.03.

**Regelgröße ist die Leak-Quote**, nicht die Kill-Quote. Über Kill-Anteil zu
regeln („die Verteidigung hat alles getötet, also mehr erlauben") liest die
eigene Vorsicht des Reglers als Spielraum: eine kleine Welle wird geräumt, *weil*
sie klein ist. Das ist einseitiger Druck; im Python-Original pinnte es den
Multiplikator auf jede gegebene Obergrenze; bei 40 entstanden Caps von 4761
Gegnern, das Gate war effektiv aus. Leak ist zweiseitig und pendelt sich ein.

**Proportionalregler statt fester Schrittweite.** Der Multiplikator muss ~1.6
erreichen, nur um den veralteten Realism-Abschlag aufzuheben, und mehr, bevor
überhaupt etwas durchkommt. Bei 5 % pro Fenster wären das ~170 Waves gegen Runs
von ~60, die bei 1.0 starten; er kam nie an (gemessener Median 1.28).

```
GATE_ADAPT_WINDOW    = 4      // Waves Leak-History, bevor überhaupt geregelt wird
GATE_LEAK_TARGET_LO  = 0.08   // Zielband für den Anteil, der die Basis erreicht
GATE_LEAK_TARGET_HI  = 0.16
GATE_GAIN            = 0.35   // proportional auf den relativen Leak-Fehler
GATE_MULT_DOWN       = 0.8    // Rückfall bei Run-Ende, bewusst härter als der Gain
GATE_MULT_MIN / MAX  = 0.5 / 8
```

Innerhalb des Bandes wird nicht nachgeregelt: ein wenig kommt durch, der
Spieler lebt, das ist der Zielzustand. Bei einem Run-Ende wird multiplikativ und
härter zurückgenommen, weil die Kosten einer zu großen Welle asymmetrisch sind.

**`leakRatio = null` ist nicht `0`.** Eine Welle ohne Per-Gegner-Daten ist kein
Beleg in irgendeine Richtung; ein Phantom-Sample „nichts ist durchgekommen"
würde den Regler auf nicht existierender Evidenz öffnen.

**Split-Kinder zählen mit.** Die Leck-Quote ist der Anteil der Körper, die die
Basis erreicht haben, an allen Körpern, die die Welle auf die Route gebracht hat.
Die zwei Minions eines getöteten Skeletons sind eigene Körper: ein durchgelaufener
Minion ist ein Leck, das getötete Skeleton ein Kill. Der Nenner wächst mit jedem
Split; die Fortschrittsliste führt jeden Gegner ohnehin einzeln, und
`WaveOutcome.enemiesSpawned` zählt die Kinder seit 2026-09-13 mit.

**Ein Ooze ist ab dem ersten Punkt ein Leck.** Es fließt Meter für Meter in die
Basis (`enemy:leaking`) und kostet dabei HP. Der Collector bucht es beim ersten
Punkt einmal als Ankunft; das spätere `enemy:reached-base` zählt nicht noch
einmal, ein Kill auf halbem Weg hinein ist kein Kill. Die Fortschrittsliste, aus
der das Gate liest, stand dafür schon vorher auf 1: die Spitze ist am Pfadende,
wenn das Einfließen beginnt.

**Fähigkeits-Kills zählen als Leck.** Was eine Fähigkeit des Spielers tötet
(Event `ability:resolved`, Feld `kills`), zählt `gateLeakRatio()` zu den Ankünften (Entscheidung 6.1 b, Abschnitt 7 in
[PLAYER_AGENCY_CONCEPT.md](game-design/PLAYER_AGENCY_CONCEPT.md)): der Einsatz
rettet HP und Gold, macht die Wellen danach aber nicht größer. Die Zahl kommt
über `WaveOutcome.abilityKills` vom Collector; das Backend-Gate zählt genauso
(`gate_leak_share`), der Reward nicht. Details in [ABILITIES.md](ABILITIES.md).

**Der Held zählt als Verteidigung.** Ein angeheuerter Held wirkt dauernd und
steht deshalb im Defense-Modell: `analyzeDefense` rechnet ihn als virtuellen
Tower mit Präsenzfaktor 0,5 in `effectiveDPSPerArmor`, `gateDpsPerArmor` und
`killThroughput`, je Rüstung mit seiner besten Munition. Seine Kills sind
gewöhnliche Kills, keine Lecks. Bots heuern ihn nie an, das Backend-Gate sieht
also keinen. Details in [HERO.md](HERO.md#fairness-gate).

**State ist per Run.** `reset()` gehört an den Spielstart und wird von
`WaveDirectorService.resetForNewGame()` aufgerufen (Aufrufer:
`GameLoopFacadeService.restartGame()`). Ließ man den Multiplikator über Runs hinweg
stehen, wurde er zur Ratsche: er stieg bei jeder geräumten Welle und fiel nur bei
einem Tod. Die mediane Runlänge lag dann bei 6 Waves gegen ein Ziel von 80, und
frische Runs starteten gegen Wellen, die für eine längst abgebaute Verteidigung
dimensioniert waren.

**Verdrahtung:** Der Controller hängt an `AIDataCollectorService.onWaveResult()`,
nicht am `wave:completed`-Event: dieses Event wird beim Fall der Basis nicht
emittiert, der Todes-Rückfall wäre also unerreichbar gewesen. Beim ersten Schreiben
fehlte die Verdrahtung komplett (`onWaveCompleted` hatte keinen Aufrufer), und
sämtliche Unit-Tests waren trotzdem grün, weil sie den Controller isoliert
prüften. `gate-wiring.spec.ts` existiert genau dagegen. `onWaveResult` hängt
an `addToHistory()`, dem einzigen Punkt, den das normale Wellenende und der
Game-Over-Pfad beide passieren.

---

## 6. Gemeinsamer Pfad: fünf Zahlen → Welle

`buildWaveConfig()` in `wave-config-builder.ts`. Reihenfolge ist relevant:

1. **Template-Lookup.** Ungültiger Index → Fehlerlog und Slot 0, keine Exception.
   Werfen würde bis zur Facade propagieren, dort den Director abschalten und auf
   manuelle Wellen fallen; eine degradierte AI-Welle ist besser als keine.
2. **Ranges interpolieren** (`lerpRange`): `spawnDelay`, `hpMult`, `variation`.
3. **DPS-Ramp** auf die Schwierigkeitsachsen `count` und `hpMult`: Der obere
   Endpunkt wird mit `min(1, totalDPS / DPS_RAMP_*)` skaliert, Floor
   `DPS_RAMP_FLOOR = 0.10` (`DPS_RAMP_COUNT = 500`, `DPS_RAMP_HP_MULT = 1000`). Schwache Verteidigung →
   schmaler Effektivbereich.
4. **Endgame-Multiplikator**: `hpMult *= endgameHpMultiplier(wave)`,
   W1–20 ×1.0, danach +5 %/Wave, Cap ×4.0 ab W80. Compoundet auf den Faktor des
   Directors.
5. **Fairness-Cap** (`fairMaxCount`, mit `gate.budgetMultiplier`). Das Gate
   **interpoliert, statt zu clampen**: Der Cap wird in die `count`-Range
   hineingefaltet, sodass der Faktor „wie weit in das aktuell Erlaubte" bedeutet.
   Nachträgliches Clampen bildete jeden Faktor oberhalb des Caps auf dieselbe
   Welle ab: eine flache Region, in der keine Präferenz ausdrückbar ist, und im
   Training eine gewählte Aktion, die von der ausgeführten abweicht. Liegt der Cap
   *unter* `countRange[0]`, gewinnt der Cap: Die Range kollabiert darauf, statt das
   Template-Minimum trotzdem auszuliefern. Ein Gegner, der sich beim Tod teilt
   (Skeleton), zählt mit seinen Kindern: mit der HP der ganzen Linie
   (`lineageHp`, 20 + 2 × 6), einem Kill pro Körper (`splitBodyCount`, 3) und
   bis zu einem Leck pro Kind (`splitLeafCount`, 2): Stirbt ein Skeleton kurz
   vor dem HQ, laufen beide Minions durch und kosten je den vollen Leck-Schaden.
6. **Wave-Duration-Cap.** `count × spawnDelay > 180_000 ms` → `spawnDelay` wird
   komprimiert (`MIN_SPAWN_DELAY_MS = 5`). Danach **zweiter Pass** über den
   Fairness-Cap: Eine langsame Mega-Welle passiert das Gate gerade *weil* ihr
   langes Spawn-Fenster der Verteidigung Zeit gibt; die Kompression vervielfacht
   danach die Spawn-Rate. Ohne den zweiten Pass wird das Gate genau von den
   Wellen umgangen, gegen die es existiert. Das Backend hat das immer getan, das
   Frontend nicht.
7. **Template → Enemy-Gruppen** über die Shares, Rest auf die letzte Gruppe.

### Fairness-Cap im Einzelnen

`fairMaxCount()` (`templates.ts`, Spiegel `schema.fair_max_count`) schätzt, wie
viele Gegner die Verteidigung tötet, solange die Welle spawnt und die Gegner im
Feuer stehen, und gibt eine Leck-Toleranz obendrauf:

- **Kills pro Sekunde:** das Knappere aus DPS gegen die Gegner-HP (je Rüstung,
  Boden und Luft getrennt, aus `gateDpsPerArmor`) und dem Kill-Durchsatz der
  Tower (`killThroughput`, ein Ziel pro Schuss). Ein Gegner, der sich teilt,
  zählt mit seiner ganzen Linie.
- **Zeit im Feuer:** die Spawn-Dauer plus `FAIRNESS_ENGAGEMENT_REACH_M = 60` m
  geteilt durch das Tempo der Gegner, geklemmt auf 2 bis 40 s.
- **Abschlag:** `FAIRNESS_KILL_REALISM = 0.65`, mal `budgetMultiplier` vom
  Gate-Controller (Abschnitt 5).
- **Leck-Toleranz in HP:** `FAIRNESS_WAVE_HP_BUDGET = 0.06` der Rest-HP,
  mindestens `FAIRNESS_MIN_LEAK_HP = 1`, geteilt durch den Leck-Schaden der
  Welle (`enemyBaseDamageForWave`) und durch die Lecks, die ein Gegner
  höchstens kostet (`splitLeafCount`).
- **Untergrenze** `FAIRNESS_MIN_COUNT = 5`. Hat die Verteidigung gegen die
  Welle gar keinen wirksamen Schaden (eine gepinnte Luftwelle gegen eine reine
  Bodenabwehr), liefert der Cap genau diese 5.

**Matchup-Floor (seit 2026-09).** Der Cap liest `gateDpsPerArmor` aus der
Defense-Analyse, nicht die rohe Matrix: gegen Boden-Gegner mit unarmored,
light, heavy und fortified zählt jeder Tower mindestens
`FAIRNESS_MATCHUP_FLOOR = 0.6` seiner DPS. Ohne Floor machte eine schlechte
Paarung die Welle nur kleiner (Gatlings gegen Panzer bekamen weniger Panzer),
und die breitere Schadensmatrix wäre im Gate verschwunden. Mit Floor spürt der
Spieler ein falsches Roster als Leck, begrenzt durch `maxLeakDamagePerWave`
(18 HP). Ethereal und Luft bleiben auf der reinen Matrix, dort greifen die
Capability-Gates.

### Maske und Curriculum

`getAvailableTemplateMask()` in `templates.ts` (Spiegel:
`schema.get_available_template_mask`):

- **W1–30** (`forcedThroughWave: 30`): Die Maske kollabiert auf genau das
  Curriculum-Template aus `src/app/configs/wave-curriculum.config.ts`. Das hält
  das Training ehrlich: gesampelte Aktion == ausgelieferte Welle. Die
  Vorgänger-Version maskierte frei und überschrieb die Wahl danach im Decoder,
  trainierte den Template-Head also auf Entscheidungen, die nie stattfanden.
  Der Pin umgeht die Capability-Gates bewusst: eine gepinnte Luftwelle kommt
  auch gegen eine Abwehr ohne Luftziel, der Fairness-Cap hält sie überlebbar.
- **Ab W31**: `minWave`, Capability-Gates (`antiAir`, `antiEthereal`),
  Reuse-Cooldown (`TEMPLATE_COOLDOWN_WAVES = 2`) und Boss-Kadenz
  (`isBossWave()` in `wave-curriculum.config.ts`: bis W30 jede zehnte Welle,
  dort gepinnt, danach jede fünfte). An Boss-Wellen kollabiert die Maske auf
  die Boss-Templates, die die Gates bestehen (`boss_herbert`, `boss_golem`,
  `boss_dragon`; die Älteste-zuerst-Regel rotiert sie), an allen anderen sind
  sie gesperrt. Vorher waren Bosse an Vielfachen von 10 nur erlaubt: über
  2.000 simulierte Läufe kamen zwischen W31 und W130 0,7 statt 10
  Boss-Wellen. Einen Teil der Boss-Wellen ersetzt die Facade danach durch eine
  Boss-Variante (Skarnax, Ooze), siehe
  [WAVE_SYSTEM.md](WAVE_SYSTEM.md#boss-waves). Boss-Wellen nach W30 zahlen das
  doppelte Gold-Budget (`BOSS_GOLD_MULTIPLIER` in `goldBudgetForWave`).
- **Fallbacks** in dieser Reihenfolge, damit die Maske nie leer ist (der
  maskierte Softmax liefe sonst auf NaN): an einer Boss-Welle, deren
  Boss-Templates alle im Cooldown stehen, das erste davon trotz Cooldown; an
  einer Boss-Welle, die kein Boss-Template bedienen kann (`minWave`,
  Capability), eine normale Welle; danach das erste zulässige Template trotz
  Cooldown; zuletzt Slot 0. Der Leerfall im `RuleDirector` (Abschnitt 4) ist
  deshalb rein defensiv.

`describeTemplateMask()` liefert Maske und Begründung (für „Why this wave"),
`getAvailableTemplateMask()` ist der Wrapper ohne Begründung.

22 aktive Templates in 32 permanenten Output-Slots (`MAX_TEMPLATE_SLOTS = 32`).

### Erklärung im Wave-Debug-Fenster

Jede Director-Welle trägt ihre Begründung in `WaveConfig.explanation`; die
Facade legt sie nach `GameStore.aiExplanation`, das Wave-Debug-Fenster zeigt sie
als „Why this wave". Custom-Wellen, das statische Curriculum und Wellen des
Trainings-Backends setzen `null`.

Die Gründe stammen aus der Entscheidung selbst, nicht aus einer Analyse des
Spielzustands:

| Quelle | Liefert |
|--------|---------|
| `describeTemplateMask` (`templates.ts`) | Curriculum-Pin, Boss-Regel, Templates, die eine fehlende Fähigkeit sperrt (Anti-Air, Anti-Ethereal), Cooldown-Verzicht |
| `DirectorDecision.why` (`rule-director.ts`, ONNX-Decoder) | Anzahl erlaubter Templates, wann das gewählte zuletzt lief, Gleichstand, Rampen-Position bzw. ONNX-Wahrscheinlichkeit |
| `GateController.status` | Leck-Mittel über das Fenster, letzter Schritt des Reglers, Multiplikator |
| `buildWaveConfig` | DPS-Ramp, Fairness-Cap (bindet / kollabiert / bindet nicht), Duration-Cap, Endgame-HP |

`decision-explainer.ts` formt daraus nur Sätze. Der Leck-Regler wird nur genannt,
wenn der Fairness-Cap die Welle tatsächlich begrenzt hat. Die frühere Fassung
las den Defense-Snapshot und behauptete Absichten wie „keine Anti-Air, also
Flieger" oder „Mercy-Welle"; beides tut der Regel-Director nicht.

---

## 7. Was vom RL-Aufbau bleibt

Nichts davon ist tot, das meiste ist weiterhin der gemeinsame Unterbau:

| Teil | Status |
|------|--------|
| Templates, Ranges, Maske, Curriculum | **Produktiv.** Der Regel-Director benutzt exakt sie. |
| `fairMaxCount`, DPS-Ramp, Duration-Cap | **Produktiv.** Unverändert geteilt. |
| State-Encoder (208 Features) | Nur für Training/ONNX-Pfad relevant. Der Regel-Director liest ihn nicht. |
| ONNX-Inferenz (`decodeModelOutput`) | **Opt-in** über das Debug-Fenster, angeboten nur für ein Modell mit passender Eingangsbreite. |
| Python-Backend (PPO, Reward, Dashboard) | Nur für Trainingsläufe. Für das Spiel irrelevant. |
| `directors.py` | Das Messinstrument. Ohne A/B-Baseline ist jede Aussage über „das Modell ist besser" unbelegt. |

**Eingänge des Opt-in-Modells.** Das ausgelieferte Modell (Checkpoint 7350,
trainiert ab 2026-04-17, exportiert 2026-04-21 laut `exportedAt` in
`metadata.json`, eingecheckt 2026-04-27 in `e8ae88a9`) kennt einen
Forschungsbaum mit elf Knoten; heute hat der Baum zwanzig. Zwei Eingänge haben
sich seither verschoben:

- **Research-Quote** (`completedCount / totalCount`): zählt seit 2026-09-14 nur
  die elf Knoten, die das Modell kennt (`ENCODER_RESEARCH_IDS` in
  `state-snapshot-parts.ts`); `completedIds` bleibt vollständig. Vorher stand
  der ganze Baum im Nenner: jeder neue Knoten (Storm Mastery, T4/T5, Chaos
  Rift, die vier Fähigkeiten, der Söldnervertrag) drückte die Quote bei
  gleichem Fortschritt, und weil Bots den Söldnervertrag überspringen
  (`BOT_SKIPPED_RESEARCH`), erreichten sie 1 nicht mehr. TS-Encoder und
  `server.py` lesen dieselben Snapshot-Felder, Schema und Dimensionen sind
  unverändert; das Trainings-Dashboard zeigt „Completed x/11". Bei einem neuen
  Training die Liste bewusst erweitern.
- **Held in `effectiveDPSPerArmor`**: bleibt drin. Ein angeheuerter Held bringt
  auf Stufe 1 je Rüstung 24 bis 48 effektive DPS (48 DPS × Matrix × Präsenz
  0,5), auf 500 normiert also 0,05 bis 0,1 je Eingang, am Boden und in der
  Luft. Im Training kam er nie vor, Bots heuern nicht an; neu ist vor allem,
  dass die Luft-Eingänge mit ihm auch dann über null liegen, wenn kein Tower
  Luftziele trifft. Er ist Verteidigung wie ein Tower, das Gate rechnet ihn
  genauso, und ihn nur für den Encoder herauszurechnen bräuchte ein zweites
  DPS-Feld im Snapshot und in beiden Encodern.

Der Regel-Director liest keinen der beiden Eingänge.

**Wofür der RL-Pfad noch da ist:** Ein Lauf gegen echte Spielerdaten statt gegen
einen Skript-Bot. Der Bot spielt eine feste Strategie; das Netz hat dagegen
nichts gelernt, was gegen einen Menschen etwas bedeuten würde. Außerdem gilt: Der
Entscheidungsraum (Abschnitt 2) muss zuerst geöffnet werden, sonst wiederholt
sich das Ergebnis. Ein Training auf demselben Raum wäre verlorene Rechenzeit.

### Aktueller Backend-Stand (Kontext)

Das Backend wurde parallel repariert, Details in
[AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) und
[HANDOVER_TRAINING_REFRESH.md](archive/HANDOVER_TRAINING_REFRESH.md):

- Gate-Multiplikator wurde nie zwischen Episoden zurückgesetzt (Ratsche; mediane
  Runlänge 6 statt 80; behoben, danach 62).
- Regelsignal von Kill- auf Leak-Quote umgestellt, Proportionalregler statt
  fester Schrittweite. Beides ist in `gate-controller.ts` nachgebaut.
- Advantage-Clipping im Trainer.
- `directors.py` + `tests/test_directors.py`, `tests/test_gate_loop.py` neu.
- State-Vektor: 208 Features (168 skalar + 40 spatial, Schema v5), Output 36
  (32 Template-Logits + 4 Faktoren).
- Reward: 4 Terme `death`, `drama`, `pacing`, `swarm_size`.

---

## 8. Offen und nicht validiert

Ehrlichkeitsabschnitt. Nichts davon ist belegt:

- **`NEAR_MISS_TARGET = 0.20` ist als Designziel nie validiert.** Der Wert ist
  aus der Verteilung *erreichter* Werte abgeleitet (p90 über 4002 gemessene
  Waves). Das belegt, dass er erreichbar ist, nicht dass er sich für einen
  Menschen spannend anfühlt. Zuletzt gemessen (Bot-Läufe nach der
  Platzierungsänderung, [BOT_SYSTEM.md](BOT_SYSTEM.md#das-ergebnis)): ~0.058.
- **Niemand hat den Regel-Director je selbst gespielt.** Er lief bisher
  ausschließlich gegen Bots. Alle Zahlen in diesem Dokument stammen aus
  Bot-Läufen.
- Die Rampe in Abschnitt 4 (`RAMP_FULL_WAVE = 60`, die vier Geradengleichungen)
  ist gesetzt, nicht optimiert. Sie ist bewusst leicht änderbar.
- Das Zielband des Gates (8–16 % Leak) ist eine Setzung aus demselben Anlass.

---

## 9. Dateien

### Frontend (`src/app/ai/`)

Dateien ohne Ordner liegen in `core/`.

| Datei | Funktion |
|-------|----------|
| `rule-director.ts` | Template + 4 Formfaktoren (der produktive Director) |
| `gate-controller.ts` | Leak-Regelkreis für den Fairness-Cap |
| `wave-director.service.ts` | Einstieg (`getNextWave`), `runRules`, Modell-Opt-in (`checkModel`, `loadModel`), Template-Cooldown |
| `wave-config-builder.ts` | `buildWaveConfig`: Entscheidung → Welle (für beide Directors gleich) |
| `onnx-policy.ts` | ONNX-Runtime + Session (`OnnxPolicy`), Passung aus `metadata.json` (`checkModelFit`), `decodeModelOutput` |
| `templates.ts` | 22 Templates, Maske, `fairMaxCount`, `lerpRange` (SSOT) |
| `wave-context.ts` | Maske + Ranges + Fairness-Headroom, einmal pro Entscheidung |
| `wave-config-adapter.ts` | `WaveConfig` → Spielformat |
| `ai-schema.ts` | Vokabulare + abgeleitete Blockgrößen (SSOT für den State) |
| `game-state-encoder.ts` | State-Encoding (nur Training/ONNX) |
| `ai-data-collector.service.ts` | State-Snapshot, DPS-Cache, `onWaveResult` |
| `wave-outcome-tracker.ts` | Laufende Welle → `WaveOutcome` (Kills, Leaks, HP-Verlust, Lebensdauer, Progress) |
| `wave-history.ts` | Letzte 10 Wellen + Reihen für `recentHistory` |
| `dps-profile.ts` / `dps-profile-visualizer.ts` | 20-Bin-DPS-Profil entlang des Pfads + 3D-Visualisierung |
| `defense-analyzer.ts` | Defense-Metriken |
| `decision-explainer.ts` | „Why this wave" im Wave-Debug-Fenster (siehe Abschnitt 6) |
| `spawn-schedule-builder.ts` | Pattern-basierter Spawn-Plan |
| `tower-dps.util.ts` | DPS pro Tower-Typ |
| `models/` | `game-state-snapshot.ts`, `wave-config.ts`, `wave-result.ts` |
| `training/training-client.service.ts` | Einstieg ins Training: Signale, lädt die Session erst bei Bedarf |
| `training/training-session.ts` | WebSocket-Client + Bot-Ausführung, eigener Lazy-Chunk (nur Trainingsbetrieb) |
| `training/bots/`, `training/strategies/` | Bot-System, siehe [BOT_SYSTEM.md](BOT_SYSTEM.md) |

Das Curriculum liegt **nicht** unter `ai/core/`, sondern in
`src/app/configs/wave-curriculum.config.ts` (Sequenz, Gold-Budget,
`endgameHpMultiplier`, `enemyBaseDamageForWave`, `STATIC_WAVE_PROFILES`).

Tests: `gate-controller.spec.ts`, `gate-wiring.spec.ts`, `rule-director.spec.ts`,
`templates.spec.ts`, `game-state-encoder.spec.ts`, `decision-explainer.spec.ts`.

### Backend (`training-backend/`)

| Datei | Funktion |
|-------|----------|
| `server.py` | WebSocket-Server (:3001), State-Encoder, `_decode_action`, A/B-Verteilung |
| `directors.py` | `model` / `rules` / `random` / `maxgate` als austauschbare Strategien |
| `core/model.py` | Conv1D + Dense, 208 → 36 |
| `core/trainer.py` | PPO |
| `core/reward.py` | 4 Terme (death, drama, pacing, swarm_size) |
| `config.py` | Hyperparameter, `DIRECTOR_ROSTER`, Reward-Schwellen |
| `schema.py` | Lädt `generated/ai-schema.json` (aus den TS-Configs generiert) |
| `dashboard/` | FastAPI (:3002) + Chart.js |
| `scripts/export_to_tfjs.py` | ONNX-Export (`npm run export-ai`) |
| `tests/` | `test_schema.py`, `test_encoder.py`, `test_reward_v2.py`, `test_directors.py`, `test_gate_loop.py`, `test_training_log.py` |

---

## 10. Trainings-Workflow

Nur relevant, wenn tatsächlich trainiert oder ein A/B gefahren wird; für das
Spiel wird nichts davon gebraucht.

1. `cd training-backend && python manage_server.py start` (oder `start.bat`)
2. `npm start`
3. Mehrere Browser-Tabs öffnen. Bei aktivem `DIRECTOR_ROSTER` bekommt jeder Tab
   per Round-Robin einen anderen Director. Für einen reinen Policy-Lauf
   `DIRECTOR_ROSTER = ["model"]` setzen.
4. `curl -X POST http://localhost:3002/api/control/start`
5. Dashboard: `http://localhost:3002`
6. Checkpoints in `training-backend/checkpoints/`
7. ONNX-Export: `npm run export-ai`. Nennt die neue `metadata.json` 208
   Eingänge, zeigt das Debug-Fenster beim nächsten Öffnen den Opt-in-Knopf.

Hintergrundtabs frieren ein: Chrome killt `requestAnimationFrame` in nicht
sichtbaren Tabs, die Läufe stehen dann still und melden trotzdem „gesund".

---

## 11. Verwandte Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [WAVE_SYSTEM.md](WAVE_SYSTEM.md) | WaveManager, Spawn-Pipeline, Boss-Varianten, Blutmond, Jump to Wave |
| [BOT_SYSTEM.md](BOT_SYSTEM.md) | Strategy-Pattern-Bots, die als Gegenspieler im Training laufen |
| [HANDOVER_RULE_DIRECTOR.md](archive/HANDOVER_RULE_DIRECTOR.md) | _Bericht 2026-09-07:_ die Messreihe hinter dem Wechsel auf Regeln, Einstieg für ein späteres Training |
| [HANDOVER_TRAINING_REFRESH.md](archive/HANDOVER_TRAINING_REFRESH.md) | _Bericht, abgeschlossen 2026-09-07:_ Refresh des Trainings-Backends, Befunde und Grundsatzentscheidungen |
| [PHASE_5.11_RANGES.md](archive/PHASE_5.11_RANGES.md) | _Historisch:_ Range-Templates, Decoder, Reward-Tuning; die Mechanik unterhalb der Entscheidung gilt weiter |
| [HANDOVER_PLAYTEST_PHASE5.16.md](archive/HANDOVER_PLAYTEST_PHASE5.16.md) | _Historisch:_ Balance-Pass Mai 2026 (Curriculum, Endgame-Knobs, Gold-Budget); die Gold-Zahlen dort sind überholt |
| [STATIC_WAVE_FALLBACK.md](STATIC_WAVE_FALLBACK.md) | Debug-Pfad ohne Director: `STATIC_WAVE_PROFILES` |
| [AI_TRAINING_BACKEND.md](../training-backend/docs/AI_TRAINING_BACKEND.md) | Backend-Details |
| [AI_TRAINING_SESSION_NOTES.md](../training-backend/docs/AI_TRAINING_SESSION_NOTES.md) | Entwicklungsgeschichte |
| [AI_MODEL_EXPORT.md](../training-backend/docs/AI_MODEL_EXPORT.md) | ONNX-Export |
| [PHASE_5.10_TEMPLATES.md](archive/PHASE_5.10_TEMPLATES.md) | _Historisch:_ Übergang von 16-Softmax zu Templates |
