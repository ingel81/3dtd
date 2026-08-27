"""
Training Backend Server

WebSocket server that:
- Receives game state from browser
- Returns wave configurations from AI
- Trains the model on results
"""

import argparse
import asyncio
import json
import os
import random
import shutil
import time
from datetime import datetime
from pathlib import Path

import websockets
import torch

from config import (
    SERVER_HOST,
    SERVER_PORT,
    DASHBOARD_PORT,
    BOT_WEIGHTS,
    CHECKPOINT_DIR,
    CHECKPOINT_INTERVAL,
    EPISODE_LENGTH,
    DETERMINISTIC_EVAL_EVERY,
)
import schema as schema_module
from schema import (
    INPUT_SIZE,
    NUM_BINS,
    TEMPLATE_COOLDOWN_WAVES,
    ENEMY_TYPES,
    ENEMY_ARMOR,
    TOWER_TYPES,
    DAMAGE_TYPES,
    ARMOR_TYPES,
    MAX_VALUES,
    TEMPLATES,
    NUM_ACTIVE_TEMPLATES,
    get_template,
    get_available_template_mask,
    template_for_wave,
    template_index,
    endgame_hp_multiplier,
    fair_max_count,
    build_wave_context,
    MAX_TEMPLATE_SLOTS,
    MAX_VALUES as SCHEMA_MAX_VALUES,
)
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
        # Deterministic-evaluation flag. When set, this client's waves are
        # generated from the policy mean rather than a sample, so the metrics
        # describe the policy we actually export instead of the exploration
        # noise around it.
        self.deterministic = False


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
        # Win-rate tracking, fed from wave results (see _process_result).
        self.waves_survived = 0
        self.waves_lost = 0
        # Deterministic-evaluation metrics, kept apart from training rollouts so
        # we can report the policy we ship rather than the one we explore with.
        self.eval_rewards: list[float] = []
        self.eval_deaths = 0
        self.eval_waves = 0
        # Training run-state: clients join paused. Dashboard Start button flips
        # this to 'running' and broadcasts. Reload keeps the current state.
        self.training_state = 'paused'  # 'paused' | 'running'

        # Create checkpoint directory
        Path(CHECKPOINT_DIR).mkdir(exist_ok=True)

        # Try to load latest checkpoint
        self._load_latest_checkpoint()

    @staticmethod
    def _numbered_checkpoints():
        """Every `checkpoint_<n>.pt`, excluding the `checkpoint_latest.pt` alias."""
        found = []
        for path in Path(CHECKPOINT_DIR).glob("checkpoint_*.pt"):
            suffix = path.stem.split("_", 1)[1]
            if suffix.isdigit():
                found.append(path)
        return found

    def _load_latest_checkpoint(self):
        """Resume from the most recent checkpoint, if there is one."""
        checkpoints = self._numbered_checkpoints()
        if not checkpoints:
            logger.debug("No checkpoints found — starting from scratch")
            return

        latest = max(checkpoints, key=lambda p: int(p.stem.split("_")[1]))
        self.model, episode, trainer_state = load_model(str(latest))
        # Keep eval mode (load_model sets it); the trainer flips to train() only
        # for the duration of an update.
        self.trainer = PPOTrainer(self.model, dashboard=self.dashboard)
        self.trainer.load_state_dict(trainer_state)
        # Prefer the episode recorded inside the file; fall back to the filename
        # for legacy v1 checkpoints that carried no metadata.
        self.episode = episode if episode is not None else int(latest.stem.split("_")[1])
        if trainer_state is None:
            logger.debug(
                f"{latest.name} is a legacy checkpoint — optimizer state starts fresh"
            )
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
            # Flush whatever trajectory the client had in flight, bootstrapped —
            # a disconnect is a truncation, not an ending.
            self.trainer.drop_client(client_id)
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
                                                       progress_std=progress_std,
                                                       episode_done=wave_num >= EPISODE_LENGTH)

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
                self._save_checkpoint()

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
            # Every Nth run is a measurement run.
            ctx.deterministic = (
                DETERMINISTIC_EVAL_EVERY > 0
                and self.games_played % DETERMINISTIC_EVAL_EVERY == 0
            )
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
        """Sample a wave action from the model under the availability mask.

        Inside the curriculum the mask has exactly one live slot, so the
        sampled template IS the template that ships. That equality is what
        makes the stored PPO action honest — previously the decoder overrode
        the sampled index afterwards and the categorical head was trained on a
        choice that never happened.
        """
        # Build the availability mask FIRST: it is both an input to the model
        # (the wave-context block tells the params head what its factors will be
        # applied to) and the filter on the model's template output. One source,
        # so the two can never disagree.
        #
        # Prefer the capabilities the frontend actually computed — they account
        # for line-of-sight and effective anti-air reach; fall back to research
        # flags only when an older client omits them.
        wave_num = state.get("waveNumber", 0)
        research = state.get("research", {}) or {}
        tower_unlocked = research.get("towerUnlocked", {}) or {}
        air_targeting = research.get("airTargetingUnlocked", False)
        defense = state.get("defense") or {}
        caps = defense.get("capabilities") or {}

        if "hasAntiAir" in caps:
            has_anti_air = bool(caps.get("hasAntiAir"))
        else:
            has_anti_air = bool(
                tower_unlocked.get("archer") or tower_unlocked.get("ice")
                or tower_unlocked.get("rocket") or tower_unlocked.get("lightning")
                or air_targeting
            )
        if "hasAntiEthereal" in caps:
            has_anti_ethereal = bool(caps.get("hasAntiEthereal"))
        else:
            has_anti_ethereal = bool(
                tower_unlocked.get("magic") or tower_unlocked.get("ice")
                or tower_unlocked.get("lightning")
            )

        recent_tpls = ctx.recent_template_indices if ctx else []
        wave_context = build_wave_context(
            upcoming_wave=wave_num + 1,  # state.waveNumber is "current", we plan N+1
            has_anti_air=has_anti_air,
            has_anti_ethereal=has_anti_ethereal,
            recent_template_indices=recent_tpls,
            effective_dps_per_armor=defense.get("effectiveDPSPerArmor") or {},
        )
        mask_list = wave_context["mask"]

        state_tensor = torch.tensor(
            self._encode_state(state, ctx, wave_context),
            dtype=torch.float32,
        ).unsqueeze(0)

        mask_tensor = torch.tensor([mask_list], dtype=torch.bool)

        # Get action with log_prob for PPO ratio
        deterministic = bool(ctx and ctx.deterministic)
        with torch.no_grad():
            action, log_prob, _ = self.model.get_action(
                state_tensor, template_mask=mask_tensor, deterministic=deterministic
            )

        # Store state paired with (client_id, wave_num+1) for proper result pairing
        # Deterministic rollouts are measurement, not experience: their actions
        # carry no exploration noise, so feeding them to PPO would bias the
        # ratio. Collect them for metrics only.
        if client_id is not None and ctx is not None and not deterministic:
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

    def _encode_state(self, state, ctx=None, wave_context=None):
        """Convert a game-state snapshot into the flat feature vector.

        Every vocabulary and every block size comes from `schema.py`, which is
        generated from the TypeScript configs — so this stays in lockstep with
        `game-state-encoder.ts` by construction rather than by discipline.

        Layout at schema v2 (162 features), with
        T = towers (10), D = damage types (8), A = armor types (5), E = enemies (18):

        [0-3]     Player: credits, lives%, wave, time                     (4)
        [4-5]     Tower: count, avgLevel                                  (2)
        [6..]     Tower type counts                                       (T)
        [..]      Damage history, last 5 waves                            (5)
        [..]      Progress history, last 5 waves                          (5)
        [..]      Wave signals: momentum, avgDmg, duration, episode, var   (5)
        [..]      Context: wave, trend, skill, lastThreat, winStreak       (5)
        [..]      DPS by damage type                                       (D)
        [..]      Expected enemy armor distribution                        (A)
        [..]      Research state                                            (5)
        [..]      Reserved                                                  (1)
        --- Awareness block ---
        [..]      Types-history: per-type frequency over last 5 waves       (E)
        [..]      Armor-history                                             (A)
        [..]      Damage-pct history (mirrors the earlier block)            (5)
        [..]      Tower-type average levels                                 (T)
        [..]      Defense capabilities                                      (4)
        [..]      Tower unlock status                                       (T)
        [..]      Near-miss history                                         (5)
        --- Armor-matrix block ---
        [..]      Effective DPS vs armor, ground                            (A)
        [..]      Effective DPS vs armor, air                               (A)
        --- Spatial block ---
        [..]      Ground DPS profile                                (NUM_BINS)
        [..]      Air DPS profile                                   (NUM_BINS)
        """
        encoded = []

        def last_n(seq, n=5):
            """Last n entries, left-padded with 0 so index 0 is the oldest."""
            seq = seq or []
            pad = max(0, n - len(seq))
            return [0.0] * pad + [float(v) for v in seq[-n:]]

        # === Player state ===
        player = state.get("player", {})
        encoded.extend([
            player.get("credits", 0) / MAX_VALUES["credits"],
            player.get("livesPercent", 1),
            state.get("waveNumber", 0) / MAX_VALUES["wave"],
            min(1.0, state.get("gameTimeSeconds", 0) / MAX_VALUES["gameTime"]),
        ])

        # === Tower stats ===
        defense = state.get("defense", {})
        encoded.extend([
            defense.get("towerCount", 0) / MAX_VALUES["towerCount"],
            defense.get("avgTowerLevel", 0) / MAX_VALUES["towerLevel"],
        ])

        # === Tower type counts ===
        dist = defense.get("towerDistribution", {})
        for t in TOWER_TYPES:
            stats = dist.get(t, {}) or {}
            encoded.append((stats.get("count", 0) or 0) / 10)

        # === Damage + progress history ===
        history = state.get("recentHistory", {})
        damages = history.get("damagePerWave", []) or []
        encoded.extend(last_n(damages))
        encoded.extend(last_n(history.get("progressPerWave", [])))

        # === Wave signals ===
        wave_num = state.get("waveNumber", 0)

        momentum = (damages[-1] - damages[-2]) * 10 if len(damages) >= 2 else 0.0
        encoded.append(max(-1.0, min(1.0, momentum)))

        recent_5 = damages[-5:] if damages else []
        encoded.append(min(1.0, sum(recent_5) / max(1, len(recent_5))))

        encoded.append(min(1.0, history.get("avgWaveDuration", 0) / MAX_VALUES["waveDuration"]))

        # Episode progress, measured against the episode length that actually
        # triggers the reset — not the hardcoded /20 this used to divide by.
        encoded.append(min(1.0, wave_num / EPISODE_LENGTH))

        if len(recent_5) >= 2:
            mean_d = sum(recent_5) / len(recent_5)
            variance = sum((d - mean_d) ** 2 for d in recent_5) / len(recent_5)
            encoded.append(min(1.0, variance ** 0.5 * 10))
        else:
            encoded.append(0.0)

        # === Context ===
        encoded.extend([
            wave_num / MAX_VALUES["wave"],
            self._calculate_difficulty_trend(damages),
            _estimate_player_skill(ctx.recent_damages if ctx else [], ctx.win_streak if ctx else 0),
            history.get("lastWaveThreat", 0) / MAX_VALUES["waveThreat"],
            history.get("winStreak", 0) / MAX_VALUES["winStreak"],
        ])

        # === DPS by damage type ===
        # Frontend pre-computes this via computeDpsByDamageType.
        dps_by_type_state = state.get("dpsByDamageType", {}) or {}
        for dt in DAMAGE_TYPES:
            encoded.append(min(1.0, dps_by_type_state.get(dt, 0.0)))

        # === Expected enemy armor distribution ===
        armor_dist = state.get("expectedArmorDistribution") or {}
        if not armor_dist:
            share = 1.0 / len(ARMOR_TYPES)
            armor_dist = {a: share for a in ARMOR_TYPES}
        for a in ARMOR_TYPES:
            encoded.append(armor_dist.get(a, 0))

        # === Research state ===
        research = state.get("research", {}) or {}
        total_count = research.get("totalCount", 0)
        completed_count = research.get("completedCount", 0)
        encoded.append(completed_count / total_count if total_count > 0 else 0)
        encoded.append(research.get("centerLevel", 0) / 3)
        max_slots = research.get("maxSlots", 0)
        slots_used = research.get("slotsUsed", 0)
        encoded.append(slots_used / max_slots if max_slots > 0 else 0)
        encoded.append(1.0 if research.get("airTargetingUnlocked", False) else 0.0)
        # The research tree reaches tier 5 (transcendent-tech); dividing by 3
        # used to push the feature past 1.0 once tier 4 was unlocked.
        encoded.append(min(1.0, research.get("maxUpgradeTier", 1) / MAX_VALUES["upgradeTier"]))

        # === Reserved ===
        encoded.append(0)

        # ─── AWARENESS BLOCK ────────────────────────────────────────────────

        # Types-history: fraction of the last 5 waves each enemy type appeared in.
        # Frontend sends enemyTypesUsed: string[][] (outer = wave, inner = types).
        enemy_types_history = history.get("enemyTypesUsed", []) or []
        recent_waves = enemy_types_history[-5:] if enemy_types_history else []
        window = max(1, len(recent_waves))
        for t in ENEMY_TYPES:
            encoded.append(sum(1 for w in recent_waves if t in w) / window)

        # Armor-history: fraction of the last 5 waves containing each armor class.
        for a in ARMOR_TYPES:
            encoded.append(
                sum(1 for w in recent_waves if any(ENEMY_ARMOR.get(t) == a for t in w)) / window
            )

        # Damage-pct history — deliberate duplicate of the earlier block; the
        # frontend encoder has the same repeat and the orders must match.
        encoded.extend(last_n(damages))

        # Tower-type average levels
        for t in TOWER_TYPES:
            stats = dist.get(t, {}) or {}
            encoded.append(min(1.0, (stats.get("avgLevel", 0) or 0) / MAX_VALUES["towerLevel"]))

        # Defense capabilities
        caps = defense.get("capabilities", {}) or {}
        encoded.append(1.0 if caps.get("hasAntiAir") else 0.0)
        encoded.append(1.0 if caps.get("hasSplash") else 0.0)
        encoded.append(1.0 if caps.get("hasSlow") else 0.0)
        encoded.append(1.0 if caps.get("hasDoT") else 0.0)

        # Tower unlock status
        tower_unlocked_map = research.get("towerUnlocked", {}) or {}
        for t in TOWER_TYPES:
            encoded.append(1.0 if tower_unlocked_map.get(t) else 0.0)

        # Near-miss history
        encoded.extend(last_n(history.get("nearMissPerWave", [])))

        # ─── EFFECTIVE-DPS-PER-ARMOR ────────────────────────────────────────
        # Armor-matrix weighted effective DPS, split ground/air. Gives the net
        # an explicit per-armor view of the player's damage pipeline, which the
        # raw DPS profile is blind to.
        eff = defense.get("effectiveDPSPerArmor") or {}
        eff_ground = eff.get("ground") or {}
        eff_air = eff.get("air") or {}
        max_eff = MAX_VALUES["effectiveDpsPerArmor"]
        for source in (eff_ground, eff_air):
            for a in ARMOR_TYPES:
                encoded.append(max(0.0, min(1.0, float(source.get(a, 0.0)) / max_eff)))

        # Share of that DPS which is area-of-effect, ground and air. Splash,
        # chain and beam width are constant multipliers inside each tower's DPS,
        # so the raw numbers cannot express "this defense scales with enemy
        # density" — and density is what the director sets via count and delay.
        aoe = defense.get("aoeDpsShare") or {}
        encoded.append(max(0.0, min(1.0, float(aoe.get("ground", 0.0) or 0.0))))
        encoded.append(max(0.0, min(1.0, float(aoe.get("air", 0.0) or 0.0))))

        # ─── WAVE CONTEXT ───────────────────────────────────────────────────
        # What the continuous factors will be applied to. See
        # `schema.build_wave_context` for why the availability mask is the right
        # signal here for both the curriculum and the free-choice range.
        wc = wave_context or {}
        mask = wc.get("mask") or [False] * MAX_TEMPLATE_SLOTS
        for i in range(MAX_TEMPLATE_SLOTS):
            encoded.append(1.0 if (i < len(mask) and mask[i]) else 0.0)

        def _norm(value, ceiling):
            return max(0.0, min(1.0, float(value) / ceiling))

        count_range = wc.get("count_range") or (0.0, 0.0)
        hp_range = wc.get("hp_mult_range") or (0.0, 0.0)
        delay_range = wc.get("spawn_delay_range") or (0.0, 0.0)
        encoded.append(_norm(count_range[0], SCHEMA_MAX_VALUES["templateCount"]))
        encoded.append(_norm(count_range[1], SCHEMA_MAX_VALUES["templateCount"]))
        encoded.append(_norm(hp_range[0], SCHEMA_MAX_VALUES["templateHpMult"]))
        encoded.append(_norm(hp_range[1], SCHEMA_MAX_VALUES["templateHpMult"]))
        encoded.append(_norm(delay_range[0], SCHEMA_MAX_VALUES["templateSpawnDelayMs"]))
        encoded.append(_norm(delay_range[1], SCHEMA_MAX_VALUES["templateSpawnDelayMs"]))
        # Where the fairness gate will clamp, on the same 0..1 scale as
        # count_factor. Without it the gradient above the cap is flat and the
        # net cannot see the ceiling it keeps hitting.
        encoded.append(max(0.0, min(1.0, float(wc.get("fairness_headroom", 1.0)))))

        # ─── SPATIAL BLOCK ──────────────────────────────────────────────────
        dps_profile = state.get("dpsProfile", {}) or {}
        for key in ("groundDPS", "airDPS"):
            values = dps_profile.get(key) or []
            for i in range(NUM_BINS):
                encoded.append(values[i] if i < len(values) else 0)

        # A wrong length means the encoder and the model disagree about where
        # every feature lives. Truncating silently (as this used to) turns that
        # into weeks of training on shifted inputs, so fail loudly instead.
        if len(encoded) != INPUT_SIZE:
            raise ValueError(
                f"state encoder produced {len(encoded)} features, expected {INPUT_SIZE} "
                f"(schema v{schema_module.EXPECTED_SCHEMA_VERSION}) — "
                f"regenerate with `npm run ai-schema`"
            )
        return encoded

    def _decode_action(self, action, state=None, ctx=None):
        """Range-based template decoding with DPS-scaled difficulty caps.

        The net produces template_idx + 4 factors in [0,1]; the decoder
        interpolates each factor into the template's designer-set range. For
        COUNT and HP_MULT the upper end is scaled by defense.totalDPS so wave 1
        (low DPS) cannot be oversized — that prevents an early
        "everything overflows" lock-in.

        The template index is taken as-is. Curriculum forcing happens earlier,
        by narrowing the availability mask to a single slot (see
        `schema.get_available_template_mask`), so the action the trainer stored
        is always the action that shipped.
        """
        from schema import (
            MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS,
            DPS_RAMP_FLOOR, DPS_RAMP_COUNT, DPS_RAMP_HP_MULT,
        )

        template_idx = int(action["template_idx"][0].detach().item())
        count_factor = float(action["count_factor"][0].detach().item())
        spawn_factor = float(action["spawn_factor"][0].detach().item())
        hp_factor = float(action["hp_factor"][0].detach().item())
        variation_factor = float(action["variation_factor"][0].detach().item())

        wave_num = int((state or {}).get("waveNumber", 0) or 0) + 1  # plan N+1

        template = get_template(template_idx)
        if template is None:
            # Masking guarantees a valid slot; a miss here means the mask and
            # the template table disagree, which is worth shouting about.
            logger.error(
                f"[decode] model picked reserved slot {template_idx} "
                f"(active={NUM_ACTIVE_TEMPLATES}) — falling back to slot 0"
            )
            template = TEMPLATES[0]
            template_idx = 0

        forced_id = template_for_wave(wave_num)
        if forced_id is not None and template["id"] != forced_id:
            # Only reachable if the mask was built for a different wave number
            # than the one we are decoding — a real bug, not a design choice.
            logger.error(
                f"[decode] wave {wave_num} shipped '{template['id']}' but the "
                f"curriculum pins '{forced_id}' — mask/decode disagree"
            )

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

        total_count = max(1, round(lerp_capped(template["countRange"], count_factor, dps_frac_count)))
        # round(), not int(): the frontend decoder rounds, and a half-millisecond
        # of truncation drift compounds over a 5000-enemy wave.
        spawn_delay = max(MIN_SPAWN_DELAY_MS, round(lerp(template["spawnDelayRange"], spawn_factor)))
        nn_hp_mult = lerp_capped(template["hpMultRange"], hp_factor, dps_frac_hp)
        variation = round(lerp(template["variationRange"], variation_factor), 3)

        # Structural late-game HP ramp, applied AFTER the net's factor exactly
        # as the shipped game does (wave-curriculum.config.ts). Without this the
        # net would train against a flatter difficulty curve than players see.
        endgame_hp = endgame_hp_multiplier(wave_num)
        hp_mult = round(nn_hp_mult * endgame_hp, 3)

        # Fairness gate: never ship a wave the defense cannot plausibly fight.
        # Applied after the HP multipliers so it judges the enemies as they will
        # actually spawn, and before the duration cap so the compression below
        # works on the final count.
        fair_cap = fair_max_count(
            template,
            hp_mult,
            spawn_delay,
            defense.get("effectiveDPSPerArmor") or {},
        )
        gated = fair_cap is not None and fair_cap < total_count
        if gated:
            total_count = fair_cap

        # Wave-duration cap: compress spawn_delay if (count × spawn_delay) would exceed 3 min.
        total_duration = total_count * spawn_delay
        if total_duration > MAX_WAVE_DURATION_MS:
            spawn_delay = max(MIN_SPAWN_DELAY_MS, MAX_WAVE_DURATION_MS // total_count)

        # Expand template → enemy groups
        enemies = []
        allocated = 0
        groups = template["enemies"]
        for i, group in enumerate(groups):
            enemy_type, share = group["type"], group["share"]
            if i == len(groups) - 1:
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
            "pattern": template.get("spawnPattern"),
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
            "nn_health_mult": round(nn_hp_mult, 3),
            "endgame_hp_mult": round(endgame_hp, 3),
            "curriculum_forced": forced_id is not None,
            "fairness_capped": gated,
            "fairness_max_count": fair_cap,
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
                        effective_progress=None, max_progress=0, near_miss_ratio=0,
                        progress_std=0, episode_done=False):
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

        # Did the player survive this wave?
        #
        # `stateAfter` is the authoritative source when present. On the
        # game-over path the frontend historically sent the result without it,
        # and this fell back to `result["gameOver"]` — a key that does not exist
        # on WaveOutcome. `.get(..., False)` therefore reported "survived" on
        # exactly the waves that ended the run, so the DEATH term (the largest
        # in the reward, up to -3.5) never once fired during training.
        # `playerSurvived` is the real field (wave-result.ts), and the frontend
        # now sends `stateAfter` on both paths.
        if state_after:
            survived = bool(state_after.get("player", {}).get("lives", 0) > 0)
        else:
            survived = bool(result.get("playerSurvived", True))

        # Win-streak is maintained here rather than in the `game_over` handler:
        # the frontend defines `notifyGameOver` but never calls it, so that
        # handler never ran and feature [34] was a hard-coded 0 for the whole
        # of training. A cleared wave is a win, a wave that ends the run is not.
        if survived:
            ctx.win_streak += 1
        else:
            ctx.win_streak = 0
            self.waves_lost += 1
        self.waves_survived += 1 if survived else 0
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

        # Pair reward with this client+wave's pending state. `done` closes the
        # trajectory so the death cost can be discounted back onto the waves
        # that produced it — the player never heals, so a run is one long
        # sequence, not a series of independent bets.
        if ctx is not None and ctx.deterministic:
            # Measurement run: no stored action to pair with, and its noise-free
            # actions would bias the PPO ratio. Metrics only.
            self.eval_rewards.append(reward)
            if len(self.eval_rewards) > 200:
                self.eval_rewards.pop(0)
            if not survived:
                self.eval_deaths += 1
            self.eval_waves += 1
        else:
            self.trainer.store_result(
                client_id, wave_num, reward, done=(not survived) or episode_done
            )

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
            "winRate": round(
                self.waves_survived / max(1, self.waves_survived + self.waves_lost), 3
            ),
            "clientCount": len(self.clients),
            "trainingState": self.training_state,
            "activeClientIds": active_display_ids,
            "currentBotType": next(
                (c.current_bot for c in self.client_contexts.values()), "strategist"
            ),
            # Deterministic evaluation — the policy as exported, not as explored.
            "evalAvgReward": round(
                sum(self.eval_rewards) / len(self.eval_rewards), 3
            ) if self.eval_rewards else 0.0,
            "evalWaves": self.eval_waves,
            "evalDeathRate": round(self.eval_deaths / max(1, self.eval_waves), 3),
            "droppedPairs": self.trainer.dropped_pairs,
        }

    def _save_checkpoint(self):
        """Write a checkpoint plus the `checkpoint_latest.pt` convenience copy.

        `npm run export-ai` points at `checkpoint_latest.pt`; that file never
        existed before, so the export script always exited 1.
        """
        checkpoint_path = f"{CHECKPOINT_DIR}/checkpoint_{self.episode}.pt"
        save_model(
            self.model,
            checkpoint_path,
            episode=self.episode,
            trainer_state=self.trainer.state_dict(),
            schema_version=schema_module.EXPECTED_SCHEMA_VERSION,
        )
        try:
            shutil.copyfile(checkpoint_path, f"{CHECKPOINT_DIR}/checkpoint_latest.pt")
        except OSError as e:
            logger.error(f"[checkpoint] could not refresh checkpoint_latest.pt: {e}")
        logger.checkpoint_saved(self.episode, checkpoint_path)

    def _export_model(self, version):
        """Write a standalone PyTorch snapshot for offline ONNX export.

        The ONNX conversion itself lives in `scripts/export_to_tfjs.py`
        (`npm run export-ai`), which reads a checkpoint file — this endpoint
        only pins a named copy of the current weights.
        """
        path = f"exports/wave-director-{version}.pt"
        Path("exports").mkdir(exist_ok=True)
        save_model(
            self.model,
            path,
            episode=self.episode,
            trainer_state=self.trainer.state_dict(),
            schema_version=schema_module.EXPECTED_SCHEMA_VERSION,
        )
        return path


