# Phase 5.11 — Range-Based Templates (HISTORISCH)

> **Status: überholt — das neuronale Netz ist nicht mehr der Wave Director.**
> Seit 2026-09 wählt ein **regelbasierter Director** (`src/app/ai/core/rule-director.ts`)
> Template und Formfaktoren, vollständig clientseitig. Das Spiel braucht im
> Betrieb weder Python-Server noch Modell noch ONNX-Runtime.
>
> **Warum:** In A/B-Läufen mit vier Wave-Designern (model, rules, random, maxgate)
> bei gleichen Bots, gleichem Curriculum und gleichem Fairness-Gate war das Netz
> **dreimal** statistisch nicht von uniformem Zufall zu unterscheiden (Runlänge
> 45.6 [42,49] gegen 44.7 [41,48]), während zwei triviale Heuristiken mehr
> Spannung erzeugten (Near-Miss 0.067–0.069 gegen 0.045). Das Netz hatte nie
> gelernt: `log_std` stand unverändert auf dem Initialwert, alle Faktor-Mittelwerte
> auf sigmoid(0) = 0.5. Die Ursache lag **vor** dem Lernen — das Curriculum pinnt
> das Template auf 49 % der Wellen, der Fairness-Cap band auf 63 %, und der volle
> count-Regelbereich bewegte eine Welle von 19 auf 28 Gegner. Es gab kaum etwas zu
> entscheiden und deshalb nichts zu lernen.
>
> **Was aus Phase 5.11 heute noch gilt** — der ganze Decoder unterhalb der
> Entscheidung ist unverändert und wird von Regel-Director und (optionalem)
> Modell gemeinsam benutzt:
>
> | Weiter aktiv | Datei |
> |---|---|
> | Templates mit Ranges (count / spawn_delay / hp_mult / variation) | `src/app/ai/core/templates.ts` |
> | Verfügbarkeitsmaske (Slot, min_wave, Cooldown, Capability, Boss, Curriculum) | `src/app/ai/core/wave-context.ts` |
> | Range-Interpolation + DPS-skalierte Caps (5.11b) | `wave-director.service.ts::buildWaveConfig` |
> | Wave-Duration-Cap (180 s) inkl. zweitem Gate-Durchlauf | dito |
> | Endgame-HP-Multiplier + Per-Leak-Damage (5.16) | `configs/wave-curriculum.config.ts` |
>
> **Was nicht mehr gilt:** alles, was die vier Faktoren aus einem Netz-Output
> ableitet — `OUTPUT_SIZE=36`, die Reward-Terme, die Reward-Tuning-Tabellen
> unten, die 5.14-SWARM-Dämpfung und der Decoder-Override des Curriculums (das
> Curriculum sitzt heute in der **Maske**, nicht in einem nachgelagerten
> Override). Der Fairness-Cap wird jetzt zusätzlich von einem clientseitigen
> Regelkreis korrigiert (`src/app/ai/core/gate-controller.ts`), den es in 5.11
> nur serverseitig gab.
>
> **Aktueller Stand:** [AI_WAVE_DIRECTOR_PLAN.md](AI_WAVE_DIRECTOR_PLAN.md) und
> [HANDOVER_TRAINING_REFRESH.md](HANDOVER_TRAINING_REFRESH.md).
> Dieses Dokument bleibt als Protokoll der Architekturstufe stehen.

## Kontext

Phase 5.10 hatte jedes Template mit **statischen** `base_count`, `base_spawn_delay_ms`,
`base_hp_mult`. Der NN konnte nur `strength ∈ [0.5, 2.0]` und `count ∈ [0.3, 6.0]`
skalieren — zu wenig Spielraum für echte Intensitätsvarianten pro Template
(zu langsames Spawning, zu wenig HP → Gegner einzeln weggeräumt).

Phase 5.11 dreht das um: **Templates definieren nur den Charakter** (Gegner-Mix,
Curriculum, Capability, Spawn-Pattern). Alle Dynamik-Parameter werden
**Ranges**, der NN interpoliert pro Wave unabhängig in 4 Achsen.

## Architektur-Änderungen (ggü. Phase 5.10)

| Aspekt | Phase 5.10 | Phase 5.11 |
|---|---|---|
| NN Continuous-Outputs | 2 (`strength`, `count`) | **4** (`count`, `spawn_delay`, `hp_mult`, `variation`) |
| `OUTPUT_SIZE` | 34 | **36** |
| Template-Struktur | `base_count: int` etc. (fix) | `count_range: (int, int)` etc. (Ranges) |
| Wave-Duration | unbegrenzt | **Cap 180s** (count × spawn_delay) |
| DAMAGE_SWEET_MAX | 0.10 (1-10 HP) | **0.05 (1-5 HP)** — "permanent fordernd" |
| REWARD_DAMAGE_SWEET_PEAK | +0.30 | +0.40 |
| Zero-Damage | 0 (neutral) | **−0.10** (boring penalty) |

## Range-Designs (Highlights)

Obere Enden sind **aggressiv** hoch. NN muss lernen Context-passende Ranges zu wählen.

