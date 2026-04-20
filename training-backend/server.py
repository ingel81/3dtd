"""
Training Backend Server

WebSocket server that:
- Receives game state from browser
- Returns wave configurations from AI
- Trains the model on results
"""

import asyncio
import json
import os
import random
from datetime import datetime
from pathlib import Path

import websockets
import torch

from config import (
    SERVER_HOST,
    SERVER_PORT,
    BOT_WEIGHTS,
    CHECKPOINT_DIR,
    CHECKPOINT_INTERVAL,
    EPISODE_LENGTH,
    INPUT_SIZE,
    ENEMY_BASE_HP,
    ENEMY_TYPES,
    ENEMY_ARMOR,
    AIR_ENEMIES,
    ETHEREAL_ENEMIES,
    TYPE_COOLDOWN_WAVES,
    HEALTH_MULTIPLIER_MAX,
    MIXED_WAVE_THRESHOLD,
    MIXED_WAVE_MAX_GROUPS,
)
from model import create_model, save_model, load_model
from reward import calculate_reward, estimate_player_skill
from trainer import PPOTrainer
from auto_logger import logger

# Dashboard (optional - graceful fallback if deps missing)
_dashboard = None
try:
    if os.environ.get("DASHBOARD", "1") != "0":
        from dashboard.app import dashboard as _dashboard
except ImportError:
    pass


def _compute_armor_dist(enemies: list) -> dict:
    """Armor-Verteilung (in %) aus den gerade entschiedenen Gruppen.

    Wird im wave_info ans Dashboard gegeben damit jede Client-Card die
    tatsächliche Armor-Mischung der aktuellen Wave sieht (nicht die vorige,
    die im state.expectedArmorDistribution des Clients stand und stale war).
    """
    dist = {"unarmored": 0.0, "light": 0.0, "heavy": 0.0, "fortified": 0.0, "ethereal": 0.0}
    total = sum(int(g.get("count", 0) or 0) for g in (enemies or []))
    if total <= 0:
        return dist
    for g in enemies:
        t = g.get("type")
        c = int(g.get("count", 0) or 0)
        armor = ENEMY_ARMOR.get(t, "unarmored")
        dist[armor] = dist.get(armor, 0.0) + c / total
    # Clean-up: runde auf 4 decimals um Float-Rauschen zu vermeiden
    return {k: round(v, 4) for k, v in dist.items()}


class ClientContext:
    """Per-client training context."""

    def __init__(self):
        self.current_state = None
        self.state_before_wave = None
        self.current_bot = "casual"
        self.recent_damages = []
        self.recent_progress = []
        self.enemy_types_used = []
        self.recent_types_flat = []  # Last N types for cooldown/monotony
        # Armor categories of recent waves (for armor-diversity reward signals).
        # Parallel to recent_types_flat — tracks dominant-group armor per wave.
        self.recent_armor_categories = []
        # Phase 5.7: flat armor-category-log over 30 waves (one entry per wave's
        # dominant armor). Feeds the armor-dominance-penalty AND the per-client
        # state-vector Armor-Dominance-Share features.
        self.recent_armor_categories_flat = []
        # Phase 5.7: self-awareness history — what the net itself chose last.
        # Read into state-vector so the net sees its own recent policy output.
        self.recent_rewards = []        # last 5 total rewards
        self.recent_wave_sizes = []     # last 5 totalCount values
        self.recent_kill_times = []     # last 5 kill_time decisions
        self.recent_count_factors = []  # last 5 count_factor decisions (already [0,1])
        self.consecutive_close_calls = 0
        self.win_streak = 0
        self.wave_num = 0
        self.last_enemy_type = None  # Last generated enemy type (for dashboard fallback)
        self.last_wave_info = None  # Last generated wave info (for dashboard)
        self.enemy_base_hp = None  # Set from game_start (frontend is source of truth)
        self.ground_dps_profile = [0] * 20  # DPS profile for reward normalization
        self.air_dps_profile = [0] * 20


