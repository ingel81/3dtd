"""
Wave Director Neural Network — Range-Based Templates

PyTorch model with a Conv1D spatial branch for the path DPS profile and a
dense scalar branch for the rest of the game state. Output heads:
  - template_head: Categorical over MAX_TEMPLATE_SLOTS
  - params_head:   4 continuous params in [0,1] via sigmoid
                   (count, spawn_delay, hp_mult, variation — interpolated
                    per template in the server-side decoder)
  - value_head:    PPO critic baseline
  - log_std:       learnable per-param std for exploration noise

All shapes derive from the generated schema, so a schema bump changes the
network width without any edit here.
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

# Bounds on the learned exploration noise.
#
# The upper bound used to be 2 (std ~7.4). Combined with an entropy bonus
# measured on the PRE-sigmoid Gaussian, that was a standing incentive to widen
# the distribution — and a wide Gaussian squashed through a sigmoid piles its
# mass on the range ENDPOINTS. The result is anti-exploration in factor space:
# waves collapse to min/max count and min/max HP instead of covering the range,
# which is the opposite of the "varied waves" goal. Capping at 0 keeps std <= 1,
# where the sigmoid still spreads mass across the interior.
LOG_STD_MIN = -3.0
LOG_STD_MAX = 0.0
LOG_STD_INIT = -0.5
from config import (
    NUM_SCALAR,
    NUM_BINS,
    MAX_TEMPLATE_SLOTS,
    NUM_CONTINUOUS,
)


class WaveDirectorModel(nn.Module):
    """
    Architecture:
      - Spatial branch: Conv1D over the DPS profile (2 channels × NUM_BINS)
      - Scalar branch: dense layers over the scalar state features
      - Combined: merged → policy heads

    Input:  NUM_SCALAR + 2 * NUM_BINS features
    Output: template logits (MAX_TEMPLATE_SLOTS) + NUM_CONTINUOUS params + value
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
        # No dropout here, deliberately.
        #
        # Actions are sampled under model.eval() and the PPO update runs under
        # model.train(), so dropout made the ratio pi_new/pi_old compare a
        # dropped-out network against a full one. Most of the measured
        # divergence was then sampling noise rather than actual policy change:
        # approx-KL sat at 0.14-0.24 against a 0.02 target and would not respond
        # to a 3x smaller learning rate or a doubled minibatch, because neither
        # touches the real cause. With the stop firing on the first minibatch of
        # every update, three quarters of each batch was being discarded over an
        # artefact.
        #
        # Dropout also breaks PPO's on-policy assumption more generally: the
        # behaviour policy that collected the data is not the distribution the
        # ratio is evaluated against. Reference PPO implementations do not use
        # it, and the LayerNorms already regularise this network.
        self.combined = nn.Sequential(
            nn.Linear(160, 192),
            nn.LayerNorm(192),
            nn.ReLU(),
            nn.Linear(192, 96),
            nn.LayerNorm(96),
            nn.ReLU(),
        )

        # Output heads
        self.template_head = nn.Linear(96, MAX_TEMPLATE_SLOTS)
        self.params_head = nn.Linear(96, NUM_CONTINUOUS)
        # Initialised below the upper clamp. At exactly LOG_STD_MAX a single
        # optimiser step past the bound leaves the parameter in the flat region
        # of `clamp`, where its gradient is zero — std would pin at 1.0 with no
        # way back and exploration could never anneal.
        self.log_std = nn.Parameter(torch.full((NUM_CONTINUOUS,), LOG_STD_INIT))
        self.value_head = nn.Linear(96, 1)

    def forward(self, x):
        """Forward pass returning policy logits/params and value."""
        scalars = x[:, :NUM_SCALAR]                  # (batch, NUM_SCALAR)
        spatial = x[:, NUM_SCALAR:]                  # (batch, 2 * NUM_BINS)
        spatial = spatial.view(-1, 2, NUM_BINS)      # (batch, 2, NUM_BINS)

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

        # Continuous Gaussian over the NUM_CONTINUOUS raw params
        means = params[:, :NUM_CONTINUOUS]
        std = torch.exp(torch.clamp(self.log_std, LOG_STD_MIN, LOG_STD_MAX)).unsqueeze(0).expand_as(means)

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
            + 2 * torch.clamp(self.log_std, LOG_STD_MIN, LOG_STD_MAX).unsqueeze(0)
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
        std = torch.exp(torch.clamp(self.log_std, LOG_STD_MIN, LOG_STD_MAX)).unsqueeze(0).expand_as(means)

        actions = stored_actions if stored_actions is not None else means

        log_prob_cont = -0.5 * (
            ((actions - means) / (std + 1e-8)) ** 2
            + 2 * torch.clamp(self.log_std, LOG_STD_MIN, LOG_STD_MAX).unsqueeze(0)
            + 1.8379
        )
        log_prob_cont = log_prob_cont.sum(dim=-1)

        log_prob = log_prob_cat + log_prob_cont

        # Entropy bonus on the TEMPLATE head only.
        #
        # The continuous term used to be the Gaussian's entropy in pre-sigmoid
        # space, which is state-independent — literally a bonus for a larger
        # log_std. Maximising it widened the Gaussian, and a wide Gaussian
        # through a sigmoid concentrates mass at the range endpoints, so waves
        # drifted toward min/max count and min/max HP. Exploration on the
        # continuous factors now comes from the clamped log_std alone.
        entropy_cat = cat_dist.entropy()

        return log_prob, value.squeeze(-1), entropy_cat


def create_model():
    """Create and initialize a fresh model."""
    return WaveDirectorModel()


# Checkpoint format marker. v1 was a bare state_dict with no training state;
# v2 wraps weights together with the optimizer and reward-normaliser state so a
# restart resumes instead of silently re-warming Adam from zero.
CHECKPOINT_FORMAT = 2


def save_model(model, path, *, episode=None, trainer_state=None, schema_version=None):
    """Save a checkpoint.

    Weights alone are not enough to resume: the Adam moments and the running
    reward mean/var are part of the learning state. Keeping them out of the
    file made every server restart a small regression.
    """
    torch.save(
        {
            "format": CHECKPOINT_FORMAT,
            "schema_version": schema_version,
            "episode": episode,
            "model": model.state_dict(),
            "trainer": trainer_state,
        },
        path,
    )


def load_model(path):
    """Load a checkpoint. Returns (model, episode, trainer_state).

    Accepts the legacy v1 bare-state_dict format so old checkpoints stay
    loadable, in which case there is no episode or trainer state to recover.
    """
    blob = torch.load(path, map_location="cpu", weights_only=False)
    model = create_model()

    if isinstance(blob, dict) and "model" in blob:
        model.load_state_dict(blob["model"])
        model.eval()
        return model, blob.get("episode"), blob.get("trainer")

    # Legacy: the whole file is the state_dict.
    model.load_state_dict(blob)
    model.eval()
    return model, None, None
