# Phase 5.10 — Template-Based Wave Director (HISTORICAL)

> **Status: SUPERSEDED — nur als historische Referenz erhalten.**
>
> - Phase 5.11 ersetzt statische `base_*`-Felder durch Ranges und erweitert den NN
>   auf 4 Continuous-Parameter (count, spawn_delay, hp_mult, variation):
>   [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md).
> - Phase 5.14 dämpft den SWARM-Reward (Slope 0.0015, Cap 2.0) — dokumentiert in
>   [PHASE_5.11_RANGES.md](PHASE_5.11_RANGES.md) (Abschnitt "Phase 5.14").
> - Phase 5.16 fügt Wave-Curriculum-Override + Endgame-HP-Multiplier + Gold-Budget
>   hinzu: [HANDOVER_PLAYTEST_PHASE5.16.md](HANDOVER_PLAYTEST_PHASE5.16.md).
>
> Dieses Dokument beschreibt den Phase-5.10-Übergangsstand (Action-Space mit
> 2 Continuous, statische Template-Werte) — nicht mehr aktuell.

## Overview

Phase 5.10 replaced the 16-softmax × 4-continuous action space and the 13-term
reward landscape with an industry-proven pattern (Left 4 Dead's AI Director,
Diablo's Monster Packs): designer-curated **Wave Templates** plus a small set
of continuous scaling parameters. The NN's job shrinks from "pick any enemy
mix with any parameters" to "pick a template + strength + count".

**Goals (explicit user-stated):**

1. Player must not die outright
2. Enemies should reach far on the path while dealing minimal damage (near-miss zone)
3. Large swarms with matching enemies and short spawn delays (up to 2400 enemies)

## Architecture

### Action Space

| Head            | Shape | Meaning                                        |
|-----------------|-------|------------------------------------------------|
| `template_head` | 32    | Categorical over template slots (18 active, 14 reserved) |
| `params_head`   | 2     | Continuous — strength (0.5..2.0), count (0.3..6.0) |
| `value_head`    | 1     | PPO critic baseline                           |
| `log_std`       | 2     | Learnable per-param std for exploration       |

Total output: **34 values** per sample.

### State Vector (156 features)

| Indices    | Block                                 |
|------------|---------------------------------------|
| `[0-52]`   | Base scalar (player, towers, signals) |
| `[53-105]` | Phase 5.6 awareness (types/armor/damage histories) |
| `[106-115]`| Gap-5 effective-DPS per armor (ground × 5 + air × 5) |
| `[116-135]`| Ground DPS profile (20 bins)          |
| `[136-155]`| Air DPS profile (20 bins)             |

Phase 5.7 self-awareness features (kill-time/count-factor histories) were
dropped — hard constraints in the decoder make them obsolete.

### Decoder Pipeline (`server.py::_decode_action`)

1. NN produces template logits + raw continuous params.
2. **Mask application** (multiplicative):
   - Slot-availability (slots ≥ NUM_ACTIVE_TEMPLATES blocked)
   - Min-wave curriculum (each template has a `min_wave` gate)
   - Template cooldown (2 waves — can't repeat recent templates)
   - Capability gate (`antiAir` / `antiEthereal` based on player research)
   - Boss gate (`boss_herbert` only at `wave % 10 == 0`)
3. Softmax over allowed templates, argmax (deterministic) or sample.
4. Expand: `count = base_count × count_factor`, `hp_mult = base_hp_mult × strength`.
5. For each `(enemy_type, share)` pair in the template, spawn
   `round(count × share)` enemies.

### Reward (4 terms, running-mean/std normalized)

| Term          | Formula (summary)                                       |
|---------------|---------------------------------------------------------|
| `DEATH`       | −0.3 × 10 × early-wave-factor, capped at −3.5          |
| `DRAMA`       | damage-zone score (sweet 0.01-0.10) + progress-zone score (near-miss 0.65-0.90 sweet, > 0.95 overflow penalty) |
| `SWARM_SIZE`  | 0.003 × (count − 20), cap 8.0 (≈2700 enemies)          |
| `PROGRESSION` | 0.02 × wave_num, cap 0.5, gated on survival + min damage|

The trainer applies running-mean/std normalization to rewards before PPO updates.

### Template Library

18 active templates in `training-backend/templates.py` and mirrored in
`src/app/ai/core/templates.ts`. See the full list there — highlights:

| Slot | id              | Focus                          | Base Count | Min Wave |
|------|-----------------|--------------------------------|------------|----------|
| 0    | zombie_horde    | Unarmored starter              | 40         | 1        |
| 1    | rat_tide        | **Mega-swarm (up to 2400 rats)** | 400      | 8        |
| 6    | bat_swarm       | Air swarm (requires AA)        | 100        | 7        |
| 11   | dragon_elite    | Heavy-air                      | 15         | 15       |
| 14   | wraith_storm    | Pure Ethereal (requires magic) | 35         | 18       |
| 17   | boss_herbert    | Boss (every 10 waves)          | 30 (+1)    | 20       |

Reserve slots `18–31` are placeholders — new templates can be added without
retraining the model.

## Files

### Backend (`training-backend/`)

| File | Role |
|---|---|
| `templates.py` | Template definitions + mask helper |
| `config.py` | Minimal constants (action ranges, reward thresholds, enemy HP/armor) |
| `model.py` | WaveDirectorModel with 32-template head |
| `server.py` | Template-based decoder + 156-feature encoder |
| `reward.py` | 4-term reward function |
| `trainer.py` | PPO with running-mean/std normalization |
| `dashboard/app.py` | Tracks `template_usage_counts`, exposes via `/api/stats` |
| `dashboard/static/app.js` | Template-usage chart + 4-term breakdown labels |
| `scripts/export_to_tfjs.py` | ONNX export (Phase-5.10 schema) |
| `tests/test_templates.py` | Template integrity unit tests |
| `tests/test_reward_v2.py` | Reward-function sanity tests |

### Frontend (`src/app/ai/core/`)

| File | Role |
|---|---|
| `templates.ts` | 1:1 mirror of `templates.py` |
| `wave-director.service.ts` | Decodes 34-output ONNX tensor; throws on model fail (no rule-based fallback) |
| `models/wave-config.ts` | Adds `templateIdx`, `templateName`, `templateStrength` |
| `decision-explainer.ts` | Summary includes template name + strength |
| `spawn-schedule-builder.ts` | Pattern read from template (no `getRecommendedPattern`) |
| `wave-config-adapter.ts` | Uses `DEFAULT_SPAWN_PATTERN` if template doesn't set one |
| `templates.spec.ts` | Unit tests for template + mask helper |
| `fallback-rules.ts` | **DELETED** — Phase 5.10 requires a loaded model |

## Error Handling

If the ONNX model fails to load during standalone play:
- `wave-director.service.ts::getNextWave()` throws an explicit error.
- `game-loop-facade.service.ts` catches the error and sets `store.aiError`.
- `tower-defense.component.html` renders a red banner at the top of the game
  container with the message and a close button.
- `useAIDirector` flips to `false`, so subsequent wave-starts use the manual
  config path (non-AI).

During training, waves come from the Python backend via WebSocket — the
ONNX load failure has no effect.

## Migration & Training Workflow

1. **Wipe checkpoints** — Phase-5.10 model architecture is incompatible with
   older weights (different output shapes, smaller state):
   ```
   cd training-backend
   python manage_server.py stop
   rm -rf checkpoints/*
   rm -f logs/*.jsonl
   ```
2. **Start fresh server**:
   ```
   python manage_server.py start
   ```
3. Reload all 4 browser tabs.
4. `curl -X POST http://localhost:3002/api/control/start`

## Monitoring

- **Dashboard** (http://localhost:3002): watch the new "Template Usage"
  histogram, breakdown chart with exactly 4 labels, wave-size histogram.
- **`inspect_training.py`**: includes a `TEMPLATE USAGE` section listing the
  most-used templates + percentages.

## Why This Works

The earlier Phase 5.8.x approach had 13 reward terms that interacted in
subtle ways, creating local minima (monotony rate stuck at 99% after 4000+
episodes). Hard constraints remove entire classes of undesired behavior
**structurally**, leaving the reward to express only what we genuinely want:
player survives, enemies threaten, swarms grow. Fewer knobs, less fragility,
faster convergence.