def _archive_checkpoints() -> int:
    """Move every existing checkpoint into a dated archive folder.

    Used by `--fresh`. Checkpoints are moved, never deleted — a training run
    that turns out badly should not cost you the previous one.
    Returns the number of files archived.
    """
    ckpt_dir = Path(CHECKPOINT_DIR)
    ckpt_dir.mkdir(exist_ok=True)
    existing = sorted(ckpt_dir.glob("checkpoint_*.pt"))
    if not existing:
        return 0

    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    archive = ckpt_dir / f"archive-{stamp}"
    archive.mkdir(parents=True, exist_ok=True)
    for path in existing:
        shutil.move(str(path), str(archive / path.name))
    print(f"[fresh] archived {len(existing)} checkpoints -> {archive}")
    return len(existing)


def _parse_args():
    parser = argparse.ArgumentParser(description="3DTD Wave-Director training backend")
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="start from scratch: move existing checkpoints into a dated archive folder first",
    )
    return parser.parse_args()


async def main(fresh: bool = False):
    """Start the training server + optional dashboard."""
    if fresh:
        _archive_checkpoints()

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
                    port=DASHBOARD_PORT,
                    log_level="warning",
                )
                dashboard_server = uvicorn.Server(config)
                dashboard_task = asyncio.create_task(dashboard_server.serve())
                logger.debug(f"Dashboard started on http://0.0.0.0:{DASHBOARD_PORT}")
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
    args = _parse_args()
    try:
        asyncio.run(main(fresh=args.fresh))
    except KeyboardInterrupt:
        logger.server_shutdown()
        logger.stop()
    except Exception as e:
        logger.error(f"Server error: {e}")
        logger.stop()