| Template | count | spawn_ms | hp_mult | variation |
|---|---|---|---|---|
| zombie_horde | (20, **2000**) | (15, 400) | (0.5, 6.0) | (0.05, 0.40) |
| rat_tide | (100, **5000**) | (10, 200) | (0.5, 5.0) | (0.05, 0.30) |
| mech_army | (5, 100) | (100, 900) | (0.5, **10.0**) | (0.10, 0.40) |
| mammoth_siege | (8, 120) | (100, 1000) | (0.5, **10.0**) | (0.10, 0.40) |

Full list: `src/app/ai/core/templates.ts` (Single Source of Truth; das Backend liest den Generat-Mirror `training-backend/generated/ai-schema.json`).

## Decoder-Pipeline (Server + Frontend)

```
1. NN-Output: template_logits (32) + 4 raw factors
2. Masks: Slot-Availability + Min-Wave + Cooldown + Capability + Boss-Gate
3. Sample template_idx from masked softmax
4. For each param: factor = sigmoid(raw); value = lerp(template.range, factor)
5. Wave-Duration-Cap: if count × spawn_delay > 180_000ms,
     spawn_delay = max(5ms, 180_000 / count)
6. Expand template → enemies[]
```

Der **Duration-Cap** ist ein stilles Safety-Net: NN kann (hohe count, hohes delay)
wählen, aber spawn_delay wird automatisch komprimiert damit keine 15-Minuten-Welle
entsteht. NN lernt über DRAMA/SWARM-Reward was wirklich zielführend ist; der Cap
verhindert nur Pathologien.

## Reward-Tuning (Sweet-Zone)

DRAMA-Term hat verengtes Damage-Sweet-Window:

| damage_pct | Alt (5.10) | Neu (5.11) |
|---|---|---|
| < 1% (boring) | 0 | **−0.10** |
| 1-5% (sweet) | +0.30 | **+0.40** |
| 5-10% | +0.30 | 0 (neutral) |
| 10-20% | 0 | 0 (neutral) |
| > 20% | 0→penalty @25% | **penalty @20%** |

Ziel: Spieler soll pro Wave zwischen 1-5 HP verlieren. "Permanent fordernd"
statt gelegentlich-mild.

## Migration

1. Checkpoints wipen (Model-Architektur inkompatibel: 34→36 Output)
2. Fresh Training

## Kritische Dateien

- `src/app/ai/core/templates.ts` — 19 Templates mit Ranges (Backend liest sie über das generierte Schema)
- `training-backend/config.py` — NUM_CONTINUOUS=4, MAX_WAVE_DURATION_MS, Damage-Thresholds
- `training-backend/model.py` — params_head (4,), factors in [0,1] via sigmoid
- `training-backend/server.py::_decode_action` — lerp + Duration-Cap
- `training-backend/reward.py::_drama_reward` — narrower sweet, zero-damage penalty
- `src/app/ai/core/templates.ts` — 1:1 Mirror
- `src/app/ai/core/wave-director.service.ts::decodeModelOutput` — lerp + Duration-Cap
- `training-backend/scripts/export_to_tfjs.py` — Metadata mit Ranges + Duration-Cap-Config

---

## Phase 5.11b — DPS-scaled Range Caps

Der NN gibt Faktoren in `[0,1]` aus. Ein frischer/leerer Spieler bei sigmoid≈0.5
würde ohne Schutz die Mitte der Ranges treffen — bei `count=1010` (Mitte von
20..2000) und `hp_mult≈3.25` ist Wave 1 unspielbar.

Decoder-Side Schutz (`config.py`):

```
dps_frac      = max(FLOOR, min(1.0, totalDPS / DPS_RAMP))
effective_max = range_min + (range_max − range_min) × dps_frac
final_value   = lerp((range_min, effective_max), factor)
```

Nur auf **count** und **hp_mult** angewendet (Difficulty-Achsen). `spawn_delay` und
`variation` bleiben über volle Range frei (Stil, nicht Difficulty).

Konstanten:
- `DPS_RAMP_FLOOR = 0.10` — auch bei 0 DPS sind 10 % der Range erreichbar
- `DPS_RAMP_COUNT = 500.0`
- `DPS_RAMP_HP_MULT = 1000.0`

---

## Phase 5.14 — SWARM-Reward Dampening

Vorheriger SWARM_SIZE-Term (Slope `0.003`, Cap `8.0`) machte große unarmored Swarms
zum dominierenden Reward-Signal. Beobachtetes NN-Verhalten:
"2000 Zombies senden, alle laufen durch, +4.67 Swarm vs. -3.39 DRAMA = +1.28 net
pro Wave — Bot verliert jede Wave, NN belohnt sich trotzdem."

Änderungen in `config.py` + Reward-Gating:

| Konstante                    | Alt    | Neu (5.14) |
|-----------------------------|--------|------------|
| `SWARM_SIZE_SLOPE`          | 0.003  | **0.0015** |
| `SWARM_SIZE_CAP`            | 8.0    | **2.0**    |
| `SWARM_SMALL_PENALTY`       | -0.10  | -0.10 (unverändert) |

