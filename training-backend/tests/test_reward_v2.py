"""reward.py — v4 reward sanity checks.

Most of these pin the *shape* of the reward landscape rather than exact
numbers, because the landscape is what kept getting exploited: the terms are
only meaningful relative to each other.

The v4 tests fall into three groups:

  - the old exploits must stay dead (drip-feeding mass, overflow farming,
    bleeding the player out and cashing in the death),
  - the v3 failure must not be reproducible (an unreachable target band, and a
    landscape flat enough that doing nothing is the best available move),
  - the new terms must be reachable at every wave number, which is exactly what
    v3's quantised damage band stopped being from wave 51.

Run:  venv/Scripts/python.exe -m pytest tests/ -q
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (  # noqa: E402
    GAMMA,
    NEAR_MISS_TARGET,
    TARGET_RUN_WAVES,
)
from reward import calculate_reward, hp_target  # noqa: E402


def wave(near_miss=0.0, progress=0.3, count=100, survived=True, hp_after=None,
         wave_number=10):
    """A wave result, defaulting `hp_after` to whatever the curve wants.

    Defaulting to on-curve keeps the PACING term out of the way of tests that
    are about DRAMA, and vice versa.
    """
    if hp_after is None:
        hp_after = hp_target(wave_number)
    return calculate_reward(
        {
            "nearMissRatio": near_miss,
            "avgProgress": progress,
            "totalCount": count,
            "survived": survived,
            "hpAfter": hp_after,
        },
        {"wave_number": wave_number},
    )


class TestRewardShape(unittest.TestCase):
    def test_breakdown_has_exactly_4_keys(self):
        _, bd = wave(near_miss=NEAR_MISS_TARGET)
        self.assertEqual(set(bd.keys()), {"death", "drama", "pacing", "swarm_size"})

    def test_a_near_miss_wave_on_curve_is_clearly_positive(self):
        total, _ = wave(near_miss=NEAR_MISS_TARGET, progress=0.5, count=200)
        self.assertGreater(total, 0.5)

    def test_doing_nothing_is_negative(self):
        """The v3 failure mode, stated as a test.

        Under v3 a wave that killed everything early scored -0.08, and that was
        the best guaranteed option on the board — better than reaching for a
        band that could not be hit. Four clients converged on it and one ran a
        133-wave streak without costing the player a single HP. Sending a
        harmless wave has to be worse than sending a real one.
        """
        nothing, _ = wave(near_miss=0.0, progress=0.08, count=200)
        real, _ = wave(near_miss=NEAR_MISS_TARGET, progress=0.5, count=200)
        self.assertLess(nothing, 0.0)
        self.assertGreater(real, nothing + 0.8)

    def test_every_wave_carries_a_gradient(self):
        """v3's step functions returned identical values across whole regions.

        A policy cannot learn from a signal that does not move when the action
        moves. Walking the near-miss ratio up toward the target must strictly
        improve the score at every step.
        """
        scores = [wave(near_miss=nm, count=200)[0]
                  for nm in (0.0, 0.05, 0.10, 0.15, 0.20, NEAR_MISS_TARGET)]
        for earlier, later in zip(scores, scores[1:]):
            self.assertLess(earlier, later)


class TestReachability(unittest.TestCase):
    """v3's band was unreachable past wave 51. v4's target must not be."""

    def test_the_drama_target_is_reachable_at_every_wave(self):
        for wave_number in (1, 25, 51, 80, 99):
            total, bd = wave(near_miss=NEAR_MISS_TARGET, progress=0.5,
                             count=200, wave_number=wave_number)
            self.assertGreater(bd["drama"], 0.9,
                               f"drama unreachable at wave {wave_number}")

    def test_being_on_the_curve_is_free_at_every_wave(self):
        """Pacing is a penalty for drifting, so on-curve costs nothing.

        This is the property the quantised damage band lost: from wave 51 a
        single leak was 6% against a 1-5% window, so no achievable amount of
        damage satisfied it and the terms gated on it were dead weight.
        """
        for wave_number in (1, 25, 51, 80, 99):
            _, bd = wave(near_miss=0.0, count=200, wave_number=wave_number,
                         hp_after=hp_target(wave_number))
            self.assertAlmostEqual(bd["pacing"], 0.0, places=4,
                                   msg=f"on-curve should be free at wave {wave_number}")

    def test_drifting_off_the_curve_costs_more_the_further_it_drifts(self):
        wave_number = 40
        on_curve = wave(count=200, wave_number=wave_number,
                        hp_after=hp_target(wave_number))[1]["pacing"]
        drifted = wave(count=200, wave_number=wave_number,
                       hp_after=hp_target(wave_number) + 0.20)[1]["pacing"]
        far = wave(count=200, wave_number=wave_number,
                   hp_after=1.0)[1]["pacing"]
        self.assertGreater(on_curve, drifted)
        self.assertGreater(drifted, far)

    def test_an_untouched_player_late_in_the_run_scores_badly(self):
        """Measured reality: a client sat at 100% HP on wave 92.

        Under v3 that was the optimum. Under v4 it has to be the worst place on
        the pacing curve, so that every point of damage is an improvement and
        the gradient points at attacking.
        """
        _, healthy = wave(near_miss=0.0, count=200, wave_number=92, hp_after=1.0)
        _, on_curve = wave(near_miss=0.0, count=200, wave_number=60,
                           hp_after=hp_target(60))
        self.assertLess(healthy["pacing"], -0.55)
        self.assertGreater(on_curve["pacing"], healthy["pacing"] + 0.5)


class TestExploitsStayDead(unittest.TestCase):
    def test_drip_fed_mass_that_dies_early_pays_nothing(self):
        """The safe farm: 1350 weak enemies that all die at 20% of the path.

        Zero risk, and under an earlier revision it collected the full swarm
        bonus every wave.
        """
        total, bd = wave(near_miss=0.0, progress=0.20, count=1350)
        self.assertEqual(bd["swarm_size"], 0.0)
        self.assertLess(bd["drama"], 0.0)

    def test_overflow_is_punished_however_large(self):
        """2000 enemies that all reach the base scored +4.67 swarm once."""
        total, bd = wave(near_miss=1.0, progress=0.99, count=2000)
        self.assertLess(bd["drama"], 0.0)
        self.assertEqual(bd["swarm_size"], 0.0)
        self.assertLess(total, 0.0)

    def test_a_tiny_wave_cannot_farm_the_ratio(self):
        """`near_miss_ratio` is scale-free: 1 leaker out of 4 reads as 0.25.

        Without damping, four enemies would score as well as two hundred.
        """
        _, tiny = wave(near_miss=NEAR_MISS_TARGET, count=4)
        _, real = wave(near_miss=NEAR_MISS_TARGET, count=200)
        self.assertLess(tiny["drama"], real["drama"] * 0.5)

    def test_damping_does_not_make_tiny_waves_a_cheap_escape(self):
        """Scaling must not pull a *penalty* toward zero.

        If it did, the cheapest way to avoid the boring-wave penalty would be
        to send almost nothing — reintroducing the collapse from the other end.
        """
        _, tiny = wave(near_miss=0.0, progress=0.1, count=4)
        _, big = wave(near_miss=0.0, progress=0.1, count=200)
        self.assertLessEqual(tiny["drama"], big["drama"])
        self.assertLess(tiny["drama"], 0.0)

    def test_swarm_never_dominates_drama(self):
        """Size is a tiebreaker inside the envelope, not the objective."""
        _, bd = wave(near_miss=NEAR_MISS_TARGET, count=5000)
        self.assertLess(bd["swarm_size"], bd["drama"])

    def test_death_outweighs_the_run_that_led_to_it(self):
        """Bleed the player out, then cash in — the objective-inverting exploit.

        With discounting the death only has to outweigh the waves inside the
        effective horizon, 1/(1-GAMMA) waves back, not the entire run.
        """
        good_wave, _ = wave(near_miss=NEAR_MISS_TARGET, progress=0.5,
                            count=200, wave_number=15)
        _, death = wave(near_miss=1.0, progress=1.0, count=200, survived=False,
                        hp_after=0.0, wave_number=30)
        horizon = 1.0 / (1.0 - GAMMA)
        self.assertLess(death["death"], -good_wave * horizon,
                        "a death must cost more than the waves that set it up")


class TestDeathCurve(unittest.TestCase):
    def test_an_early_death_is_far_worse_than_a_late_one(self):
        _, early = wave(survived=False, hp_after=0.0, wave_number=5)
        _, late = wave(survived=False, hp_after=0.0, wave_number=60)
        self.assertLess(early["death"], late["death"])

    def test_reaching_the_target_run_length_costs_nothing(self):
        """The run is supposed to end.

        v3 punished dying at -15..-30 regardless of when, while its own
        per-wave optimum guaranteed death inside 100 waves. Ending on schedule
        has to be free or the reward contradicts itself again.
        """
        _, on_time = wave(survived=False, hp_after=0.0,
                          wave_number=TARGET_RUN_WAVES)
        self.assertEqual(on_time["death"], 0.0)

    def test_surviving_costs_nothing(self):
        _, bd = wave(survived=True)
        self.assertEqual(bd["death"], 0.0)


class TestHpCurve(unittest.TestCase):
    def test_the_curve_runs_from_full_to_empty(self):
        self.assertAlmostEqual(hp_target(0), 1.0)
        self.assertAlmostEqual(hp_target(TARGET_RUN_WAVES), 0.0)

    def test_the_curve_never_goes_negative(self):
        self.assertEqual(hp_target(TARGET_RUN_WAVES * 2), 0.0)

    def test_the_curve_asks_for_a_sustainable_rate(self):
        """~1.25 HP per wave at 100 HP over 80 waves.

        The number that matters: past wave 51 a leak costs 6 HP, so this is one
        leak every four to five waves. Coarse, but steerable through count and
        spawn delay — unlike v3, which asked for a per-wave amount that no
        number of leaks could produce.
        """
        per_wave = (hp_target(0) - hp_target(TARGET_RUN_WAVES)) / TARGET_RUN_WAVES
        self.assertGreater(per_wave * 100, 0.5)
        self.assertLess(per_wave * 100, 3.0)


if __name__ == "__main__":
    unittest.main()
