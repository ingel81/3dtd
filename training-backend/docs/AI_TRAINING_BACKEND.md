# AI Training Backend

**Stand:** 2026-09-07 — Schema v3 (203 Features), Reward v4, A/B-Director-Roster.

> **Das Backend ist ein Messinstrument, keine Produktionsabhängigkeit.**
> Seit `3875d61` entscheidet im Spiel ein Regel-Director im Client
> (`src/app/ai/core/rule-director.ts`). Das Spiel braucht im Betrieb **keinen**
> Python-Server, **kein** Modell und **keine** ONNX-Runtime. Dieses Backend
> existiert, um Wave-Designs gegen Bots über hunderte Runs zu vergleichen — das
> ist die einzige Umgebung im Projekt, in der das geht.
>
> Warum der Wechsel stattfand: [../../docs/HANDOVER_RULE_DIRECTOR.md](../../docs/HANDOVER_RULE_DIRECTOR.md).

## Überblick

Python-basiertes Trainings- und Messsystem für den Wave Director. Besteht aus
WebSocket-Server (Port 3001), PPO-Trainer und Web-Dashboard (Port 3002) für
Live-Monitoring.

**Stack:**
- Python 3.8+ / PyTorch 2.0+
- WebSocket-Server (`websockets`)
- FastAPI + Chart.js Dashboard
- ONNX (Browser-Export, Opt-in im Spiel)

**Location:** `training-backend/`

---

## Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRAINING BACKEND (Python)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   server.py  │───▶│   model.py   │───▶│  trainer.py  │       │
│  │  (WebSocket) │    │ (Template+4P)│    │    (PPO)     │       │
│  └──────┬───────┘    └──────────────┘    └──────────────┘       │
│         │                    ▲                                   │
│         │            ┌───────┴──────┐                            │
│         ├───────────▶│ directors.py │  A/B: model | rules |      │
│         │            │  (Roster)    │       random | maxgate     │
│         │            └──────────────┘                            │
│         │                                                        │
│         │            ┌──────────────┐  ┌──────────────┐         │
│         ├───────────▶│  schema.py   │  │  reward.py   │         │
│         │            │ (32 Slots,   │  │  (4 Terme)   │         │
│         │            │  Curriculum) │  └──────────────┘         │
│         │            └──────┬───────┘                            │
│         │                   │ liest                              │
│         │            ┌──────▼────────────────┐                   │
│         └───────────▶│ generated/            │                   │
│                      │   ai-schema.json      │                   │
│                      │ (npm run ai-schema)   │                   │
│                      └───────────────────────┘                   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  dashboard/                                               │   │
│  │  ├── app.py     (FastAPI, WebSocket-Broadcast)            │   │
│  │  └── static/    (Chart.js, Live-UI)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└────────────────────────────────────┬────────────────────────────┘
        WebSocket :3001              │  HTTP :3002
              │                      │
              ▼                      ▼
