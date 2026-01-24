"""
Training Configuration

Hyperparameters and settings for AI training.
"""

# === SERVER ===
SERVER_HOST = "localhost"
SERVER_PORT = 3001

# === MODEL ARCHITECTURE ===
INPUT_SIZE = 74  # Must match ENCODED_STATE_SIZE in game-state-encoder.ts
NUM_SCALAR = 34  # Scalar features [0-33], rest is spatial (DPS profile)
NUM_SPATIAL = 40  # 2 channels x 20 bins (ground + air DPS profile)
NUM_BINS = 20    # Number of DPS profile bins per channel
OUTPUT_SIZE = 10  # Enemy probs (6) + continuous params (4)

# === TRAINING ===
LEARNING_RATE = 0.0003  # Increased from 0.0001 (was too slow to converge)
GAMMA = 0.99  # Discount factor
CLIP_EPSILON = 0.2  # PPO clip parameter
ENTROPY_COEF = 0.04  # High to prevent early specialization (boring waves from low kill_time)
VALUE_COEF = 0.5  # Value loss coefficient

BATCH_SIZE = 16  # Reduced from 32 (more frequent updates)
UPDATE_EPOCHS = 4  # PPO epochs per batch

# === REWARD SHAPING ===
REWARD_PROGRESS_CENTER = 0.55   # Target avg raw progress (half die in defense, half reach base)
REWARD_PROGRESS_SIGMA = 0.15    # Wide Gaussian for gradient signal with raw progress
REWARD_GAME_OVER_PENALTY = -0.5  # Mild game-over penalty
REWARD_BORING_PENALTY = -0.3    # When avg progress < 20%
REWARD_VARIETY_BONUS = 0.15

# === ENEMY BASE HP (for healthMultiplier calculation) ===
ENEMY_BASE_HP = {
    "zombie": 80,
    "bat": 25,
    "tank": 250,
    "wallsmasher": 200,
    "penguin": 30,
    "herbert": 500,
}

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
EPISODE_LENGTH = 20  # Max waves per episode before reset

# === CHECKPOINTS ===
CHECKPOINT_INTERVAL = 10  # Save every N episodes
CHECKPOINT_DIR = "checkpoints"

# === EXPORT ===
EXPORT_DIR = "../src/assets/ai"
