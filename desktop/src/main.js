'use strict';

/**
 * Main process of the desktop build.
 *
 * Production loads the Angular build over app:// (see protocol.js), `--dev`
 * loads the Angular dev server on localhost:4200 instead. The game itself
 * does not know which of the two it runs in.
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { app, BrowserWindow, Menu, Notification, nativeTheme, protocol, screen, session, shell } = require('electron');
const { APP_ID } = require('./app-id');
const { uniqueDownloadPath } = require('./downloads');
const { errorPageUrl, isFatalLoadFailure } = require('./error-page');
const { APP_ORIGIN, APP_SCHEME, createAppProtocolHandler } = require('./protocol');
const { classifyNavigation, isPermissionAllowed } = require('./security');
const { shortcutFor } = require('./shortcuts');
const { identifiedUrlPatterns, identifyingUserAgent } = require('./user-agent');
const {
  createStateTracker,
  initialWindowState,
  minimumSizeFor,
  readWindowState,
  writeWindowState,
} = require('./window-state');

const DEV_ORIGIN = 'http://localhost:4200';
const isDev = !app.isPackaged && process.argv.includes('--dev');
const appOrigin = isDev ? DEV_ORIGIN : APP_ORIGIN;
const webRoot = path.join(__dirname, '..', 'app');

// Packaged builds carry the version of the root package.json (see
// electron-builder.config.js); unpackaged runs read it from there directly.
const version = app.isPackaged ? app.getVersion() : require('../../package.json').version;

/** Resizing and moving fire continuously; write the state once things settle. */
const WINDOW_STATE_SAVE_DELAY_MS = 500;

/** TD_THEME.bgDark, so the window is not white before the first frame. */
const BACKGROUND_COLOR = '#111613';

// Must happen before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

/** Keep every navigation on the app's origin, send http(s) links to the system browser. */
function hardenContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, appOrigin) === 'external') void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    const verdict = classifyNavigation(url, appOrigin);
    if (verdict === 'allow') return;
    event.preventDefault();
    if (verdict === 'external') void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * A failed load or a dead renderer shows the error page with a Reload link
 * instead of a blank or frozen window. Reload returns to the address the
 * game had, so a crash mid-game comes back to the same place.
 */
function showErrorPages(contents) {
  let lastAppUrl = `${appOrigin}/`;
  const remember = (_event, url) => {
    if (classifyNavigation(url, appOrigin) === 'allow') lastAppUrl = url;
  };
  contents.on('did-navigate', remember);
  // The game moves between places with history.replaceState (UrlLocationService).
  contents.on('did-navigate-in-page', remember);
  const show = (heading, detail) => void contents.loadURL(errorPageUrl({ heading, detail, retryUrl: lastAppUrl }));

  contents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isFatalLoadFailure(errorCode, isMainFrame) || url.startsWith('data:')) return;
    show('The game could not be loaded', `${errorDescription} (${errorCode}) at ${url}, 3DTD ${version}`);
  });
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    show('The game stopped', `renderer ${details.reason}, exit code ${details.exitCode}, 3DTD ${version}`);
  });
}

/**
 * Files the game saves go to Downloads without a dialog, as in a browser.
 * The page gives no feedback of its own (the browser's download bar does
 * that on the web), so a notification says where the file went; clicking it
 * shows the file in Explorer.
 */
function saveDownloads(targetSession) {
  targetSession.on('will-download', (_event, item) => {
    const target = uniqueDownloadPath(app.getPath('downloads'), item.getFilename(), existsSync);
    item.setSavePath(target);
    item.once('done', (_doneEvent, state) => {
      if (state !== 'completed') {
        console.warn(`[downloads] ${path.basename(target)}: ${state}`);
        return;
      }
      if (!Notification.isSupported()) return;
      const notification = new Notification({ title: 'Saved to Downloads', body: path.basename(target), silent: true });
      notification.on('click', () => shell.showItemInFolder(target));
      notification.show();
    });
  });
}

/**
 * The page stays at 100 %. Pinch zoom is switched off; a zoom level that got
 * changed anyway (Ctrl+wheel) or that Chromium restored for the origin is
 * reset. The wheel and the keys still reach the game.
 */
