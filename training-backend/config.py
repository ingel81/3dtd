"""
Training Configuration — Phase 5.10 Template-Based Wave Director

Minimal, clean config after the Phase 5.10 big-wurf overhaul.
Action space: template_idx (32 slots, 18 active) + strength + count.
Reward: 4 terms (DEATH, DRAMA, SWARM_SIZE, PROGRESSION) + running normalization.
State: 156 features (Phase 5.6 + Gap-5 armor-matrix). Phase 5.7 awareness dropped.
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
# Action space:
#   template_head: 32 logits (Categorical over MAX_TEMPLATE_SLOTS)
#   params_head:   2 continuous (strength, count) → Gaussian policy
#   value_head:    1 scalar (PPO critic)
#
# MAX_TEMPLATE_SLOTS is permanent (32). NUM_ACTIVE_TEMPLATES (18) can grow
# later without retraining — reserve slots are masked at decode time.
INPUT_SIZE = 156
NUM_SCALAR = 116
NUM_SPATIAL = 40
NUM_BINS = 20
MAX_TEMPLATE_SLOTS = 32
NUM_CONTINUOUS = 2
OUTPUT_SIZE = MAX_TEMPLATE_SLOTS + NUM_CONTINUOUS  # 34

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
DAMAGE_SWEET_MIN = 0.01           # >= 1% HP lost = into sweet zone
DAMAGE_SWEET_MAX = 0.10           # <= 10% = peak
DAMAGE_HARD_THRESHOLD = 0.25      # damage > 25% starts linear penalty
REWARD_DAMAGE_SWEET_PEAK = 0.30
REWARD_DAMAGE_HARD_SLOPE = 3.0    # penalty factor per full HP overrun
PROGRESS_NEAR_MISS_LOW = 0.65     # enemies reached 65-90% path = near-miss sweet
PROGRESS_NEAR_MISS_HIGH = 0.90
PROGRESS_OVERFLOW_THRESHOLD = 0.95
REWARD_NEAR_MISS_PEAK = 0.50
REWARD_OVERFLOW = -0.80
REWARD_PROGRESS_SLOPE = 0.30      # mild positive for intermediate progress

# === REWARD — Term 3: SWARM_SIZE ===
SWARM_SMALL_THRESHOLD = 20        # below this = tiny wave (penalty)
SWARM_SMALL_PENALTY = -0.10
SWARM_SIZE_SLOPE = 0.003          # +0.003 per enemy above threshold
SWARM_SIZE_CAP = 8.0              # reaches cap at ~2700 enemies

# === REWARD — Term 4: PROGRESSION ===
PROGRESSION_SLOPE = 0.02          # +0.02 per wave_num
PROGRESSION_CAP = 0.5             # plateau at wave 25+

# === ACTION SCALING (decoder) ===
STRENGTH_MIN = 0.5
STRENGTH_MAX = 2.0
COUNT_MIN = 0.3
COUNT_MAX = 6.0                   # rat_tide × 400 × 6.0 → 2400 enemies

# === TEMPLATE CONSTRAINTS ===
TEMPLATE_COOLDOWN_WAVES = 2       # template blocked for N waves after use

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