┌─────────────────────────┐  ┌────────────────────┐
│  BROWSER (Angular)      │  │  WEB DASHBOARD     │
│  Spiel + Strategy-Bot   │  │  (localhost:3002)  │
│  + Training-Client      │  │  Charts, Metriken  │
└─────────────────────────┘  └────────────────────┘
```

Im **Spielbetrieb** existiert dieser Kasten nicht: der Client entscheidet selbst
(`rule-director.ts` + `gate-controller.ts`) und redet mit niemandem.

---

## Datei-Struktur

```
training-backend/
├── server.py              # WebSocket-Server, State-Encoder, Action-Decoder,
│                          #   Fairness-Gate-Regelkreis (steer_gate)
├── directors.py           # A/B-Roster: model / rules / random / maxgate
├── model.py               # Conv1D + Dense — Template-Head + 4 Continuous-Params
├── schema.py              # Lädt generated/ai-schema.json (Templates, Curriculum,
│                          #   Enemy-Tabellen, Feature-Layout) — aus den TS-Configs
├── generated/             # ai-schema.json, erzeugt von `npm run ai-schema`
├── trainer.py             # PPO mit Mask-Aware-Reevaluation, GAE, Advantage-Clip
├── reward.py              # 4-Term-Reward v4 (DEATH, DRAMA, PACING, SWARM_SIZE)
├── config.py              # Trainings-Entscheidungen: Hyperparameter, Reward-
│                          #   Shaping, Gate-Regelparameter, Director-Roster
│
├── tui_logger.py          # Console-Logger + JSONL-File-Logging
├── auto_logger.py         # Logger-Shim
│
├── inspect_training.py    # Interaktives Checkpoint-Inspect-Tool
├── manage_server.py       # Start/Stop-Helper
│
├── dashboard/
│   ├── app.py             # FastAPI-Dashboard-Server
│   └── static/            # index.html, app.js (Chart.js), style.css
│
├── scripts/
│   ├── export_to_tfjs.py  # ONNX-Export (Browser-Inferenz, Opt-in)
│   └── analyze_log.py     # Post-hoc JSONL-Analyse
│
├── tests/                 # pytest-Suite (96 Tests, Stand 2026-09-07)
│   ├── test_gate_loop.py  #   Fairness-Gate-Regelkreis
│   ├── test_directors.py  #   Decoder-Contract aller Directors
│   ├── test_encoder.py    #   Feature-Layout gegen das Schema
│   ├── test_reward_v2.py  #   Reward-Terme
│   └── test_schema.py     #   Schema-Loader
├── requirements.txt
├── start.bat / start.sh
├── checkpoints/           # checkpoint_*.pt (alle 10 Episoden) + checkpoint_latest.pt
└── logs/                  # JSONL-Trainingslogs
```

**Zuständigkeitsschnitt:** `schema.py` trägt alles, was aus dem **Spiel** kommt
(Enemy-Tabellen, Templates, Curriculum, Feature-Layout, Decoder-Konstanten) und
wird von `npm run ai-schema` generiert — nie von Hand editieren. `config.py`
trägt alles, was eine **Trainings-Entscheidung** ist.

---

## Kern-Konzepte

### 1. State-Vektor (203 Features, Schema v3)

Alle Größen kommen aus `generated/ai-schema.json`; `INPUT_SIZE` ist nirgends
hartkodiert.

| Block | Größe | Inhalt |
|---|---|---|
| Base | 55 | Spieler, Tower-Counts, Damage-/Progress-History, Wave-Signale, Research |
| Awareness | 57 | Typ-/Armor-History, Tower-Level, Capabilities, Unlocks, Near-Miss-History |
| Effective DPS | 12 | effektive DPS pro Armor-Typ (Ground 5 + Air 5) + AoE-Anteil (2) |
| Wave-Context | 39 | Availability-Maske (32) + effektive Ranges (6) + Fairness-Headroom (1) |
| **Scalar gesamt** | **163** | |
| Spatial | 40 | Ground-DPS-Profil (20 Bins) + Air-DPS-Profil (20 Bins) |
| **INPUT_SIZE** | **203** | |

Der **Wave-Context-Block** ist die Neuerung von Schema v3 und der Grund für den
Versionssprung: Das Netz gab vorher `count_factor` aus, ohne zu wissen, auf
welches Template es angewendet wird — derselbe 0..1-Wert bedeutet 20–2000 Gegner
für `zombie_horde` und 5–100 für `mech_army`.

Layout: `server.py::_encode_state`. Frontend-Pendant:
`src/app/ai/core/game-state-encoder.ts`. Beide werden gegen dieselbe
Schema-Datei validiert; eine falsche Länge lässt den Encoder mit `ValueError`
fehlschlagen statt still zu kürzen.

> **Bekannte Abweichung:** Der Docstring von `_encode_state` beschreibt sich
> selbst noch als „schema v2 (162 features)" und listet den Wave-Context-Block
> nicht auf. Der Code darunter ist korrekt und produziert 203 Features.

### 2. Template-basierter Action-Space

Das Netz pickt aus 19 aktiven Templates + 4 Continuous-Params:

```
template_head:  Categorical(32)            # 32 Slots, 19 aktiv (Rest reserviert)
params_head:    sigmoid → [0,1] × 4        # count, spawn_delay, hp_mult, variation
log_std:        learnable, geklemmt        # Exploration-Noise, [-3.0, 0.0]
```

Jedes Template hat designer-gesetzte Ranges; der Decoder interpoliert:

```python
final_count = lerp(template.count_range, count_factor)
```

**Hard Constraints im Decoder** (`server.py::_decode_action`) bzw. in der Maske
(`schema.get_available_template_mask`):

- **Curriculum-Gate**: Waves 1–30 (`curriculum.forcedThroughWave = 30`) verengen
  die Maske auf genau ein Template — die gesampelte Aktion *ist* dann die
  ausgelieferte Wave, was die PPO-Credit-Zuweisung ehrlich hält.
- **Capability-Gate** (`requiresCapability`): „antiAir" / „antiEthereal" muss der
  Spieler tatsächlich haben (Frontend-Capabilities inkl. Line-of-Sight, mit
  Fallback auf Research-Flags).
- **Boss-only**: nur an `wave % 10 == 0`.
- **Cooldown**: `TEMPLATE_COOLDOWN_WAVES = 2`.
- **DPS-Scaled Range Caps**: bei niedriger Spieler-DPS wird das obere Ende von
  `count` und `hp_mult` zusammengezogen (`dpsRamp`: floor 0.1, count 500,
  hpMult 1000).
- **Wave-Duration-Cap**: `count × spawn_delay > 180 s` komprimiert `spawn_delay`
  auf `max(5 ms, cap/count)`.
- **Fairness-Gate**: siehe unten — der Deckel, der in der Praxis am häufigsten
  bindet.

### 3. Fairness-Gate (Regelkreis)

`schema.fair_max_count` schätzt, wie viele Gegner eine Verteidigung zerstören
kann, diskontiert mit `FAIRNESS_KILL_REALISM = 0.65`. Dieser Discount wurde auf
den Waves 1–10 gemessen und ist ab Wave 11 falsch — die Schätzung hat also einen
stehenden Bias und keine Möglichkeit, ihn zu bemerken. `server.py::steer_gate`
korrigiert ihn aus dem einzigen belastbaren Signal: was tatsächlich die Basis
erreicht hat.

```python
if len(ctx.leak_shares) < GATE_ADAPT_WINDOW:  return ctx.gate_multiplier
leaked = mean(ctx.leak_shares)
if not survived:
    mult *= GATE_MULT_DOWN                        # der Run endete → hart zurück
