'use strict';

/**
 * Keys the desktop shell handles itself. There is no application menu, so
 * none of Electron's default accelerators (Ctrl+R reload, Ctrl+W close,
 * Ctrl+Plus zoom) exist; these are the only keys taken away from the game.
 */

/** The action for a before-input-event, or null to let the game have the key. */
function shortcutFor(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null;
  const plain = !input.control && !input.alt && !input.meta && !input.shift;
  if (!plain) return null;
  if (input.key === 'F11') return 'toggle-fullscreen';
  if (input.key === 'F12') return 'toggle-devtools';
  return null;
}

module.exports = { shortcutFor };
