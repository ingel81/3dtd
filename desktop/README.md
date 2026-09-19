# 3DTD Desktop

Windows build of 3DTD on Electron. The game is the regular Angular build from the
repository root; this folder only wraps it. Requirements, decisions and the plan:
[docs/ELECTRON_DESKTOP_PLAN.md](../docs/ELECTRON_DESKTOP_PLAN.md).

## Commands

Run from `desktop/`, after `npm install` here and in the repository root.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Angular dev server plus Electron on `localhost:4200`, with live reload |
| `npm start` | Production build of the game, copied to `app/`, started over `app://` |
| `npm run dist` | Same build, then the NSIS installer in `release/` |
| `npm test` | Tests of the main-process logic (`node --test`) |

The version comes from the root `package.json`; this `package.json` has none on
purpose.

## Layout

```
src/main.js                 window, security wiring, dev or app://
src/protocol.js             app:// handler: paths, MIME types, ranges, CSP
src/security.js             navigation and permission rules
src/preload.js              window.desktop, the only bridge to the game
src/shortcuts.js            F11 fullscreen, F12 DevTools, nothing else
src/window-state.js         size, position, maximized, fullscreen across starts
src/user-agent.js           identifies the app to OpenStreetMap and Wikidata
scripts/copy-web.js         dist/3DTD/browser -> app/, with the key guard
scripts/build-guard.js      refuses a build that contains a local tile key
scripts/make-icon.sh        build/icon.ico from the logo (ImageMagick)
build/icon.ico              app and installer icon, 16 to 256 px
electron-builder.config.js  NSIS target, fuses, version from the root
test/                       node:test suites
```

## Things to know

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