elif leaked < GATE_LEAK_TARGET_LO or leaked > GATE_LEAK_TARGET_HI:
    target = (LO + HI) / 2
    error  = (target - leaked) / target           # +1 = es leakt gar nichts
    mult  *= 1.0 + GATE_GAIN * clamp(error, -1, 1)
# innerhalb des Bandes: halten
```

| Parameter | Wert | Bedeutung |
|---|---|---|
| `GATE_ADAPT_WINDOW` | 4 | Wellen Leak-History, bevor überhaupt gesteuert wird |
| `GATE_LEAK_TARGET_LO/HI` | 0.08 / 0.16 | Zielband für den Anteil, der die Basis erreicht |
| `GATE_GAIN` | 0.35 | Proportionalverstärkung auf den relativen Leak-Fehler |
| `GATE_MULT_DOWN` | 0.80 | Rückzug nach einem Tod (bewusst härter als der Gain) |
| `GATE_MULT_MIN` / `MAX` | 0.5 / 8.0 | Grenzen |

**Zustand ist pro Run.** `server.py::_reset_context` setzt `gate_multiplier` und
`leak_shares` zurück. Ohne diesen Reset war der Multiplikator eine Ratsche pro
*Client*: Mittel 7,0, Max 40,0, Caps von 4761 Gegnern, mediane Runlänge 6 Waves
gegen ein Ziel von 80. Nach dem Fix: 62.

Das Frontend spiegelt diesen Regelkreis in `src/app/ai/core/gate-controller.ts`
mit denselben Konstanten.

> `GATE_SATURATED_SHARE = 0.98` in `config.py` ist ein Rest aus der
> Kill-Quoten-Steuerung und wird von keinem Modul mehr gelesen.

### 4. DPS-Profil (räumliche Verteidigung)

Pfad in **20 Bins**, Ground und Air getrennt:

```
Bin:     [0] [1] [2] [3] [4] [5] ... [19]
Ground:   0   0  0.3 0.8 1.0 1.0 ...   0
Air:      0   0   0  0.2 0.4 0.4 ...   0
```

Frontend: `src/app/ai/core/dps-profile.ts`. Backend: Conv1D-Branch verarbeitet
das Profil räumlich (2 Channels × 20 Bins).

### 5. HP-Multiplier statt absoluter HP

Das Netz wählt `hp_mult` (interpoliert aus `template.hpMultRange`). Finale
Gegner-HP = `enemy_base_hp × hp_mult × endgame_hp_multiplier(wave)`. Die
Base-HP-Tabelle stammt aus dem Schema; die Endgame-Rampe spiegelt
`wave-curriculum.config.ts`.

---

## A/B-Director-Roster

`config.DIRECTOR_ROSTER` bestimmt, welcher Wave-Designer welchen Client fährt.
Clients werden beim Verbinden reihum zugewiesen, laufen also **gleichzeitig
gegen dieselben Bots, dasselbe Curriculum und denselben Gate**.

```python
DIRECTOR_ROSTER = ["model", "rules", "random", "maxgate"]   # ["model"] = Einzelbetrieb
```

| Director | Verhalten | Zweck |
|---|---|---|
| `model` | die Policy | Status quo |
| `random` | uniform über die erlaubten Templates, uniforme Faktoren | der ehrliche Boden. Wer das nicht schlägt, verdient seinen Unterhalt nicht |
| `rules` | ältestes erlaubtes Template, Faktoren aus fester Rampe | Referenz für den Client-Regel-Director |
| `maxgate` | zufälliges Template, immer so groß wie der Gate erlaubt | isoliert, wie viel Schwierigkeit allein aus der Größe kommt |

`random` ist kein schwacher Gegner: die Maske trägt Curriculum, Capability-Gates
und Boss-Kadenz, und der Gate deckelt danach die Größe. Es ist „keine
Intelligenz obendrauf".

**Nicht-lernende Directors speisen PPO nicht.** `server.py::_process_result`
prüft `director.is_learner`; ihre Wellen kamen nie aus der Policy-Verteilung,
eine Paarung mit dem PPO-Ratio wären Off-Policy-Daten mit On-Policy-Etikett.
Ihre Ergebnisse gehen in die Eval-Metriken.

Der Director steht in den JSONL-Logs an `wave_result` und `episode_end`
(Feld `director`). `scripts/analyze_log.py` gruppiert nicht danach — die
Auswertung ist selbst zu schreiben.

**Ergebnis der bisher einzigen vollständigen Messreihe:** `model` war dreimal
statistisch nicht von `random` zu unterscheiden (mittlere Runlänge 45,6 [42,49]
gegen 44,7 [41,48]), `rules` und `maxgate` erzeugten mehr Spannung (near-miss
0,067–0,069 gegen 0,045). Details und Konsequenzen:
[HANDOVER_RULE_DIRECTOR.md](../../docs/HANDOVER_RULE_DIRECTOR.md).

---

## Modell-Architektur

**Typ:** Actor-Critic-PPO mit hybridem Action-Space. Alle Breiten leiten sich aus
dem Schema ab.

```
Input: 203 Features
├── Scalar Branch [0..162]: NUM_SCALAR = 163
│   → Linear(163, 128) + LayerNorm + ReLU → 128 Features
│
├── Spatial Branch [163..202]: 40 Features = 2 Channels × 20 Bins
│   → Conv1d(2→16, k=3, padding=1) + ReLU
│   → Conv1d(16→32, k=3, padding=1) + ReLU
│   → AdaptiveAvgPool1d(1) → 32 Features
│
├── Combined: concat(128, 32) = 160
│   → Linear(160, 192) + LayerNorm + ReLU
│   → Linear(192, 96)  + LayerNorm + ReLU
│
└── Output Heads (alle aus 96 Features):
    ├── Template Head: Linear(96, 32)  → Categorical
    ├── Params Head:   Linear(96, 4)   → 4 sigmoid-Faktoren
    ├── log_std:       Parameter(4)    → Exploration-Noise, geklemmt [-3.0, 0.0]
    └── Value Head:    Linear(96, 1)   → State-Value
