"""Tests for the fairness gate's closed loop.

This loop has failed twice in ways every other metric hid, so it gets its own
coverage:

  1. `gate_multiplier` and the leak history were not reset between episodes, so
     the multiplier was a per-CLIENT ratchet. It climbed on every cleared wave
     and was divided down only on a death, reaching its ceiling of 40 and
     turning the gate off. Median run length was 6 waves against a target of 80.
  2. It steered on kill-share, raising the budget whenever the defense killed
     everything. A small wave is cleared BECAUSE it is small, so the loop read
     its own caution as headroom — one-way pressure that pinned the multiplier
     to whatever ceiling it was given.

The invariant that catches both: a defense holding steady inside the target
leak band must leave the multiplier where it is.
"""

import config
import server


class _Ctx:
    def __init__(self):
        self.leak_shares = []
        self.gate_multiplier = 1.0
        self.current_state = None
        self.state_before_wave = None
        self.recent_damages = []
        self.recent_progress = []
        self.enemy_types_used = []
        self.recent_template_indices = []


def _steer(ctx, leak_ratio, survived=True, waves=1):
    """Feed the real loop, one wave at a time.

    Calls server.steer_gate rather than reimplementing it — an earlier version
    of this file mirrored the logic by hand, which meant it could only ever
    agree with the code it was copied from.
    """
    for _ in range(waves):
        ctx.leak_shares.append(max(0.0, min(1.0, leak_ratio)))
        if len(ctx.leak_shares) > config.GATE_ADAPT_WINDOW:
            ctx.leak_shares.pop(0)
        server.steer_gate(ctx, survived)
    return ctx.gate_multiplier


def test_target_band_holds_the_multiplier():
    """The bug that mattered: a healthy defense must not move the budget."""
    ctx = _Ctx()
    mid = (config.GATE_LEAK_TARGET_LO + config.GATE_LEAK_TARGET_HI) / 2
    assert _steer(ctx, mid, waves=50) == 1.0


def test_nothing_leaking_opens_the_budget():
    ctx = _Ctx()
    assert _steer(ctx, 0.0, waves=20) > 1.0


def test_too_much_leaking_closes_the_budget():
    ctx = _Ctx()
    ctx.gate_multiplier = 4.0
    assert _steer(ctx, 0.5, waves=20) < 4.0


def test_death_backs_off():
    ctx = _Ctx()
    ctx.gate_multiplier = 4.0
    assert _steer(ctx, 0.2, survived=False, waves=4) < 4.0


def test_steering_is_two_sided():
    """Up and down from the same start must both be reachable.

    Under kill-share steering the down branch existed only for deaths, which is
    why the multiplier could only climb during a healthy run.
    """
    up, down = _Ctx(), _Ctx()
    assert _steer(up, 0.0, waves=20) > 1.0
    down.gate_multiplier = 2.0
    assert _steer(down, 0.5, waves=20) < 2.0


def test_adapt_window_fits_inside_a_run():
    """At 8 the window outlived the median run, so the loop never steered."""
    assert config.GATE_ADAPT_WINDOW <= 5


def test_reset_context_clears_gate_state():
    """The ratchet: this state must not survive into the next episode."""
    ctx = _Ctx()
    ctx.gate_multiplier = 7.5
    ctx.leak_shares = [0.9, 0.9, 0.9, 0.9]
    srv = server.TrainingServer.__new__(server.TrainingServer)
    srv._reset_context(ctx)
    assert ctx.gate_multiplier == 1.0
    assert ctx.leak_shares == []


def test_starved_gate_reaches_useful_scale_within_a_run():
    """The failure that made every director equivalent.

    With nothing leaking, the multiplier has to climb past ~1.6 just to undo
    the stale kill-realism discount. The old fixed 1.05 step needed ~170 waves
    to get there; runs last about 60 and reset to 1.0 at the start of each one,
    so the cap stayed pinned to exactly what the defense could kill and 80% of
    waves dealt no damage at all.
    """
    ctx = _Ctx()
    assert _steer(ctx, 0.0, waves=40) > 1.6


def test_correction_shrinks_inside_the_band():
    """Proportional control has to settle, not oscillate."""
    ctx = _Ctx()
    ctx.gate_multiplier = 3.0
    target = (config.GATE_LEAK_TARGET_LO + config.GATE_LEAK_TARGET_HI) / 2.0
    assert _steer(ctx, target, waves=30) == 3.0
