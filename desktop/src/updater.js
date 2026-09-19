'use strict';

/**
 * Automatic updates from GitHub Releases (electron-updater).
 *
 * Checks at start and every six hours, downloads in the background and
 * installs when the player quits (autoInstallOnAppQuit). A downloaded update
 * is reported once through onReady(), which main.js passes on to the game's
 * update hint. Nothing here ever shows a dialog: no connection, no release
 * yet or a broken latest.yml end up as one line in the log.
 *
 * Takes the updater and the log from main.js, so the tests drive it with
 * fakes.
 */

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const message = (error) => (error && error.message) || String(error);

/**
 * @param {object} options
 * @param {import('electron-updater').AppUpdater} options.autoUpdater
 * @param {{ info: Function, warn: Function }} options.log
 * @param {(update: { version: string }) => void} options.onReady
 * @param {string} [options.feedUrl] A generic update server instead of GitHub,
 *   for testing the update path locally (E34); also lets an unpackaged run check.
 */
function startUpdater({ autoUpdater, log, onReady, feedUrl }) {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // The installer is a full NSIS package, never a web installer
  autoUpdater.disableWebInstaller = true;
  if (feedUrl) {
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    log.info(`[updater] feed ${feedUrl}`);
  }

  let ready = null;
  autoUpdater.on('update-downloaded', (info) => {
    ready = { version: String(info?.version ?? '') };
    log.info(`[updater] ${ready.version} downloaded, installs on quit`);
    onReady(ready);
  });
  // Errors of a background download need no handler here: electron-updater
  // listens for its own 'error' events and writes them to the logger set above.

  const check = () => {
    Promise.resolve()
      .then(() => autoUpdater.checkForUpdates())
      .catch((error) => log.warn(`[updater] check failed: ${message(error)}`));
  };
  check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    /** The downloaded update, or null. */
    get ready() {
      return ready;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { CHECK_INTERVAL_MS, startUpdater };