```

**Kein Dropout im Torso.** Aktionen werden unter `model.eval()` gesampelt, das
PPO-Update läuft unter `model.train()` — Dropout ließ das Ratio π_neu/π_alt ein
ausgedünntes Netz gegen ein volles vergleichen. Der gemessene approx-KL von
0,14–0,24 gegen ein Ziel von 0,02 war größtenteils Sampling-Rauschen und
reagierte weder auf eine dreifach kleinere Lernrate noch auf eine verdoppelte
Minibatch. Die LayerNorms regularisieren ausreichend.

**`log_std` ist geklemmt statt entropie-belohnt.** Die alte Obergrenze 2 (std
≈ 7,4) zusammen mit einem Entropie-Bonus auf der *Prä-Sigmoid*-Gaußverteilung
war ein stehender Anreiz, die Verteilung zu verbreitern — und eine breite
Gaußverteilung durch ein Sigmoid häuft ihre Masse an den **Rändern** des
Bereichs. Das ist Anti-Exploration im Faktorraum: Wellen kollabieren auf
min/max count und min/max HP. Der Entropie-Bonus läuft heute nur noch auf dem
Template-Head.

ONNX-Export-Format: `concat(template_logits, raw_params)` → **36 Werte** pro
Sample (`OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS = 32 + 4`).

---

## Reward-Funktion (v4, 4 Terme)

`reward.py::calculate_reward` summiert **DEATH + DRAMA + PACING + SWARM_SIZE**.

> Der Kopfkommentar von `config.py` listet die Terme noch als
> „DEATH, DRAMA, SWARM_SIZE, PROGRESSION" — `PROGRESSION` existiert nicht mehr,
> der dritte Term heißt `PACING`.

> **v3 wurde ersetzt, weil sie nicht erfüllbar war.** v3 verlangte 1–5 % HP-Verlust
> *pro Wave* und gatete drei ihrer vier Terme auf dieses Band. Der Leak-Schaden
> ist `1 + floor((w-1)/10)` HP bei 100 max HP, also quantisiert: ab Wave 51 sind
> 0 Leaks = 0 % und 1 Leak = 6 %, dazwischen existiert nichts. Die drei gegateten
> Terme lieferten ab W51 strukturell 0. Dazu heilt der Spieler nie und das Spiel
> hat kein Sieg-Ziel — 100 HP sind das Budget des gesamten Runs, 1–5 % pro Wave
> sind also der Tod, den der DEATH-Term mit −15…−30 bestrafte. Gemessenes
> Ergebnis nach ~9.900 Episoden: die AI schickte nichts mehr (avgProgress 0,06–0,27
> gegen Zielband 0,65–0,90; ein Client mit 133 Waves ohne einen HP-Verlust).

v4 trennt die zwei Fragen, die v3 vermischt hatte:

* **DRAMA** — „war diese Wave spannend?" — pro Wave, auf `near_miss_ratio`.
* **PACING** — „hat der Run die richtige Länge?" — über den ganzen Run, auf der HP-Kurve.

### Term 1: DEATH (`_death_penalty`)

Relativ zur Ziel-Rundenlänge, nicht absolut. Der Run *soll* enden — ein endloses
Spiel ohne Heilung hat genau einen Ausgang. Planmäßig zu enden ist gratis:

```python
shortfall = max(0.0, (TARGET_RUN_WAVES - wave_num) / TARGET_RUN_WAVES)
penalty   = REWARD_DEATH_MAX * shortfall ** 2       # -8.0 bei W0, 0 ab W80
if damage_pct > OVERKILL_DAMAGE_FRACTION:           # 0.15
    penalty += REWARD_OVERKILL                      # -1.5
