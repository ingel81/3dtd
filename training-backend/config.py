"""
Training Configuration

Hyperparameters and settings for AI training.
"""

# === SERVER ===
SERVER_HOST = "localhost"
SERVER_PORT = 3001

# === MODEL ARCHITECTURE (Phase 5.7 — +25 self-awareness features) ===
# Phase 5.6 baseline: 146 features (53 scalar awareness + 40 spatial + 53 base).
# Phase 5.7 adds 25 features so the net sees its OWN recent policy choices:
#   +5  reward-history (last 5 total rewards, clipped [-2, +2] / 2)
#   +5  wave-size-history (last 5 totalCount, min(1, count/500))
#   +5  kill-time-history (last 5 kill_time, normalized)
#   +5  count-factor-history (last 5 count_factor, already [0,1])
#   +5  armor-dominance-share (per category share over last 30 waves)
# Ohne diese kann das Netz nicht explizit lernen "ich habe seit 30 Waves
# 64% light/unarmored gesendet" — PPO muss das implizit aus Advantage lernen,
# deutlich langsamer/instabiler. Fresh-Run braucht diese Signale.
INPUT_SIZE = 171   # was 146 (+25 features)
NUM_SCALAR = 131   # was 106 (+25 features)
NUM_SPATIAL = 40   # 2 channels x 20 bins (ground + air DPS profile) — unchanged
NUM_BINS = 20    # Number of DPS profile bins per channel
NUM_ENEMY_TYPES = 16  # All 16 enemies
OUTPUT_SIZE = 20  # Enemy probs (16) + continuous params (4) — unchanged

# === TRAINING ===
LEARNING_RATE = 0.0003  # Increased from 0.0001 (was too slow to converge)
GAMMA = 0.99  # Discount factor
CLIP_EPSILON = 0.2  # PPO clip parameter
# Step 2: 0.04 → 0.02. At 0.04 the policy stayed multimodal — two of four
# clients found the damage-sweet+moderate-progress region, the other two
# stuck in damage-sweet+overflow region. Lower entropy forces commitment to
# one mode and should pull all clients toward the same (better) policy.
# Phase 5.7: 0.02 → 0.05. After 5742 eps the net committed to 3 types
# (penguin 46%, spider 17%, wraith 11% = 74%) — committment came too
# early. With armor-dominance-penalty now active, net needs headroom to
# actually explore alternatives. 0.05 is a moderate increase that doesn't
# throw away learnt damage-sweet-zone hitting.
ENTROPY_COEF = 0.05
VALUE_COEF = 0.5  # Value loss coefficient

BATCH_SIZE = 16  # Reduced from 32 (more frequent updates)
UPDATE_EPOCHS = 4  # PPO epochs per batch

# === REWARD SHAPING ===
# NEW MODEL (2026-04-17): two independent tension sources instead of a
# narrow Gaussian peak on avg_progress.
#   (a) Damage-zone: Bot should take SOME damage per wave (1-10 HP sweet)
#       but not too much (>25 HP steep penalty). Zero damage is slightly
#       negative UNLESS near-miss progress saves it.
#   (b) Near-miss progress: enemies reaching 60-90% of the path carries its
#       own tension, even at zero damage.
# Wave-progression bonus rewards surviving later waves (linear with wave_num)
# so the AI has an incentive to gradually escalate instead of stagnating.

# --- Damage-zone thresholds (as fraction of player's max HP, 0..1) ---
# 0 damage (perfect): mild negative unless redeemed by near-miss
# (0, DAMAGE_SWEET_MIN): ramping into sweet zone
# [DAMAGE_SWEET_MIN, DAMAGE_SWEET_MAX]: sweet — reward peak
# (DAMAGE_SWEET_MAX, DAMAGE_NEUTRAL_MAX]: neutral band, no reward/penalty
# (DAMAGE_NEUTRAL_MAX, DAMAGE_HARD_THRESHOLD]: rising penalty
# (DAMAGE_HARD_THRESHOLD, 1.0]: steep penalty (overwhelming)
DAMAGE_SWEET_MIN = 0.01            # 1 HP on 100-HP base
DAMAGE_SWEET_MAX = 0.10            # 10 HP — peak of tension zone
DAMAGE_NEUTRAL_MAX = 0.25          # 25 HP — still acceptable, no reward
DAMAGE_HARD_THRESHOLD = 0.50       # 50 HP — clearly overwhelming
REWARD_DAMAGE_SWEET_PEAK = 0.30    # max reward inside sweet zone
REWARD_DAMAGE_ZERO = -0.10         # perfect-wave penalty (redeemable)
REWARD_DAMAGE_HARD_SLOPE = 2.0     # penalty per full-HP overrun above HARD threshold

