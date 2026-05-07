"""
Wave Director Neural Network — Phase 5.11 Range-Based Templates

PyTorch model with Conv1D spatial branch for DPS profile and Dense scalar
branch for game state features. Output heads:
  - template_head: Categorical over MAX_TEMPLATE_SLOTS (32, 18 active)
  - params_head:   4 continuous params in [0,1] via sigmoid
                   (count, spawn_delay, hp_mult, variation — interpolated
                    per template in the server-side decoder)
  - value_head:    PPO critic baseline
  - log_std:       learnable per-param std for exploration noise
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from config import (
    INPUT_SIZE,
    NUM_SCALAR,
    NUM_SPATIAL,
    MAX_TEMPLATE_SLOTS,
    NUM_CONTINUOUS,
)


class WaveDirectorModel(nn.Module):
    """
    Architecture:
      - Spatial branch: Conv1D over DPS profile (2 channels × 20 bins)
      - Scalar branch: Dense layers over state features (NUM_SCALAR = 116)
      - Combined: merged → policy heads

    Input:  156 features = 116 scalar + 40 spatial
    Output: template logits (32) + 2 continuous params + value
    """

    def __init__(self):
        super().__init__()

        # Spatial branch: Conv1D over DPS profile (2 channels × 20 bins)
        self.spatial = nn.Sequential(
            nn.Conv1d(2, 16, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv1d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )  # Output: 32 features

        # Scalar branch
        self.scalar = nn.Sequential(
            nn.Linear(NUM_SCALAR, 128),
            nn.LayerNorm(128),
            nn.ReLU(),
        )  # Output: 128 features

        # Combined: 32 + 128 = 160
        self.combined = nn.Sequential(
            nn.Linear(160, 192),
            nn.LayerNorm(192),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(192, 96),
            nn.LayerNorm(96),
            nn.ReLU(),
            nn.Dropout(0.1),
        )

        # Output heads
        self.template_head = nn.Linear(96, MAX_TEMPLATE_SLOTS)
        self.params_head = nn.Linear(96, NUM_CONTINUOUS)
        self.log_std = nn.Parameter(torch.zeros(NUM_CONTINUOUS))
        self.value_head = nn.Linear(96, 1)

    def forward(self, x):
        """Forward pass returning policy logits/params and value."""
        scalars = x[:, :NUM_SCALAR]          # (batch, 116)
        spatial = x[:, NUM_SCALAR:]           # (batch, 40)
        spatial = spatial.view(-1, 2, 20)     # (batch, 2, 20)

        spatial_out = self.spatial(spatial).squeeze(-1)   # (batch, 32)
        scalar_out = self.scalar(scalars)                 # (batch, 128)

        combined = torch.cat([scalar_out, spatial_out], dim=1)  # (batch, 160)
        features = self.combined(combined)                       # (batch, 96)

        template_logits = self.template_head(features)
        params = self.params_head(features)
        value = self.value_head(features)

        return template_logits, params, value

    def get_action(self, state, deterministic=False, template_mask=None):
        """
        Sample an action from the policy.

        Args:
            state:           (batch, INPUT_SIZE) tensor
            deterministic:   if True, argmax template + mean params
            template_mask:   optional (batch, MAX_TEMPLATE_SLOTS) bool tensor;
                             True = allowed, False = blocked (logit set to -inf)

        Returns:
            action dict, log_prob (sum over template + continuous), value
        """
        template_logits, params, value = self(state)

        # Apply template mask by setting blocked logits to -inf
        if template_mask is not None:
            template_logits = template_logits.masked_fill(~template_mask, float("-inf"))

        # Template categorical
        cat_dist = torch.distributions.Categorical(logits=template_logits)
        if deterministic:
            template_idx = template_logits.argmax(dim=-1)
        else:
            template_idx = cat_dist.sample()

        template_probs = F.softmax(template_logits, dim=-1)
        log_prob_cat = cat_dist.log_prob(template_idx)

        # Continuous Gaussian (2 params)
        means = params[:, :NUM_CONTINUOUS]
        std = torch.exp(torch.clamp(self.log_std, -5, 2)).unsqueeze(0).expand_as(means)

        if deterministic:
            sampled_raw = means
        else:
            noise = torch.randn_like(means)
            sampled_raw = means + noise * std

        # All 4 continuous params normalised to [0, 1] via sigmoid.
        # The server-side decoder interpolates each factor into the template's range.
        factors = torch.sigmoid(sampled_raw)  # shape (batch, NUM_CONTINUOUS=4)

        # Continuous log-prob (Gaussian on raw logits, not scaled factors)
        log_prob_cont = -0.5 * (
            ((sampled_raw - means) / (std + 1e-8)) ** 2
            + 2 * torch.clamp(self.log_std, -5, 2).unsqueeze(0)
            + 1.8379
        )
        log_prob_cont = log_prob_cont.sum(dim=-1)

        log_prob = log_prob_cat + log_prob_cont

        return {
            "template_probs": template_probs,
            "template_idx": template_idx.detach(),
            "count_factor": factors[:, 0],
            "spawn_factor": factors[:, 1],
            "hp_factor": factors[:, 2],
            "variation_factor": factors[:, 3],
            "raw_params": sampled_raw.detach(),
        }, log_prob, value.squeeze(-1)

    def evaluate_action(self, state, stored_actions, stored_template_idx=None, template_mask=None):
        """
        Re-evaluate stored actions under current policy for PPO update.

        Args:
            state:                (batch, INPUT_SIZE)
            stored_actions:       (batch, NUM_CONTINUOUS) raw_params; if None, use mean
            stored_template_idx:  (batch,) template indices; if None, use argmax
            template_mask:        optional (batch, MAX_TEMPLATE_SLOTS) bool tensor
        """
        template_logits, params, value = self(state)

        if template_mask is not None:
            template_logits = template_logits.masked_fill(~template_mask, float("-inf"))

        cat_dist = torch.distributions.Categorical(logits=template_logits)
        if stored_template_idx is not None:
            log_prob_cat = cat_dist.log_prob(stored_template_idx)
        else:
            log_prob_cat = cat_dist.log_prob(template_logits.argmax(dim=-1))

        means = params[:, :NUM_CONTINUOUS]
        std = torch.exp(torch.clamp(self.log_std, -5, 2)).unsqueeze(0).expand_as(means)

        actions = stored_actions if stored_actions is not None else means

        log_prob_cont = -0.5 * (
            ((actions - means) / (std + 1e-8)) ** 2
            + 2 * torch.clamp(self.log_std, -5, 2).unsqueeze(0)
            + 1.8379
        )
        log_prob_cont = log_prob_cont.sum(dim=-1)

        log_prob = log_prob_cat + log_prob_cont

        entropy_cat = cat_dist.entropy()
        entropy_cont = 0.5 * (1 + 2 * torch.clamp(self.log_std, -5, 2) + 1.8379).sum()
        entropy = entropy_cat + entropy_cont

        return log_prob, value.squeeze(-1), entropy


def create_model():
    """Create and initialize a fresh model."""
    return WaveDirectorModel()


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
