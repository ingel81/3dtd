"""
Professional Logging System for Training Backend

Provides colored, structured logging with proper formatting.
"""

import sys
from datetime import datetime
from typing import Optional


class Colors:
    """ANSI color codes for terminal output."""
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

    # Foreground colors
    BLACK = '\033[30m'
    RED = '\033[31m'
    GREEN = '\033[32m'
    YELLOW = '\033[33m'
    BLUE = '\033[34m'
    MAGENTA = '\033[35m'
    CYAN = '\033[36m'
    WHITE = '\033[37m'

    # Bright variants
    BRIGHT_BLACK = '\033[90m'
    BRIGHT_RED = '\033[91m'
    BRIGHT_GREEN = '\033[92m'
    BRIGHT_YELLOW = '\033[93m'
    BRIGHT_BLUE = '\033[94m'
    BRIGHT_MAGENTA = '\033[95m'
    BRIGHT_CYAN = '\033[96m'
    BRIGHT_WHITE = '\033[97m'

    # Background colors
    BG_BLACK = '\033[40m'
    BG_RED = '\033[41m'
    BG_GREEN = '\033[42m'
    BG_YELLOW = '\033[43m'
    BG_BLUE = '\033[44m'
    BG_MAGENTA = '\033[45m'
    BG_CYAN = '\033[46m'
    BG_WHITE = '\033[47m'