Zusätzliches Gating in `reward.py::_swarm_size_reward`: Bonus = 0 wenn
- `survived == False`, oder
- `avg_progress > PROGRESS_OVERFLOW_THRESHOLD (0.95)`, oder
- `damage_pct > DAMAGE_HARD_THRESHOLD (0.20)`

Damit muss das NN erst die DRAMA-Sweet-Zone treffen, bevor SWARM-Bonus überhaupt
zählt.

---

## Phase 5.16 — Wave-Curriculum + Endgame-Knobs + Gold-Budget

**Wave-Curriculum** (`src/app/configs/wave-curriculum.config.ts`):
- 30 Waves explizit gepinnt
- Decoder forciert das Curriculum-Template für Wave 1..N (NN's Template-Argmax wird
  überschrieben)
- NN's Continuous-Faktoren tunen weiterhin Difficulty
- Bot/Player hat Foreknowledge → Capability-Gating bleibt Spieler-Verantwortung

> **Korrektur (2026-09):** Das Curriculum wird nicht mehr *nachgelagert* über den
> Decoder erzwungen, sondern sitzt in der Verfügbarkeitsmaske
> (`wave-context.ts` → `getAvailableTemplateMask(..., templateForWave(wave))`):
> innerhalb des Curriculums kollabiert die Maske auf einen Slot, die gewählte
> Aktion *ist* also die gelieferte Welle. Der alte Override trainierte den
> Template-Head auf nie gespielte Aktionen. Ebenfalls überholt: die
> Template-Sequenz loopt ab W31 **nicht** mod 30 — dort wählt der Director frei.
> Der mod-30-Loop gilt weiterhin für das Gold-Budget und den statischen
> Wave-Fallback.

**Endgame HP-Multiplier** (`wave-curriculum.ts::endgameHpMultiplier`):
- W1-19: ×1.0
- W20+: +5 %/Wave
- Cap: ×4.0 bei W80
- Wirkt **post-NN**, compoundet auf NN's `hp_mult`

**Per-Leak Damage-Skalierung** (`wave-curriculum.ts::enemyBaseDamageForWave`):
- W1-10: 1 HP pro Leak
- W11-20: 2 HP
- W21-30: 3 HP
- W31+: 4 HP+ (linear weiter)

**Gold-Budget** (Frontend-only, `src/app/configs/wave-curriculum.config.ts`):
- Pro Wave deterministisch: `goldKill` (Summe aller Kill-Credits) + `goldComplete`
- Pro-Kill-Reward = `goldKill / waveSize` (NICHT pro-enemy-type-gewichtet)
- Skill-Bonuses (Perfect, CloseCall, Milestone, Combo, Comeback) stacken oben drauf

> **Korrektur (2026-09) — die Zahlen in diesem Abschnitt waren nie richtig.**
> Real: **W1 = 133/67**, **W30 = 120000/60000**. Ab W31 wird weder linear
> extrapoliert noch mod-30 geloopt, sondern das Budget **verfällt geometrisch**:
> `×0.5` je Welle, mit Boden bei 5 % der W30-Werte (also 6000/3000 ab ~W35).
> `KILL_DELTA_PER_WAVE` und `COMPLETE_DELTA_PER_WAVE` existieren nicht mehr.
>
> Begründung im Code (`goldBudgetForWave`): Der frühere mod-30-Loop ließ Welle 31
> von 180 000 auf 200 Gold fallen und wieder hochklettern — mitten im Run
> unverständlich. Über 100 Wellen zahlte er 2,64 M aus, gegen ein Design-Roster
> von 1,39 M. Der Trainings-Bot erreichte damit ~6700 DPS über die ganze Route
> und tötete ab Welle 11 100 % jeder Welle; der Wave Director hatte nichts mehr
> zum Zielen. Der Tail soll den Run *tragen*, keine zweite Armee finanzieren.

**Backend-Mirror** (`training-backend/generated/ai-schema.json`, generiert):
- Nur die Template-Sequenz spiegelt sich ins Backend (für Decoder-Override)
- Gold-Budget lebt nur im Frontend — der Reward des NN ist getrennt davon

**Compatibility (historisch):** Das alte Phase-5.10/5.11 ONNX-Modell lief mit den
5.14/5.16-Decoder-Knobs ohne Retraining — die Architektur (156→36) war damals
identisch geblieben.

> **Stand 2026-09:** Der Encoder ging über Schema v2 (162) auf **v3 (203
> Features)**; alte Checkpoints sind nicht ladbar. Wichtiger: Es wird kein Modell
> mehr geladen. `WaveDirectorService` startet im Modus `'rules'`, lädt beim
> Start weder ONNX-Runtime noch Modelldatei, und `loadModel()` ist ein
> ausdrückliches Opt-in — schlägt es fehl, bleibt der Regel-Director aktiv
> (kein Fehlerzustand). Den früheren Zustand „Fehler, kein Modell", der eine
> Exception warf, gibt es nicht mehr.
