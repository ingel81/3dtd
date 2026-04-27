"""
Training Configuration — Phase 5.11 Range-Based Templates

Templates define character (enemy mix, curriculum, capability). The NN picks
a template + 4 independent scaling factors (count, spawn_delay, hp_mult,
variation) — each interpolated into the template's designer-set range.

Architecture:
  - State:  156 features (unchanged from Phase 5.10)
  - Action: template_idx (32 slots, 18 active) + 4 continuous in [0,1]
  - Reward: 4 terms (DEATH, DRAMA, SWARM_SIZE, PROGRESSION)
"""

# === SERVER ===
SERVER_HOST = "localhost"
SERVER_PORT = 3001

# === MODEL ARCHITECTURE ===
# State layout (156 features):
#   [0-52]    Base scalar (53)
#   [53-105]  Phase 5.6 awareness (53)
#   [106-115] Gap-5 effective-DPS-per-armor (10)
#   [116-135] Ground DPS Profile (20)
#   [136-155] Air DPS Profile (20)
#
# Action space (Phase 5.11):
#   template_head: 32 logits (Categorical over MAX_TEMPLATE_SLOTS)
#   params_head:   4 continuous in [0,1] via sigmoid — the decoder interpolates
#                  them across each template's designer-set range for
#                    count, spawn_delay_ms, hp_mult, variation.
INPUT_SIZE = 156
NUM_SCALAR = 116
NUM_SPATIAL = 40
NUM_BINS = 20
MAX_TEMPLATE_SLOTS = 32
NUM_CONTINUOUS = 4
OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS  # 36

# Ordered names of the continuous params (for logging + debugging).
CONTINUOUS_PARAM_NAMES = ["count", "spawn_delay", "hp_mult", "variation"]

# === TRAINING ===
LEARNING_RATE = 0.0003
GAMMA = 0.99
CLIP_EPSILON = 0.2
ENTROPY_COEF = 0.05
VALUE_COEF = 0.5
BATCH_SIZE = 16
UPDATE_EPOCHS = 4

# === REWARD — Term 1: DEATH ===
REWARD_GAME_OVER_PENALTY = -0.3   # multiplied by early-wave scaling in reward._death_penalty
REWARD_GAME_OVER_CAP = -3.5       # absolute floor for the death term

# === REWARD — Term 2: DRAMA (damage + path-progress merged) ===
# Phase 5.11 user-tightened sweet zone: 1-5% HP loss per wave = "permanent fordernd".
DAMAGE_SWEET_MIN = 0.01           # >= 1% HP lost = into sweet zone
DAMAGE_SWEET_MAX = 0.05           # <= 5% = peak (was 0.10 in 5.10)
DAMAGE_HARD_THRESHOLD = 0.20      # damage > 20% starts linear penalty (was 0.25)
REWARD_DAMAGE_SWEET_PEAK = 0.40   # higher peak to reward exact targeting (was 0.30)
REWARD_DAMAGE_ZERO_PENALTY = -0.10  # small penalty below SWEET_MIN (boring wave)
REWARD_DAMAGE_HARD_SLOPE = 3.0    # penalty factor per full HP overrun
PROGRESS_NEAR_MISS_LOW = 0.65     # enemies reached 65-90% path = near-miss sweet
PROGRESS_NEAR_MISS_HIGH = 0.90
PROGRESS_OVERFLOW_THRESHOLD = 0.95
REWARD_NEAR_MISS_PEAK = 0.50
REWARD_OVERFLOW = -0.80
REWARD_PROGRESS_SLOPE = 0.30      # mild positive for intermediate progress

# === REWARD — Term 3: SWARM_SIZE ===
# Phase 5.14 dampening: previous values (slope=0.003, cap=8.0) made big
# unarmored swarms net +1-8 reward, dwarfing sweet-spot peak (+0.4) and
# progression cap (+0.5). NN exploited the path-of-least-resistance
# (huge zombie waves → bot trivially clears → 0 damage → max swarm bonus,
# 77% zero-damage waves observed). Halved slope + 4× lower cap brings
# swarm reward in line with the other terms so sweet-spot becomes the
# attractive optimization target again.
SWARM_SMALL_THRESHOLD = 20        # below this = tiny wave (penalty)
SWARM_SMALL_PENALTY = -0.10
SWARM_SIZE_SLOPE = 0.0015         # +0.0015 per enemy above threshold (was 0.003)
SWARM_SIZE_CAP = 2.0              # max swarm bonus (was 8.0)

