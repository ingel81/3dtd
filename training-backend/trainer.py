"""
PPO Trainer

Proximal Policy Optimization trainer for the Wave Director.
"""

import torch
import torch.optim as optim
from collections import deque

from config import (
    LEARNING_RATE,
    CLIP_EPSILON,
    ENTROPY_COEF,
    VALUE_COEF,
    BATCH_SIZE,
    UPDATE_EPOCHS,
)
from auto_logger import logger


class PPOTrainer:
    """
    PPO Trainer for Wave Director.

    Proper Proximal Policy Optimization with:
    - Clipped surrogate objective
    - Multiple epochs per batch
    - Value baseline for advantage estimation
    """

    def __init__(self, model, dashboard=None):
        self.model = model
        self.dashboard = dashboard
        self.optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)

        # Paired transitions: (state, action, enemy_idx, old_log_prob, reward)
        self.transitions = []

        # Pending states waiting for their reward (keyed by (client_id, wave_num))
        self.pending = {}

        # Running statistics
        self.reward_history = deque(maxlen=100)

        # Reward normalization (running mean/std)
        self.reward_running_mean = 0.0
        self.reward_running_var = 1.0
        self.reward_count = 0

    def store_action(self, client_id, wave_num, state_tensor, action_tensor=None,
                     enemy_idx=None, log_prob=None, template_mask=None):
        """Store a pending state+action+log_prob+mask for a client+wave (awaiting reward)."""
        self.pending[(client_id, wave_num)] = (
            state_tensor.detach(),
            action_tensor.detach() if action_tensor is not None else None,
            enemy_idx.detach() if enemy_idx is not None else None,
            log_prob.detach() if log_prob is not None else None,
            template_mask.detach() if template_mask is not None else None,
        )

    def store_result(self, client_id, wave_num, reward):
        """Pair reward with the pending state for this client+wave."""
        self.reward_history.append(reward)

        pending = self.pending.pop((client_id, wave_num), None)
        if pending is None:
            return  # No matching state (wave result without prior state request)

        state, action, enemy_idx, old_log_prob, template_mask = pending
        self.transitions.append((state, action, enemy_idx, old_log_prob, reward, template_mask))

        # Drain the backlog: several clients can pair results in the same tick,
        # so a single store_result may complete more than one batch.
        while len(self.transitions) >= BATCH_SIZE:
            self._update()

    def _update(self):
        """Perform PPO update with clipped surrogate objective."""
        if len(self.transitions) < BATCH_SIZE:
            return

        # Consume the OLDEST BATCH_SIZE transitions and keep the rest for the
        # next update. This used to take the newest slice and then clear the
        # whole list, silently discarding every transition that arrived while a
        # batch was filling up.
        batch = self.transitions[:BATCH_SIZE]
        self.transitions = self.transitions[BATCH_SIZE:]

        # Unpack paired transitions
        states_list = []
        actions_list = []
        enemy_idx_list = []
        old_log_probs_list = []
        rewards_list = []
        template_mask_list = []
        for state, action, enemy_idx, old_log_prob, reward, template_mask in batch:
            states_list.append(state)
            actions_list.append(action)
            enemy_idx_list.append(enemy_idx)
            old_log_probs_list.append(old_log_prob)
            rewards_list.append(reward)
            template_mask_list.append(template_mask)

        try:
            states_batch = torch.stack(states_list)
            actions_batch = torch.stack(actions_list) if actions_list[0] is not None else None
            enemy_idx_batch = torch.stack(enemy_idx_list) if enemy_idx_list[0] is not None else None
            old_log_probs_batch = torch.stack(old_log_probs_list) if old_log_probs_list[0] is not None else None
            template_mask_batch = torch.stack(template_mask_list) if template_mask_list[0] is not None else None
        except Exception as e:
            logger.error(f"[Trainer] Failed to stack batch, dropping it: {e}")
            return

        # One wave is one self-contained decision whose reward is fully observed
        # when the wave ends — a contextual bandit, not a trajectory. So the
        # return IS the reward; there is nothing downstream to discount toward.
        returns = torch.tensor(rewards_list, dtype=torch.float32)

        # Update running reward statistics
        batch_mean = returns.mean().item()
        batch_var = returns.var().item() if len(returns) > 1 else 0.0
        batch_count = len(returns)
        # Welford's online update
        new_count = self.reward_count + batch_count
        delta = batch_mean - self.reward_running_mean
        self.reward_running_mean += delta * batch_count / max(1, new_count)
        self.reward_running_var = (self.reward_running_var * self.reward_count + batch_var * batch_count + delta**2 * self.reward_count * batch_count / max(1, new_count)) / max(1, new_count)
        self.reward_count = new_count

        # Normalize returns (stabilizes gradients)
        reward_std = max(self.reward_running_var ** 0.5, 0.1)
        returns = (returns - self.reward_running_mean) / reward_std

        # Set model to train mode for update
        self.model.train()

        # Multiple PPO epochs over same batch
        for epoch in range(UPDATE_EPOCHS):
            # Re-evaluate actions under current policy (apply same template mask)
            log_probs, values, entropy = self.model.evaluate_action(
                states_batch,
                actions_batch,
                stored_template_idx=enemy_idx_batch,
                template_mask=template_mask_batch,
            )

            # Advantage estimation with value baseline
            advantages = returns - values.detach()
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

            # PPO clipped surrogate objective
            if old_log_probs_batch is not None:
                ratio = torch.exp(log_probs - old_log_probs_batch)
                surr1 = ratio * advantages
                surr2 = torch.clamp(ratio, 1.0 - CLIP_EPSILON, 1.0 + CLIP_EPSILON) * advantages
                policy_loss = -torch.min(surr1, surr2).mean()
            else:
                # Fallback: vanilla policy gradient
                policy_loss = -(log_probs * advantages).mean()

            # Value loss (train the baseline)
            value_loss = VALUE_COEF * ((values - returns) ** 2).mean()
            # Entropy bonus for exploration
            entropy_loss = -ENTROPY_COEF * entropy.mean()

            total_loss = policy_loss + value_loss + entropy_loss

            self.optimizer.zero_grad()
            total_loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(self.model.parameters(), 0.5)
            self.optimizer.step()

        # Switch back to eval mode for inference
        self.model.eval()

        avg_reward = sum(rewards_list) / len(rewards_list)
        pl = policy_loss.item()
        ent = entropy.mean().item()
        gn = grad_norm.item() if hasattr(grad_norm, 'item') else float(grad_norm)

        logger.training_update(
            policy_loss=pl, entropy=ent,
            grad_norm=gn, batch_avg_reward=avg_reward,
        )

        if self.dashboard:
            self.dashboard.record_training_update(pl, ent, gn, avg_reward)

    def get_avg_reward(self):
        """Get average reward from recent episodes."""
        if not self.reward_history:
            return 0
        return sum(self.reward_history) / len(self.reward_history)

    def state_dict(self):
        """Optimizer + reward-normaliser state, for the checkpoint.

        Without this, every server restart reset the Adam moments and the
        running reward statistics to zero while keeping trained weights — the
        first updates after a resume were effectively un-normalised and had no
        momentum, which shows up as a reward dip after every restart.
        """
        return {
            "optimizer": self.optimizer.state_dict(),
            "reward_running_mean": self.reward_running_mean,
            "reward_running_var": self.reward_running_var,
            "reward_count": self.reward_count,
            "reward_history": list(self.reward_history),
        }

    def load_state_dict(self, state):
        """Restore optimizer + reward-normaliser state from a checkpoint."""
        if not state:
            return
        if "optimizer" in state:
            self.optimizer.load_state_dict(state["optimizer"])
        self.reward_running_mean = state.get("reward_running_mean", 0.0)
        self.reward_running_var = state.get("reward_running_var", 1.0)
        self.reward_count = state.get("reward_count", 0)
        self.reward_history = deque(state.get("reward_history", []), maxlen=100)
