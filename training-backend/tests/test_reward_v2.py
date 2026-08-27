"""reward.py — 4-term reward sanity checks.

Several of these pin the *shape* of the reward landscape rather than exact
numbers, because the landscape is what kept getting exploited: the terms are
only meaningful relative to each other.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import GAMMA, REWARD_GAME_OVER_CAP
from reward import calculate_reward


class TestReward(unittest.TestCase):
    def test_breakdown_has_exactly_4_keys(self):
        _, bd = calculate_reward(
            {"damagePercent": 0.05, "totalCount": 50, "survived": True, "avgProgress": 0.75},
            {"wave_number": 5},
        )
        self.assertEqual(set(bd.keys()), {"death", "drama", "swarm_size", "progression"})

    def test_sweet_near_miss_wave_is_positive(self):
        total, _ = calculate_reward(
            {"damagePercent": 0.05, "totalCount": 100, "survived": True, "avgProgress": 0.75},
            {"wave_number": 10},
        )
        self.assertGreater(total, 0.5)

    def test_swarm_size_breaks_ties_but_does_not_dominate(self):
        """Size is a tiebreaker inside the drama envelope, not the objective.

        The cap used to be 2.0 — five times the sweet-damage peak (+0.4) — so
        the net optimised for size and treated the damage band as incidental.
        """
        total, bd = calculate_reward(
            {"damagePercent": 0.04, "totalCount": 2000, "survived": True, "avgProgress": 0.80},
            {"wave_number": 30},
        )
        self.assertGreater(bd["swarm_size"], 0)
        self.assertLessEqual(bd["swarm_size"], bd["drama"],
                             "swarm must not outweigh the drama it is supposed to garnish")
        self.assertGreater(total, 1.0)

    def test_death_penalty_applied(self):
        total, bd = calculate_reward(
            {"damagePercent": 1.0, "totalCount": 50, "survived": False, "avgProgress": 1.0},
            {"wave_number": 8},
        )
        self.assertLess(bd["death"], 0)
        # Cap is -3.5, so total with drama/swarm can still end up below -3
        self.assertLess(total, -2.0)

    def test_death_penalty_capped(self):
        _, bd = calculate_reward(
            {"damagePercent": 1.0, "totalCount": 1, "survived": False, "avgProgress": 0.5},
            {"wave_number": 1},
        )
        self.assertGreaterEqual(bd["death"], REWARD_GAME_OVER_CAP)

    def test_death_outweighs_the_run_that_led_to_it(self):
        """The exploit that inverted the whole objective.

        The player never heals, so a policy that takes the per-wave optimum
        (1-5% HP) every wave kills them in ~33 waves by construction. With the
        old -3.5 cap, thirty good waves plus one death was a large net profit,
        so "bleed them out and finish them" beat any sustainable policy.
        """
        good_wave, _ = calculate_reward(
            {"damagePercent": 0.03, "totalCount": 200, "survived": True, "avgProgress": 0.80},
            {"wave_number": 15},
        )
        _, death = calculate_reward(
            {"damagePercent": 0.5, "totalCount": 200, "survived": False, "avgProgress": 1.0},
            {"wave_number": 30},
        )
        # With discounting the death only has to outweigh the waves inside the
        # effective horizon, 1/(1-GAMMA) waves back — not the entire run.
        horizon = 1.0 / (1.0 - GAMMA)
        self.assertLess(death["death"], -good_wave * horizon,
                        "a death must cost more than the waves that set it up")

    def test_swarm_pays_nothing_without_real_damage(self):
        """The safe-farm exploit: mass that dies harmlessly early on the path."""
        _, bd = calculate_reward(
            {"damagePercent": 0.0, "totalCount": 1350, "survived": True, "avgProgress": 0.25},
            {"wave_number": 20},
        )
        self.assertEqual(bd["swarm_size"], 0.0)
        self.assertEqual(bd["progression"], 0.0)

    def test_grinding_damage_earns_no_progression(self):
        """15% HP a wave kills the player in ~7 waves; it must not pay."""
        _, bd = calculate_reward(
            {"damagePercent": 0.15, "totalCount": 300, "survived": True, "avgProgress": 0.80},
            {"wave_number": 20},
        )
        self.assertEqual(bd["progression"], 0.0)
        self.assertEqual(bd["swarm_size"], 0.0)

    def test_boring_wave_near_zero(self):
        total, _ = calculate_reward(
            {"damagePercent": 0.0, "totalCount": 10, "survived": True, "avgProgress": 0.30},
            {"wave_number": 5},
        )
        # Small wave below threshold → mild penalty
        self.assertLess(total, 0.2)
        self.assertGreater(total, -0.5)

    def test_progression_gated_on_minimum_damage(self):
        # Zero damage → no progression credit even if survived
        _, bd_zero = calculate_reward(
            {"damagePercent": 0.0, "totalCount": 50, "survived": True, "avgProgress": 0.7},
            {"wave_number": 20},
        )
        self.assertEqual(bd_zero["progression"], 0.0)

        # Sweet damage → progression credit
        _, bd_sweet = calculate_reward(
            {"damagePercent": 0.05, "totalCount": 50, "survived": True, "avgProgress": 0.7},
            {"wave_number": 20},
        )
        self.assertGreater(bd_sweet["progression"], 0)

    def test_overflow_penalty(self):
        # avg_progress > 0.95 means enemies reached the base
        _, bd = calculate_reward(
            {"damagePercent": 0.05, "totalCount": 50, "survived": True, "avgProgress": 0.98},
            {"wave_number": 10},
        )
        # Drama includes overflow penalty
        self.assertLess(bd["drama"], 0.5)


if __name__ == "__main__":
    unittest.main()