class TrainingServer:
    """WebSocket server for AI training."""

    def __init__(self):
        self.model = create_model()
        self.model.eval()  # Eval mode by default; trainer switches to train during updates

        # Dashboard reference
        self.dashboard = _dashboard
        if self.dashboard:
            self.dashboard.set_server(self)

        self.trainer = PPOTrainer(self.model, dashboard=self.dashboard)
        self.clients = set()
        self.client_contexts = {}  # Per-client state: {client_id: ClientContext}

        # Global training state
        self.episode = 0
        self.games_played = 0
        self.total_reward = 0
        self.best_reward = float("-inf")
        # Training run-state: clients join paused. Dashboard Start button flips
        # this to 'running' and broadcasts. Reload keeps the current state.
        self.training_state = 'paused'  # 'paused' | 'running'

        # Create checkpoint directory
        Path(CHECKPOINT_DIR).mkdir(exist_ok=True)

        # Try to load latest checkpoint
        self._load_latest_checkpoint()

    def _load_latest_checkpoint(self):
        """Load most recent checkpoint if exists."""
        checkpoints = list(Path(CHECKPOINT_DIR).glob("checkpoint_*.pt"))
        if checkpoints:
            latest = max(checkpoints, key=lambda p: int(p.stem.split("_")[1]))
            self.model = load_model(str(latest))
            # Keep eval mode (load_model sets it) - trainer switches to train only during updates
            self.trainer = PPOTrainer(self.model, dashboard=self.dashboard)
            self.episode = int(latest.stem.split("_")[1])
            logger.model_resumed(self.episode, str(latest))

    async def handle_client(self, websocket):
        """Handle a connected client."""
        self.clients.add(websocket)
        client_id = id(websocket)
        self.client_contexts[client_id] = ClientContext()
        logger.client_connected(client_id, len(self.clients))

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    await self._handle_message(websocket, client_id, data)
                except Exception as e:
                    logger.error(f"[WS-Debug] Error handling message: {type(e).__name__}: {e}")
                    import traceback
                    traceback.print_exc()
        except (websockets.ConnectionClosed, asyncio.CancelledError):
            pass
        finally:
            self.clients.remove(websocket)
            if client_id in self.client_contexts:
                del self.client_contexts[client_id]
            # Clean up any pending states for this client (prevents memory leak)
            stale_keys = [k for k in self.trainer.pending if k[0] == client_id]
            for k in stale_keys:
                del self.trainer.pending[k]
            # Drop dashboard per-client history so the UI's stats broadcast
            # (activeClientIds) can prune the card without stale data resurrection.
            if self.dashboard:
                display_id = client_id % 10000
                self.dashboard.per_client.pop(display_id, None)
            logger.client_disconnected(client_id, len(self.clients))
            # Push fresh stats so the dashboard UI sees the new activeClientIds list
            # and removes the disconnected client's card immediately.
            try:
                await self._broadcast_stats()
            except Exception:
                pass

    async def _handle_message(self, ws, client_id, msg):
        """Process incoming message."""
        msg_type = msg.get("type")
        ctx = self.client_contexts.get(client_id)
        if not ctx:
            ctx = ClientContext()
            self.client_contexts[client_id] = ctx

        if msg_type == "connect":
            session_id = f"session_{datetime.now().timestamp()}"
            display_id = client_id % 10000
            await ws.send(json.dumps({
                "type": "connected",
                "sessionId": session_id,
                "displayId": display_id,
                "trainingState": self.training_state,
            }))
            logger.debug(f"Session established: #{display_id} ({self.training_state})")

        elif msg_type == "state":
            # Game state received - generate wave config
            state_data = msg.get("data")
            ctx.state_before_wave = state_data
            ctx.current_state = state_data
            wave_num = state_data.get("waveNumber", 0)
            ctx.wave_num = wave_num

            # Extract state info for logging
            defense = state_data.get("defense", {})
            towers = defense.get("towerCount", 0)
            dps = defense.get("totalDPS", 0)
            defense_reach = defense.get("defenseReachPercent", 0)
            credits = state_data.get("player", {}).get("credits", 0)

            logger.wave_received(client_id, wave_num, towers, dps, credits, defense_reach=defense_reach, bot_type=ctx.current_bot)

            action = self._get_action(state_data, ctx, client_id)
            wave_config, wave_info = self._decode_action(action, state_data, ctx)

            # Track ALL enemy types from this wave (not just dominant) so monotony
            # + armor-diversity reward signals see the full mixed-wave composition.
            from config import ENEMY_ARMOR
            wave_all_types = [g["type"] for g in wave_config["enemies"]]
            wave_enemy_type = wave_all_types[0]  # dominant — kept for legacy fields
            wave_all_armors = list({ENEMY_ARMOR.get(t, "unknown") for t in wave_all_types})

            ctx.last_enemy_type = wave_enemy_type
            ctx.last_wave_info = wave_info
            ctx.enemy_types_used.append(wave_all_types)  # all types per wave
            # Flat history: each wave extends with ALL its types (not just one)
            ctx.recent_types_flat.extend(wave_all_types)
            if len(ctx.recent_types_flat) > 30:
                ctx.recent_types_flat = ctx.recent_types_flat[-30:]
            # Armor-history: one entry per wave containing ALL armors present.
            # Use comma-joined string so reward.py can parse back set membership.
            ctx.recent_armor_categories.append(",".join(sorted(wave_all_armors)))
            if len(ctx.recent_armor_categories) > 10:
                ctx.recent_armor_categories = ctx.recent_armor_categories[-10:]
            # Phase 5.7: flat armor log over 30 waves (one entry per wave's
            # DOMINANT armor) for the Armor-Dominance-Penalty in reward.py AND
            # the per-client state-vector features.
            dominant_armor = ENEMY_ARMOR.get(wave_enemy_type, "unarmored")
            ctx.recent_armor_categories_flat.append(dominant_armor)
            if len(ctx.recent_armor_categories_flat) > 30:
                ctx.recent_armor_categories_flat = ctx.recent_armor_categories_flat[-30:]
            # Phase 5.7: self-awareness — remember what the net chose (wave size,
            # kill_time, count_factor) so the state-vector can expose those as
            # features the net can read back.
            ctx.recent_wave_sizes.append(int(wave_config.get("totalCount", 0)))
            if len(ctx.recent_wave_sizes) > 5:
                ctx.recent_wave_sizes = ctx.recent_wave_sizes[-5:]
            ctx.recent_kill_times.append(float(wave_info.get("kill_time", 0)))
            if len(ctx.recent_kill_times) > 5:
                ctx.recent_kill_times = ctx.recent_kill_times[-5:]
            ctx.recent_count_factors.append(float(wave_info.get("count_factor", 0)))
            if len(ctx.recent_count_factors) > 5:
                ctx.recent_count_factors = ctx.recent_count_factors[-5:]

            logger.wave_generated(wave_config, wave_info=wave_info)

            await ws.send(json.dumps({
                "type": "wave_config",
                "data": wave_config
            }))

        elif msg_type == "result":
            # Wave result - calculate reward and train
            data = msg.get("data", {})
            wave_num = data.get("waveNumber", 0)
            outcome = data.get("outcome", {})
            state_after = data.get("stateAfter")

            # Compute effective progress using DPS profile
            damage_pct = outcome.get('damagePercent', 0)
            killed = outcome.get('enemiesKilled', 0)
            raw_progress = outcome.get('avgPathProgressPercent', 0)

            # Use raw path progress (DPS profile is model INPUT only, not used for reward normalization)
            raw_values = outcome.get('enemyProgressValues', [])
            if not raw_values:
                # Fallback: per-enemy list is missing (can happen on game-over mid-wave
                # when the frontend hasn't finalized enemyPathProgress). Use the summary
                # from the outcome so we don't drop the wave to a bogus 0.0 progress
                # (that made avg_progress bimodal at 0/1 and killed the reward gradient).
                summary = raw_progress
                # If game-over but zero summary, synthesize from damage — enemies clearly
                # got through (damage > 0) so progress must have been high.
                if summary == 0 and damage_pct > 0:
                    summary = min(1.0, 0.5 + damage_pct)
                raw_values = [summary] if summary > 0 else [0]

            # Compute distribution metrics on raw progress values
            avg_progress = sum(raw_values) / len(raw_values)
            max_progress = max(raw_values)
            near_miss_ratio = sum(1 for v in raw_values if v > 0.80) / len(raw_values)
            progress_std = (sum((v - avg_progress)**2 for v in raw_values) / len(raw_values)) ** 0.5

            display_id_for_log = client_id % 10000
            logger.wave_result(
                wave_num, damage_pct, killed, avg_progress, near_miss_ratio,
                client_id=display_id_for_log,
                max_progress=max_progress,
                progress_std=progress_std,
                total_count=outcome.get("enemiesSpawned", 0),
                perfect=outcome.get("perfect"),
                close_call=outcome.get("wasCloseCall"),
                enemy_types=list(ctx.enemy_types_used[-1]) if ctx.enemy_types_used and ctx.enemy_types_used[-1] else None,
                player_credits=(state_after or {}).get("player", {}).get("credits") if state_after else None,
                player_health=(state_after or {}).get("player", {}).get("lives") if state_after else None,
            )

            # Show player state changes during wave
            if state_after and ctx.current_state:
                logger.player_state_change(ctx.current_state, state_after)

            # Skip wave 0 from training (tutorial, always 0% damage, no signal)
            if wave_num == 0:
                ctx.wave_num = wave_num
                return

            reward, breakdown = self._process_result(ctx, client_id, wave_num, outcome, state_after,
                                                       effective_progress=avg_progress,
                                                       max_progress=max_progress,
                                                       near_miss_ratio=near_miss_ratio,
                                                       progress_std=progress_std)

            self.episode += 1
            self.total_reward += reward
            avg_reward = self.total_reward / max(1, self.episode)

            logger.training_step(
                self.episode, reward, avg_reward, breakdown=breakdown,
                client_id=client_id % 10000, wave=wave_num,
            )

            # Record to dashboard
            if self.dashboard:
                display_id = client_id % 10000
                self.dashboard.record_episode(reward, avg_progress,
                                              near_miss=near_miss_ratio, breakdown=breakdown,
                                              client_id=display_id)
                enemy_type = ctx.enemy_types_used[-1][0] if ctx.enemy_types_used and ctx.enemy_types_used[-1] else getattr(ctx, 'last_enemy_type', '?')
                enemy_count = outcome.get("enemiesSpawned", 0)
                # Enrich wave_info with post-wave player economy (credits + health) for
                # dashboard visibility — not used by the NN, purely for balance inspection.
                if ctx.last_wave_info is not None and state_after:
                    player = state_after.get("player", {})
                    ctx.last_wave_info["player_credits"] = player.get("credits", 0)
                    # Snapshot uses `lives`, not `health`, for base HP
                    ctx.last_wave_info["player_health"] = player.get("lives", 0)
                    ctx.last_wave_info["damage_pct"] = damage_pct

                    # Bot telemetry — tower-type distribution + avg levels for
                    # dashboard inspection. towerDistribution = {id: {count, avgLevel, ...}}
                    defense = state_after.get("defense", {}) or {}
                    tower_dist = defense.get("towerDistribution", {}) or {}
                    tower_counts = {}
                    tower_levels = {}
                    for type_id, stats in tower_dist.items():
                        if isinstance(stats, dict):
                            count = stats.get("count", 0) or 0
                            if count > 0:
                                tower_counts[type_id] = count
                                tower_levels[type_id] = round(stats.get("avgLevel", 1) or 1, 1)
                    ctx.last_wave_info["tower_counts"] = tower_counts
                    ctx.last_wave_info["tower_avg_levels"] = tower_levels
                    ctx.last_wave_info["tower_count_total"] = defense.get("towerCount", 0)
                self.dashboard.record_wave(wave_num, enemy_type, enemy_count, avg_progress, reward,
                                           wave_info=ctx.last_wave_info,
                                           client_id=display_id)

            # Save checkpoint periodically
            if self.episode % CHECKPOINT_INTERVAL == 0:
                checkpoint_path = f"{CHECKPOINT_DIR}/checkpoint_{self.episode}.pt"
                save_model(self.model, checkpoint_path)
                logger.checkpoint_saved(self.episode, checkpoint_path)

            # Send stats to all clients
            await self._broadcast_stats()

            # Episode reset: after N waves, reset the game
            if wave_num >= EPISODE_LENGTH:
                avg_prg = sum(ctx.recent_progress) / max(1, len(ctx.recent_progress))
                logger.episode_end(client_id, wave_num, avg_prg, reason="reset")
                await ws.send(json.dumps({"type": "reset"}))
                self._reset_context(ctx)
                self._select_bot(ctx)
                self.games_played += 1
                logger.update_games(self.games_played)
                logger.episode_start(client_id, ctx.current_bot)

        elif msg_type == "game_start":
            # New game starting - receive enemy base HP from frontend
            enemy_base_hp = msg.get("enemyBaseHp")
            if enemy_base_hp:
                ctx.enemy_base_hp = enemy_base_hp
            self._select_bot(ctx)
            self._reset_context(ctx)
            self.games_played += 1
            logger.update_games(self.games_played)
            logger.episode_start(client_id, ctx.current_bot)

        elif msg_type == "game_over":
            # Game ended
            won = msg.get("won", False)
            avg_prg = sum(ctx.recent_progress) / max(1, len(ctx.recent_progress))
            logger.episode_end(client_id, ctx.wave_num, avg_prg, reason="won" if won else "game_over")
            if won:
                ctx.win_streak += 1
            else:
                ctx.win_streak = 0
                if self.dashboard:
                    self.dashboard.record_game_over()

        elif msg_type == "request_stats":
            await self._send_stats(ws)

        elif msg_type == "request_export":
            version = msg.get("version", "v1")
            path = self._export_model(version)
            await ws.send(json.dumps({
                "type": "model_exported",
                "path": path,
                "version": version
            }))

    def _get_action(self, state, ctx=None, client_id=None):
        """Get action from model."""
        # Convert state to tensor
        state_tensor = torch.tensor(
            self._encode_state(state, ctx),
            dtype=torch.float32
        ).unsqueeze(0)

        # Get action with log_prob for PPO ratio
        with torch.no_grad():
            action, log_prob, _ = self.model.get_action(state_tensor)

        # Store state paired with (client_id, wave_num+1) for proper result pairing
        # state.waveNumber=N means "requesting config for wave N+1"
        # result.waveNumber=N+1 means "wave N+1 finished"
        if client_id is not None and ctx is not None:
            raw_params = action.get("raw_params")
            enemy_idx = action.get("enemy_idx")
            self.trainer.store_action(
                client_id, ctx.wave_num + 1,
                state_tensor.squeeze(0),
                action_tensor=raw_params.squeeze(0) if raw_params is not None else None,
                enemy_idx=enemy_idx.squeeze(0) if enemy_idx is not None else None,
                log_prob=log_prob.squeeze(0),
            )

        return action

    def _encode_state(self, state, ctx=None):
        """Convert game state dict to flat 171-feature array (Phase 5.7).

        Layout (MUST match game-state-encoder.ts encodeGameState):
        [0-3]     Player: credits, lives%, wave, time
        [4-5]     Tower: count, avgLevel
        [6-14]    Tower Type Counts: 9 types (archer, cannon, magic, dual-gatling, rocket, ice, fire, tentacle, poison)
        [15-19]   History Damage: last 5 waves
        [20-24]   History Progress: last 5 waves avg_progress
        [25-29]   Wave Signals: momentum, avgDmg, duration, episodeProgress, variance
        [30-34]   Context: wave, trend, skill, lastThreat, winStreak
        [35-41]   DPS by Damage Type: physical, pierce, siege, magic, fire, ice, poison (7)
        [42-46]   Enemy Armor Distribution (current wave): unarmored, light, heavy, fortified, ethereal (5)
        [47-51]   Research State: completedRatio, centerLevel/3, slotsUsed/maxSlots, airTargeting, maxTier/3 (5)
        [52]      Reserved
        --- Phase 5.6 Awareness Block (53 features, scalar) ---
        [53-68]   Types-History: per-type frequency across last 5 waves (16)
        [69-73]   Armor-History: per-armor frequency across last 5 waves (5)
        [74-78]   Damage-Pct-History: last 5 damage percentages (5)
        [79-87]   Tower-Type Avg-Levels: avg upgrade level per tower type (9)
        [88-91]   Defense Capabilities: hasAntiAir, hasSplash, hasSlow, hasDoT (4)
        [92-100]  Tower-Unlock-Status: researched flags per tower type (9)
        [101-105] Near-Miss-History: last 5 nearMissRatio values (5)
        --- Phase 5.7 Self-Awareness Block (25 features, scalar, PER-CLIENT) ---
        [106-110] Reward-History: last 5 total rewards, clipped [-2,+2]/2 (5)
        [111-115] Wave-Size-History: last 5 totalCount, min(1, count/500) (5)
        [116-120] Kill-Time-History: last 5 kill_time, normalized (5)
        [121-125] Count-Factor-History: last 5 count_factor values [0,1] (5)
        [126-130] Armor-Dominance-Share: per category share over last 30 waves (5)
        --- Spatial Block (40 features) ---
        [131-150] Ground DPS Profile: 20 bins
        [151-170] Air DPS Profile: 20 bins
        """
        encoded = []

        # === Player state [0-3] ===
        player = state.get("player", {})
        encoded.extend([
            player.get("credits", 0) / 5000,
            player.get("livesPercent", 1),
            state.get("waveNumber", 0) / 50,
            state.get("gameTimeSeconds", 0) / 3600,
        ])

        # === Tower stats [4-5] ===
        defense = state.get("defense", {})
        encoded.extend([
            defense.get("towerCount", 0) / 30,
            defense.get("avgTowerLevel", 0) / 5,
        ])

        # === Tower Type Counts [6-14] (9 types — added fire, tentacle) ===
        tower_types = ["archer", "cannon", "magic", "dual-gatling", "rocket", "ice", "fire", "tentacle", "poison"]
        dist = defense.get("towerDistribution", {})
        for t in tower_types:
            stats = dist.get(t, {})
            encoded.append(stats.get("count", 0) / 10)

        # === History Damage [15-19] ===
        history = state.get("recentHistory", {})
        damages = history.get("damagePerWave", [])
        for i in range(5):
            idx = len(damages) - 5 + i
            encoded.append(damages[idx] if 0 <= idx < len(damages) else 0)

        # === History Progress [20-24] ===
        progresses = history.get("progressPerWave", [])
        for i in range(5):
            idx = len(progresses) - 5 + i
            encoded.append(progresses[idx] if 0 <= idx < len(progresses) else 0)

        # === Wave Signals [25-29] ===
        wave_num = state.get("waveNumber", 0)

        # [25] Damage momentum
        if len(damages) >= 2:
            momentum = (damages[-1] - damages[-2]) * 10
        else:
            momentum = 0.0
        encoded.append(max(-1.0, min(1.0, momentum)))

        # [26] Average recent damage
        recent_5 = damages[-5:] if damages else []
        avg_recent = sum(recent_5) / max(1, len(recent_5))
        encoded.append(min(1.0, avg_recent))

        # [27] Wave duration
        encoded.append(min(1.0, history.get("avgWaveDuration", 0) / 300))

        # [28] Episode progress
        encoded.append(wave_num / 20.0)

        # [29] Damage variance
        if len(recent_5) >= 2:
            mean_d = sum(recent_5) / len(recent_5)
            variance = sum((d - mean_d) ** 2 for d in recent_5) / len(recent_5)
            encoded.append(min(1.0, variance ** 0.5 * 10))
        else:
            encoded.append(0.0)

        # === Context [30-34] ===
        encoded.extend([
            wave_num / 50,
            self._calculate_difficulty_trend(damages),
            estimate_player_skill(ctx.recent_damages if ctx else [], ctx.win_streak if ctx else 0),
            history.get("lastWaveThreat", 0) / 100,
            history.get("winStreak", 0) / 10,
        ])

        # === DPS by Damage Type [35-41] (Phase 5.5) ===
        damage_types = ["physical", "pierce", "siege", "magic", "fire", "ice", "poison"]
        dps_by_type = {dt: 0.0 for dt in damage_types}
        # Frontend pre-computes this via computeDpsByDamageType — if not in state, fall back to 0
        dps_by_type_state = state.get("dpsByDamageType", {})
        for dt in damage_types:
            encoded.append(min(1.0, dps_by_type_state.get(dt, 0.0)))

        # === Enemy Armor Distribution [42-46] (Phase 5.5) ===
        armor_types = ["unarmored", "light", "heavy", "fortified", "ethereal"]
        armor_dist = state.get("expectedArmorDistribution") or {}
        if not armor_dist:
            # Uniform fallback
            share = 1.0 / len(armor_types)
            armor_dist = {a: share for a in armor_types}
        for a in armor_types:
            encoded.append(armor_dist.get(a, 0))

        # === Research State [47-51] (Phase 5.5) ===
        research = state.get("research", {}) or {}
        total_count = research.get("totalCount", 0)
        completed_count = research.get("completedCount", 0)
        encoded.append(completed_count / total_count if total_count > 0 else 0)
        encoded.append(research.get("centerLevel", 0) / 3)
        max_slots = research.get("maxSlots", 0)
        slots_used = research.get("slotsUsed", 0)
        encoded.append(slots_used / max_slots if max_slots > 0 else 0)
        encoded.append(1.0 if research.get("airTargetingUnlocked", False) else 0.0)
        encoded.append(research.get("maxUpgradeTier", 1) / 3)

        # === Reserved [52] ===
        encoded.append(0)

        # ─── PHASE 5.6 AWARENESS BLOCK [53-105] (53 features) ───────────────

        # === Types-History [53-68] (16) ===
        # Each entry = fraction of last 5 waves in which this enemy type appeared.
        # Frontend sends enemyTypesUsed: string[][] (outer = wave, inner = types used that wave).
        enemy_types_history = history.get("enemyTypesUsed", []) or []
        recent_waves = enemy_types_history[-5:] if enemy_types_history else []
        window = max(1, len(recent_waves))
        for t in ENEMY_TYPES:
            count_in_window = sum(1 for wave_types in recent_waves if t in wave_types)
            encoded.append(count_in_window / window)

        # === Armor-History [69-73] (5) ===
        # Fraction of last 5 waves that contained each armor category.
        for a in armor_types:
            count_in_window = sum(
                1 for wave_types in recent_waves
                if any(ENEMY_ARMOR.get(t) == a for t in wave_types)
            )
            encoded.append(count_in_window / window)

        # === Damage-Pct-History [74-78] (5) ===
        # Same semantics as [15-19] — explicit duplication mirrors frontend.
        for i in range(5):
            idx = len(damages) - 5 + i
            encoded.append(damages[idx] if 0 <= idx < len(damages) else 0)

        # === Tower-Type Avg-Levels [79-87] (9) ===
        for t in tower_types:
            stats = dist.get(t, {}) or {}
            avg_lvl = stats.get("avgLevel", 0)
            encoded.append(min(1.0, (avg_lvl or 0) / 5))

        # === Defense Capabilities [88-91] (4) ===
        caps = defense.get("capabilities", {}) or {}
        encoded.append(1.0 if caps.get("hasAntiAir") else 0.0)
        encoded.append(1.0 if caps.get("hasSplash") else 0.0)
        encoded.append(1.0 if caps.get("hasSlow") else 0.0)
        encoded.append(1.0 if caps.get("hasDoT") else 0.0)

        # === Tower-Unlock Status [92-100] (9) ===
        tower_unlocked_map = (research or {}).get("towerUnlocked", {}) or {}
        for t in tower_types:
            encoded.append(1.0 if tower_unlocked_map.get(t) else 0.0)

        # === Near-Miss History [101-105] (5) ===
        near_miss_hist = history.get("nearMissPerWave", []) or []
        for i in range(5):
            idx = len(near_miss_hist) - 5 + i
            encoded.append(near_miss_hist[idx] if 0 <= idx < len(near_miss_hist) else 0)

        # ─── PHASE 5.7 SELF-AWARENESS BLOCK [106-130] (25 features) ─────────
        # All five histories are PER-CLIENT (read from ctx). If ctx is missing
        # (shouldn't happen in practice), we zero-fill so the vector stays the
        # correct size and the model's first evaluate call doesn't crash.

        # === Reward-History [106-110] (5) ===
        # Last 5 total rewards, clipped to [-2, +2] then normalized to [-1, +1].
        recent_rewards = ctx.recent_rewards if ctx else []
        for i in range(5):
            idx = len(recent_rewards) - 5 + i
            if 0 <= idx < len(recent_rewards):
                r = recent_rewards[idx]
                encoded.append(max(-1.0, min(1.0, r / 2.0)))
            else:
                encoded.append(0.0)

        # === Wave-Size-History [111-115] (5) ===
        # Last 5 totalCount values, normalized min(1, count/500).
        recent_wave_sizes = ctx.recent_wave_sizes if ctx else []
        for i in range(5):
            idx = len(recent_wave_sizes) - 5 + i
            if 0 <= idx < len(recent_wave_sizes):
                encoded.append(min(1.0, recent_wave_sizes[idx] / 500.0))
            else:
                encoded.append(0.0)

        # === Kill-Time-History [116-120] (5) ===
        # Last 5 kill_time values, normalized (value - KT_MIN) / (KT_MAX - KT_MIN).
        from config import KILL_TIME_MIN, KILL_TIME_MAX
        kt_span = max(0.001, KILL_TIME_MAX - KILL_TIME_MIN)
        recent_kill_times = ctx.recent_kill_times if ctx else []
        for i in range(5):
            idx = len(recent_kill_times) - 5 + i
            if 0 <= idx < len(recent_kill_times):
                normed = (recent_kill_times[idx] - KILL_TIME_MIN) / kt_span
                encoded.append(max(0.0, min(1.0, normed)))
            else:
                encoded.append(0.0)

        # === Count-Factor-History [121-125] (5) ===
        # Last 5 count_factor values (already [0, 1]).
        recent_count_factors = ctx.recent_count_factors if ctx else []
        for i in range(5):
            idx = len(recent_count_factors) - 5 + i
            if 0 <= idx < len(recent_count_factors):
                encoded.append(max(0.0, min(1.0, recent_count_factors[idx])))
            else:
                encoded.append(0.0)

        # === Armor-Dominance-Share [126-130] (5) ===
        # Per category share over last 30 waves (dominant armor per wave).
        armor_flat = ctx.recent_armor_categories_flat if ctx else []
        from config import ARMOR_DOMINANCE_WINDOW
        window_flat = armor_flat[-ARMOR_DOMINANCE_WINDOW:] if armor_flat else []
        total_in_window = max(1, len(window_flat))
        for a in armor_types:
            cnt = sum(1 for x in window_flat if x == a)
            encoded.append(cnt / total_in_window)

        # ─── SPATIAL BLOCK [131-170] (40 features) ──────────────────────────
        dps_profile = state.get("dpsProfile", {})
        ground_dps = dps_profile.get("groundDPS", [0] * 20)
        air_dps = dps_profile.get("airDPS", [0] * 20)

        # Store profile in context for reward computation
        if ctx:
            ctx.ground_dps_profile = ground_dps[:20]
            ctx.air_dps_profile = air_dps[:20]

        # Ground DPS [131-150]
        for i in range(20):
            encoded.append(ground_dps[i] if i < len(ground_dps) else 0)

        # Air DPS [151-170]
        for i in range(20):
            encoded.append(air_dps[i] if i < len(air_dps) else 0)

        return encoded[:INPUT_SIZE]

    def _decode_action(self, action, state=None, ctx=None):
        """Convert model action to wave config (Phase 5.5: Top-K multi-group mixed waves)."""
        enemy_types = ENEMY_TYPES  # 16 types from config
        probs = action["enemy_probs"][0].detach().numpy()  # 16 enemy type probabilities

        # Get wave number
        wave_num = state.get("waveNumber", 0) if state else 0

        # Extract model outputs
        kill_time = action["kill_time"][0].detach().item()
        count_t = action["count_factor"][0].detach().item()
        delay_t = action["delay_factor"][0].detach().item()
        variation = action["variation"][0].detach().item()

        # Apply fairness mask (same logic as frontend)
        research = state.get("research", {}) if state else {}
        masked_probs = self._apply_fairness_mask(probs, research)

        # Count: PRIMARY difficulty knob, but gated by what the defense can
        # actually kill in WAVE_BUDGET_S seconds. Strong defense + low-HP enemies
        # → thousands of mobs legitimately possible. Weak defense → small wave.
        # Wave stays challenging (slack > 1.0) but beatable — never unwinnable.
        from config import (
            WAVE_COUNT_MIN_BASE, WAVE_COUNT_CAP, WAVE_COUNT_FLOOR,
            WAVE_BUDGET_S, WAVE_COUNT_SLACK, HEALTH_MULTIPLIER_MAX,
        )
        defense = state.get("defense", {}) if state else {}
        tower_count = max(1, defense.get("towerCount", 1))
        total_dps = max(25.0, float(defense.get("totalDPS", 25)))

        # Expected per-enemy HP for capacity-planning. Use a fixed reference
        # (median baseHP × typical multiplier) instead of the AI's kill_time
        # derived HP — otherwise kill_capacity collapses to a constant, and
        # stronger defense wouldn't unlock bigger waves. This way:
        #   DPS=100  → capacity ~20  (early game)
        #   DPS=800  → capacity ~160
        #   DPS=3000 → capacity ~600 (mid-late game)
        #   DPS=10000→ capacity ~2000 (endgame)
        # Swarm waves (rats, baseHP=5) are even larger in practice since the
        # healthMultiplier cap bites — the AI is free to exploit that.
        REFERENCE_ENEMY_HP = 300.0   # median baseHP × typical mult (~100 × 3)
        kill_capacity = (total_dps * WAVE_BUDGET_S) / REFERENCE_ENEMY_HP

        min_count = max(WAVE_COUNT_MIN_BASE, tower_count + 1)
        max_count = min(WAVE_COUNT_CAP, int(max(WAVE_COUNT_FLOOR, kill_capacity * WAVE_COUNT_SLACK)))
        if max_count <= min_count:
            max_count = min_count + 5
        total_count = int(min_count + count_t * (max_count - min_count))

        # Spawn delay: compress for large waves so all enemies fit inside
        # WAVE_BUDGET_S (wave shouldn't drag on much longer than the budget).
        from config import SPAWN_DELAY_MIN, SPAWN_DELAY_MAX
        base_delay = int(SPAWN_DELAY_MIN + delay_t * (SPAWN_DELAY_MAX - SPAWN_DELAY_MIN))
        target_window_ms = WAVE_BUDGET_S * 1000
        if total_count * base_delay > target_window_ms:
            base_delay = int(target_window_ms / max(1, total_count))
        # Floor 5ms → at 2000 enemies = 10s spawn window = actual horde feeling
        # (was 50ms = 100s which killed swarm impact).
        spawn_delay = max(5, base_delay)

        # Top-K multi-group selection
        groups = self._select_enemy_groups_top_k(
            masked_probs, total_count, wave_num, ctx
        )

        # Compute health multiplier per group
        enemies = []
        for group in groups:
            is_air = group["type"] in AIR_ENEMIES
            effective_dps = max(10, defense.get("antiAirDPS", 10)) if is_air \
                else max(25, defense.get("totalDPS", 25))
            enemy_hp = effective_dps * kill_time
            enemy_base_hp = ctx.enemy_base_hp if ctx and ctx.enemy_base_hp else ENEMY_BASE_HP
            base_hp = enemy_base_hp.get(group["type"], 80)
            health_mult = min(enemy_hp / base_hp, HEALTH_MULTIPLIER_MAX)
            enemies.append({
                "type": group["type"],
                "count": group["count"],
                "healthMultiplier": round(health_mult, 2),
                "speedMultiplier": 1.0,
            })

        dominant_type = enemies[0]["type"] if enemies else "zombie"

        config = {
            "enemies": enemies,
            "totalCount": total_count,
            "spawnDelay": spawn_delay,
            "spawnDelayVariation": variation,
            # Pattern for mixed waves — hardcoded 'interleaved' (AB AB AB)
            "pattern": "interleaved" if len(enemies) > 1 else None,
            "useGathering": False,
            "confidence": 0.8,
            "archetype": self._infer_archetype(dominant_type, total_count),
        }

        # Compute dominant-group HP/DPS for dashboard (backwards-compat)
        dominant_is_air = dominant_type in AIR_ENEMIES
        dominant_eff_dps = (max(10, defense.get("antiAirDPS", 10)) if dominant_is_air
                            else max(25, defense.get("totalDPS", 25)))
        dominant_enemy_hp = dominant_eff_dps * kill_time

        # Extended wave info for logging/dashboard
        wave_info = {
            "kill_time": kill_time,
            "enemy_hp": dominant_enemy_hp,
            "effective_dps": dominant_eff_dps,
            "count": total_count,
            "count_factor": count_t,
            "delay_factor": delay_t,
            "variation": variation,
            "spawn_delay": spawn_delay,
            "type_probs": {enemy_types[i]: round(float(probs[i]), 4) for i in range(len(enemy_types))},
            "masked_probs": {enemy_types[i]: round(float(masked_probs[i]), 4) for i in range(len(enemy_types))},
            "groups": enemies,
            "num_groups": len(enemies),
            "final_type": dominant_type,
            # Phase 5.5: damage/armor/research signals (for dashboard observability)
            # armor_dist: deterministisch aus den gerade entschiedenen enemies-Gruppen
            # berechnen. State.expectedArmorDistribution stammt noch aus der VORIGEN
            # Wave → stale/None. Hier zählen wir die tatsächliche Verteilung der
            # Wave, die wir gerade zurücksenden.
            "armor_dist": _compute_armor_dist(enemies),
            "dps_by_type": state.get("dpsByDamageType") if state else None,
            "research": {
                "centerLevel": (state.get("research", {}) or {}).get("centerLevel", 0),
                "completedCount": (state.get("research", {}) or {}).get("completedCount", 0),
                "totalCount": (state.get("research", {}) or {}).get("totalCount", 0),
                "maxUpgradeTier": (state.get("research", {}) or {}).get("maxUpgradeTier", 1),
                "airTargetingUnlocked": (state.get("research", {}) or {}).get("airTargetingUnlocked", False),
                "completedIds": (state.get("research", {}) or {}).get("completedIds", []),
            } if state else None,
        }

        return config, wave_info

    def _apply_fairness_mask(self, probs, research):
        """Zero out probs for enemies without available counter-tech, renormalize."""
        import numpy as np
        tower_unlocked = research.get("towerUnlocked", {}) if research else {}
        air_targeting = research.get("airTargetingUnlocked", False) if research else False

        has_anti_air = (
            tower_unlocked.get("ice", False) or
            tower_unlocked.get("rocket", False) or
            air_targeting
        )
        has_ethereal_counter = (
            tower_unlocked.get("magic", False) or
            tower_unlocked.get("ice", False)
        )

        masked = probs.copy()
        for i, t in enumerate(ENEMY_TYPES):
            if t in AIR_ENEMIES and not has_anti_air:
                masked[i] = 0
            elif t in ETHEREAL_ENEMIES and not has_ethereal_counter:
                masked[i] = 0

        s = masked.sum()
        if s <= 0:
            return probs  # nothing allowed — fall back to original
        return masked / s

    def _select_enemy_groups_top_k(self, probs, total_count, wave_num, ctx):
        """Top-K selection: returns list of {type, count} dicts.
        Matches frontend selectEnemyGroupsTopK logic.
        """
        # Early wave: force zombie
        if wave_num < 2:
            return [{"type": "zombie", "count": total_count}]

        # Waves 2-3: single unarmored-pool type
        if wave_num < 4:
            allowed_types = ["zombie", "rat", "penguin"]
            allowed_idx = [ENEMY_TYPES.index(t) for t in allowed_types if t in ENEMY_TYPES]
            allowed_probs = [probs[i] for i in allowed_idx]
            best_idx = allowed_idx[allowed_probs.index(max(allowed_probs))]
            return [{"type": ENEMY_TYPES[best_idx], "count": total_count}]

        # Wave 4+: Top-K with threshold
        candidates = [(i, probs[i]) for i in range(len(probs)) if probs[i] > MIXED_WAVE_THRESHOLD]
        candidates.sort(key=lambda x: -x[1])
        candidates = candidates[:MIXED_WAVE_MAX_GROUPS]

        # Fallback: nothing above threshold → argmax
        if not candidates:
            i = int(probs.argmax())
            return [{"type": ENEMY_TYPES[i], "count": total_count}]

        # Allocate counts proportional to probs (last group gets remainder)
        prob_sum = sum(p for _, p in candidates)
        groups = []
        allocated = 0
        for idx, (i, p) in enumerate(candidates):
            if idx == len(candidates) - 1:
                count = max(1, total_count - allocated)
            else:
                count = max(1, round(total_count * (p / prob_sum)))
                allocated += count
            groups.append({"type": ENEMY_TYPES[i], "count": count})
        return groups

    def _infer_archetype(self, dominant_type, count):
        """Infer wave archetype from dominant enemy type."""
        if dominant_type == "herbert":
            return "boss"
        elif dominant_type == "bat":
            return "air"
        elif dominant_type in ["tank", "wallsmasher"]:
            return "siege"
        elif dominant_type == "penguin":
            return "swarm"
        elif count > 30:
            return "swarm"
        elif count < 10:
            return "elite"
        else:
            return "mixed"

    def _process_result(self, ctx, client_id, wave_num, result, state_after=None,
                        effective_progress=None, max_progress=0, near_miss_ratio=0, progress_std=0):
        """Process wave result and train. Returns (reward, breakdown)."""
        damage_pct = result.get("damagePercent", 0)

        # Use pre-normalized effective progress (normalized by defense reach)
        avg_progress = effective_progress if effective_progress is not None else result.get("avgPathProgressPercent", 0)

        # Update per-client context
        ctx.recent_damages.append(damage_pct)
        if len(ctx.recent_damages) > 10:
            ctx.recent_damages.pop(0)
        ctx.recent_progress.append(avg_progress)
        if len(ctx.recent_progress) > 20:
            ctx.recent_progress.pop(0)

        if result.get("wasCloseCall"):
            ctx.consecutive_close_calls += 1
        else:
            ctx.consecutive_close_calls = 0

        # Calculate reward with normalized progress + distribution metrics
        normalized_result = dict(result)
        normalized_result["avgPathProgressPercent"] = avg_progress
        normalized_result["maxPathProgress"] = max_progress
        normalized_result["nearMissRatio"] = near_miss_ratio
        normalized_result["progressStd"] = progress_std
        # Current wave's enemy type for variety bonus
        normalized_result["enemy_types"] = ctx.enemy_types_used[-1] if ctx.enemy_types_used else []

        context = {
            "wave_number": wave_num,
            "recent_damages": ctx.recent_damages,
            "enemy_types_used": ctx.enemy_types_used[:-1],  # History before current wave
            "recent_types_flat": ctx.recent_types_flat,  # For monotony penalty
            "recent_armor_categories": ctx.recent_armor_categories,  # For armor-diversity
            # Phase 5.7: flat 30-wave armor log feeds Armor-Dominance-Penalty.
            "recent_armor_categories_flat": ctx.recent_armor_categories_flat,
            "consecutive_close_calls": ctx.consecutive_close_calls,
        }

        reward, breakdown = calculate_reward(normalized_result, context, state_before=ctx.state_before_wave, state_after=state_after)

        if reward > self.best_reward:
            self.best_reward = reward

        # Phase 5.7: track reward in per-client history so next state's encoder
        # can expose it (self-awareness — the net sees what it just earned).
        ctx.recent_rewards.append(float(reward))
        if len(ctx.recent_rewards) > 5:
            ctx.recent_rewards = ctx.recent_rewards[-5:]

        # Pair reward with this client+wave's pending state
        self.trainer.store_result(client_id, wave_num, reward)

        return reward, breakdown

    def _select_bot(self, ctx):
        """Select random bot type for next game."""
        rand = random.random()
        cumulative = 0
        for bot_type, weight in BOT_WEIGHTS.items():
            cumulative += weight
            if rand < cumulative:
                ctx.current_bot = bot_type
                break

    def _reset_context(self, ctx):
        """Reset context for new game."""
        ctx.current_state = None
        ctx.state_before_wave = None
        ctx.recent_damages = []
        ctx.recent_progress = []
        ctx.enemy_types_used = []
        ctx.consecutive_close_calls = 0
        # Phase 5.7: reset self-awareness histories on new game. Armor-
        # dominance-flat deliberately NOT reset — it's a longer-term signal
        # that reflects the policy across multiple games.
        ctx.recent_rewards = []
        ctx.recent_wave_sizes = []
        ctx.recent_kill_times = []
        ctx.recent_count_factors = []

    def _calculate_difficulty_trend(self, damages):
        """Calculate difficulty trend matching TypeScript's implementation.
        Returns 0-1: 0.5 = stable, >0.5 = increasing, <0.5 = decreasing."""
        if len(damages) < 2:
            return 0.5
        recent = damages[-3:] if len(damages) >= 3 else damages[-2:]
        older = damages[:-len(recent)]
        if not older:
            return 0.5
        recent_avg = sum(recent) / len(recent)
        older_avg = sum(older) / len(older)
        trend = recent_avg - older_avg
        return max(0.0, min(1.0, 0.5 + trend * 5))

    async def _broadcast_stats(self):
        """Send stats to all clients."""
        stats = self._get_stats()
        msg = json.dumps({"type": "stats", "data": stats})
        for client in self.clients:
            try:
                await client.send(msg)
            except Exception:
                pass

    async def broadcast_client_command(self, cmd: str) -> int:
        """Send a control command to every connected training client.

        Backend holds authoritative training_state. 'start'/'stop' flip it;
        newly-connected clients read it from the `connected` message and
        auto-sync. 'reload' is transient and doesn't change the state.

        Client behavior:
          - 'reload': window.location.reload() — fresh engine state
          - 'start':  enable bot + training timescale (resume training)
          - 'stop':   disable bot + timescale 1 (pause training, keep game)
        Returns the number of clients that received the message.
        """
        if cmd == 'start':
            self.training_state = 'running'
        elif cmd == 'stop':
            self.training_state = 'paused'
        msg = json.dumps({"type": "control", "action": cmd})
        delivered = 0
        for client in list(self.clients):
            try:
                await client.send(msg)
                delivered += 1
            except Exception:
                pass
        print(f"[control] broadcast '{cmd}' -> {delivered}/{len(self.clients)} clients (state={self.training_state})")
        return delivered

    async def _send_stats(self, ws):
        """Send stats to specific client."""
        stats = self._get_stats()
        await ws.send(json.dumps({"type": "stats", "data": stats}))

    def _get_stats(self):
        """Get current training stats."""
        import math
        avg_reward = self.total_reward / max(1, self.episode)
        # Handle inf/nan for JSON serialization
        best = self.best_reward if math.isfinite(self.best_reward) else 0.0
        # Active display-IDs (same id mapping as record_episode/record_wave use)
        active_display_ids = sorted({cid % 10000 for cid in self.client_contexts.keys()})
        return {
            "episode": self.episode,
            "avgReward": round(avg_reward, 3),
            "bestReward": round(best, 3),
            "gamesPlayed": self.games_played,
            "winRate": 0,  # TODO: Track
            "clientCount": len(self.clients),
            "trainingState": self.training_state,
            "activeClientIds": active_display_ids,
        }

    def _export_model(self, version):
        """Export model to TensorFlow.js format."""
        # Save PyTorch model
        path = f"exports/wave-director-{version}.pt"
        Path("exports").mkdir(exist_ok=True)
        save_model(self.model, path)

        # TODO: Convert to ONNX then TF.js
        # For now, just save PyTorch model

        return path