```

Die Größenordnung ist zweiseitig eingeklemmt:

- **Von unten** durch den Exploit, den sie ausschließen soll: ein Tod muss die
  guten Wellen überwiegen, die ihn vorbereitet haben, sonst gewinnt
  „ausbluten lassen und dann kassieren" wieder (unter v3 real, mit einem Cap
  von −3,5).
- **Von oben** durch den Reward-Skalierer. Rewards werden über eine gefensterte
  Standardabweichung normalisiert; Tode sind selten und riesig, setzen also
  diese Standardabweichung und dividieren alles andere zu Rauschen. Bei −40
  gemessen: kombinierte std 9,13, davon 9,12 aus dem DEATH-Term — ein voller
  Drama-Ausschlag von 1,30 kam skaliert bei 0,142 an, ein Tod bei −3,58. Bei
  25:1 lernt der Agent nicht, gute Wellen zu bauen, sondern Tode zu vermeiden.
- Bei −15 kollabierte Drama über 56 Updates monoton auf 0
  (0,104 → 0,082 → 0,058 → 0,042 → 0,017 → 0,000). **−8** ist das Ergebnis.

### Term 2: DRAMA (`_drama_reward`)

`near_miss_ratio` = Anteil der Gegner, die über 80 % des Pfades kamen **ohne**
anzukommen. Drei Gründe für diese Größe: sie beschreibt den *oberen Rand* der
Verteilung statt des Mittelwerts, ihre Schrittweite ist 1/count statt 6 % pro
Leak, und sie ist das, was ein Spieler als knappe Sache wahrnimmt. Ankünfte
auszuschließen ist entscheidend — sonst punktet ein Durchbruch identisch mit
einer knappen Sache.

```python
if nmr <= NEAR_MISS_TARGET:  shape = nmr / NEAR_MISS_TARGET      # linear hinauf
else:                        shape = bell(nmr, TARGET, SIGMA)    # Gauß hinunter
score = REWARD_DRAMA_PEAK * shape + REWARD_DRAMA_IDLE * (1 - shape)

if score > 0:                                     # Strafen NIE dämpfen
    if total_count < DRAMA_MIN_COUNT:   score  = 0.0
    elif total_count < DRAMA_FULL_COUNT: score *= (count - MIN) / (FULL - MIN)

