"""
Training Configuration

Hyperparameters and settings for AI training.
"""

# === SERVER ===
SERVER_HOST = "localhost"
SERVER_PORT = 3001

# === MODEL ARCHITECTURE (Phase 5.5) ===
INPUT_SIZE = 93  # Must match ENCODED_STATE_SIZE in game-state-encoder.ts (was 74)
NUM_SCALAR = 53  # Scalar features [0-52], rest is spatial (DPS profile) — was 34
NUM_SPATIAL = 40  # 2 channels x 20 bins (ground + air DPS profile)
NUM_BINS = 20    # Number of DPS profile bins per channel
NUM_ENEMY_TYPES = 16  # Expanded from 6 to all 16 enemies
OUTPUT_SIZE = 20  # Enemy probs (16) + continuous params (4) — was 10

# === TRAINING ===
LEARNING_RATE = 0.0003  # Increased from 0.0001 (was too slow to converge)
GAMMA = 0.99  # Discount factor
CLIP_EPSILON = 0.2  # PPO clip parameter
ENTROPY_COEF = 0.08  # Increased from 0.04 to prevent type collapse
VALUE_COEF = 0.5  # Value loss coefficient

BATCH_SIZE = 16  # Reduced from 32 (more frequent updates)
UPDATE_EPOCHS = 4  # PPO epochs per batch

# === REWARD SHAPING ===
REWARD_PROGRESS_CENTER = 0.55   # Target avg raw progress (half die in defense, half reach base)
REWARD_PROGRESS_SIGMA = 0.15    # Wide Gaussian for gradient signal with raw progress
REWARD_GAME_OVER_PENALTY = -0.5  # Mild game-over penalty
REWARD_BORING_PENALTY = -0.3    # When avg progress < boring threshold
REWARD_BORING_THRESHOLD = 0.30  # Increased from 0.20 to punish easy waves harder
REWARD_VARIETY_BONUS = 0.20     # Increased from 0.15 to encourage type diversity

# === TYPE COOLDOWN ===
TYPE_COOLDOWN_WAVES = 6  # Block a type for N waves after use (expanded pool → longer cooldown)

# === MIXED WAVE DECODER ===
MIXED_WAVE_THRESHOLD = 0.15  # Min prob for a type to become a separate group
MIXED_WAVE_MAX_GROUPS = 3    # Max enemy groups per wave

# === VARIATION ===
VARIATION_MAX = 0.3  # Max speed/count/delay variation (0.0 = uniform, 0.3 = ±30%)

# === KILL TIME ===
KILL_TIME_MIN = 2.0  # Minimum seconds enemy survives under focus-fire (was 1.5)
KILL_TIME_MAX = 5.0  # Maximum seconds (was 4.0)

# === HEALTH MULTIPLIER ===
HEALTH_MULTIPLIER_MAX = 20.0  # Cap to prevent absurd values at high DPS

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
