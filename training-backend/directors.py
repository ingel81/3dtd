"""Wave directors — interchangeable strategies for choosing the next wave.

The point of this module is a MEASUREMENT that has never been taken: is the
learned policy better than not learning at all?

Every wave the training server ships is produced by a policy network, and the
reward function that steers it has been rewritten several times against metrics
that turned out to be unreachable. What was never established is a baseline. A
run of 1400 episodes ended with `log_std` at -0.5001 against an initial -0.5 and
all four factor means sitting on sigmoid(0) = 0.5 — statistically the policy was
still its own initialisation, and every improvement measured that day came from
deterministic code (a missing state reset, a corrected control signal), not from
learning. Without something to compare against, there is no way to tell whether
that is a problem or simply what the task looks like.

Each director takes the same inputs and returns the same action dict the model
returns, so they are drop-in substitutes at the one call site in the server.
Run them side by side across clients and the comparison is direct: same bots,
same curriculum, same fairness gate, same metrics.

  model    the policy network (status quo)
  random   uniform over whatever the mask allows, uniform factors — the honest
           floor. Anything that cannot beat this is not earning its keep.
  rules    least-recently-used template, factors from a fixed heuristic
  maxgate  random template, but always as large as the fairness gate permits —
           isolates whether sizing alone carries the difficulty
"""

import random

import torch

from config import NUM_CONTINUOUS, MAX_TEMPLATE_SLOTS


def _as_action(template_idx: int, factors) -> dict:
    """Wrap plain numbers in the tensor shapes the decoder expects.

    `raw_params` stays None: it only exists so PPO can re-evaluate its own
    samples, and a non-model director has no Gaussian behind its factors. The
    server must not store these as training experience — see `is_learner`.
    """
    f = [float(max(0.0, min(1.0, x))) for x in factors]
    idx = int(template_idx)
    # One-hot: the decoder reads a confidence out of this, and a director that
    # simply decided has probability 1 on its choice. Passing None here made
    # _decode_action raise on every wave, and the client fell back to a
    # 10-enemy default — which is what an A/B run of "always exactly 10 enemies,
    # one template" turned out to be measuring.
    probs = torch.zeros((1, MAX_TEMPLATE_SLOTS))
    probs[0, idx] = 1.0
    return {
        "template_idx": torch.tensor([idx]),
        "count_factor": torch.tensor([f[0]]),
        "spawn_factor": torch.tensor([f[1]]),
        "hp_factor": torch.tensor([f[2]]),
        "variation_factor": torch.tensor([f[3]]),
        "raw_params": None,
        "template_probs": probs,
    }


def _allowed(mask_list) -> list:
    return [i for i, ok in enumerate(mask_list) if ok]


class Director:
    """Base: a named strategy for picking the next wave."""

    name = "base"
    is_learner = False

    def act(self, state, wave_context, mask_list, ctx):
        raise NotImplementedError


class RandomDirector(Director):
    """Uniform over the allowed templates, uniform factors.

    The floor for every other director. Note this is NOT a weak opponent: the
    mask already encodes the curriculum, capability gates and boss cadence, and
    the fairness gate still caps the size afterwards. It is "no intelligence on
    top of the existing constraints", which is exactly the baseline in question.
    """

    name = "random"

    def act(self, state, wave_context, mask_list, ctx):
        allowed = _allowed(mask_list)
        idx = random.choice(allowed) if allowed else 0
        return _as_action(idx, [random.random() for _ in range(NUM_CONTINUOUS)])


class MaxGateDirector(Director):
    """Random template, always as big as the gate allows.

    Isolates one question: how much of the difficulty is carried by SIZE alone?
    count_factor is pinned high, so the fairness gate — not the director — sets
    the wave size every single time. If this scores as well as anything else,
    the interesting decisions are not in the factors.
    """

    name = "maxgate"

    def act(self, state, wave_context, mask_list, ctx):
        allowed = _allowed(mask_list)
        idx = random.choice(allowed) if allowed else 0
        # Spawn delay low (dense), HP moderate: the point is to vary SIZE only.
        return _as_action(idx, [1.0, 0.25, 0.5, random.random()])


class RuleDirector(Director):
    """Least-recently-used template, factors from a fixed ramp.

    Two deliberate choices:

    - Variety is ENFORCED rather than rewarded. The reward function has a
      variation factor and a template-cooldown mask, and waves still came out
      repetitive; picking the stalest allowed template makes repetition
      impossible instead of merely expensive.
    - Difficulty ramps with the wave number rather than being chosen per wave.
      The player's HP is a whole-run budget, so difficulty is a curve, and a
      curve is a thing you write down, not a thing you infer from a per-wave
      scalar reward.
    """

    name = "rules"

    def act(self, state, wave_context, mask_list, ctx):
        allowed = _allowed(mask_list)
        if not allowed:
            return _as_action(0, [0.6, 0.4, 0.5, 0.5])

        recent = list(getattr(ctx, "recent_template_indices", []) or [])
        # Stalest first: position from the end of the recent list, unseen = oldest.
        def staleness(i):
            return recent[::-1].index(i) if i in recent else len(recent) + 1
        best = max(staleness(i) for i in allowed)
        idx = random.choice([i for i in allowed if staleness(i) == best])

        wave_num = int((state or {}).get("waveNumber", 0) or 0) + 1
        # Ramp to full difficulty around the target run length, then hold.
        ramp = min(1.0, wave_num / 60.0)

        jitter = lambda v, w=0.12: v + random.uniform(-w, w)
        return _as_action(idx, [
            jitter(0.45 + 0.40 * ramp),   # count: grows through the run
            jitter(0.55 - 0.25 * ramp),   # spawn delay: tightens
            jitter(0.40 + 0.35 * ramp),   # hp: grows
            jitter(0.60),                 # variation: steady mix
        ])


class ModelDirector(Director):
    """The policy network. Delegates to the server's existing sampling path."""

    name = "model"
    is_learner = True

    def act(self, state, wave_context, mask_list, ctx):
        raise NotImplementedError("handled inline by the server")


REGISTRY = {
    d.name: d for d in (RandomDirector(), MaxGateDirector(), RuleDirector())
}
REGISTRY["model"] = ModelDirector()


def get_director(name: str) -> Director:
    return REGISTRY.get(name, REGISTRY["model"])
