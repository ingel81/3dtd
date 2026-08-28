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
    DRAMA_MIN_COUNT,
    DRAMA_FULL_COUNT,
    PACING_SIGMA,
    TARGET_RUN_WAVES,
)
from reward import calculate_reward, hp_target  # noqa: E402


def wave(near_miss=0.0, leak=0.0, count=100, survived=True, hp_after=None,
         damage=0.0, wave_number=10, progress=None):
    """A wave result, defaulting `hp_after` to whatever the curve wants.

    Defaulting to on-curve keeps the PACING term out of the way of tests that
    are about DRAMA, and vice versa. `progress` is accepted and ignored: the
    reward no longer reads mean path progress at all.
    """
    if hp_after is None:
        hp_after = hp_target(wave_number)
    return calculate_reward(
        {
            "nearMissRatio": near_miss,
            "leakRatio": leak,
            "totalCount": count,
            "survived": survived,
            "hpAfter": hp_after,
            "damagePercent": damage,
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

    def test_trying_beats_idling_even_when_some_enemies_leak(self):
        """The bimodality trap, stated as a test.

        A pure bell is still 14.5% of its peak at ratio 0, so a wave that
        threatened nothing scored -0.11 rather than the full -0.30. That made
        harmless waves cheaper than any attempt that risks a leak, and the
        policy oscillated between harmless and breach: 52.5% of waves parked in
        the idle band, 30% leaked heavily, and only 11.5% scored positive.

        A real attempt that leaks a little has to beat sending nothing.
        """
        _, idle = wave(near_miss=0.0, leak=0.0, count=200)
        _, tried = wave(near_miss=0.15, leak=0.10, count=200)
        self.assertGreater(tried["drama"], idle["drama"])
        self.assertGreater(tried["drama"], 0.0)

    def test_an_empty_wave_pays_the_full_idle_penalty(self):
        _, bd = wave(near_miss=0.0, leak=0.0, count=200)
        self.assertAlmostEqual(bd["drama"], -0.30, places=4)

    def test_every_step_toward_the_target_pays(self):
        """Monotone on the way up: no flat stretch to get stuck on."""
        steps = [NEAR_MISS_TARGET * f for f in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)]
        scores = [wave(near_miss=nm, count=200)[1]["drama"] for nm in steps]
        for earlier, later in zip(scores, scores[1:]):
            self.assertLess(earlier, later)

    def test_overshooting_the_target_falls_off(self):
        """Most of the horde at the gate is a breach forming, not more drama."""
        peak = wave(near_miss=NEAR_MISS_TARGET, count=200)[1]["drama"]
        over = wave(near_miss=0.6, count=200)[1]["drama"]
        self.assertLess(over, peak)

    def test_every_wave_carries_a_gradient(self):
        """v3's step functions returned identical values across whole regions.

        A policy cannot learn from a signal that does not move when the action
        moves. Walking the near-miss ratio up toward the target must strictly
        improve the score at every step.
        """
        steps = [NEAR_MISS_TARGET * f for f in (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)]
        scores = [wave(near_miss=nm, count=200)[0] for nm in steps]
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

    def test_pacing_keeps_a_gradient_far_from_the_curve(self):
        """The dead-term hole.

        A pure Gaussian is flat past about two sigma, so the term that steers
        run length became a constant tax carrying no gradient — measured at
        58.4% of waves pinned to exactly -0.60, and specifically the waves
        furthest off the curve, which are the ones that most need telling which
        way to move.
        """
        wave_number = 40
        target = hp_target(wave_number)
        far = [target + k * PACING_SIGMA for k in (1.5, 2.0, 2.5, 3.0)]
        scores = [wave(count=200, wave_number=wave_number, hp_after=min(1.0, hp))[1]["pacing"]
                  for hp in far]
        for earlier, later in zip(scores, scores[1:]):
            self.assertLess(later, earlier,
                            "pacing must keep discriminating beyond 2 sigma")

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
        total, bd = wave(near_miss=0.0, leak=0.0, count=1350)
        self.assertEqual(bd["swarm_size"], 0.0)
        self.assertLess(bd["drama"], 0.0)

    def test_a_full_breach_is_punished_however_large(self):
        """2000 enemies that all reach the base scored +4.67 swarm once."""
        total, bd = wave(near_miss=0.0, leak=1.0, count=2000, damage=0.9)
        self.assertLess(bd["drama"], 0.0)
        self.assertEqual(bd["swarm_size"], 0.0)
        self.assertLess(total, 0.0)

    def test_leaks_do_not_count_as_near_misses(self):
        """The hole both reviewers found independently.

        `near_miss_ratio` was `p > 0.80`, which includes p == 1.0. A wave where
        a quarter of 200 enemies walked into the base — fifty leaks, lethal
        several times over — produced the same ratio as one where a quarter
        died at 85% of the path, and scored the same full drama peak.
        """
        _, real = wave(near_miss=NEAR_MISS_TARGET, leak=0.0, count=200)
        _, breach = wave(near_miss=0.0, leak=NEAR_MISS_TARGET, count=200)
        self.assertGreater(real["drama"], 0.9)
        self.assertLess(breach["drama"], 0.0)

    def test_leaking_more_always_scores_worse(self):
        """Leaks are charged on their own slope, so the gradient is monotone."""
        scores = [wave(near_miss=NEAR_MISS_TARGET, leak=lk, count=200)[1]["drama"]
                  for lk in (0.0, 0.1, 0.25, 0.5, 1.0)]
        for earlier, later in zip(scores, scores[1:]):
            self.assertGreater(earlier, later)

    def test_a_wave_below_the_size_floor_earns_no_positive_drama(self):
        """The relocated exploit.

        sqrt-damping alone still paid +0.71 for five near-missers out of 21
        enemies, at no risk, and 48% of measured waves came in at 20 or fewer.
        """
        _, tiny = wave(near_miss=NEAR_MISS_TARGET, count=4)
        _, floor = wave(near_miss=NEAR_MISS_TARGET, count=DRAMA_MIN_COUNT - 1)
        self.assertLessEqual(tiny["drama"], 0.0)
        self.assertLessEqual(floor["drama"], 0.0)

    def test_size_credit_ramps_up_rather_than_jumping(self):
        span = DRAMA_FULL_COUNT - DRAMA_MIN_COUNT
        counts = sorted({DRAMA_MIN_COUNT + round(span * f) for f in (0.0, 0.25, 0.5, 0.75, 1.0)})
        scores = [wave(near_miss=NEAR_MISS_TARGET, count=c)[1]["drama"] for c in counts]
        for earlier, later in zip(scores, scores[1:]):
            self.assertLess(earlier, later)

    def test_a_late_wipe_is_still_punished(self):
        """The free-wipe hole.

        The shortfall term decays to -0.6 by wave 70 and -0.006 by wave 79, so
        deleting a healthy player in one wave was free exactly where the agent
        has the firepower to do it — the unfair wipe this design rules out.
        """
        _, graceful = wave(survived=False, hp_after=0.0, damage=0.05,
                           wave_number=75)
        _, wipe = wave(survived=False, hp_after=0.0, damage=0.60,
                       wave_number=75)
        self.assertLess(wipe["death"], graceful["death"] - 1.0)
        self.assertLess(wipe["death"], -1.0)

    def test_a_tiny_wave_cannot_farm_the_ratio(self):
        """`near_miss_ratio` is scale-free: 1 near-misser out of 4 reads as 0.25.

        Without a floor, four enemies would score as well as two hundred.
        """
        _, tiny = wave(near_miss=NEAR_MISS_TARGET, count=4)
        _, real = wave(near_miss=NEAR_MISS_TARGET, count=200)
        self.assertLess(tiny["drama"], real["drama"] * 0.5)

    def test_damping_does_not_make_tiny_waves_a_cheap_escape(self):
        """Scaling must not pull a *penalty* toward zero.

        If it did, the cheapest way to avoid the boring-wave penalty would be
        to send almost nothing — reintroducing the collapse from the other end.
        """
        _, tiny = wave(near_miss=0.0, count=4)
        _, big = wave(near_miss=0.0, count=200)
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
                        hp_after=0.0, wave_number=15)
        # The run that sets up a death is finite, so the yardstick is the
        # discounted sum of the ten waves inside the horizon, not the infinite
        # series 1/(1-GAMMA). Using the infinite one forced REWARD_DEATH_MAX so
        # high that deaths dominated the reward scaler and drowned out every
        # other term at 25:1 — see the note on REWARD_DEATH_MAX in config.
        horizon_waves = 10
        discounted_run = good_wave * (1 - GAMMA ** horizon_waves) / (1 - GAMMA)
        self.assertLess(death["death"], -discounted_run,
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