# --- Near-miss progress band (progress where enemies create drama) ---
# Phase 5.7: 0.20 → 0.15. Bei 94% near-miss-rate wurde das kein "drama"
# mehr, sondern baseline. Leichter Abwärts-Korrigierung sodass near-miss
# wieder special ist und nicht den damage-zone-Signal dominiert.
NEAR_MISS_PROGRESS_LOW = 0.60      # below this: not dramatic enough
NEAR_MISS_PROGRESS_HIGH = 0.90     # above this: already overflow territory
REWARD_NEAR_MISS_PEAK = 0.15       # was 0.20

# --- Overflow penalty (progress saturated, enemies reach base en masse) ---
# Slope 0.8 → 1.5 (Phase 5.6): blocked damage-sweet+overflow exploit.
# Slope 1.5 → 0.8 (Phase 5.8.1): after Large-Zero-Damage-Penalty shifted the
# net into "small hard waves with armor-exploit overflow", the −1.5 overflow
# dominated and zeroed-out damage-sweet learning. Softening to 0.8 lets the
# net keep sweet-damage waves even when they slightly saturate progress, so
# the Goldilocks zone (mid-size + sweet damage + moderate overflow) becomes
# net-positive rather than net-catastrophic.
OVERFLOW_PROGRESS_THRESHOLD = 0.95
REWARD_OVERFLOW_SLOPE = 0.8

# --- Boring penalty (only when truly nothing happens) ---
REWARD_BORING_PENALTY = -0.30      # fires if damage==0 AND progress<0.30
REWARD_BORING_THRESHOLD = 0.30     # progress below which "boring" can trigger

# --- Wave-progression survival bonus ---
# Per wave survived: +SURVIVAL_BASE + SURVIVAL_SLOPE × wave_num.
# Keeps early waves low-reward (so AI must learn to escalate), grows linearly
# so wave 50 is meaningfully more valuable than wave 5.
REWARD_SURVIVAL_BASE = 0.05
REWARD_SURVIVAL_SLOPE = 0.010      # wave 5 → +0.10, wave 50 → +0.55

# --- Game-over penalty ---
# Phase 5.7: CAP -2.5 → -3.5. Pro-Client game-over-rate 21-24% nach 5742 Eps
# (Design-Ziel <10%) zeigt Netz pusht zu hart. Härterer Cap bei frühem Tod
# zwingt Netz zu früherer Vorsicht, behält aber Gradient (kein harter Floor).
REWARD_GAME_OVER_PENALTY = -0.3    # multiplier: scaled × (EPISODE_LEN / wave_num)
REWARD_GAME_OVER_CAP = -3.5        # was -2.5

# --- Variety / monotony ---
# Variety 0.40 (stays) + Monotony -0.08 → -0.25:
# 313-wave spider-run showed -0.08 was way too soft. 78% spider dominance ate
# -0.08 × frequency but still net-positive thanks to damage-sweet +0.30.
# -0.25 makes single-type spam net-negative when paired with armor-monotony
# (also -0.25) — AI has strong incentive to actually rotate types.
# Variety +0.40 keeps the positive pull (discovering a new type pays well).
# Phase 5.7: -0.25 → -0.40. Penguin 46%/spider 17%/wraith 11% = 74% nach
# 5742 Eps zeigt -0.25 ist nicht genug bite. -0.40 + neue Armor-Dominance
# machen Single-Type/Single-Armor-Spam klar unattraktiv.
REWARD_VARIETY_BONUS = 0.40
MONOTONY_PENALTY = -0.40

