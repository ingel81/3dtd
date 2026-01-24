"""
Auto Logger - Provides the global logger instance.

Uses tui_logger (simple console + JSONL file logger).
"""

from tui_logger import tui_logger

logger = tui_logger

__all__ = ['logger']
