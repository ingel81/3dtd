"""
PPO Trainer

Proximal Policy Optimization trainer for the Wave Director.
"""

import torch
import torch.optim as optim
from collections import deque

from config import (
    LEARNING_RATE,
    GAMMA,
    GAE_LAMBDA,
    CLIP_EPSILON,
    ENTROPY_COEF,
    VALUE_COEF,
    BATCH_SIZE,
    MINIBATCH_SIZE,
    UPDATE_EPOCHS,
    TARGET_KL,
    TRAJECTORY_FLUSH_LENGTH,
    REWARD_SCALE_WINDOW,
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

        # Transitions ready for an update, already carrying their computed
        # return and advantage.
        self.transitions = []

        # Per-client trajectories still being collected. Waves within a run are
        # NOT independent — the player never heals, so a wave that costs 3% HP
        # helps kill them twenty waves later. Keeping the ordering lets the
        # death cost flow back to the waves that set it up.
        self.trajectories = {}

        # Pending states waiting for their reward (keyed by (client_id, wave_num))
        self.pending = {}

        # Running statistics
        self.reward_history = deque(maxlen=100)

        # Running second moment of the reward, used to scale it at collection
        # time (see _scale_reward).
        self.reward_sq_sum = 0.0
        self.reward_count = 0

        # Diagnostics: pairs dropped because a result arrived with no matching
        # stored action. Silent loss here would destroy training invisibly.
        self.dropped_pairs = 0

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

    def store_result(self, client_id, wave_num, reward, done=False):
        """Pair a reward with its stored action and append to the trajectory.

        `done` marks the end of a run — the player died, or the episode hit its
        wave limit. On done the trajectory is closed out and converted into
        discounted returns and GAE advantages, which is what lets a death be
        charged to the waves that led to it.
        """
        self.reward_history.append(reward)

        pending = self.pending.pop((client_id, wave_num), None)
        if pending is None:
            self.dropped_pairs += 1
            # Still close the run. Returning early here left the trajectory open
            # forever: the death was never charged back to the waves that caused
            # it — the exact thing this machinery exists for — and the next
            # game's transitions were appended onto the dead one, eventually
            # chaining a wave-40 state to a wave-1 state inside one trajectory.
            if done:
                self._close_trajectory(client_id, bootstrap=False)
            return

        state, action, enemy_idx, old_log_prob, template_mask = pending
        self.trajectories.setdefault(client_id, []).append(
            (state, action, enemy_idx, old_log_prob, self._scale_reward(reward), template_mask)
        )

        if done:
            self._close_trajectory(client_id, bootstrap=False)
        elif len(self.trajectories[client_id]) > TRAJECTORY_FLUSH_LENGTH:
            # Long survivors would otherwise never contribute. Cut, but hold the
            # newest transition back: its state is the "next state" the flushed
            # tail needs to bootstrap against, and it seeds the next segment.
            self._close_trajectory(client_id, bootstrap=True, hold_back_last=True)

        while len(self.transitions) >= BATCH_SIZE:
            self._update()

    def _scale_reward(self, reward):
        """Put a raw reward into the unit everything downstream works in.

        Scale only, never centre: the reward distribution is non-stationary in
        three ways at once (the policy improves, the progression bonus grows
        with wave number, and curriculum waves differ from free-choice waves),
        so subtracting a lifetime mean flips a wave's sign based on an average
        that no longer describes it. Centring is the value baseline's job.

        Applied HERE rather than at update time because GAE mixes rewards and
        value estimates in the same expression. Scaling the returns afterwards
        while the critic had been trained on scaled targets left
        `delta = r_raw + gamma*V_scaled - V_scaled`, which for a large scale is
        almost exactly `r_raw` — the baseline subtracted nothing and the
        advantages degenerated into raw Monte-Carlo returns.
        """
        self.reward_sq_sum += reward * reward
        self.reward_count += 1
        # EMA-ish: a lifetime count would stop adapting to a moving reward.
        if self.reward_count > REWARD_SCALE_WINDOW:
            self.reward_sq_sum *= REWARD_SCALE_WINDOW / self.reward_count
            self.reward_count = REWARD_SCALE_WINDOW
        scale = max((self.reward_sq_sum / max(1, self.reward_count)) ** 0.5, 1e-3)
        return reward / scale

    def drop_client(self, client_id):
        """Flush whatever a disconnecting client had in flight."""
        if self.trajectories.get(client_id):
            self._close_trajectory(client_id, bootstrap=True)
        self.trajectories.pop(client_id, None)

    def _close_trajectory(self, client_id, bootstrap, hold_back_last=False):
        """Turn a finished trajectory into returns + GAE advantages.

        `bootstrap` distinguishes a cut from an ending: when the run really
        ended (death) there is no future value, so the terminal value is 0 and
        the death penalty propagates back undiluted. When we merely truncated a
        long survivor, the value head estimates what came next.

        `hold_back_last` keeps the newest transition out of the flush and leaves
        it as the seed of the next segment. Its state IS the next state of the
        flushed tail, which is what the bootstrap needs: using the value of the
        last *flushed* state instead makes the final delta
        `r + gamma*V(s_T) - V(s_T)`, a bias that the GAE recursion then spreads
        backwards over the whole segment.
        """
        traj = self.trajectories.pop(client_id, None)
        if not traj:
            return

        carry = None
        if hold_back_last and len(traj) > 1:
            carry = traj[-1]
            traj = traj[:-1]

        states = torch.stack([t[0] for t in traj])
        if carry is not None:
            states = torch.cat([states, carry[0].unsqueeze(0)])

        with torch.no_grad():
            self.model.eval()
            _, _, values = self.model(states)
            values = values.squeeze(-1)

        if carry is not None:
            next_value = values[-1].item()
            values = values[:-1]
        elif bootstrap:
            # No held-back state to bootstrap against (a disconnect, say).
            # V(s_T) is the best estimate available; note it is an approximation.
            next_value = values[-1].item()
        else:
            next_value = 0.0

        advantages = [0.0] * len(traj)
        gae = 0.0
        for i in reversed(range(len(traj))):
            reward = traj[i][4]
            # The last step of a bootstrapped cut continues; of a real ending
            # it does not.
            is_last = i == len(traj) - 1
            v_next = next_value if is_last else values[i + 1].item()
            non_terminal = 0.0 if (is_last and not bootstrap) else 1.0
            delta = reward + GAMMA * v_next * non_terminal - values[i].item()
            gae = delta + GAMMA * GAE_LAMBDA * non_terminal * gae
            advantages[i] = gae

        for i, step in enumerate(traj):
            state, action, enemy_idx, old_log_prob, reward, mask = step
            self.transitions.append(
                (state, action, enemy_idx, old_log_prob, reward,
                 mask, advantages[i] + values[i].item(), advantages[i])
            )

        if carry is not None:
            self.trajectories[client_id] = [carry]

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

        # Unpack. Returns and advantages were computed when the trajectory was
        # closed, so they already carry the discounted future — including the
        # death penalty charged back to the waves that set it up.
        states_list, actions_list, enemy_idx_list = [], [], []
        old_log_probs_list, rewards_list, template_mask_list = [], [], []
        returns_list, advantages_list = [], []
        for (state, action, enemy_idx, old_log_prob, reward,
             template_mask, ret, adv) in batch:
            states_list.append(state)
            actions_list.append(action)
            enemy_idx_list.append(enemy_idx)
            old_log_probs_list.append(old_log_prob)
            rewards_list.append(reward)
            template_mask_list.append(template_mask)
            returns_list.append(ret)
            advantages_list.append(adv)

        try:
            states_batch = torch.stack(states_list)
            actions_batch = torch.stack(actions_list) if actions_list[0] is not None else None
            enemy_idx_batch = torch.stack(enemy_idx_list) if enemy_idx_list[0] is not None else None
            old_log_probs_batch = torch.stack(old_log_probs_list) if old_log_probs_list[0] is not None else None
            template_mask_batch = torch.stack(template_mask_list) if template_mask_list[0] is not None else None
        except Exception as e:
            logger.error(f"[Trainer] Failed to stack batch, dropping it: {e}")
            return

        # Already in scaled units — the reward was normalised at collection time
        # so GAE, the returns and the value target all share one scale.
        returns = torch.tensor(returns_list, dtype=torch.float32)
        advantages = torch.tensor(advantages_list, dtype=torch.float32)

        # Standardise advantages ONCE, over the whole batch, before the epoch
        # loop. Recomputing them per epoch from freshly-updated values made the
        # policy chase a target that moved underneath it mid-update.
        advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        self.model.train()

        approx_kl = 0.0
        policy_loss = value_loss = entropy = None
        grad_norm = 0.0
        stop = False

        for epoch in range(UPDATE_EPOCHS):
            if stop:
                break
            # Reshuffle each epoch so minibatch composition varies.
            indices = torch.randperm(len(batch))
            epoch_kls = []
            for start_i in range(0, len(batch), MINIBATCH_SIZE):
                mb = indices[start_i:start_i + MINIBATCH_SIZE]
                if len(mb) < 2:
                    continue

                log_probs, values, entropy = self.model.evaluate_action(
                    states_batch[mb],
                    actions_batch[mb] if actions_batch is not None else None,
                    stored_template_idx=enemy_idx_batch[mb] if enemy_idx_batch is not None else None,
                    template_mask=template_mask_batch[mb] if template_mask_batch is not None else None,
                )

                mb_adv = advantages[mb]
                if old_log_probs_batch is not None:
                    log_ratio = log_probs - old_log_probs_batch[mb]
                    ratio = torch.exp(log_ratio)
                    surr1 = ratio * mb_adv
                    surr2 = torch.clamp(ratio, 1.0 - CLIP_EPSILON, 1.0 + CLIP_EPSILON) * mb_adv
                    policy_loss = -torch.min(surr1, surr2).mean()
                    # Schulman's low-variance KL estimator.
                    with torch.no_grad():
                        epoch_kls.append(float(((ratio - 1) - log_ratio).mean().item()))
                else:
                    policy_loss = -(log_probs * mb_adv).mean()

                value_loss = VALUE_COEF * ((values - returns[mb]) ** 2).mean()
                entropy_loss = -ENTROPY_COEF * entropy.mean()

                self.optimizer.zero_grad()
                (policy_loss + value_loss + entropy_loss).backward()
                grad_norm = torch.nn.utils.clip_grad_norm_(self.model.parameters(), 0.5)
                self.optimizer.step()

                # Check drift after EVERY minibatch, not once per epoch.
                #
                # Checking only at the epoch boundary let four unclipped
                # minibatch steps land before the stop could fire, and measured
                # approx-KL then sat at 0.19-0.24 against a 0.02 target on every
                # single update. The early stop was firing after epoch 1 every
                # time, so UPDATE_EPOCHS=4 was really 1 — the policy took four
                # oversized steps and then quit, instead of several small ones.
                # Averaged over the epoch so far rather than per minibatch: a
                # single 32-sample estimate is noisy enough to trigger
                # spuriously, but waiting a whole epoch overshoots.
                if epoch_kls:
                    approx_kl = sum(epoch_kls) / len(epoch_kls)
                    if approx_kl > TARGET_KL:
                        stop = True
                        break

        self.model.eval()

        avg_reward = sum(rewards_list) / len(rewards_list)
        pl = float(policy_loss.item()) if policy_loss is not None else 0.0
        ent = float(entropy.mean().item()) if entropy is not None else 0.0
        gn = grad_norm.item() if hasattr(grad_norm, "item") else float(grad_norm)

        logger.training_update(
            policy_loss=pl, entropy=ent,
            grad_norm=gn, batch_avg_reward=avg_reward,
        )

        if self.dashboard:
            self.dashboard.record_training_update(
                pl, ent, gn, avg_reward,
                approx_kl=approx_kl,
                log_std=float(self.model.log_std.mean().item()),
                dropped_pairs=self.dropped_pairs,
            )

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
            "reward_sq_sum": self.reward_sq_sum,
            "reward_count": self.reward_count,
            "reward_history": list(self.reward_history),
        }

    def load_state_dict(self, state):
        """Restore optimizer + reward-normaliser state from a checkpoint."""
        if not state:
            return
        if "optimizer" in state:
            self.optimizer.load_state_dict(state["optimizer"])
        self.reward_sq_sum = state.get("reward_sq_sum", 0.0)
        self.reward_count = state.get("reward_count", 0)
        self.reward_history = deque(state.get("reward_history", []), maxlen=100)
