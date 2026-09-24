# Changelog

What changed for players, newest first. Every release adds a section here, and the
game shows it once after an update.

## 0.4.0 (2026-09-24)

### New
- Watch any wave of the run again, as it was played, with a free camera: pause, 0.25x
  to 4x, jump anywhere, step to other waves. Save a run's replays as a file and watch
  them again later on the same map.
- Man a tower: press C in a projectile tower to aim and fire it yourself. C or Esc
  gets you out.
- Research opens as a full tree (Q or the button in the build panel), and the queue
  can be reordered.
- New music and sounds: tracks for bosses, blood moon and game over, deaths, hits, a
  horn at the end of a wave. The music makes room before a wave's signals. A master
  volume with M to mute, and a volume of its own for interface sounds.

### Better
- You start with 500 HP, and waves adapt to how hard your base is pressed. Tough
  enemies pay a bigger bounty, and the campaign brings its own bosses: the Ooze in
  wave 20, Skarnax in wave 30.
- Hold Alt to show the health bars, or to hide them while they are on. The HQ is a
  crystal with an energy core, and every spawn is named after its street.

### Fixed
- Towers no longer shoot at enemies that already reached the base.
- A wave no longer grows with towers built just before you start it, and there is no
  sudden wall of enemies in wave 15. A new place starts the waves fresh.

## 0.3.2 (2026-09-20)

### New
- Linux build: an AppImage (x64) on the releases page, auto-updating like the Windows
  app. Needs FUSE 2 (`libfuse2` on Ubuntu, `fuse2` on Arch).
- Hold fire: a button in the tower panel stops a tower from attacking. It stands greyed
  out with a pause sign, and can still be upgraded or sold.
- A click on an arrow at the screen edge takes the camera to its boss or enemy.

### Better
- The random location rolls at once, out of a list in the game, and lands only on
  cities Google covers in 3D.
- Place names carry the country, in the header and on the loading screen.
- The red enemy route is on from the start. If you switched it off, it stays off.

### Fixed
- Towers on flat ground stood on a stone plinth they did not need.
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
