# Showreel

Records a programme of custom maps and the map editor in a real Chrome, fullscreen, with the game's own sound,
for cutting a trailer. Picture and sound come separately and are lined up afterwards; every scene leaves time
marks in video time.

## Parts

| Part | What it does |
|------|--------------|
| `src/app/showreel/` | The page hook: loaded by `main.ts` only in a development build and only with `?showreel` in the address (a production build defines `ngDevMode` as false, the branch and its chunk drop out) |
| `director.ts` | Plays a scene (steps as data) on the page's frame clock: camera shots, the drawn pointer's clicks, strokes, sliders and keys, the stage's actions, time marks |
| `camera-path.ts` | Paths through keyframes (centripetal Catmull-Rom, one speed along the curve) and orbits, with easing |
| `game-stage.ts`, `editor-stage.ts` | The game on a custom map and the editor: camera held per frame (game: controls off; editor: the orbit camera's `apply`), map points to the screen, actions (`photo`, `routes`, `hints`, `credits`, `research`, `build`, `wave`, `speed`, `environment`; `settings`, `environment`, `trialSpeed`, `viewReady`, `idle`, `save`) |
| `pointer.ts`, `hands.ts` | The drawn pointer (the real one hidden) and synthetic pointer, mouse and key events |
| `audio-tap.ts` | Every connection to the speakers also feeds a MediaStream; a MediaRecorder writes it as Opus/WebM. The sync mark turns the page white for 120 ms (held by time: two frames at 144 Hz slipped between the frames of a 60 fps capture) and puts a full-scale 1 kHz click into the recording only, in its first frame |
| `tools/showreel/run.mjs` | The runner: Chrome (channel `chrome`, fresh profile, `--kiosk` on a display), ddagrab + hevc_nvenc, the scenes, the sound files, then the alignment and a preview |
| `tools/showreel/script.mjs` | The programme: scenes as data, reorder or trim there |
| `tools/showreel/capture.mjs` | Displays, which ddagrab output shows the window (a test colour, one frame per output), recording, flash and click detection, the mix |

## Run

The dev server must run (`npm start`, or `npx ng serve --port <p>` with `--url`). ffmpeg on PATH with ddagrab and
hevc_nvenc. playwright-core from `e2e/node_modules` (of this checkout, else of the main checkout).

```bash
node tools/showreel/run.mjs --list                                     # scenes and their step lengths
node tools/showreel/run.mjs --displays                                 # the displays Windows has
node tools/showreel/run.mjs --scene ember-flyover --rehearse           # one scene on the screen, nothing recorded
node tools/showreel/run.mjs --scene ember-flyover --out <dir>          # one scene recorded
node tools/showreel/run.mjs --out <dir>                                # the whole programme
node tools/showreel/run.mjs --from editor-new --headless 1600x900 --shots 3 --url http://localhost:4307   # development
```

A run writes `run.json` after every page and scene (capture start, pages with their sound file and sync times, marks).
If it stops early it still stops ffmpeg, keeps the open page's sound when the page answers, and aligns and mixes
what it has. `--finish <run folder>` does the alignment and the mix for a folder again (without `run.json` the
sync flashes, runs of 4 to 12 white frames, pair with the sound files in order).

The dev server for a recording should run without live reload (`npx ng serve --port 4307 --live-reload=false
--hmr=false`): a source change during a run reloads the page under the runner.

Options: `--display DISPLAY2` (default the primary), `--quality ultra|high` (default ultra; Auto would play custom maps a level lower), `--output-idx N` (skips the colour test), `--dpr 1` (headless: the scaling to stand in for, e.g. `--headless 2048x1152 --dpr 1.25`),
`--cq 18`, `--chroma 444`, `--from <scene>`, `--scene a,b`.

UI per step: `{ do: 'ui', on }` (game: photo mode; editor: without header, tool column, side column, status bar,
minimap), `{ do: 'legend', on }` (the editor's mouse legend, off at the start), `{ do: 'markers', on }` (HQ diamond and
name signs in the game). Fly-overs and finale play clean, editor and game with their UI.

Chrome gets no translate bubble: the feature list (Playwright's own plus `TranslateUI`, since Chrome reads only the
last `--disable-features`), `--lang=en-US`, and `translate.enabled: false` in the fresh profile; `--check-browser`
prints the flags and the pref.

A scene with `page` loads it (`opened`: the address the editor's Test map asked for, opened in the same window);
one without plays on. `--scene` loads the page the scene needs, but editor scenes build on the ones before
(`--from editor-new` for those).

## Output (one folder per run)

- `video.mkv`: HEVC, 60 fps, the display as it was, without the real pointer
- `sound-NN.webm`: the game's sound per page (Opus 256 kbit/s, as the recorder wrote it), `sound-NN.flac` the same with a proper length; the alignment and the mix read the FLAC
- `sound.wav`: all sound on the video's time line; `preview.mp4`: video copied with that sound (AAC)
- `marks.json`: per page the flash in the video and where its sound file starts there (`offset`); every scene
  start and end and labelled step with `video` (seconds into `video.mkv`)

Alignment: each page turns white for 120 ms and puts a click into its sound file in the first white frame. The runner
finds the white frames (mean brightness, `detectFlashes`) and the click (first sample over half scale), and places
the file so both meet. Without them it falls back to the wall clock and says so.

## The window

Windows opens a new window behind the one in front when its program had no recent input (foreground lock),
so the runner finds its window by a title only it carries and raises it with `window.ps1`: an Alt press and
release, then topmost, BringWindowToTop and SetForegroundWindow; up to four tries before the test colour. The
window stays topmost for the run and is released at the end. No other window is moved, minimised or closed.

## While it records

Nobody may touch mouse or keyboard over the recorded display: real pointer moves reach the page (the editor's
brush follows the real pointer). Windows over the display show in the picture. The editor's Test map normally
opens a second window; under the hook the runner opens it in the same one.

## Script reference (director steps)

Every step may carry `label` (a time mark). Points: `[fx, fy, h?]` shares of the map around its middle, `{ at, dx,
dy, h }` from a named spot (`hq`, `center`, `spawn:<i>`; editor `node:<i>`, `river:<r>:<p>`, `object:<asset|last>`;
game `spot:<i>`, `spots`), `{ m: [x, y], h }` metres; `h` above the ground, `habs` absolute, none: on the ground.

| Step | Does |
|------|------|
| `shot` `{ keys: [{eye, look}] or 'current', dur, ease }` | Camera path through keyframes |
| `orbit` `{ center, from, to, radius, radiusTo, height, heightTo, dur, ease }` | Camera round a point (degrees, 0 = south of it) |
| `click` `{ sel, withText?, dur }` | Pointer glides to a shown element (visibility hidden panels skipped) and clicks |
| `clickMap` `{ at, mods }`, `stroke` `{ points, dur, mods, settle }` | Click or drag on the map; the screen point follows the camera |
| `type`, `select`, `range` `{ sel, to, dur }`, `key` `{ key, mods }`, `move` | Inputs as a person makes them |
| `wait`, `par`, `seq`, `if` `{ sel, steps }`, `mark`, `fade`, `cursor`, `release` | Flow |
| `ui`, `legend`, `markers` | UI in the picture (see above) |
| `act` `{ name, ... }` | Stage action. Game: `photo`, `routes`, `markers`, `hints`, `credits`, `research`, `jumpWave`, `speed`, `planTowers` `{count, tower}`, `build` `{tower, spot, hold}`, `wave`, `environment` `{patch}`. Editor: `settings` `{patch}` (EditorSettings, deep merge), `environment`, `trialSpeed`, `viewReady`, `idle`, `save` |

Towers: `planTowers` finds spots beside the routes with the game's own rules (`TowerPlacementService.placementAt`,
3 m room around) before the pointer moves; `build` clicks the card once it is enabled, glides the camera over a spot
the HUD would cover, holds the pointer on the spot (`hold`, preview and route grid visible) and clicks once.

## Pitfalls found (2026-10-14)

- Foreground lock: a new Chrome window opens behind the user's window; `window.ps1` raises it (see above).
- Translate bubble: Chrome reads only the last `--disable-features`; Playwright passes its own list, so the runner
  repeats it with `TranslateUI` and writes `translate.enabled: false` into the profile.
- 144 Hz display: a two-frame flash (14 ms) fell between the frames of the 60 fps capture; the flash lasts 120 ms.
- A MediaRecorder on a stream without samples never fires `start` (the editor has no sound): a silent constant
  source feeds the tap; a recorder that does not start in 5 s fails loudly.
- Live reload: a source change while a run plays reloads the page under the runner; serve without live reload.
- Dynamic resolution (Low, Medium, Auto on custom maps) resized the canvas after the draw: one black frame per
  step (fixed in the engine, `fix(engine): dynamic resolution resizes before the draw`); the runner sets Ultra.
- 125 % Windows scaling: CSS 2048x1152, pixel ratio 1.25; High and Ultra allow it on custom maps (Auto does not),
  `--window-size` is left to kiosk. The runner logs CSS size, pixel ratio and drawing buffer per page and scene.
- Hidden editor panels stay in the DOM under `visibility: hidden` with the same `data-mode` values: steps look
  for shown elements only.
- Pour on flat ground once flooded a wide plain (fixed in round 3); Fill a hollow with Ctrl fills one crater to
  its rim.
- A ground layer limit (8, then 12 since round 3): a biome brings 3 to 6 layers; the script header lists them.
- Brush strokes depend on frame timing (holding grows a shape), so results vary a little between runs.

## Take 3 status (2026-10-14 evening)

Done (b2987e1c): faster, closer fly-overs with image skies; take-3 editor beats; trial wave at 2x low at the
spawn; game part halved (4 towers, 14 s fight).

Open, asked by the user:
- every editor tool and mode that reads on screen, larger brushes, result held 1 s (Ramp from the side, Auto
  paint on a fresh mountain, Duplicate a group of houses, Water modes incl. Pour, Dig a lake, Sea from the edge,
  Stamps, Map generator, still frame B as bullet time)
- brush size and strength changed visibly between two strokes
- objects: taller buildings, scale with the gizmo, lamps along a road (Line along a road) lit at night
- sky sliders with visible effect (wind, time sweep, fog, rain/snow strength, moonlight), camera on vegetation
- a grass close-up about 1 m above the ground
- symmetry obvious: high view, 2 and 4 copies from one stroke
- game intro flights complete with the UI hidden from the load on (lane lines, HQ, spawns kept), as fly-over
  openers; the page flash must not eat the intro
- trial wave: look at the spawn, then a chase camera following one runner, then pull up
- W3X import beat (tmp/wc3/Mafa-Td-Queen-v14.6.w3x from the main checkout, read only)
- History rewind, stamps rotated, tower first-person view in the game