return score + REWARD_LEAK_SLOPE * leak_ratio + REWARD_P90_PROGRESS_WEIGHT * p90
```

| Konstante | Wert | Begründung |
|---|---|---|
| `NEAR_MISS_TARGET` | 0.20 | 90. Perzentil einer Messung über 4002 Wellen. **Nie gegen echtes Spielempfinden validiert** — siehe Handover, Abschnitt 4 |
| `NEAR_MISS_SIGMA` | 0.18 | |
| `REWARD_DRAMA_PEAK` | 1.00 | Wert exakt im Ziel |
| `REWARD_DRAMA_IDLE` | −0.30 | Wert weit weg vom Ziel |
| `DRAMA_MIN_COUNT` | 10 | darunter kein positives Drama (schließt „1 Durchkommer von 4") |
| `DRAMA_FULL_COUNT` | 20 | ab hier voller Kredit |
| `REWARD_LEAK_SLOPE` | −0.8 | Durchbrüche dürfen nicht als Drama lesen |
| `REWARD_P90_PROGRESS_WEIGHT` | 0.12 | dichte Formung im Bereich ohne Near-Miss |

**Aufwärts linear, abwärts Gauß.** Eine reine Glocke steht bei Ratio 0 noch bei
14,5 % ihres Maximums (das Ziel liegt 1,4 σ darüber), eine völlig harmlose Wave
kostete also −0,11 statt der vollen −0,30. Gemessen parkten 52,5 % der Wellen in
diesem Band — billiger als jeder Versuch, der ein Leak riskiert.

**Der p90-Term** existiert, weil 88–91 % der Wellen eine Near-Miss-Ratio von
exakt 0 haben und DRAMA über diesen gesamten Bereich konstant ist. Ohne ihn kann
der Agent „alles stirbt bei 40 % des Pfades" nicht von „alles stirbt bei 79 %"
unterscheiden.

### Term 3: PACING (`_pacing_reward`)

HP-Zerfallskurve über den Run statt eines Per-Wave-Bandes:

```python
err   = abs(hp_after - hp_target(wave_num))          # target: linear 1.0 → 0.0 über 80 Waves
u     = err / PACING_SIGMA                           # 0.18
shape = u*u if u <= 1.0 else 1.0 + PACING_TAIL_SLOPE * (u - 1.0)   # 0.3
return -REWARD_PACING_PEAK * min(shape, PACING_SHAPE_CAP)          # 0.60, Cap 5.0
```

**Eine Strafe, kein Bonus.** Für das Sitzen auf der Kurve zu zahlen bedeutete,
dass Nichtstun positiv punktet, solange der Spieler zufällig auf der Kurve
liegt — der v3-Kollaps durch eine andere Tür. Auf Kurve zu sein ist lediglich
kostenlos; nur DRAMA zahlt.

**Quadratisch innerhalb 1 σ, linear darüber.** Eine reine Gaußkurve ist jenseits
von ~2 σ flach und wird zur konstanten Steuer ohne Gradient — gemessen saßen
58,4 % der Wellen exakt auf −0,60, also genau die, die am weitesten von der
Kurve entfernt waren und die Richtung am dringendsten gebraucht hätten.

### Term 4: SWARM_SIZE (`_swarm_size_reward`)

Tiebreaker innerhalb der Drama-Hülle, nie das Ziel:

```python
if total_count <= SWARM_SMALL_THRESHOLD:  return SWARM_SMALL_PENALTY   # 20 → -0.10
if drama <= 0:                            return 0.0
return min(SWARM_SIZE_CAP, SWARM_SIZE_SLOPE * (total_count - 20))      # 0.30, 0.0004
```

Ungegatet war dieser Term schwer ausbeutbar: das Netz schickte 2000 Gegner im
Wissen, dass alle überlaufen — +4,67 Swarm gegen −3,39 Drama, netto +1,28 pro
Wave, während der Bot jede Wave verlor.

**Hard-Constraints stehen nicht im Reward**, sondern in der Maske
(`schema.get_available_template_mask`) und im Decoder
(`server.py::_decode_action`).

---

## PPO-Training

### Hyperparameter (`config.py`)

| Parameter | Wert | Beschreibung |
|---|---|---|
| `LEARNING_RATE` | 0.0001 | Adam. Von 3e-4 gesenkt: dort lag approx-KL bei 0,23–0,37 gegen ein Ziel von 0,02 |
| `CLIP_EPSILON` | 0.2 | PPO Surrogate Clip |
| `ENTROPY_COEF` | 0.02 | **nur auf dem Template-Head** |
| `VALUE_COEF` | 0.5 | Value-Loss-Gewicht |
| `BATCH_SIZE` | 128 | Transitions pro Update (von 16 erhöht) |
| `MINIBATCH_SIZE` | 64 | von 32 erhöht, um die KL pro Schritt direkt zu senken |
| `UPDATE_EPOCHS` | 4 | |
| `TARGET_KL` | 0.02 | Early-Stop pro Minibatch |
| `ADVANTAGE_CLIP` | 3.0 | standardisierte Advantages auf ±3 σ geklemmt |
| `GAMMA` | 0.9 | Discount **entlang der Trajektorie**, nicht per Bandit |
| `GAE_LAMBDA` | 0.95 | |
| `TRAJECTORY_FLUSH_LENGTH` | 32 | Wellen, bevor die Trajektorie geschnitten und gebootstrappt wird |
| `REWARD_SCALE_WINDOW` | 2000 | effektives Fenster der Reward-Skalierungsstatistik |
| `DETERMINISTIC_EVAL_EVERY` | 25 | jeder 25. gestartete Run läuft rauschfrei (Policy-Mittel statt Sample) und geht nur in die Eval-Metriken |
| `EPISODE_LENGTH` | 100 | max. Wellen pro Episode (aus dem Schema) |
| `CHECKPOINT_INTERVAL` | 10 | Auto-Save |

**`ADVANTAGE_CLIP` ist die wichtigste der jüngeren Änderungen.** Die −8
Todesstrafe gegen ~−0,6 typische Wellen setzte pro Batch einige Samples jenseits
−3 σ. Diese allein dominierten den Gradienten (gemessene Grad-Norm 3,6–51,7
gegen einen Clip von 0,5) und trieben den Schritt bereits im ersten Minibatch
über `TARGET_KL` — der Early-Stop verwarf damit den Großteil jedes Batches:
**16 Updates ergaben etwa 20–30 echte Gradientenschritte über 1200 Episoden.**
Clipping begrenzt den Einfluss einzelner Samples, ohne das Vorzeichen des
Lernsignals anzutasten; eine kleinere Lernrate hätte nur die überlebenden
Schritte weiter verkleinert.

**`GAMMA = 0.9` statt 0.99, und die Diskontierung läuft entlang der
Trajektorie.** Wellen sind nicht unabhängig: der Spieler heilt nie, HP sind eine
Einwegressource über den ganzen Run. Die alte Bandit-Rahmung zahlte den vollen
Sweet-Spot-Reward den ganzen Weg nach unten und stellte am Ende einmal −3,5 in
Rechnung — „den Spieler ausbluten und bei Wave 30 töten" punktete ~+83 und
schlug jede nachhaltige Politik.

### Training-Loop

1. Browser sendet den Game-State-Snapshot.
2. Server baut zuerst die **Availability-Maske** — sie ist gleichzeitig Input
   (Wave-Context-Block) und Filter auf den Template-Output. Eine Quelle, damit
   beide nicht auseinanderlaufen können.
3. Fährt ein nicht-lernender Director diesen Client, entscheidet er hier; sonst
   kodiert der Server 203 Features und sampelt aus dem Modell.
4. Decoder übersetzt in eine Wave-Config (Range-Interpolation, DPS-Caps,
   Duration-Cap, Fairness-Gate).
5. Browser spielt die Wave und sendet das Ergebnis (`damagePercent`,
   `nearMissRatio`, `leakRatio`, `p90Progress`, `enemiesSpawned`, `stateAfter`).
6. `steer_gate` faltet die Leak-Quote in den Gate-Regelkreis.
7. `calculate_reward()` berechnet den 4-Term-Reward.
8. Transition gespeichert: `(state, template_idx, raw_params, log_prob, reward, mask)`.
9. Bei `BATCH_SIZE` Transitions: Mask-Aware-PPO-Update über 4 Epochs mit
   KL-Early-Stop pro Minibatch.

### PPO-Update mit Maske

`model.evaluate_action()` bekommt die ursprüngliche Template-Maske, damit
geblockte Logits korrekt re-evaluiert werden — sonst erhielte das Netz
Ratio-Werte für Templates, die es nie hätte wählen können.

---

## Web-Dashboard (Port 3002)

- **Header:** Episode, Avg-Reward, Best, Clients, Damage-Sweet %, Game-Over-Rate
- **Reward-Chart:** Raw + Rolling Average (50)
- **Damage-Chart:** Damage-Distribution + Sweet-Zone-Band
- **Near-Miss-Chart:** Path-Progress + Target-Linie
- **Damage-Distribution:** Boring / Sweet / Hard / Game-Over
- **Modell-Metriken:** Policy-Loss, Entropy, Grad-Norm, Batch-Reward
- **DPS-Profile:** Per-Client Ground/Air-Profil (20 Bins)
- **Template-Histogramm**
- **Wave-Log + Training-Log**

> Das Dashboard kennt den A/B-Roster **nicht** — es aggregiert über alle
> Clients. Eine Aufschlüsselung nach Director geht nur über die JSONL-Logs.
> Die Damage-Bänder (`DAMAGE_SWEET_MIN/MAX`, `DAMAGE_HARD_THRESHOLD`,
> `PROGRESS_OVERFLOW_THRESHOLD`, `PROGRESS_NEAR_MISS_LOW/HIGH`) sind seit v4
> reine **Anzeigegrößen**: kein Reward-Term gatet mehr auf sie.

### API-Endpoints

| Endpoint | Methode | Beschreibung |
|----------|---------|---|
| `/` | GET | Dashboard-HTML |
| `/api/stats` | GET | Aktuelle Trainings-Stats |
| `/api/history` | GET | Reward/Damage/Progress-History |
| `/api/clients` | GET | Verbundene Clients + DPS-Profile |
| `/api/profile/{id}` | GET | DPS-Profil eines Clients |
| `/api/config` | GET | Reward-Schwellwerte (Frontend liest diese dynamisch) |
| `/ws/live` | WebSocket | Real-Time-Event-Stream |

### WebSocket-Events

- `episode` — neuer Reward/Damage/Progress-Datenpunkt
- `wave` — Wave-Ergebnis (Template, Count, Progress, Reward-Breakdown)
- `stats` — Gesamt-Statistiken
- `training_update` — PPO-Metriken (Loss, Entropy, Grad-Norm)

---

## WebSocket-Protokoll (Port 3001)

### Browser → Backend

| Type | Beschreibung |
|------|---|
| `connect` | Initial-Connection |
| `state` | Game-State-Snapshot (wird serverseitig zu 203 Features kodiert) |
| `result` | Wave-Outcome (`damagePercent`, `nearMissRatio`, `leakRatio`, `p90Progress`, `enemiesSpawned`, `stateAfter`, …) |
| `game_start` | Neues Spiel (+ `enemyBaseHp`-Map) |
| `game_over` | Spiel beendet |
| `request_stats` | Stats anfordern |
| `request_export` | Modell-Export anfordern |
| `client_status` | 1-Hz-Live-Status (Wave, EnemiesAlive, Phase) |

### Backend → Browser

| Type | Beschreibung |
|------|---|
| `connected` | Connection bestätigt |
| `wave_config` | Generierte Wave-Konfiguration (Enemies + Spawn-Pattern) |
| `stats` | Trainings-Statistiken |
| `reset` | Episode zurücksetzen |
| `select_bot` | Bot-Typ zuweisen (aus `BOT_WEIGHTS`) |
| `model_exported` | ONNX-Export fertig |
| `control` | Server-seitige Steuerung |

---

## Start & Betrieb

### Quick Start (Windows)

```bash
cd training-backend
start.bat
```

Startet WebSocket :3001 + Dashboard :3002.

### Manuell

```bash
cd training-backend
pip install -r requirements.txt
python server.py
```

`DASHBOARD=0 python server.py` startet ohne Dashboard (CI/Headless).
`python server.py --fresh` archiviert vorhandene Checkpoints nach
`checkpoints/archive-<datum>/`.

### Browser-Client verbinden

1. `npm start` (Angular Dev-Server)
2. Im Spiel den Training-Client im Debug-Fenster einschalten
3. Auto-Connect zum WebSocket :3001

Solange ein Training-Client verbunden ist, kommen die Wellen vom Server. Ohne
Verbindung entscheidet der clientseitige Regel-Director.

**Der Gegner:** `BOT_WEIGHTS = {"strategist": 1.0}` — es gibt derzeit genau
einen Bot. Alles, was ein Agent über dessen Schwächen lernt, ist gegen einen
Menschen wertlos; das ist eine Obergrenze für den Aussagewert jeder Messung
hier.

---

## Logging

### Console (stderr)

Minimal: jede 10. Episode, Game-Overs, PPO-Updates, Checkpoints.

### JSONL-Logfile

`logs/training_YYYYMMDD_HHMMSS.jsonl`:

| Entry-Type | Felder (Auswahl) |
|---|---|
| `wave_state` | `client_id`, `wave`, `towers`, `dps`, `bot_type` |
| `wave_generated` | `template_id`, `count`, `count_factor`, `spawn_delay`, `hp_factor`, `endgame_hp_mult`, `gate`, `curriculum_forced` |
| `wave_result` | `wave`, `damage_pct`, `killed`, `avg_progress`, `near_miss_ratio`, `reward`, `director` |
| `training_step` | `episode`, `reward`, `avg_reward`, `breakdown` |
| `model_update` | `policy_loss`, `entropy`, `grad_norm`, `batch_avg_reward` |
| `episode_start` / `episode_end` | `client_id`, `bot_type`, `waves`, `reason`, `director` |
| `checkpoint` | `episode`, `path` |

Analyse: `python scripts/analyze_log.py logs/training_*.jsonl` (aggregiert über
alle Clients; für den A/B nach `director` gruppieren).

---

## Tests

```bash
cd training-backend
python -m pytest tests -q          # 96 Tests, Stand 2026-09-07
```

Zwei Suiten decken die Stellen ab, an denen bereits stille Fehler geschifft
wurden:

- `tests/test_gate_loop.py` ruft `server.steer_gate` **direkt** auf statt die
  Logik zu spiegeln. Die Vorgängerversion hatte den Regelkreis nachgebaut und
  konnte deshalb nur mit dem übereinstimmen, wovon sie kopiert war — keiner der
  beiden geschifften Gate-Bugs wäre auffindbar gewesen.
- `tests/test_directors.py` prüft den Decoder-Contract. `template_probs` war bei
  den Nicht-Modell-Directors `None`, der Decoder warf auf jeder Wave, die
  Exception wurde zu einer Default-Wave mit 10 Gegnern verschluckt — ein
  A/B-Lauf meldete daraufhin drei flache Linien, die wie ein Befund über
  Strategien aussahen und ein fehlender Key waren.

---

## Dependencies

```
torch>=2.0.0
numpy>=1.24.0
websockets>=10.0
onnx>=1.14.0
fastapi>=0.100.0
uvicorn>=0.23.0
```

Exakte Versionen siehe `requirements.txt`.

---

## Changelog

Vollständige Entwicklungsgeschichte: [AI_TRAINING_SESSION_NOTES.md](AI_TRAINING_SESSION_NOTES.md).

Kurz-Timeline:
- **v1.0** Damage-basiert
- **v2.0** DPS-Relative HP + Path-Progress
- **v3.0** DPS-Profil + Conv1D + Web-Dashboard
- **v3.1–3.5** Anti-Exploitation, Anti-Kollaps, Reward-Skalierung
- **Phase 5.5** State 74→93, Multi-Group-Decoder, Reward-Restart
  (`PHASE5.5_TRAINING_RUNBOOK.md`)
- **Phase 5.10** Template-basiert, State 156, 4-Term-Reward (Schema v1)
- **Phase 5.11** Range-Based-Templates, 4 Continuous-Params, Wave-Duration-Cap
- **Phase 5.16** Wave-Curriculum-Override
- **Training-Refresh (2026-08)** Schema v2 → v3 (162 → 203 Features), Reward v4,
  Wave-Context-Block (`docs/HANDOVER_TRAINING_REFRESH.md`)
- **Regel-Director (2026-09-07, aktuell)** Fairness-Gate als Regelkreis,
  A/B-Roster, Advantage-Clipping — und das Ergebnis der Messung: das Spiel
  läuft auf Regeln, das Backend ist ein Messinstrument
  (`docs/HANDOVER_RULE_DIRECTOR.md`)
