# 3DTD Desktop

Desktop build of 3DTD on Electron: a Windows installer and a Linux AppImage, both
x64. The game is the regular Angular build from the repository root; this folder
only wraps it. Requirements, decisions and the plan:
[docs/ELECTRON_DESKTOP_PLAN.md](../docs/ELECTRON_DESKTOP_PLAN.md).

## Commands

Run from `desktop/`, after `npm install` here and in the repository root.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Angular dev server plus Electron on `localhost:4200`, with live reload |
| `npm start` | Production build of the game, copied to `app/`, started over `app://` |
| `npm run dist` | Same build, then the package for this platform in `release/`: the NSIS installer on Windows, the AppImage on Linux |
| `npm test` | Tests of the main-process logic (`node --test`) |

The version comes from the root `package.json`; this `package.json` has none on
purpose.

## Layout

```
src/main.js                 window, security wiring, dev or app://
src/app-id.js               appId for installer, notifications and updater
src/protocol.js             app:// handler: paths, MIME types, ranges, CSP
src/security.js             navigation and permission rules
src/preload.js              window.desktop, the only bridge to the game
src/downloads.js            where and under which name downloads are saved
src/error-page.js           page shown when loading fails or the renderer dies
src/log.js                  log lines, key masking, repeats, GPU line
src/shortcuts.js            F11 fullscreen, F12 DevTools, nothing else
src/window-state.js         size, position, maximized, fullscreen across starts
src/user-agent.js           identifies the app to OpenStreetMap and Wikidata
src/updater.js              electron-updater: check, background download, install on quit
scripts/copy-web.js         dist/3DTD/browser -> app/, with the key guard
scripts/build-guard.js      refuses a build that contains a local tile key
scripts/make-icon.sh        build/icon.ico from the logo (ImageMagick)
scripts/check-version.js    release guard: the tag has to name the root version
scripts/changelog.js        release guard and release text: the CHANGELOG.md section
build/icon.ico              app and installer icon, 16 to 256 px
electron-builder.config.js  NSIS target, fuses, version from the root
test/                       node:test suites
```

## Releases

`/release X.Y.Z` in Claude Code walks through it (`.claude/commands/release.md`). A
release needs a section `## X.Y.Z (date)` in the root `CHANGELOG.md`, written for players;
the game shows it as "What's new" and the update hint shows its first items.

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: it checks the tag against
the root version and the changelog, runs both test suites, builds the installer and puts
it on a draft GitHub release with `latest.yml`, the blockmap and the changelog section as
its text. Download the draft installer, try it, then publish the draft as a normal
release (not a pre-release). Publishing hands the update to installed copies and runs
`deploy.yml`, which puts the same version of the web game and the landing page live. To
test the update path locally, serve the output folder of a build with a higher version
and start the app with `DTD_UPDATE_FEED=http://127.0.0.1:<port>`.

## Things to know

- **Log file:** `%APPDATA%\3DTD\logs\main.log` (rotated at 5 MB into `main.old.log`).
  Ctrl+Shift+L opens the folder, F12 the DevTools. Keys and tokens in URLs are masked
  before a line is written, so the file can go into a public issue.
- **No keys in the installer.** `copy-web.js` reads `cesiumIonToken` and
  `googleMapsApiKey` from `src/environments/environment.ts` and
  `environment.prod.ts` and stops when one of those values appears in the build.
- **The CSP lives in `src/protocol.js`.** A new host the game talks to shows up
  as a CSP violation in the console; add it to `CONNECT_HOSTS`. A new inline
  handler in `index.html` fails `test/index-csp.test.js`.
- **`appId` never changes** once a release is out, or installed copies stop
  receiving updates.
- **First `npm run dist` on a new machine** may fail on the winCodeSign symlinks.
  Turn on Windows developer mode or run it once as administrator, see the plan.