async def main():
    """Start the training server + optional dashboard."""
    server = TrainingServer()

    # Start TUI
    logger.start()

    # Initialize before try block so `finally` can always access it
    dashboard_task = None

    try:
        # Start WebSocket training server
        ws_server = await websockets.serve(
            server.handle_client,
            SERVER_HOST,
            SERVER_PORT,
            ping_interval=None,  # Disable ping (browser busy with 3D rendering)
            ping_timeout=None,
            close_timeout=30,
        )
        logger.server_started(SERVER_HOST, SERVER_PORT, server.episode)

        # Start dashboard if available
        if _dashboard:
            try:
                import uvicorn
                config = uvicorn.Config(
                    _dashboard.app,
                    host="0.0.0.0",
                    port=3002,
                    log_level="warning",
                )
                dashboard_server = uvicorn.Server(config)
                dashboard_task = asyncio.create_task(dashboard_server.serve())
                logger.debug("Dashboard started on http://0.0.0.0:3002")
            except ImportError:
                logger.debug("uvicorn not installed, dashboard disabled")

        await asyncio.Future()  # Run forever
    except asyncio.CancelledError:
        logger.server_shutdown()
    finally:
        if dashboard_task:
            dashboard_task.cancel()
        logger.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.server_shutdown()
        logger.stop()
    except Exception as e:
        logger.error(f"Server error: {e}")
        logger.stop()
