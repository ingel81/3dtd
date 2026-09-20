# Changelog

What changed for players, newest first. Every release adds a section here, and the
game shows it once after an update.

## 0.3.2 (2026-09-20)

### New
- Linux build: an AppImage (x64) on the releases page, auto-updating like the Windows
  app. Needs FUSE 2 (`libfuse2` on Ubuntu, `fuse2` on Arch).
- Hold fire: a button in the tower panel stops a tower from attacking. It stands greyed
  out with a pause sign, and can still be upgraded or sold.
- A click on an arrow at the screen edge takes the camera to its boss or enemy.

### Better
- The red enemy route is on from the start. If you switched it off, it stays off.

### Fixed
- The tank and the penguin were invisible in the sidebar preview.

## 0.3.1 (2026-09-19)

### New
- A Windows app, next to the browser version. Get the installer from the
  [releases page](https://github.com/ingel81/3dtd/releases/latest). It keeps itself up
  to date: a new version installs when you quit, or right away if you choose to restart.
- In the app, F11 switches to full screen, and the window opens where you left it.
- The app saves screenshots from photo mode straight to your Downloads folder.

### Better
- Big waves run much faster in Firefox: in our test with 5000 enemies, from about 22
  to about 59 frames per second. The game does less work per enemy in every browser.