# --- Mixed diversity ---
REWARD_MIXED_PER_GROUP = 0.05      # +0.05 per extra group (cap at 3)

# --- Armor matrix exploit bonus ---
# 0.05 → 0.15: small tactical signal was too weak to nudge the AI away from
# mono-type swarms. At 0.15 picking armors that counter the bot's damage mix
# becomes worth roughly one near-miss — actually attractive.
# 0.15 → 0.25 (Phase 5.8.1): net discovered armor-exploit is legit drama
# source (heavy/fortified/ethereal vs physical-only bot). Higher bonus + lower
# overflow-penalty together channel that strategy into sweet-damage moderate-
# progress waves instead of overflow-all-the-way-through.
REWARD_ARMOR_MATCH_BONUS_MAX = 0.25

# --- Swarm-Count Bonus (rewards actual large-wave policy) ---
# Phase 5.7: Complete redesign from binary (+0.05 flat, threshold 100) to
# continuous scaling. After 5742 eps 87% of waves were in [0-20] bucket,
# 0 over 100 — the old +0.05 flat was no match for the overflow-penalty
# (up to -1.5) that drove net into small-wave local minimum.
# New model:
#   bonus = min(CAP, SLOPE * max(0, count - THRESHOLD))
#   Gate: damage ≤ DAMAGE_NEUTRAL_MAX (not only sweet). Bigger waves will
#   occasionally overflow a bit; don't require pixel-perfect sweet.
# Example: count=40 → 0, count=100 → +0.30, count=240 → +1.00 (cap).
REWARD_SWARM_COUNT_THRESHOLD = 40     # was 100 — niedriger Einstieg
REWARD_SWARM_COUNT_SLOPE = 0.005      # NEW: +0.005 pro Enemy über threshold
REWARD_SWARM_COUNT_CAP = 1.00         # was 0.05 flat; bei count=240 erreicht
# Legacy name (kept for tooling compat; now used as per-wave "was over threshold" marker)
REWARD_SWARM_COUNT_BONUS = REWARD_SWARM_COUNT_CAP

# --- Small-Wave Penalty (complements Swarm-Bonus) ---
# Creates a soft gradient: TINY waves (<15 enemies) get a fixed penalty.
# Combined with Swarm-Bonus this shifts the whole reward landscape away
# from the "2-9 enemies per type, 30 total" local minimum the net fell in.
SMALL_WAVE_PENALTY = -0.15            # NEW
SMALL_WAVE_THRESHOLD = 15             # NEW

# --- Large-Zero-Damage Penalty (Phase 5.8) ---
# Closes the reward-landscape gap where the net could send 500-rat zero-damage
# waves (rat HP=5, insta-killed by bot) and pay only the generic −0.30 boring
# penalty. With this penalty, large waves that don't pressure the bot become
# significantly worse than small-but-focused waves, giving PPO a clear gradient
# AWAY from the "big empty horde" policy that trapped it at Ep 3229.
# Fires when count > threshold AND damage < SWEET_MIN (trivial wave).
LARGE_ZERO_DAMAGE_PENALTY = -0.50     # NEW
LARGE_ZERO_DAMAGE_THRESHOLD = 100     # NEW — above which "big empty" penalty applies

# --- Episode Length Bonus (late-game survival matters) ---
# Per-wave bonus that grows with wave_number. Rewards late-game plays
# (wave 50 survived = harder than wave 5 survived). Capped to prevent
# runaway late-game reward.
REWARD_EPISODE_LENGTH_SLOPE = 0.005   # +0.005 × wave_num
REWARD_EPISODE_LENGTH_CAP = 0.30      # max per wave

