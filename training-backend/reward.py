"""
Reward Calculation

Raw path-progress based reward shaping for the Wave Director AI.
Goal: Generate waves where avg raw progress hits ~55% (half die in defense, half reach base).

DPS profile is used as MODEL INPUT only (Conv1D spatial features).
Reward uses raw physical path progress directly - no DPS normalization.
"""

import math

from config import (
    REWARD_PROGRESS_CENTER,
    REWARD_PROGRESS_SIGMA,
    REWARD_GAME_OVER_PENALTY,
    REWARD_BORING_PENALTY,
    REWARD_BORING_THRESHOLD,
    REWARD_VARIETY_BONUS,
    NUM_BINS,
)



def calculate_reward(result: dict, context: dict, state_before: dict = None, state_after: dict = None) -> tuple[float, dict]:
    """
    Calculate reward based on average path progress.

    The key insight: avg_path_progress is continuous and gradient-rich,
    unlike damage which is binary (0% or 10%+ per enemy).

    Args:
        result: Wave outcome from game
            - avgPathProgressPercent: How far enemies got on average (0-1)
            - playerSurvived: Player survived the wave
            - enemiesKilled: Number of enemies killed

        context: Training context
            - wave_number: Current wave number
            - enemy_types_used: List of enemy types used recently
            - ground_dps_profile: 20-bin ground DPS profile (optional)
            - air_dps_profile: 20-bin air DPS profile (optional)
            - dominant_type: Current wave's dominant enemy type (optional)

    Returns:
        Tuple of (reward_value, breakdown_dict)
    """
    avg_progress = result.get("avgPathProgressPercent", 0)
    max_progress = result.get("maxPathProgress", 0)
    near_miss_ratio = result.get("nearMissRatio", 0)
    progress_std = result.get("progressStd", 0)
    player_survived = result.get("playerSurvived", True)

    breakdown = {}
    reward = 0.0

    # === CORE: Gaussian peak at target path progress ===
    progress_reward = math.exp(
        -((avg_progress - REWARD_PROGRESS_CENTER) ** 2) / (2 * REWARD_PROGRESS_SIGMA ** 2)
    )

    # Penalty for too easy (enemies die before reaching threshold)
    if avg_progress < REWARD_BORING_THRESHOLD:
        progress_reward = REWARD_BORING_PENALTY  # Flat penalty, same as overflow

    # Hard penalty for overwhelming waves (most enemies get through)
    if avg_progress > 0.85:
        progress_reward = -0.3

    breakdown["progress"] = round(progress_reward, 4)
    reward += progress_reward

    # === GAME OVER PENALTY ===
    # Stronger penalty for early game overs (wave 3 → -3.3, wave 10 → -1.0, wave 20 → -0.5)
    game_over_penalty = 0.0
    if not player_survived:
        wave_number = context.get("wave_number", 1)
        from config import EPISODE_LENGTH
        game_over_penalty = REWARD_GAME_OVER_PENALTY * (EPISODE_LENGTH / max(1, wave_number))
        game_over_penalty = max(game_over_penalty, -5.0)  # Cap at -5.0
        reward += game_over_penalty
    breakdown["game_over"] = round(game_over_penalty, 4)

    # === NEAR-MISS BONUS: Many enemies get close but die ===
    # Bonus when >50% of enemies reach 80%+ AND player survived AND not overwhelming
    near_miss_bonus = 0.0
    if player_survived and near_miss_ratio > 0.5 and avg_progress < 0.85:
        near_miss_bonus = 0.15 * min(1.0, (near_miss_ratio - 0.5) / 0.4)
        reward += near_miss_bonus
    breakdown["near_miss"] = round(near_miss_bonus, 4)

    # === MAX PROGRESS BONUS: At least one enemy gets VERY far ===
    # Only when the wave is exciting (not overwhelming)
    max_bonus = 0.0
    if player_survived and max_progress > 0.90 and avg_progress < 0.85:
        max_bonus = 0.1 * min(1.0, (max_progress - 0.90) / 0.09)
        reward += max_bonus
    breakdown["max_progress"] = round(max_bonus, 4)

    # === SPREAD BONUS: Enemies die at different points (progressive overload) ===
    # Moderate std means towers get gradually overwhelmed = exciting
    spread_bonus = 0.0
    if progress_std > 0.05:
        spread_bonus = 0.05 * min(1.0, progress_std / 0.20)
        reward += spread_bonus
    breakdown["spread"] = round(spread_bonus, 4)

    # === ENEMY VARIETY BONUS ===
    variety_bonus = 0.0
    enemy_types = result.get("enemy_types", [])
    recent_types = context.get("enemy_types_used", [])

    if recent_types:
        all_recent = [t for wave_types in recent_types[-5:] for t in wave_types]
        unique_recent = set(all_recent)
        unique_now = set(enemy_types)

        new_types = unique_now - unique_recent
        if new_types:
            variety_bonus = REWARD_VARIETY_BONUS * min(1, len(new_types) / 2)
            reward += variety_bonus
    breakdown["variety"] = round(variety_bonus, 4)

    # === MONOTONY PENALTY ===
    # Penalize if same type used 3+ times in last 5 waves
    monotony_penalty = 0.0
    recent_flat = context.get("recent_types_flat", [])
    if len(recent_flat) >= 3:
        last_5 = recent_flat[-5:]
        current_type = enemy_types[0] if enemy_types else None
        if current_type and last_5.count(current_type) >= 3:
            monotony_penalty = -0.20
            reward += monotony_penalty
    breakdown["monotony"] = round(monotony_penalty, 4)

    # === PHASE 5.5: Wave-Quality Signals (Perfect / CloseCall / Mixed) ===

    # Perfect-Wave Penalty: if the player took ZERO damage, the wave was too easy
    # → mild negative signal to push the director toward more pressure
    perfect_penalty = 0.0
    if result.get("perfect", False):
        perfect_penalty = -0.15
        reward += perfect_penalty
    breakdown["perfect_penalty"] = round(perfect_penalty, 4)

    # CloseCall Bonus: player barely survived (HP <= closeCallHpThreshold) → perfect challenge
    close_call_bonus = 0.0
    if result.get("closeCall", False):
        close_call_bonus = 0.15
        reward += close_call_bonus
    breakdown["close_call"] = round(close_call_bonus, 4)

    # Mixed-Wave Diversity Bonus: reward waves with >=2 distinct enemy groups.
    # Prevents the model from collapsing to single-type spam.
    mixed_bonus = 0.0
    num_groups = len(result.get("enemies", [])) if "enemies" in result else len(enemy_types)
    if num_groups >= 2:
        mixed_bonus = 0.05 * min(num_groups, 3)  # +0.05, +0.10, +0.15 for 2/3/3+ groups
        reward += mixed_bonus
    breakdown["mixed_diversity"] = round(mixed_bonus, 4)

    return reward, breakdown


def estimate_player_skill(recent_damages: list, recent_win_streak: int) -> float:
    """
    Estimate player skill from recent performance.

    Returns:
        Skill estimate (0-1, higher = better)
    """
    if not recent_damages:
        return 0.5

    avg_damage = sum(recent_damages) / len(recent_damages)
    damage_skill = 1 - avg_damage

    streak_bonus = min(0.2, recent_win_streak * 0.04)

    return min(1, max(0, damage_skill + streak_bonus))
