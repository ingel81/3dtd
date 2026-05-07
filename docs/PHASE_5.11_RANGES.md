# Phase 5.11 — Range-Based Templates

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

Full list: `training-backend/templates.py` und `src/app/ai/core/templates.ts`.

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

- `training-backend/templates.py` — 18 Templates mit Ranges
- `training-backend/config.py` — NUM_CONTINUOUS=4, MAX_WAVE_DURATION_MS, Damage-Thresholds
- `training-backend/model.py` — params_head (4,), factors in [0,1] via sigmoid
- `training-backend/server.py::_decode_action` — lerp + Duration-Cap
- `training-backend/reward.py::_drama_reward` — narrower sweet, zero-damage penalty
- `src/app/ai/core/templates.ts` — 1:1 Mirror
- `src/app/ai/core/wave-director.service.ts::decodeModelOutput` — lerp + Duration-Cap
- `training-backend/scripts/export_to_tfjs.py` — Metadata mit Ranges + Duration-Cap-Config