# --- Type-Diversity Score (long-term variety) ---
# Continuous bonus based on unique types seen in last N waves. Complements
# the event-based Variety-Bonus. Encourages long-term type rotation.
# Phase 5.7: per 0.02 → 0.04, cap 0.10 → 0.25. After 5742 eps type-diversity
# signal was rarely visible in breakdowns because the cap was reached
# quickly — now it scales further when the net actually uses more types.
REWARD_TYPE_DIVERSITY_PER = 0.04   # was 0.02
REWARD_TYPE_DIVERSITY_WINDOW = 10  # count unique types over last N waves
REWARD_TYPE_DIVERSITY_CAP = 0.25   # was 0.10

# Legacy names kept for tooling compatibility (inspect_training.py reads these)
REWARD_PROGRESS_CENTER = 0.55
REWARD_PROGRESS_SIGMA = 0.22

# === TYPE COOLDOWN ===
TYPE_COOLDOWN_WAVES = 6  # Block a type for N waves after use (expanded pool → longer cooldown)

# === MIXED WAVE DECODER ===
# Lowered 0.15 → 0.08. At 0.15 a differentiated policy (e.g. spider 17%,
# bat 13%, ghost 11%) collapsed to single-type waves because only the top
# type crossed the threshold. 0.08 lets secondary types (≥8% prob) into the
# wave — mixed-waves sichtbar, ohne reward-shaping anzufassen.
MIXED_WAVE_THRESHOLD = 0.08
MIXED_WAVE_MAX_GROUPS = 3    # Max enemy groups per wave

# === VARIATION ===
VARIATION_MAX = 0.3  # Max speed/count/delay variation (0.0 = uniform, 0.3 = ±30%)

# === KILL TIME ===
# Reduced MAX from 5.0 → 3.5 so the AI can't inflate single-enemy HP as its
# primary difficulty lever. Count is the preferred knob now (engine handles
# 5000+ enemies), kill_time is secondary tuning.
KILL_TIME_MIN = 2.0
KILL_TIME_MAX = 3.5

# === SPAWN DELAY ===
# Range the AI can express via delay_factor [0..1]:
#   delay = SPAWN_DELAY_MIN + delay_factor × (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN)
# Lowered MIN 500 → 50ms so the AI can produce actual hordes at small counts
# (30 zombies × 80ms = shoulder-to-shoulder swarm). Before: 500ms floor meant
# 30 zombies spread over 15s — no horde feeling possible.
# The 5ms compression floor stays as absolute limit for mega-swarms (>1200).
SPAWN_DELAY_MIN = 50
SPAWN_DELAY_MAX = 2000

# === WAVE COUNT ===
# Primary difficulty knob. Waves must remain BEATABLE — so max_count is
# derived from the defense's actual kill-throughput:
#   kill_capacity = (total_DPS × WAVE_BUDGET_S) / expected_enemy_HP × SLACK
# With a strong defense (high total_DPS) and low-HP enemies (rats/bats with
# the healthMultiplier cap biting), this can legitimately reach thousands.
# With a weak defense, max_count stays small — no unwinnable overwhelm.
WAVE_COUNT_MIN_BASE = 5       # floor regardless of towers
WAVE_COUNT_CAP = 2000         # absolute ceiling per wave (engine handles 5000+)
WAVE_COUNT_FLOOR = 10         # keep at least 10 even with tiny defense
WAVE_BUDGET_S = 60.0          # target wave duration the defense has to kill through
WAVE_COUNT_SLACK = 1.25       # 25% over kill-capacity → challenging but beatable

# === HEALTH MULTIPLIER ===
# Reduced from 20.0 → 8.0: 20× baseHP created unwinnable early waves
# (wallsmasher 4000 HP, herbert 10000 HP). 8× keeps pressure scalable while
# still letting the director tune difficulty via kill_time.
HEALTH_MULTIPLIER_MAX = 8.0

# === ENEMY BASE HP (for healthMultiplier calculation) ===
# Phase 5.5: expanded from 6 to all 16 enemies
ENEMY_BASE_HP = {
    # Unarmored
    "zombie": 80,
    "rat": 5,
    "penguin": 30,
    # Light
    "wallsmasher": 200,
    "bat": 25,
    "hornet": 80,
    "spider": 60,
    # Heavy
    "zombie-soldier": 160,
    "tank": 250,
    "bear": 300,
    "dragon": 450,
    "mech": 500,
    # Fortified
    "mammoth": 400,
    "herbert": 500,
    # Ethereal
    "ghost": 120,
    "wraith": 100,
}

