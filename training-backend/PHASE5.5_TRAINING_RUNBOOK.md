# Phase 5.5 — Training Runbook

After the Phase 5.5 architecture changes (state-vector 74→93, enemy pool 6→16,
top-K multi-group decoder, new reward signals), the neural network
architecture is incompatible with all existing checkpoints.

**Training must restart from scratch.**

---

## What changed (why restart is required)

| Component | Before | After |
|---|---|---|
| State vector size | 74 | 93 |
| Scalar features | 34 | 53 |
| Enemy output head | 6 | 16 |
| Model output size | 10 | 20 |
| Scalar branch output | 64 | 96 |
| Combined hidden | 128→64 | 192→96 |
| Value head input | 64 | 96 |
| Decoder | Single-type (argmax) | Top-K multi-group (mixed waves) |

All `checkpoint_*.pt` files save `state_dict` for the OLD architecture —
loading them into the new model fails with shape mismatch.

---

## Preparation steps

### 1. Archive old checkpoints

```bash
cd training-backend/checkpoints
mkdir -p archive-v3.5
mv checkpoint_*.pt archive-v3.5/
```

Verify the directory is empty:
```bash
ls checkpoints/*.pt 2>/dev/null  # should show nothing
ls checkpoints/archive-v3.5/ | wc -l  # should show 650 files
```

### 2. Verify Python deps are up to date

```bash
cd training-backend
pip install -r requirements.txt  # or your equivalent
```

### 3. Start the training server

```bash
cd training-backend
python server.py
```

First-startup should print:
```
No checkpoints found, starting fresh
Model: INPUT_SIZE=93, OUTPUT_SIZE=20, NUM_ENEMY_TYPES=16
Server listening on localhost:3001
```

### 4. Start the dashboard (separate terminal)

```bash
cd training-backend/dashboard
python app.py
```

Dashboard at http://localhost:3002

---

## Starting training

1. Open the game in browser (http://localhost:4200)
2. In debug menu: enable **Bot auto-mode** + **AI Director**
3. The frontend auto-connects to `ws://localhost:3001`
4. Training should start — episode 0, reward ~0, exploration high

---

## Monitoring

**Healthy first-hour signals:**
- Reward moves out of noise band (starts ~0, gradient visible)
- Loss decreases over first few batches
- Episode count increases (~1 episode/minute at 75x timescale)
- No shape-errors in server log
- Mixed-wave rate starts near 0% (uniform probs fail threshold),
  rises as network learns to differentiate

**Warning signs:**
- Shape-mismatch errors → state encoder desync (frontend vs backend)
- Reward stuck at 0 → bot not playing (check bot research-awareness)
- All waves game-over by wave 5 → economy balance too punishing
- Perfect-rate >95% → director too easy, reward weights off
- Mixed-rate stays 0% → threshold too high or probs not differentiating

---

## What to watch for (new metrics)

- **Perfect Rate** (per batch): fraction of waves with 0 HP loss
  - Target: 10-30% in mid-game — too high = easy, too low = brutal
- **CloseCall Rate** (per batch): fraction of waves with HP <= 25 at end
  - Target: 15-40% — this is the "perfect challenge" zone
- **Mixed Wave Rate** (per batch): fraction with enemies.length >= 2
  - Target: rising from 0% → 40-60% as network learns
- **Armor Distribution** (per wave): which armor types are being sent
  - Should be varied, not collapsed to one type

---

## Rollback

If training collapses or diverges badly:

```bash
# Kill training server
# Verify no new *.pt files in checkpoints/ (shouldn't be — we moved them)
# Check git status — no uncommitted debug changes?
# Restart: python server.py
```

The archive folder preserves v3.5 model state, but those checkpoints
CANNOT be loaded into v5.5 architecture. They're kept only for:
- Reference if you want to revert the codebase
- Historical comparison of reward curves in dashboard exports

---

## Notes

- **Hyperparameters unchanged** (LEARNING_RATE=0.0003, etc.) — we're letting
  them ride with the new architecture. Watch for needing adjustments after
  ~500 episodes if loss oscillates.
- **Bot Research strategies are active** from episode 0 — all skill levels
  build the Research Center and pick research per their skill profile.
- **Fairness gates** are enforced both frontend-side (wave-director decoder)
  and backend-side (server.py _decode_action) — should produce consistent
  masked probs regardless of which inference path runs.
