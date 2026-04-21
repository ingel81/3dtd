"""Phase 5.10 templates.py integrity tests.

Run: venv/Scripts/python.exe -m pytest tests/test_templates.py -v
Or with unittest:
  venv/Scripts/python.exe -m unittest tests.test_templates
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import unittest

from templates import (
    TEMPLATES,
    NUM_ACTIVE_TEMPLATES,
    get_template,
    get_available_template_mask,
)
from config import MAX_TEMPLATE_SLOTS, ENEMY_TYPES


class TestTemplates(unittest.TestCase):
    def test_exactly_18_active(self):
        self.assertEqual(NUM_ACTIVE_TEMPLATES, 18)
        self.assertEqual(len(TEMPLATES), 18)

    def test_max_slots_32(self):
        self.assertEqual(MAX_TEMPLATE_SLOTS, 32)
        self.assertEqual(MAX_TEMPLATE_SLOTS - NUM_ACTIVE_TEMPLATES, 14)

    def test_enemy_shares_sum_to_one(self):
        for t in TEMPLATES:
            total = sum(share for _, share in t["enemies"])
            self.assertAlmostEqual(total, 1.0, delta=0.01, msg=f"{t['id']} shares sum={total}")

    def test_all_enemy_ids_are_valid(self):
        for t in TEMPLATES:
            for enemy_type, _ in t["enemies"]:
                self.assertIn(
                    enemy_type,
                    ENEMY_TYPES,
                    msg=f"Template {t['id']} references unknown enemy {enemy_type}",
                )

    def test_required_fields(self):
        required = {"id", "name", "description", "enemies", "base_count",
                    "base_spawn_delay_ms", "base_hp_mult", "min_wave",
                    "spawn_pattern", "requires_capability", "boss_only"}
        for t in TEMPLATES:
            self.assertTrue(required.issubset(t.keys()), f"{t['id']} missing keys")

    def test_base_count_positive(self):
        for t in TEMPLATES:
            self.assertGreater(t["base_count"], 0, f"{t['id']} base_count={t['base_count']}")

    def test_get_template_invalid_indices(self):
        self.assertIsNone(get_template(-1))
        self.assertIsNone(get_template(NUM_ACTIVE_TEMPLATES))
        self.assertIsNone(get_template(MAX_TEMPLATE_SLOTS))
        self.assertIsNone(get_template(999))

    def test_get_template_valid(self):
        for i in range(NUM_ACTIVE_TEMPLATES):
            t = get_template(i)
            self.assertIsNotNone(t, f"slot {i} returned None")
            self.assertEqual(t["id"], TEMPLATES[i]["id"])

    def test_mask_reserve_slots_blocked(self):
        mask = get_available_template_mask(
            current_wave=100, has_anti_air=True, has_anti_ethereal=True,
            recent_template_indices=[],
        )
        for i in range(NUM_ACTIVE_TEMPLATES, MAX_TEMPLATE_SLOTS):
            self.assertFalse(mask[i], f"reserve slot {i} should be blocked")

    def test_mask_min_wave_enforced(self):
        # rat_tide (slot 1) has min_wave=8
        mask_w1 = get_available_template_mask(1, True, True, [])
        self.assertFalse(mask_w1[1])
        self.assertTrue(mask_w1[0])  # zombie_horde is wave 1+

        mask_w10 = get_available_template_mask(10, True, True, [])
        self.assertTrue(mask_w10[1])

    def test_mask_capabilities_enforced(self):
        mask_no_aa = get_available_template_mask(20, False, True, [])
        # bat_swarm (slot 6) needs antiAir
        self.assertFalse(mask_no_aa[6])

        mask_no_eth = get_available_template_mask(20, True, False, [])
        # ghost_surge (slot 13) needs antiEthereal
        self.assertFalse(mask_no_eth[13])

    def test_mask_cooldown_enforced(self):
        mask = get_available_template_mask(20, True, True, [0, 1])
        self.assertFalse(mask[0])
        self.assertFalse(mask[1])
        # But some other template must still be allowed
        self.assertTrue(any(mask))

    def test_mask_boss_only_at_wave_mod_10(self):
        mask_15 = get_available_template_mask(15, True, True, [])
        mask_20 = get_available_template_mask(20, True, True, [])
        # boss_herbert is slot 17
        self.assertFalse(mask_15[17])
        self.assertTrue(mask_20[17])

    def test_mask_always_fallback(self):
        # Impossible combo: wave 1, no capabilities — must still unblock at least one slot.
        mask = get_available_template_mask(1, False, False, [])
        self.assertTrue(any(mask))


if __name__ == "__main__":
    unittest.main()
