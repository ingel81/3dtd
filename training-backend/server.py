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
import time
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
    MAX_TEMPLATE_SLOTS,
    ENEMY_BASE_HP,
    ENEMY_TYPES,
    ENEMY_ARMOR,
    AIR_ENEMIES,
    ETHEREAL_ENEMIES,
    TEMPLATE_COOLDOWN_WAVES,
)
from templates import TEMPLATES, get_template, get_available_template_mask, NUM_ACTIVE_TEMPLATES
from model import create_model, save_model, load_model
from reward import calculate_reward
from trainer import PPOTrainer
from auto_logger import logger


def _estimate_player_skill(recent_damages: list, win_streak: int) -> float:
    """Skill heuristic: inverse of damage taken + streak bonus. [0..1]."""
    if not recent_damages:
        return 0.5
    avg_damage = sum(recent_damages) / len(recent_damages)
    streak_bonus = min(0.2, win_streak * 0.04)
    return max(0.0, min(1.0, 1.0 - avg_damage + streak_bonus))

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
    """Per-client training context (Phase 5.10 — trimmed)."""

    def __init__(self):
        self.current_state = None
        self.state_before_wave = None
        self.current_bot = "casual"
        # Reward-relevant history
        self.recent_damages = []        # last 10 damagePercent for skill estimation
        self.recent_progress = []       # last 20 avg_progress values
        self.enemy_types_used = []      # history of types per wave (for Phase 5.6 encoder features)
        # Phase 5.10: template-cooldown tracking
        self.recent_template_indices = []  # last 2 template indices for cooldown mask
        # Meta
        self.win_streak = 0
        self.wave_num = 0
        self.last_template_idx = None   # Last template idx (for dashboard)
        self.last_wave_info = None      # Last wave info (for dashboard)
        self.enemy_base_hp = None       # Set from game_start (frontend is source of truth)


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
        # Phase 5.14: live 1Hz status from clients (display_id → {wave,enemiesAlive,phase,ts})
        self.client_statuses: dict[int, dict] = {}

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
            # Drop live-status entry
            self.client_statuses.pop(client_id % 10000, None)
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

            # Phase 5.10: track only template-idx for cooldown, plus the types
            # that actually landed in this wave (for Phase 5.6 encoder features).
            wave_all_types = [g["type"] for g in wave_config["enemies"]]
            ctx.last_template_idx = wave_info.get("template_idx")
            ctx.last_wave_info = wave_info
            ctx.enemy_types_used.append(wave_all_types)
            if len(ctx.enemy_types_used) > 20:
                ctx.enemy_types_used = ctx.enemy_types_used[-20:]
            tmpl_idx = wave_info.get("template_idx")
            if tmpl_idx is not None:
                ctx.recent_template_indices.append(int(tmpl_idx))
                if len(ctx.recent_template_indices) > 5:
                    ctx.recent_template_indices = ctx.recent_template_indices[-5:]

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
                # Game-over tracking: the frontend's explicit `game_over` message
                # isn't always sent (notifyGameOver is defined but never called).
                # Use the authoritative signal from the wave result instead — if
                # the player has no lives left, this wave ended the game.
                if state_after:
                    player_lives = (state_after.get("player") or {}).get("lives", 1)
                    if player_lives is not None and player_lives <= 0:
                        self.dashboard.record_game_over()
                enemy_type = ctx.enemy_types_used[-1][0] if ctx.enemy_types_used and ctx.enemy_types_used[-1] else '?'
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

                    # Dashboard sparklines: kill-time, enemy-hp, DPS, dps-by-type, research.
                    # Phase 5.11 no longer computes these in _decode_action — pull them
                    # from the authoritative post-wave state + outcome for the UI only.
                    ctx.last_wave_info["effective_dps"] = float(defense.get("totalDPS", 0) or 0)
                    ctx.last_wave_info["dps_by_type"] = state_after.get("dpsByDamageType") or {}
                    ctx.last_wave_info["research"] = state_after.get("research") or {}
                    # Kill-time = wave duration in seconds (outcome.waveDurationMs or fallback).
                    kill_time_ms = outcome.get("waveDurationMs")
                    if kill_time_ms is not None:
                        ctx.last_wave_info["kill_time"] = round(float(kill_time_ms) / 1000.0, 2)
                    # Approximate per-enemy HP from template base × hp-multiplier. Good enough
                    # for a dashboard sparkline; exact values would need frontend telemetry.
                    groups = ctx.last_wave_info.get("groups") or []
                    hp_mult = float(ctx.last_wave_info.get("health_mult", 1.0))
                    if groups and ctx.enemy_base_hp:
                        total_hp = 0.0
                        total_n = 0
                        for g in groups:
                            base_hp = float(ctx.enemy_base_hp.get(g.get("type"), 0) or 0)
                            n = int(g.get("count", 0) or 0)
                            total_hp += base_hp * hp_mult * n
                            total_n += n
                        if total_n > 0:
                            ctx.last_wave_info["enemy_hp"] = round(total_hp / total_n, 1)
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

        elif msg_type == "status":
            # Phase 5.14: 1Hz live status push from client. Stored per-client
            # so the dashboard can show live wave + enemies-alive without
            # waiting for post-wave results.
            display_id = client_id % 10000
            self.client_statuses[display_id] = {
                "wave": int(msg.get("wave", 0) or 0),
                "enemiesAlive": int(msg.get("enemiesAlive", 0) or 0),
                "phase": msg.get("phase", "setup"),
                "ts": time.time(),
            }

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
        """Get action from model (Phase 5.10: template-based with mask)."""
        # Convert state to tensor
        state_tensor = torch.tensor(
            self._encode_state(state, ctx),
            dtype=torch.float32,
        ).unsqueeze(0)

        # Build template availability mask based on current wave + capabilities
        wave_num = state.get("waveNumber", 0)
        research = state.get("research", {}) or {}
        tower_unlocked = research.get("towerUnlocked", {}) or {}
        air_targeting = research.get("airTargetingUnlocked", False)
        has_anti_air = bool(
            tower_unlocked.get("ice") or tower_unlocked.get("rocket") or air_targeting
        )
        has_anti_ethereal = bool(
            tower_unlocked.get("magic") or tower_unlocked.get("ice")
        )
        recent_tpls = ctx.recent_template_indices if ctx else []
        mask_list = get_available_template_mask(
            current_wave=wave_num + 1,  # state.waveNumber is "current", we plan N+1
            has_anti_air=has_anti_air,
            has_anti_ethereal=has_anti_ethereal,
            recent_template_indices=recent_tpls,
            cooldown_waves=TEMPLATE_COOLDOWN_WAVES,
        )
        mask_tensor = torch.tensor([mask_list], dtype=torch.bool)

        # Get action with log_prob for PPO ratio
        with torch.no_grad():
            action, log_prob, _ = self.model.get_action(state_tensor, template_mask=mask_tensor)

        # Store state paired with (client_id, wave_num+1) for proper result pairing
        if client_id is not None and ctx is not None:
            raw_params = action.get("raw_params")
            template_idx = action.get("template_idx")
            self.trainer.store_action(
                client_id, ctx.wave_num + 1,
                state_tensor.squeeze(0),
                action_tensor=raw_params.squeeze(0) if raw_params is not None else None,
                enemy_idx=template_idx.squeeze(0) if template_idx is not None else None,
                log_prob=log_prob.squeeze(0),
                template_mask=mask_tensor.squeeze(0),
            )

        return action

    def _encode_state(self, state, ctx=None):
        """Convert game state dict to flat 156-feature array (Phase 5.10).

        Layout (156 features):
        [0-3]     Player: credits, lives%, wave, time (4)
        [4-5]     Tower: count, avgLevel (2)
        [6-14]    Tower Type Counts: 9 types (9)
        [15-19]   History Damage: last 5 waves (5)
        [20-24]   History Progress: last 5 waves avg_progress (5)
        [25-29]   Wave Signals: momentum, avgDmg, duration, episodeProgress, variance (5)
        [30-34]   Context: wave, trend, skill, lastThreat, winStreak (5)
        [35-41]   DPS by Damage Type (7)
        [42-46]   Enemy Armor Distribution (5)
        [47-51]   Research State (5)
        [52]      Reserved (1)
        --- Phase 5.6 Awareness Block ---
        [53-68]   Types-History: per-type frequency over last 5 waves (16)
        [69-73]   Armor-History (5)
        [74-78]   Damage-Pct-History (5)
        [79-87]   Tower-Type Avg-Levels (9)
        [88-91]   Defense Capabilities (4)
        [92-100]  Tower-Unlock-Status (9)
        [101-105] Near-Miss-History (5)
        --- Gap-5 Armor-Matrix Block ---
        [106-110] Effective DPS vs Armor (ground) (5)
        [111-115] Effective DPS vs Armor (air) (5)
        --- Spatial Block ---
        [116-135] Ground DPS Profile (20)
        [136-155] Air DPS Profile (20)
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
            _estimate_player_skill(ctx.recent_damages if ctx else [], ctx.win_streak if ctx else 0),
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

        # ─── GAP-5 EFFECTIVE-DPS-PER-ARMOR [106-115] (10 features) ──────────
        # Armor-matrix weighted effective DPS, split into ground/air. Gives the
        # net an explicit per-armor view of the player's damage pipeline (closes
        # the armor-agnostic gap of the raw DPS profile).
        eff = (state.get("defense") or {}).get("effectiveDPSPerArmor") or {}
        eff_ground = eff.get("ground") or {}
        eff_air = eff.get("air") or {}
        MAX_EFF_DPS = 500.0
        # Ground [106-110]
        for a in armor_types:
            val = float(eff_ground.get(a, 0.0))
            encoded.append(max(0.0, min(1.0, val / MAX_EFF_DPS)))
        # Air [111-115]
        for a in armor_types:
            val = float(eff_air.get(a, 0.0))
            encoded.append(max(0.0, min(1.0, val / MAX_EFF_DPS)))

        # ─── SPATIAL BLOCK [116-155] (40 features) ──────────────────────────
        dps_profile = state.get("dpsProfile", {})
        ground_dps = dps_profile.get("groundDPS", [0] * 20)
        air_dps = dps_profile.get("airDPS", [0] * 20)

        # Ground DPS [116-135]
        for i in range(20):
            encoded.append(ground_dps[i] if i < len(ground_dps) else 0)

        # Air DPS [136-155]
        for i in range(20):
            encoded.append(air_dps[i] if i < len(air_dps) else 0)

        return encoded[:INPUT_SIZE]

    def _decode_action(self, action, state=None, ctx=None):
        """Phase 5.11: Range-based template decoding with DPS-scaled difficulty caps.

        NN produces template_idx + 4 factors in [0,1]. The decoder interpolates
        each factor into the template's designer-set range. For COUNT and
        HP_MULT the upper end is scaled by defense.totalDPS so wave 1 (low
        DPS) can't oversized — prevents "everything overflows" lock-in early.
        """
        from config import (
            MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS,
            DPS_RAMP_FLOOR, DPS_RAMP_COUNT, DPS_RAMP_HP_MULT,
        )

        template_idx = int(action["template_idx"][0].detach().item())
        count_factor = float(action["count_factor"][0].detach().item())
        spawn_factor = float(action["spawn_factor"][0].detach().item())
        hp_factor = float(action["hp_factor"][0].detach().item())
        variation_factor = float(action["variation_factor"][0].detach().item())

        template = get_template(template_idx)
        if template is None:
            template = TEMPLATES[0]
            template_idx = 0

        # DPS-scaled frac: 0 DPS → FLOOR, DPS_RAMP_X → 1.0.
        defense = (state or {}).get("defense") or {}
        total_dps = max(0.0, float(defense.get("totalDPS", 0) or 0))
        dps_frac_count = max(DPS_RAMP_FLOOR, min(1.0, total_dps / DPS_RAMP_COUNT))
        dps_frac_hp = max(DPS_RAMP_FLOOR, min(1.0, total_dps / DPS_RAMP_HP_MULT))

        def lerp(rng, t):
            return rng[0] + (rng[1] - rng[0]) * t

        def lerp_capped(rng, factor, dps_frac):
            """Lerp where the range-max is dps-scaled: min + (max-min)*dps_frac."""
            eff_max = rng[0] + (rng[1] - rng[0]) * dps_frac
            return rng[0] + (eff_max - rng[0]) * factor

        total_count = max(1, round(lerp_capped(template["count_range"], count_factor, dps_frac_count)))
        spawn_delay = max(MIN_SPAWN_DELAY_MS, int(lerp(template["spawn_delay_range"], spawn_factor)))
        hp_mult = round(lerp_capped(template["hp_mult_range"], hp_factor, dps_frac_hp), 3)
        variation = round(lerp(template["variation_range"], variation_factor), 3)

        # Wave-duration cap: compress spawn_delay if (count × spawn_delay) would exceed 3 min.
        total_duration = total_count * spawn_delay
        if total_duration > MAX_WAVE_DURATION_MS:
            spawn_delay = max(MIN_SPAWN_DELAY_MS, MAX_WAVE_DURATION_MS // total_count)

        # Expand template → enemy groups
        enemies = []
        allocated = 0
        for i, (enemy_type, share) in enumerate(template["enemies"]):
            if i == len(template["enemies"]) - 1:
                count = max(1, total_count - allocated)
            else:
                count = max(1, round(total_count * share))
                allocated += count
            enemies.append({
                "type": enemy_type,
                "count": count,
                "healthMultiplier": hp_mult,
                "speedMultiplier": 1.0,
            })

        final_total = sum(e["count"] for e in enemies)

        config = {
            "enemies": enemies,
            "totalCount": final_total,
            "spawnDelay": spawn_delay,
            "spawnDelayVariation": variation,
            "pattern": template.get("spawn_pattern"),
            "useGathering": False,
            "confidence": round(float(action["template_probs"][0, template_idx].item()), 4),
            "templateIdx": template_idx,
            "templateName": template["name"],
            "templateStrength": hp_mult,
        }

        wave_info = {
            "template_idx": template_idx,
            "template_id": template["id"],
            "template_name": template["name"],
            "template_description": template["description"],
            "count_factor": round(count_factor, 3),
            "spawn_factor": round(spawn_factor, 3),
            "hp_factor": round(hp_factor, 3),
            "variation_factor": round(variation_factor, 3),
            "count": final_total,
            "spawn_delay": spawn_delay,
            "variation": variation,
            "health_mult": hp_mult,
            "num_groups": len(enemies),
            "groups": enemies,
            "armor_dist": _compute_armor_dist(enemies),
            "template_probs": {
                TEMPLATES[i]["id"]: round(float(action["template_probs"][0, i].item()), 4)
                for i in range(NUM_ACTIVE_TEMPLATES)
            },
        }

        return config, wave_info

    def _process_result(self, ctx, client_id, wave_num, result, state_after=None,
                        effective_progress=None, max_progress=0, near_miss_ratio=0, progress_std=0):
        """Phase 5.10: simplified reward pipeline (4 terms only)."""
        damage_pct = result.get("damagePercent", 0)
        avg_progress = effective_progress if effective_progress is not None else result.get("avgPathProgressPercent", 0)

        # Update per-client history for state encoder features
        ctx.recent_damages.append(damage_pct)
        if len(ctx.recent_damages) > 10:
            ctx.recent_damages.pop(0)
        ctx.recent_progress.append(avg_progress)
        if len(ctx.recent_progress) > 20:
            ctx.recent_progress.pop(0)

        # Build reward input
        survived = bool(state_after and state_after.get("player", {}).get("lives", 0) > 0) \
            if state_after else not bool(result.get("gameOver", False))
        wave_result = {
            "damagePercent": damage_pct,
            "totalCount": int(result.get("enemiesSpawned", 0)),
            "survived": survived,
            "avgProgress": avg_progress,
        }
        context = {"wave_number": wave_num}

        reward, breakdown = calculate_reward(wave_result, context)

        if reward > self.best_reward:
            self.best_reward = reward

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
        """Reset per-client context on new game."""
        ctx.current_state = None
        ctx.state_before_wave = None
        ctx.recent_damages = []
        ctx.recent_progress = []
        ctx.enemy_types_used = []
        ctx.recent_template_indices = []

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

    async def broadcast_client_command(self, cmd: str, value=None) -> int:
        """Send a control command to every connected training client.

        Supported commands (Phase 5.14 extended):
          - 'start'          : enable bot + timescale 75
          - 'stop'           : disable bot + timescale 1
          - 'reload'         : hard-reload tab (fresh engine)
          - 'set_timescale'  : value=number — set game speed
          - 'set_rendering'  : value=bool   — enable/disable 3D render

        Returns the number of clients that received the message.
        """
        if cmd == 'start':
            self.training_state = 'running'
        elif cmd == 'stop':
            self.training_state = 'paused'
        payload = {"type": "control", "action": cmd}
        if value is not None:
            payload["value"] = value
        msg = json.dumps(payload)
        delivered = 0
        for client in list(self.clients):
            try:
                await client.send(msg)
                delivered += 1
            except Exception:
                pass
        print(f"[control] broadcast '{cmd}' value={value} -> {delivered}/{len(self.clients)} clients")
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
