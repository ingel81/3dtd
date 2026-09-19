'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { describe, it, mock } = require('node:test');
const { CHECK_INTERVAL_MS, startUpdater } = require('../src/updater');

function fakeUpdater(check = () => Promise.resolve(null)) {
  const updater = new EventEmitter();
  // electron-updater's own listener, which writes 'error' events to its logger
  updater.on('error', () => {});
  updater.checkForUpdates = mock.fn(check);
  updater.setFeedURL = mock.fn();
  return updater;
}

function fakeLog() {
  return { info: mock.fn(), warn: mock.fn() };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('startUpdater', () => {
  it('downloads in the background and installs on quit', () => {
    const autoUpdater = fakeUpdater();
    const log = fakeLog();
    const updater = startUpdater({ autoUpdater, log, onReady: () => {} });
    assert.equal(autoUpdater.autoDownload, true);
    assert.equal(autoUpdater.autoInstallOnAppQuit, true);
    assert.equal(autoUpdater.disableWebInstaller, true);
    assert.equal(autoUpdater.logger, log);
    assert.equal(autoUpdater.setFeedURL.mock.callCount(), 0);
    updater.stop();
  });

  it('checks at start and every six hours', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const autoUpdater = fakeUpdater();
      const updater = startUpdater({ autoUpdater, log: fakeLog(), onReady: () => {} });
      assert.equal(CHECK_INTERVAL_MS, 6 * 60 * 60 * 1000);
      await flush();
      assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 1);
      mock.timers.tick(CHECK_INTERVAL_MS);
      await flush();
      assert.equal(autoUpdater.checkForUpdates.mock.callCount(), 2);
      updater.stop();
    } finally {
      mock.timers.reset();
    }
  });

  it('reports a downloaded update once and keeps it', () => {
    const autoUpdater = fakeUpdater();
    const onReady = mock.fn();
    const updater = startUpdater({ autoUpdater, log: fakeLog(), onReady });
    assert.equal(updater.ready, null);

    autoUpdater.emit('update-downloaded', { version: '0.4.0', releaseNotes: 'x' });
    assert.equal(onReady.mock.callCount(), 1);
    assert.deepEqual(onReady.mock.calls[0].arguments[0], { version: '0.4.0' });
    assert.deepEqual(updater.ready, { version: '0.4.0' });
    updater.stop();
  });

  it('only logs when there is no connection, no release or a broken feed', async () => {
    const autoUpdater = fakeUpdater(() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')));
    const log = fakeLog();
    const updater = startUpdater({ autoUpdater, log, onReady: () => {} });
    await flush();
    autoUpdater.emit('error', new Error('Cannot parse releases feed'));

    // An 'error' event goes to electron-updater's own logger; here only the failed check
    const lines = log.warn.mock.calls.map((call) => call.arguments[0]);
    assert.deepEqual(lines, ['[updater] check failed: net::ERR_INTERNET_DISCONNECTED']);
    updater.stop();
  });

  it('survives a check that throws instead of rejecting', async () => {
    const autoUpdater = fakeUpdater(() => {
      throw new Error('boom');
    });
    const log = fakeLog();
    const updater = startUpdater({ autoUpdater, log, onReady: () => {} });
    await flush();
    assert.equal(log.warn.mock.calls[0].arguments[0], '[updater] check failed: boom');
    updater.stop();
  });

  it('uses a generic feed for a local update test', () => {
    const autoUpdater = fakeUpdater();
    const updater = startUpdater({ autoUpdater, log: fakeLog(), onReady: () => {}, feedUrl: 'http://localhost:8081' });
    assert.deepEqual(autoUpdater.setFeedURL.mock.calls[0].arguments[0], { provider: 'generic', url: 'http://localhost:8081' });
    assert.equal(autoUpdater.forceDevUpdateConfig, true);
    updater.stop();
  });
});
