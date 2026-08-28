"""
Tests for the state encoder and the survival derivation in server.py.

These are the two places where a silent mismatch is most expensive: a wrong
feature count trains the net on shifted inputs, and a wrong `survived` flag
silences the largest reward term. Both used to fail quietly.

Run:  venv/Scripts/python.exe -m pytest tests/ -q
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

# The dashboard spins up FastAPI on import; tests don't need it.
os.environ.setdefault("DASHBOARD", "0")

import pytest  # noqa: E402

import schema  # noqa: E402
from server import TrainingServer  # noqa: E402


@pytest.fixture
def server():
    """A TrainingServer without __init__ — no model, no checkpoint I/O.

    `_encode_state` and `_process_result` only touch self for the difficulty
    helper and the win-rate counters, so this is enough and keeps the test
    from loading 200 MB of checkpoints.
    """
    s = object.__new__(TrainingServer)
    s.waves_survived = 0
    s.waves_lost = 0
    s.best_reward = float("-inf")
    s.eval_rewards = []
    s.eval_deaths = 0
    s.eval_waves = 0
    s.trainer = _NullTrainer()
    return s


class _NullTrainer:
    def store_result(self, *_args, **_kwargs):
        pass


class _Ctx:
    def __init__(self, deterministic=False):
        self.recent_damages = []
        self.recent_progress = []
        self.win_streak = 0
        self.deterministic = deterministic
        # Closed-loop fairness-gate state, mirrored from ClientContext.
        self.kill_shares = []
        self.gate_multiplier = 1.0


def _full_state():
    """A snapshot with every field the encoder reads populated."""
    return {
        "waveNumber": 7,
        "gameTimeSeconds": 420,
        "player": {"credits": 1200, "livesPercent": 0.83, "lives": 83},
        "defense": {
            "towerCount": 6,
            "avgTowerLevel": 2.5,
            "totalDPS": 310,
            "towerDistribution": {t: {"count": 1, "avgLevel": 2} for t in schema.TOWER_TYPES},
            "capabilities": {
                "hasAntiAir": True, "hasSplash": True,
                "hasSlow": False, "hasDoT": True,
            },
            "effectiveDPSPerArmor": {
                "ground": {a: 120 for a in schema.ARMOR_TYPES},
                "air": {a: 40 for a in schema.ARMOR_TYPES},
            },
        },
        "recentHistory": {
            "damagePerWave": [0.02, 0.05, 0.01],
            "progressPerWave": [0.7, 0.8, 0.6],
            "nearMissPerWave": [0.1, 0.2, 0.3],
            "enemyTypesUsed": [["zombie"], ["rat", "penguin"], ["bat"]],
            "lastWaveThreat": 40,
            "avgWaveDuration": 90,
            "winStreak": 3,
        },
        "research": {
            "totalCount": 14, "completedCount": 5, "centerLevel": 2,
            "maxSlots": 2, "slotsUsed": 1,
            "airTargetingUnlocked": True, "maxUpgradeTier": 3,
            "towerUnlocked": {t: True for t in schema.TOWER_TYPES},
        },
        "expectedArmorDistribution": {a: 0.2 for a in schema.ARMOR_TYPES},
        "dpsByDamageType": {d: 0.4 for d in schema.DAMAGE_TYPES},
        "dpsProfile": {
            "groundDPS": [0.5] * schema.NUM_BINS,
            "airDPS": [0.25] * schema.NUM_BINS,
        },
    }


def _context(state, wave=None):
    """Wave context as _get_action builds it."""
    defense = state.get("defense") or {}
    return schema.build_wave_context(
        upcoming_wave=(wave if wave is not None else state.get("waveNumber", 0)) + 1,
        has_anti_air=True,
        has_anti_ethereal=True,
        recent_template_indices=[],
        effective_dps_per_armor=defense.get("effectiveDPSPerArmor") or {},
    )


def test_encoder_emits_exactly_input_size_features(server):
    state = _full_state()
    encoded = server._encode_state(state, _Ctx(), _context(state))
    assert len(encoded) == schema.INPUT_SIZE


def test_wave_context_block_is_a_one_hot_inside_the_curriculum(server):
    """The block that tells the params head what its factors apply to.

    Inside the curriculum the availability mask has collapsed to a single
    template, so this block is a one-hot of the wave that will ship.
    """
    state = _full_state()
    encoded = server._encode_state(state, _Ctx(), _context(state))

    start = (
        schema.NUM_SCALAR
        - schema.MAX_TEMPLATE_SLOTS
        - schema.NUM_TEMPLATE_RANGE_FEATURES
        - 1
    )
    block = encoded[start:start + schema.MAX_TEMPLATE_SLOTS]
    assert sum(block) == 1.0, "curriculum wave should mark exactly one template"

    live = block.index(1.0)
    expected = schema.template_for_wave(state["waveNumber"] + 1)
    assert schema.TEMPLATES[live]["id"] == expected


def test_wave_context_ranges_and_headroom_stay_normalised(server):
    state = _full_state()
    encoded = server._encode_state(state, _Ctx(), _context(state))
    tail = encoded[schema.NUM_SCALAR - schema.NUM_TEMPLATE_RANGE_FEATURES - 1:schema.NUM_SCALAR]
    for v in tail:
        assert 0.0 <= v <= 1.0


def test_encoder_handles_a_completely_empty_snapshot(server):
    """A fresh client sends almost nothing; that must not shift the layout."""
    encoded = server._encode_state({}, _Ctx(), _context({}))
    assert len(encoded) == schema.INPUT_SIZE


def test_encoder_tolerates_a_missing_wave_context(server):
    """Layout must hold even if a caller forgets the context entirely."""
    assert len(server._encode_state(_full_state(), _Ctx())) == schema.INPUT_SIZE


def test_encoder_output_stays_in_range(server):
    state = _full_state()
    encoded = server._encode_state(state, _Ctx(), _context(state))
    for i, v in enumerate(encoded):
        assert isinstance(v, (int, float)), f"feature {i} is {type(v)}"
        # Damage momentum is the one deliberately signed feature.
        assert -1.0 <= v <= 1.0, f"feature {i} out of range: {v}"


def test_max_upgrade_tier_does_not_overflow(server):
    """Tier 5 exists (transcendent-tech); dividing by 3 used to exceed 1.0."""
    state = _full_state()
    state["research"]["maxUpgradeTier"] = 5
    encoded = server._encode_state(state, _Ctx(), _context(state))
    assert max(encoded) <= 1.0


def test_short_histories_are_left_padded(server):
    """Index 0 of a history window is the OLDEST entry, zero-padded in front."""
    state = _full_state()
    state["recentHistory"]["damagePerWave"] = [0.9]
    encoded = server._encode_state(state, _Ctx(), _context(state))
    # Damage history starts right after player(4) + tower(2) + tower counts.
    start = 4 + 2 + len(schema.TOWER_TYPES)
    window = encoded[start:start + 5]
    assert window == [0.0, 0.0, 0.0, 0.0, 0.9]


def test_encoder_rejects_a_truncated_vocabulary(server, monkeypatch):
    """A stale schema must fail loudly instead of silently shifting features."""
    monkeypatch.setattr("server.TOWER_TYPES", schema.TOWER_TYPES[:-1])
    state = _full_state()
    with pytest.raises(ValueError, match="expected"):
        server._encode_state(state, _Ctx(), _context(state))


# ── survival derivation ─────────────────────────────────────────────────────

def test_death_is_detected_from_state_after(server):
    ctx = _Ctx()
    state_after = {"player": {"lives": 0, "credits": 10}}
    reward, breakdown = server._process_result(
        ctx, client_id=1, wave_num=12,
        result={"damagePercent": 0.5, "enemiesSpawned": 100, "playerSurvived": False},
        state_after=state_after,
    )
    assert breakdown["death"] < 0
    assert ctx.win_streak == 0


def test_death_is_detected_without_state_after(server):
    """The game-over path used to omit stateAfter; `playerSurvived` covers it.

    The old code read `result["gameOver"]`, a key WaveOutcome never had, so
    `.get(..., False)` reported a survivor on every fatal wave.
    """
    ctx = _Ctx()
    reward, breakdown = server._process_result(
        ctx, client_id=1, wave_num=12,
        result={"damagePercent": 0.5, "enemiesSpawned": 100, "playerSurvived": False},
        state_after=None,
    )
    assert breakdown["death"] < 0


def test_survival_increments_the_win_streak(server):
    ctx = _Ctx()
    for _ in range(3):
        server._process_result(
            ctx, client_id=1, wave_num=5,
            result={"damagePercent": 0.03, "enemiesSpawned": 100, "playerSurvived": True},
            state_after={"player": {"lives": 90}},
        )
    assert ctx.win_streak == 3
    assert server.waves_survived == 3
    assert server.waves_lost == 0
