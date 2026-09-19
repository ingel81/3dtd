'use strict';

/**
 * The log file bug reports are made of: %APPDATA%\3DTD\logs\main.log.
 *
 * The main process logs everything, the page its warnings and errors. Players
 * attach this file to public issues, so every line goes through
 * maskSecrets() first: tile requests carry the player's key in the URL
 * (Cesium `access_token=`, Google `key=` and `session=`), and a failed one
 * shows up as a console message with that URL.
 *
 * Plain functions over text; main.js hands them electron-log.
 */

/** Largest log before it is rotated to main.old.log; one old file is kept. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Query parameters whose values could be a key, a token or a signed session. */
const SECRET_PARAM = /\b((?:access_token|api_?key|key|token|session|sig|signature)=)[^&\s"'<>)]+/gi;
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/g;

function maskSecrets(text) {
  return String(text).replace(SECRET_PARAM, '$1***').replace(BEARER, '$1***');
}

/** A value on its way into the log: text and errors masked, the rest as it is. */
function maskValue(value) {
  if (typeof value === 'string') return maskSecrets(value);
  if (value instanceof Error) return maskSecrets(value.stack || `${value.name}: ${value.message}`);
  return value;
}

/** console-message levels (WebContentsConsoleMessageEventParams.level) to electron-log's. */
const PAGE_LEVELS = { warning: 'warn', error: 'error' };

/**
 * The line for a console message of the page, or null for one below warning.
 * The page logs a lot at info ([Camera], [Corridor], ...), which would push
 * the start of a session out of the file within minutes. Takes the
 * console-message event itself; Electron 44 puts the fields on it and warns
 * that the old second argument is deprecated.
 */
function rendererLine(event) {
  const level = PAGE_LEVELS[event.level];
  if (!level) return null;
  const where = event.sourceId ? ` (${event.sourceId}:${event.lineNumber})` : '';
  return { level, text: maskSecrets(`[page] ${event.message}${where}`) };
}

/**
 * Collapses a message repeated back to back into one line and a count, so a
 * warning fired every frame does not rotate everything else out. accept()
 * returns the lines to write now; flush() the pending count.
 */
function createRepeatFilter() {
  let last = null;
  let repeats = 0;
  const summary = () => (repeats > 0 ? [{ level: last.level, text: `[page] (previous message repeated ${repeats} times)` }] : []);
  return {
    accept(line) {
      if (last && line.level === last.level && line.text === last.text) {
        repeats++;
        return [];
      }
      const out = [...summary(), line];
      last = line;
      repeats = 0;
      return out;
    },
    flush() {
      const out = summary();
      repeats = 0;
      return out;
    },
  };
}

/** The GPUs from app.getGPUInfo('complete') as one line: which one draws matters for every performance report. */
function describeGpus(info) {
  const devices = (info?.gpuDevice ?? []).map((device) => {
    const name = [device.vendorString, device.deviceString].filter(Boolean).join(' ') ||
      `vendor 0x${Number(device.vendorId).toString(16)} device 0x${Number(device.deviceId).toString(16)}`;
    const driver = device.driverVersion ? `, driver ${device.driverVersion}` : '';
    return `${name}${driver}${device.active ? ' (active)' : ''}`;
  });
  const renderer = info?.auxAttributes?.glRenderer;
  return `GPU: ${devices.join('; ') || 'unknown'}${renderer ? `; renderer ${renderer}` : ''}`;
}

module.exports = {
  MAX_LOG_BYTES,
  createRepeatFilter,
  describeGpus,
  maskSecrets,
  maskValue,
  rendererLine,
};