class TrainingLogger:
    """Professional logger for training backend."""

    def __init__(self, use_colors: bool = True):
        self.use_colors = use_colors and sys.stdout.isatty()
        self.start_time = datetime.now()

    def start(self):
        """Start logger (no-op for classic logger, needed for API compatibility with TUI logger)."""
        pass

    def stop(self):
        """Stop logger (no-op for classic logger, needed for API compatibility with TUI logger)."""
        pass

    def _color(self, text: str, color: str) -> str:
        """Apply color to text if colors are enabled."""
        if self.use_colors:
            return f"{color}{text}{Colors.RESET}"
        return text

    def _timestamp(self) -> str:
        """Get formatted timestamp."""
        return datetime.now().strftime("%H:%M:%S")

    def _format_prefix(self, level: str, color: str) -> str:
        """Format log prefix with level and timestamp."""
        timestamp = self._color(self._timestamp(), Colors.DIM)
        level_colored = self._color(f"[{level:^7}]", color + Colors.BOLD)
        return f"{timestamp} {level_colored}"

    def info(self, message: str):
        """Log info message."""
        prefix = self._format_prefix("INFO", Colors.BLUE)
        print(f"{prefix} {message}")

    def success(self, message: str):
        """Log success message."""
        prefix = self._format_prefix("SUCCESS", Colors.GREEN)
        print(f"{prefix} {message}")

    def warning(self, message: str):
        """Log warning message."""
        prefix = self._format_prefix("WARNING", Colors.YELLOW)
        print(f"{prefix} {message}")

    def error(self, message: str):
        """Log error message."""
        prefix = self._format_prefix("ERROR", Colors.RED)
        print(f"{prefix} {message}")

    def debug(self, message: str):
        """Log debug message."""
        prefix = self._format_prefix("DEBUG", Colors.BRIGHT_BLACK)
        print(f"{prefix} {message}")

    def separator(self, char: str = "─", length: int = 80):
        """Print separator line."""
        line = char * length
        print(self._color(line, Colors.DIM))

    def header(self, title: str, char: str = "═"):
        """Print header with title."""
        width = 80
        title_line = f" {title} "
        padding = (width - len(title_line)) // 2
        line = char * padding + title_line + char * (width - padding - len(title_line))
        print()
        print(self._color(line, Colors.CYAN + Colors.BOLD))

    def section(self, title: str):
        """Print section header."""
        print()
        print(self._color(f"▌ {title}", Colors.CYAN + Colors.BOLD))
        print(self._color("  " + "─" * 78, Colors.DIM))

    def metric(self, label: str, value: str, unit: str = "", color: str = Colors.WHITE):
        """Print formatted metric."""
        label_colored = self._color(f"  {label:.<30}", Colors.DIM)
        value_str = f"{value} {unit}".strip()
        value_colored = self._color(value_str, color + Colors.BOLD)
        print(f"{label_colored} {value_colored}")

    def update_episode(self, *args, **kwargs):
        pass

    def update_clients(self, count: int):
        pass

    def update_wave(self, *args, **kwargs):
        pass

    def update_games(self, count: int):
        pass

    def client_connected(self, client_id: int, total: int):
        """Log client connection."""
        msg = f"Client {self._color(f'#{client_id}', Colors.CYAN)} connected"
        msg += f" {self._color(f'[Total: {total}]', Colors.DIM)}"
        self.info(msg)

    def client_disconnected(self, client_id: int, total: int):
        """Log client disconnection."""
        msg = f"Client {self._color(f'#{client_id}', Colors.CYAN)} disconnected"
        msg += f" {self._color(f'[Total: {total}]', Colors.DIM)}"
        self.info(msg)

    def wave_received(self, client_id: int, wave_num: int, towers: int, dps: float, credits: int, bot_type: str = None):
        """Log wave state received."""
        wave_str = self._color(f"Wave {wave_num}", Colors.YELLOW + Colors.BOLD)
        stats = self._color(f"[Towers: {towers}, DPS: {dps:.0f}, Credits: {credits}]", Colors.DIM)
        self.info(f"{wave_str} state received {stats}")

    def wave_generated(self, config: dict, raw_health: float = None):
        """Log wave generation."""
        enemy_type = config.get("enemies", [{}])[0].get("type", "?")
        count = config.get("totalCount", 0)
        delay = config.get("spawnDelay", 0)

        enemy_str = self._color(f"{count}x {enemy_type.upper()}", Colors.YELLOW + Colors.BOLD)
        delay_str = self._color(f"[Delay: {delay}ms]", Colors.DIM)
        self.success(f"Generated wave: {enemy_str} {delay_str}")

    def wave_result(self, wave_num: int, damage_pct: float, killed: int, avg_progress: float):
        """Log wave result."""
        wave_str = self._color(f"Wave {wave_num}", Colors.YELLOW + Colors.BOLD)

        if damage_pct < 0.1:
            damage_color = Colors.GREEN
        elif damage_pct < 0.3:
            damage_color = Colors.YELLOW
        else:
            damage_color = Colors.RED

        damage_str = self._color(f"{damage_pct:.1%}", damage_color + Colors.BOLD)

        stats = self._color(f"Killed: {killed}, Progress: {avg_progress:.1%}", Colors.DIM)
        self.info(f"{wave_str} completed → Damage: {damage_str} [{stats}]")

    def training_step(self, episode: int, reward: float, avg_reward: float, breakdown: dict = None):
        """Log training step."""
        ep_str = self._color(f"Episode {episode}", Colors.CYAN + Colors.BOLD)

        if reward > 0:
            reward_color = Colors.GREEN
        elif reward < -5:
            reward_color = Colors.RED
        else:
            reward_color = Colors.YELLOW

        reward_str = self._color(f"{reward:+.2f}", reward_color + Colors.BOLD)
        avg_str = self._color(f"(avg: {avg_reward:.2f})", Colors.DIM)

        self.success(f"{ep_str} → Reward: {reward_str} {avg_str}")

    def training_update(self, policy_loss: float, entropy: float, grad_norm: float, batch_avg_reward: float):
        """Log model training update."""
        self.info(f"Update: Loss={policy_loss:.4f} Entropy={entropy:.3f} Grad={grad_norm:.4f} AvgR={batch_avg_reward:.2f}")

    def episode_start(self, client_id: int, bot_type: str):
        """Log episode start."""
        self.info(f"Episode start: Client #{client_id}, Bot: {bot_type}")

    def episode_end(self, client_id: int, waves_survived: int, total_damage: float, reason: str = "reset"):
        """Log episode end."""
        self.info(f"Episode end: Client #{client_id}, Waves: {waves_survived}, Damage: {total_damage:.1%}, Reason: {reason}")

    def checkpoint_saved(self, episode: int, path: str):
        """Log checkpoint save."""
        ep_str = self._color(f"Episode {episode}", Colors.CYAN + Colors.BOLD)
        path_str = self._color(path, Colors.DIM)
        self.success(f"Checkpoint saved: {ep_str} → {path_str}")

    def model_resumed(self, episode: int, path: str):
        """Log model resume from checkpoint."""
        ep_str = self._color(f"Episode {episode}", Colors.CYAN + Colors.BOLD)
        path_str = self._color(path, Colors.DIM)
        self.success(f"Resumed training from {ep_str} → {path_str}")

    def server_started(self, host: str, port: int, episode: int):
        """Log server startup."""
        self.header("AI WAVE DIRECTOR - TRAINING SERVER")
        print()
        self.metric("Server Address", f"ws://{host}:{port}", color=Colors.CYAN)
        self.metric("Current Episode", str(episode), color=Colors.YELLOW)
        self.metric("Status", "Ready for connections", color=Colors.GREEN)
        print()
        self.separator()
        print()

    def server_shutdown(self):
        """Log server shutdown."""
        print()
        self.separator()
        print()
        self.warning("Server shutting down...")
        print()

    def player_state_change(self, before: dict, after: dict):
        """Log player state changes during wave."""
        before_towers = before.get("defense", {}).get("towerCount", 0)
        after_towers = after.get("defense", {}).get("towerCount", 0)
        before_dps = before.get("defense", {}).get("totalDPS", 0)
        after_dps = after.get("defense", {}).get("totalDPS", 0)

        if after_towers != before_towers or abs(after_dps - before_dps) > 0.1:
            towers_str = self._color(f"{before_towers}→{after_towers}", Colors.CYAN)
            dps_str = self._color(f"{before_dps:.0f}→{after_dps:.0f}", Colors.YELLOW)
            self.debug(f"Player activity: Towers {towers_str}, DPS {dps_str}")


# Global logger instance
logger = TrainingLogger()
