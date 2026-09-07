"""Every director must produce an action the decoder can actually consume.

`template_probs` was returned as None by the non-model directors. The decoder
reads a confidence out of it, raised TypeError on every single wave, and the
exception was swallowed into a default 10-enemy wave. An A/B run then reported
"rules", "random" and "maxgate" as producing exactly 10 enemies of one template
forever — three flat lines that looked like a finding about the strategies and
were in fact one missing key.

A contract this cheap to break, whose failure mode is silent and plausible,
gets a test.
"""

import torch

import config
import directors


class _Ctx:
    recent_template_indices = [0, 1, 2]
    director = "rules"


def _mask(n_allowed=6):
    return [i < n_allowed for i in range(config.MAX_TEMPLATE_SLOTS)]


def _non_model():
    return [d for d in directors.REGISTRY.values() if not d.is_learner]


def test_every_director_returns_the_decoder_contract():
    """Exactly the reads _decode_action performs, in the shapes it expects."""
    for d in _non_model():
        a = d.act({"waveNumber": 12}, {}, _mask(), _Ctx())
        idx = int(a["template_idx"][0].detach().item())
        assert 0 <= idx < config.MAX_TEMPLATE_SLOTS, d.name
        for key in ("count_factor", "spawn_factor", "hp_factor", "variation_factor"):
            v = float(a[key][0].detach().item())
            assert 0.0 <= v <= 1.0, f"{d.name}.{key} = {v}"
        # The read that broke: probs[0, idx] must be indexable.
        conf = float(a["template_probs"][0, idx].item())
        assert 0.0 <= conf <= 1.0, d.name


def test_directors_only_pick_allowed_templates():
    """The mask carries the curriculum, capability gates and boss cadence."""
    allowed = 3
    for d in _non_model():
        for _ in range(50):
            a = d.act({"waveNumber": 5}, {}, _mask(allowed), _Ctx())
            assert int(a["template_idx"][0].item()) < allowed, d.name


def test_no_director_survives_an_empty_mask():
    """Degenerate but reachable; must not raise."""
    for d in _non_model():
        a = d.act({"waveNumber": 1}, {}, [False] * config.MAX_TEMPLATE_SLOTS, _Ctx())
        assert a["template_idx"] is not None, d.name


def test_maxgate_pins_count_to_the_ceiling():
    """Its whole purpose: let the fairness gate set the size, every time."""
    d = directors.get_director("maxgate")
    for _ in range(10):
        a = d.act({"waveNumber": 20}, {}, _mask(), _Ctx())
        assert float(a["count_factor"][0].item()) == 1.0


def test_rules_avoids_recently_used_templates():
    """Variety enforced, not merely rewarded."""
    d = directors.get_director("rules")

    class Ctx:
        recent_template_indices = [0, 1]
        director = "rules"

    picks = {int(d.act({"waveNumber": 9}, {}, _mask(4), Ctx())["template_idx"][0].item())
             for _ in range(60)}
    assert picks == {2, 3}, picks


def test_rules_difficulty_grows_with_wave_number():
    d = directors.get_director("rules")
    early = [float(d.act({"waveNumber": 1}, {}, _mask(), _Ctx())["count_factor"][0].item())
             for _ in range(40)]
    late = [float(d.act({"waveNumber": 70}, {}, _mask(), _Ctx())["count_factor"][0].item())
            for _ in range(40)]
    assert sum(late) / len(late) > sum(early) / len(early)


def test_non_learners_are_excluded_from_ppo():
    """Their actions never came from the policy; storing them would be
    off-policy data wearing an on-policy label."""
    for d in _non_model():
        assert not d.is_learner, d.name
    assert directors.get_director("model").is_learner