function lockZoom(contents) {
  void contents.setVisualZoomLevelLimits(1, 1);
  const reset = () => contents.setZoomLevel(0);
  contents.on('zoom-changed', reset);
  contents.on('did-finish-load', reset);
}

function handleShortcuts(window) {
  window.webContents.on('before-input-event', (event, input) => {
    const action = shortcutFor(input);
    if (!action) return;
    event.preventDefault();
    if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
    if (action === 'toggle-devtools') window.webContents.toggleDevTools();
  });
}

function rememberWindowState(window, filePath, initial, created) {
  const tracker = createStateTracker(initial, created);
  let timer = null;
  const save = () => {
    clearTimeout(timer);
    timer = null;
    // A minimized window cannot tell whether it is fullscreen; keep what was
    // saved before it was minimized.
    if (window.isDestroyed() || window.isMinimized()) return;
    try {
      writeWindowState(filePath, tracker.snapshot(window));
    } catch (error) {
      console.warn('[window-state] could not save:', error.message);
    }
  };
  const changed = () => {
    tracker.observe(window);
    clearTimeout(timer);
    timer = setTimeout(save, WINDOW_STATE_SAVE_DELAY_MS);
  };
  // A window that opened in fullscreen was never maximized underneath. Put it
  // back the way it was before fullscreen; registered first, so the tracker
  // below sees the maximized window, not the passing normal one.
  window.on('leave-full-screen', () => {
    if (tracker.snapshot(window).maximized && !window.isMaximized()) window.maximize();
  });
  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    window.on(event, changed);
  }
  window.on('close', save);
}

function createWindow() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const state = initialWindowState(readWindowState(stateFile), screen.getAllDisplays(), screen.getPrimaryDisplay());
  const minimum = minimumSizeFor(screen.getDisplayMatching(state.bounds).workArea);

  const window = new BrowserWindow({
    ...state.bounds,
    minWidth: minimum.width,
    minHeight: minimum.height,
    show: false,
    backgroundColor: BACKGROUND_COLOR,
    title: '3DTD',
    // Packaged, the window takes the icon embedded in 3DTD.exe.
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Music may start before the first click, as in any installed game.
      autoplayPolicy: 'no-user-gesture-required',
      additionalArguments: [`--desktop-version=${version}`],
    },
  });

  hardenContents(window.webContents);
  showErrorPages(window.webContents);
  lockZoom(window.webContents);
  handleShortcuts(window);
  // Tracking starts once the window has reached its start state. On the way
  // there Windows fires resize and move while isFullScreen() still reads
  // false, which would record the passing normal window as the one to keep.
  // The size is taken now, before maximize() or fullscreen change it.
  const created = window.getBounds();
  const settled = state.fullScreen ? 'enter-full-screen' : state.maximized ? 'maximize' : 'show';
  window.once(settled, () => rememberWindowState(window, stateFile, state, created));

  window.once('ready-to-show', () => {
    // Not both: fullscreen right after maximize() on a fresh window ends up
    // borderless at the normal size. rememberWindowState() maximizes when
    // the player leaves fullscreen instead.
    if (state.fullScreen) window.setFullScreen(true);
    else if (state.maximized) window.maximize();
    window.show();
  });
  void window.loadURL(isDev ? DEV_ORIGIN : `${APP_ORIGIN}/`);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  // A copy is already running; it brings itself to the front (second-instance).
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // A game has no use for File/Edit/View, and dropping the menu also drops
    // its accelerators: no Ctrl+R reload or Ctrl+W close in the middle of a wave.
    Menu.setApplicationMenu(null);
    // Notifications need it; the installed app gets the same id from the installer.
    app.setAppUserModelId(APP_ID);
    // Dark native title bar; the game's own theme is dark and fixed.
    nativeTheme.themeSource = 'dark';

    if (!isDev) {
      protocol.handle(APP_SCHEME, createAppProtocolHandler({ root: webRoot, readFile: fs.readFile }));
    }

    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(isPermissionAllowed(permission))
    );
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));

    saveDownloads(session.defaultSession);

    const userAgent = identifyingUserAgent(version);
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: identifiedUrlPatterns() }, (details, callback) =>
      callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': userAgent } })
    );

    mainWindow = createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
