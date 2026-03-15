"""
Wave Director Neural Network

PyTorch model with Conv1D spatial branch for DPS profile
and Dense scalar branch for game state features.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from config import INPUT_SIZE, NUM_SCALAR, NUM_SPATIAL, KILL_TIME_MIN, KILL_TIME_MAX, VARIATION_MAX


class WaveDirectorModel(nn.Module):
    """
    Neural network for wave configuration prediction.

    Architecture:
    - Spatial branch: Conv1D over DPS profile (2 channels x 20 bins)
    - Scalar branch: Dense layers over game state (34 features)
    - Combined: Merged features -> output heads

    Input: 74 features = 34 scalar + 40 spatial (2x20 DPS bins)
    Output: Enemy type (categorical) + continuous params (Gaussian) + value
    """

    # Number of continuous action parameters
    NUM_CONTINUOUS = 4  # kill_time, count_factor, delay_factor, variation

    def __init__(self):
        super().__init__()

        # Spatial branch: Conv1D over DPS profile
        # Input: (batch, 2, 20) - 2 channels (ground, air), 20 bins
        self.spatial = nn.Sequential(
            nn.Conv1d(2, 16, kernel_size=3, padding=1),   # -> (batch, 16, 20)
            nn.ReLU(),
            nn.Conv1d(16, 32, kernel_size=3, padding=1),  # -> (batch, 32, 20)
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),                       # -> (batch, 32, 1)
        )  # Output: 32 features

        # Scalar branch: Dense
        self.scalar = nn.Sequential(
            nn.Linear(NUM_SCALAR, 64),
            nn.LayerNorm(64),
            nn.ReLU(),
        )  # Output: 64 features

        # Combined: 32 + 64 = 96
        self.combined = nn.Sequential(
            nn.Linear(96, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(128, 64),
            nn.LayerNorm(64),
            nn.ReLU(),
            nn.Dropout(0.1),
        )

        # Output heads
        self.enemy_head = nn.Linear(64, 6)   # 6 enemy types
        self.params_head = nn.Linear(64, 4)  # 4 continuous params

        # Learnable log_std for continuous action exploration
        self.log_std = nn.Parameter(torch.zeros(self.NUM_CONTINUOUS))

        # Value head for PPO
        self.value_head = nn.Linear(64, 1)

    def forward(self, x):
        """Forward pass returning policy and value."""
        # Split input into scalar and spatial
        scalars = x[:, :NUM_SCALAR]            # (batch, 34)
        spatial = x[:, NUM_SCALAR:]            # (batch, 40)
        spatial = spatial.view(-1, 2, 20)      # (batch, 2, 20) = 2 channels

        # Process branches
        spatial_out = self.spatial(spatial).squeeze(-1)  # (batch, 32)
        scalar_out = self.scalar(scalars)                # (batch, 64)

        # Combine
        combined = torch.cat([scalar_out, spatial_out], dim=1)  # (batch, 96)
        features = self.combined(combined)                       # (batch, 64)

        # Output heads
        enemy_logits = self.enemy_head(features)
        params = self.params_head(features)
        value = self.value_head(features)

        return enemy_logits, params, value

    def get_action(self, state, deterministic=False):
        """
        Get action from state.

        Returns:
            action: Dict with enemy_probs, continuous params, enemy_idx, raw_params
            log_prob: Log probability of full action (categorical + continuous)
            value: State value estimate
        """
        enemy_logits, params, value = self(state)

        # === Enemy type (proper Categorical sampling) ===
        cat_dist = torch.distributions.Categorical(logits=enemy_logits)
        if deterministic:
            enemy_idx = enemy_logits.argmax(dim=-1)
        else:
            enemy_idx = cat_dist.sample()

        enemy_probs = F.softmax(enemy_logits, dim=-1)
        log_prob_cat = cat_dist.log_prob(enemy_idx)

        # === Continuous params (Gaussian policy) ===
        means = params[:, :self.NUM_CONTINUOUS]
        std = torch.exp(torch.clamp(self.log_std, -5, 2)).unsqueeze(0).expand_as(means)

        if deterministic:
            sampled_raw = means
        else:
            noise = torch.randn_like(means)
            sampled_raw = means + noise * std

        # Apply activations to sampled values
        kill_time_range = KILL_TIME_MAX - KILL_TIME_MIN
        kill_time = KILL_TIME_MIN + torch.sigmoid(sampled_raw[:, 0]) * kill_time_range  # [KILL_TIME_MIN, KILL_TIME_MAX]s
        count_factor = torch.sigmoid(sampled_raw[:, 1])                 # [0, 1] -> mapped to [min_count, max]
        delay_factor = torch.sigmoid(sampled_raw[:, 2])                 # [0, 1] -> mapped to [500, 2000]ms
        variation = torch.sigmoid(sampled_raw[:, 3]) * VARIATION_MAX     # [0, VARIATION_MAX]

        # === Continuous log probability ===
        log_prob_cont = -0.5 * (((sampled_raw - means) / (std + 1e-8)) ** 2
                                 + 2 * torch.clamp(self.log_std, -5, 2).unsqueeze(0) + 1.8379)
        log_prob_cont = log_prob_cont.sum(dim=-1)

        log_prob = log_prob_cat + log_prob_cont

        return {
            "enemy_probs": enemy_probs,
            "enemy_idx": enemy_idx.detach(),
            "kill_time": kill_time,
            "count_factor": count_factor,
            "delay_factor": delay_factor,
            "variation": variation,
            "raw_params": sampled_raw.detach(),
        }, log_prob, value.squeeze(-1)

    def evaluate_action(self, state, stored_actions, stored_enemy_idx=None):
        """
        Evaluate stored actions under current policy.

        Args:
            state: Batch of states (batch, INPUT_SIZE)
            stored_actions: Batch of raw_params (batch, NUM_CONTINUOUS), or None
            stored_enemy_idx: Batch of enemy type indices (batch,), or None
        """
        enemy_logits, params, value = self(state)

        # Categorical log_prob with proper distribution
        cat_dist = torch.distributions.Categorical(logits=enemy_logits)
        if stored_enemy_idx is not None:
            log_prob_cat = cat_dist.log_prob(stored_enemy_idx)
        else:
            log_prob_cat = cat_dist.log_prob(enemy_logits.argmax(dim=-1))

        # Continuous log_prob under current policy
        means = params[:, :self.NUM_CONTINUOUS]
        std = torch.exp(torch.clamp(self.log_std, -5, 2)).unsqueeze(0).expand_as(means)

        if stored_actions is not None:
            actions = stored_actions
        else:
            actions = means

        log_prob_cont = -0.5 * (((actions - means) / (std + 1e-8)) ** 2
                                 + 2 * torch.clamp(self.log_std, -5, 2).unsqueeze(0) + 1.8379)
        log_prob_cont = log_prob_cont.sum(dim=-1)

        log_prob = log_prob_cat + log_prob_cont

        # Entropy: categorical + continuous
        entropy_cat = cat_dist.entropy()
        entropy_cont = 0.5 * (1 + 2 * torch.clamp(self.log_std, -5, 2) + 1.8379).sum()
        entropy = entropy_cat + entropy_cont

        return log_prob, value.squeeze(-1), entropy


def create_model():
    """Create and initialize model."""
    model = WaveDirectorModel()
    return model


def save_model(model, path):
    """Save model checkpoint."""
    torch.save(model.state_dict(), path)
    print(f"Model saved to {path}")


def load_model(path):
    """Load model from checkpoint."""
    model = create_model()
    model.load_state_dict(torch.load(path))
    model.eval()
    print(f"Model loaded from {path}")
    return model