# Enemy type order — MUST match frontend ENEMY_TYPES in wave-director.service.ts
# NN output logits[i] corresponds to ENEMY_TYPES[i]
ENEMY_TYPES = [
    "zombie", "rat", "penguin",                           # Unarmored (3)
    "wallsmasher", "bat", "hornet", "spider",             # Light (4, air: bat+hornet)
    "zombie-soldier", "tank", "bear", "dragon", "mech",   # Heavy (5, air: dragon)
    "mammoth", "herbert",                                  # Fortified (2, boss: herbert)
    "ghost", "wraith",                                     # Ethereal (2)
]

# Air-unit flags (matches frontend isAirUnit)
AIR_ENEMIES = {"bat", "hornet", "dragon"}

# Ethereal enemies (for fairness-gate on server side, mirrors frontend)
ETHEREAL_ENEMIES = {"ghost", "wraith"}

# Armor category per enemy type — used for armor-diversity reward signals.
# Must stay in sync with frontend enemy-types config (armorType field).
ENEMY_ARMOR = {
    "zombie": "unarmored", "rat": "unarmored", "penguin": "unarmored",
    "wallsmasher": "light", "bat": "light", "hornet": "light", "spider": "light",
    "zombie-soldier": "heavy", "tank": "heavy", "bear": "heavy",
    "dragon": "heavy", "mech": "heavy",
    "mammoth": "fortified", "herbert": "fortified",
    "ghost": "ethereal", "wraith": "ethereal",
}

# === ARMOR-DIVERSITY REWARD SIGNALS ===
# AI kept spamming spider/bat/penguin — all light/unarmored. Single-category
# spam is reward-hacking on the existing type-monotony (which only checks
# exact type identity). These signals punish/reward diversity at the armor
# category level.
# Penalty -0.15 → -0.25 after 78% spider-dominance over 313 waves showed
# -0.15 couldn't outweigh sweet-damage +0.30 net.
# Phase 5.7: -0.25 → -0.40, window 3 → 5. Net gets more time to diversify
# before penalty kicks in, but penalty is sharper when it does.
ARMOR_MONOTONY_PENALTY = -0.40      # was -0.25
ARMOR_MONOTONY_WINDOW = 5           # was 3
REWARD_ARMOR_VARIETY_BONUS = 0.35   # was 0.20 — bonus for introducing new category
ARMOR_VARIETY_WINDOW = 5            # recency window for variety check

# === GLOBAL ARMOR DOMINANCE (Phase 5.7) ===
# Local armor-monotony (3-5 wave window) can't see "over the last 30 waves
# I sent 64% light/unarmored". Armor-Dominance catches that at a larger
# time-scale. Scales linearly once one category exceeds THRESHOLD share.
ARMOR_DOMINANCE_PENALTY = -0.30     # NEW — base penalty when threshold hit
ARMOR_DOMINANCE_THRESHOLD = 0.40    # NEW — share above 40% triggers penalty
ARMOR_DOMINANCE_WINDOW = 30         # NEW — rolling window for share calc
# Linear scaling: at exactly threshold → 0 penalty, at share=1.0 → full penalty.
# Formula: penalty = PENALTY * max(0, (max_share - THRESHOLD) / (1 - THRESHOLD))

# === EXPLORATION ===
INITIAL_EPSILON = 1.0
FINAL_EPSILON = 0.1
EPSILON_DECAY = 0.995

# === BOT DISTRIBUTION ===
# Only "strategist" is actively maintained on the frontend
BOT_WEIGHTS = {
    "strategist": 1.0,
}

# === EPISODE ===
EPISODE_LENGTH = 100  # Max waves per episode before reset

# === CHECKPOINTS ===
CHECKPOINT_INTERVAL = 10  # Save every N episodes
CHECKPOINT_DIR = "checkpoints"

# === EXPORT ===
EXPORT_DIR = "../src/assets/ai"