# === REWARD — Term 4: PROGRESSION ===
PROGRESSION_SLOPE = 0.02          # +0.02 per wave_num
PROGRESSION_CAP = 0.5             # plateau at wave 25+

# === TEMPLATE CONSTRAINTS ===
TEMPLATE_COOLDOWN_WAVES = 2       # template blocked for N waves after use

# === DPS-SCALED RANGE CAPS (Phase 5.11b curriculum) ===
# NN's factors are in [0,1], but the decoder clamps the TOP of difficulty
# ranges based on the player's actual defense DPS. Prevents one-shotting
# the fresh player at wave 1 (sigmoid(0)=0.5 → midrange → unplayable with
# 25 DPS) while still letting a heavily-invested bot see hard waves early.
#
# formula: dps_frac      = max(FLOOR, min(1.0, total_dps / DPS_RAMP))
#          effective_max = range_min + (range_max - range_min) * dps_frac
#          final_value   = lerp((range_min, effective_max), factor)
#
# Applied only to COUNT and HP_MULT (difficulty axes). spawn_delay and
# variation remain free over the full range (style, not difficulty).
DPS_RAMP_FLOOR = 0.10             # even at 0 DPS, 10% of the range is reachable
DPS_RAMP_COUNT = 500.0            # count hits full range at totalDPS ≥ 500
DPS_RAMP_HP_MULT = 1000.0         # hp_mult hits full range at totalDPS ≥ 1000

# === WAVE-DURATION CAP (Phase 5.11) ===
# Hard upper bound on total wave duration. If (count × spawn_delay) would
# exceed this, the decoder compresses spawn_delay down to max(min_floor, cap/count).
# Prevents pathological mega-wave + long-delay combos from stretching across
# 10+ minutes. NN's preference still counts within the cap.
MAX_WAVE_DURATION_MS = 180_000    # 3 minutes
MIN_SPAWN_DELAY_MS = 5            # engine floor — below this brings no feel-improvement

# === ENEMY DEFINITIONS (shared by templates, fairness gates, HP scaling) ===
# Must stay in sync with frontend enemy-types config.
ENEMY_TYPES = [
    "zombie", "rat", "penguin",                           # Unarmored (3)
    "wallsmasher", "bat", "hornet", "spider",             # Light (4, air: bat+hornet)
    "zombie-soldier", "tank", "bear", "dragon", "mech",   # Heavy (5, air: dragon)
    "mammoth", "herbert",                                 # Fortified (2, boss: herbert)
    "ghost", "wraith",                                    # Ethereal (2)
]
NUM_ENEMY_TYPES = len(ENEMY_TYPES)

ENEMY_BASE_HP = {
    "zombie": 80, "rat": 5, "penguin": 30,
    "wallsmasher": 200, "bat": 25, "hornet": 80, "spider": 60,
    "zombie-soldier": 160, "tank": 250, "bear": 300, "dragon": 450, "mech": 500,
    "mammoth": 400, "herbert": 500,
    "ghost": 120, "wraith": 100,
}

ENEMY_ARMOR = {
    "zombie": "unarmored", "rat": "unarmored", "penguin": "unarmored",
    "wallsmasher": "light", "bat": "light", "hornet": "light", "spider": "light",
    "zombie-soldier": "heavy", "tank": "heavy", "bear": "heavy",
    "dragon": "heavy", "mech": "heavy",
    "mammoth": "fortified", "herbert": "fortified",
    "ghost": "ethereal", "wraith": "ethereal",
}

AIR_ENEMIES = {"bat", "hornet", "dragon"}
ETHEREAL_ENEMIES = {"ghost", "wraith"}

# === BOT DISTRIBUTION (client-side selection weight) ===
BOT_WEIGHTS = {"strategist": 1.0}

# === EPISODE ===
EPISODE_LENGTH = 100  # Max waves per episode before reset

# === CHECKPOINTS ===
CHECKPOINT_INTERVAL = 10
CHECKPOINT_DIR = "checkpoints"

# === EXPORT ===
EXPORT_DIR = "../src/assets/ai"
