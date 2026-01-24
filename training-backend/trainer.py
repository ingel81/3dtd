"""
PPO Trainer

Proximal Policy Optimization trainer for the Wave Director.
"""

import torch
import torch.nn as nn
import torch.optim as optim
from collections import deque

from config import (
    LEARNING_RATE,
    GAMMA,
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

    def store_action(self, client_id, wave_num, state_tensor, action_tensor=None, enemy_idx=None, log_prob=None):
        """Store a pending state+action+log_prob for a client+wave (awaiting reward)."""
        self.pending[(client_id, wave_num)] = (
            state_tensor.detach(),
            action_tensor.detach() if action_tensor is not None else None,
            enemy_idx.detach() if enemy_idx is not None else None,
            log_prob.detach() if log_prob is not None else None,
        )

    def store_result(self, client_id, wave_num, reward):
        """Pair reward with the pending state for this client+wave."""
        self.reward_history.append(reward)

        pending = self.pending.pop((client_id, wave_num), None)
        if pending is None:
            return  # No matching state (wave result without prior state request)

        state, action, enemy_idx, old_log_prob = pending
        self.transitions.append((state, action, enemy_idx, old_log_prob, reward))

        # Update when we have enough paired samples
        if len(self.transitions) >= BATCH_SIZE:
            self._update()

    def _update(self):
        """Perform PPO update with clipped surrogate objective."""
        if len(self.transitions) < BATCH_SIZE:
            return

        batch = self.transitions[-BATCH_SIZE:]

        # Unpack paired transitions
        states_list = []
        actions_list = []
        enemy_idx_list = []
        old_log_probs_list = []
        rewards_list = []
        for state, action, enemy_idx, old_log_prob, reward in batch:
            states_list.append(state)
            actions_list.append(action)
            enemy_idx_list.append(enemy_idx)
            old_log_probs_list.append(old_log_prob)
            rewards_list.append(reward)

        try:
            states_batch = torch.stack(states_list)
            actions_batch = torch.stack(actions_list) if actions_list[0] is not None else None
            enemy_idx_batch = torch.stack(enemy_idx_list) if enemy_idx_list[0] is not None else None
            old_log_probs_batch = torch.stack(old_log_probs_list) if old_log_probs_list[0] is not None else None
        except Exception as e:
            print(f"[Trainer] Failed to stack: {e}")
            self.transitions = []
            return

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
            # Re-evaluate actions under current policy
            log_probs, values, entropy = self.model.evaluate_action(
                states_batch, actions_batch, stored_enemy_idx=enemy_idx_batch
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

        # Clear processed transitions
        self.transitions = []

    def get_avg_reward(self):
        """Get average reward from recent episodes."""
        if not self.reward_history:
            return 0
        return sum(self.reward_history) / len(self.reward_history)


class ExperienceBuffer:
    """Buffer for storing training experiences."""

    def __init__(self, max_size=10000):
        self.max_size = max_size
        self.buffer = deque(maxlen=max_size)

    def add(self, state, action, reward, next_state, done):
        """Add experience to buffer."""
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size):
        """Sample random batch from buffer."""
        import random
        batch = random.sample(self.buffer, min(batch_size, len(self.buffer)))
        states, actions, rewards, next_states, dones = zip(*batch)
        return (
            torch.stack(states),
            torch.stack(actions),
            torch.tensor(rewards),
            torch.stack(next_states),
            torch.tensor(dones),
        )

    def __len__(self):
        return len(self.buffer)
