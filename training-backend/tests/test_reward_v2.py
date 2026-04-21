"""Phase 5.10 reward.py — 4-term reward sanity checks."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

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

    def test_mega_swarm_dominates_reward(self):
        # Mega-swarm with sweet damage & near-miss progress — should reward strongly.
        total, bd = calculate_reward(
            {"damagePercent": 0.04, "totalCount": 2000, "survived": True, "avgProgress": 0.80},
            {"wave_number": 30},
        )
        self.assertGreater(bd["swarm_size"], 3.0)
        self.assertGreater(total, 5.0)

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
        # Cap -3.5, early-wave harshness scaling
        self.assertGreaterEqual(bd["death"], -3.5)

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
