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
| `camera-floor.ts` | The camera floor (3 m over the ground, 0.5 m over water) the stages lift every pose to, and the camera log's rows |
| `tools/showreel/run.mjs` | The runner: takes (`--scene`, take.mjs) or the programme in one browser; `--finish`, `--check` |
| `tools/showreel/take.mjs` | One take per scene from its fixed start (see Takes) |
| `tools/showreel/fixtures.mjs` | The takes' generated start states: map files by MapKit commands, game saves |
| `tools/showreel/check.mjs` | The automatic check of a take and its contact sheet |
| `tools/showreel/quiet.mjs` | One recording on the display at a time: queue, lock, `--wait` for the others' heavy work |
| `tools/showreel/browser.mjs` | Chrome on a fresh profile, Playwright, the page's sound, the editor map's fingerprint |
| `tools/showreel/script.mjs` | The programme (`SCENES`), the takes outside it (`TAKES`), the fixtures (`FIXTURES`) |
| `tools/showreel/capture.mjs` | Displays, which ddagrab output shows the window (a test colour, one frame per output), recording, the headless screencast, flash and click detection, the alignment, the mix |

## Run

The dev server must run (`npm start`, or `npx ng serve --port <p>` with `--url`). ffmpeg on PATH with ddagrab and
hevc_nvenc. playwright-core from `e2e/node_modules` (of this checkout, else of the main checkout).

```bash
node tools/showreel/run.mjs --list                                     # scenes and their step lengths
node tools/showreel/run.mjs --displays                                 # the displays Windows has
node tools/showreel/run.mjs --scene ember-flyover --rehearse           # one take on the screen, nothing recorded
node tools/showreel/run.mjs --scene ember-flyover --display DISPLAY2   # one take recorded (see Takes)
node tools/showreel/run.mjs --out <dir>                                # the whole programme in one browser
node tools/showreel/run.mjs --from dv-sculpt --to rc-water --headless 1600x900 --verify --url http://localhost:4307   # development
```

A run writes `run.json` after every page and scene (capture start, pages with their sound file and sync times, marks).
If it stops early it still stops ffmpeg, keeps the open page's sound when the page answers, and aligns and mixes
what it has. `--finish <run folder>` does the alignment and the mix for a folder again (without `run.json` the
sync flashes, runs of 4 to 12 white frames, pair with the sound files in order).

The dev server for a recording should run without live reload (`npx ng serve --port 4307 --live-reload=false
--hmr=false`): a source change during a run reloads the page under the runner.

Options: `--display DISPLAY2` (default the primary), `--quality ultra|high` (default ultra; Auto would play custom maps a level lower), `--output-idx N` (skips the colour test), `--dpr 1` (headless: the scaling to stand in for, e.g. `--headless 2048x1152 --dpr 1.25`),
`--cq 18`, `--chroma 444`, `--from <scene>`, `--to <scene>` (the programme), `--scene a,b` (takes).

UI per step: `{ do: 'ui', on }` (game: photo mode; editor: without header, tool column, side column, status bar,
minimap), `{ do: 'legend', on }` (the editor's mouse legend, off at the start), `{ do: 'markers', on }` (HQ diamond and
name signs in the game). Fly-overs and the outro play clean, editor and game with their UI.

Chrome gets no translate bubble: the feature list (Playwright's own plus `TranslateUI`, since Chrome reads only the
last `--disable-features`), `--lang=en-US`, and `translate.enabled: false` in the fresh profile; `--check-browser`
prints the flags and the pref.

A scene with `page` loads it (`opened`: the address the editor's Test map asked for, opened in the same window);
one without plays on. Editor scenes of the programme build on the ones before (`--from` for those, or a `start`
of their own, see Takes). A scene with `leave: <selector>` ends by the app's own navigation: after its steps the runner
keeps the page's sound, clicks that element (the pause menu's "Open in the editor") and follows the page the app
goes to; a redirect of that navigation adds `showreel`, so the hook loads there too (the app's link is left as it
is). `arrives: <address>` names the page a scene ends on (after a leave, or after the editor opened another map
from its list), so a run with `--from` a later scene loads that page. The hook opens the custom maps for its page
(`CUSTOM_MAPS_OPEN`), so the pause menu offers Edit this map before their release.

Editor storage: every run starts Chrome on a fresh profile, so no own copies or saves of an earlier run leak in.
A shipped map opened in the editor becomes an own copy; opened again (the map list's row, own copy or shipped)
it is that copy, with no "original changed" notice while the shipped file is the same.

## Takes (one scene per take, 2026-10-16)

Every scene can be recorded on its own, as often as needed; the cut picks a take per scene. A take starts on a
fixed state, not on what the scene before left.

```bash
node tools/showreel/fixtures.mjs --url http://localhost:4307                # the generated start states (missing ones; --force all)
node tools/showreel/run.mjs --scene proof-editor --headless --url http://localhost:4307   # one take, headless
node tools/showreel/run.mjs --scene a,b --display DISPLAY2 --url ...        # takes on the real display (queued, quiet.mjs)
node tools/showreel/run.mjs --check <take folder>                           # the check again
python D:/Source/3dtd/tmp/showreel/edit/build.py cut-long.json [--dry] [--limit 20]
```

Rehearsals and fixtures run against a dev server of one's own port; recordings use `--record` (below). The dev
server needs the agent's script worker for map fixtures (`node tools/agent/build-script-worker.mjs`,
which `npm start` runs; a server started before it was written must be restarted, it serves `public/` as it
found it).

**Start and environment** (scene fields in `script.mjs`, see the head of `take.mjs`):
- `start: { editor: 'fixtures/x.3dtdmap' | '<shipped id>' }`: the file is stored as an own map with the scene's
  sky patched in (no history step for it) and opened; `start: { game: '<shipped id>' | 'fixtures/x.3dtdmap', save:
  'fixtures/x.3dtdsave' }`: the game on the map (a map file stored as an own map first), the save loaded as the
  menu's Load from file does. `net: 'fixtures/x.har.zip'` on a scene answers its outside requests (page and
  workers) from a recorded HAR and aborts every other outside request, so an OSM world needs no network
  (`net-fixture.mjs record` plays the scene once and writes the HAR, `--overpass <answer.json>` answers Overpass
  from a saved answer; `check` plays it from the HAR alone and lists what is missing). Without a start, a scene with its own
  `page` loads that page (fly-overs, the fight, the outro); one that plays on from the scene before cannot be
  taken alone and says so.
- `env`: `window` (headless size, default 1600x900), `dpr`, `quality` (ultra), `seed` (the page's `Math.random`,
  default 1), `sky` (a MapEnvironment patch: `sky`, `sunAzimuth`, `sunElevation`, `weather`, `skyImage`, ...),
  `camera` `{ eye, look }` (the pose held from the first frame), `ui`, `markers` (spawn and HQ signs; the editor's
  overlay), `routes`, `healthBars`, `los` (the LOS debugger), `credits` (the HUD's sum), `floor` (camera metres
  over the ground, default 3), `sound` (whether the take must have sound; default game scenes). After setting them
  the runner reads them back from the page; a difference stops the take.
- Fixtures (`FIXTURES` in script.mjs, files in `tmp/showreel/fixtures/` of the main checkout): a map fixture is
  `from` (a shipped id, an earlier fixture, or `{ new: { name, size, ground, material } }` for a new map as the New
  map form makes it) plus a map `script` (the editor agent's `run_script`, MapKit commands,
  docs/AGENT_MCP.md); a build-up story makes one per scene, each from the one before plus the commands of the scene
  before. A save fixture plays director `steps` in the game (towers through the sidebar), sets `credits` to a
  normal sum and saves between waves in the app's own format. Saves made by hand work as well (Save to file).

**A take**: fresh Chrome profile, the start, the environment, wait until settled (no request open for 1 s; the
renderer's programs, geometries and textures unchanged for 1.5 s: grass, shadows, textures in; the editor idle;
after 90 s it goes on and notes it), 1 s still, the sync flash and click, the steps, 1 s still. Headless the
picture is Chrome's screencast at 60 fps (a frame the page did not draw repeats, as on a display); on a display
ddagrab as in the programme. The camera floor: the stages lift every pose of the director to 3 m over the ground
and 0.5 m over a water surface (`env.floor` sets less for a close-up); the camera log has every frame, whoever
holds the camera (intro flight, boss camera, tower view too).

Files in `tmp/showreel/takes/<scene>/<time>/`: `video.mkv`, `sound.flac` (as recorded) and `sound.wav` (on the
video's time line), `preview.mp4`, `marks.json` (marks in video seconds, `head`, `tail`, `end` included),
`meta.json` (app and script commit with a dirty flag, start, fixture sha256, environment, the page's state, the
settle, the capture, the steps, duration, camera `[video s, eye height, ground, water]` per frame),
`camera.json` (the full rows), `check.json`, `sheet.jpg` and `sheet/`. Takes are never overwritten.

**The check** (check.mjs, written to `check.json`, one line per take in `takes/<scene>/index.json`):
- picture: a frame within 0.3 of the one before (mean of 0-255, on a 160x90 grey copy, what mpdecimate would drop)
  repeats it; a held picture of 120 ms or more is a stutter while the camera moves (its log) or between moving
  frames; red with more than 2 stutters, or one of 250 ms while the camera moves (a hitch), or a picture held 1 s
  while the camera moves 0.3 m or more (frozen; the editor's held camera drifts by centimetres under strokes); a still picture of 6 s with the camera still is a warning only (an idle map)
- black (mean luma under 20) or white (over 225) frames without detail (standard deviation under 4: a night scene is dark but not flat) after the flash: red; black after a step labelled
  `fade...` is meant
- sound: a game scene (or `env.sound`) without sound or silent 2 s (under -60 dBFS): red; level jumps of 30 dB
  within 50 ms and clipping: warnings
- camera: under a water surface or less than 0.3 m over the ground: red; under the floor (a camera the director
  does not hold): warning. Buildings and objects are not in the log (terrain only).
- contact sheet: a frame a second of the scene and one half a second after every labelled step (yellow).
  `"accepted": true` set by hand on a line marks the take the cut takes for `best`.

**The cut** (`tmp/showreel/edit/build.py`, the old take-wide one is `build_v3.py`): reads only an edit list
(`cut-long.json`, `cut-short.json`): per shot scene, take (`best` or an id), in and out (a mark with +/- seconds,
or seconds after the scene's start), transition (`hard` or `fade`, 0.3 s crossfade), title. Game sound per shot
to `gameLufs` (-26, one gain, lifted 10 dB at most), the music its own track at `musicLufs` (-17): pieces with
`at` and `gain`, their silent heads and tails cut, 3.5 s crossfades, a fade at the end. No dip to black (the card
crossfades in); the watermark bottom left in game scenes and pages, off in the editor; titles bottom centre.
Changing a take is one line in the list and a new build.

**One recording at a time** (several agents prepare and rehearse headless in parallel, one records):

```bash
node tools/showreel/run.mjs --record --scene a,b --display DISPLAY2   # build, queue, lock, serve on 4307, record, release
node tools/showreel/quiet.mjs --wait                                   # before vitest, ng build, headless runs: returns when nobody records
node tools/showreel/quiet.mjs --status                                 # who records (pid, scene, since), who waits
```

- `--record` first builds this checkout (`dist/showreel-record`: the agent's script worker, build info, `ng build
  --configuration development`, which keeps the hook), after `quiet --wait`, so no build runs under someone else's
  recording. Then it puts a ticket into `tmp/showreel/record-queue/` (one file per request, first come, first
  served), waits for its turn, takes `tmp/showreel/record.lock` (pid, scene, start time), serves its build on
  port 4307 itself (the dev server's isolation headers, `index.html` for app routes), records its scenes on the
  display, stops serving and releases the lock. A lock or ticket whose process is gone is removed (stale).
- Why a build per agent and not one shared dev server: each agent records exactly its own code from its own
  worktree, nothing reloads or rebuilds under a recording, and no server is left running or owned by someone
  else; port 4307 is only in use while the lock is held. Nothing else may listen on 4307 then (the serve fails
  loudly). `--bundle <dir>` or `--no-build` take an existing build, `--url <server>` plays a running server instead
  (still queued), `--port` another port.
- While the lock is held: headless takes and rehearsals (`--scene ... --headless`, the programme run headless) and
  `fixtures.mjs` wait before each scene or fixture, so a run that is already going pauses between scenes; other
  heavy work calls `quiet.mjs --wait` first. A recording on the display without `--record` (the programme on a
  display, a take with `--url`) queues and locks the same way.

`scenes/proof.mjs` has two short takes that prove the flow: `proof-editor` (Demo Valley from a fixture with a
first hill raised by MapKit, a second one with the Terrain tool) and `proof-game` (Red Canyon from a save with
three towers and 420 credits, the first wave).

## Output (one folder per programme run)

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
game `spot:<i>`, `spots`, `enemy:<i>` or `enemy:<type>` (an enemy alive, held while it lives; a follow ends as it falls)), `{ m: [x, y], h }` metres; `h` above the ground (above the water surface where water lies), `habs` absolute, none: on the ground.

| Step | Does |
|------|------|
| `shot` `{ keys: [{eye, look}] or 'current', dur, ease }` | Camera path through keyframes |
| `orbit` `{ center, from, to, radius, radiusTo, height, heightTo, dur, ease }` | Camera round a point (degrees, 0 = south of it) |
| `click` `{ sel, withText?, dur }` | Pointer glides to a shown element (visibility hidden panels skipped) and clicks |
| `clickMap` `{ at, mods }`, `stroke` `{ points, dur, mods, settle }` | Click or drag on the map; the screen point follows the camera |
| `type`, `select`, `range` `{ sel, to, dur }`, `key` `{ key, mods }`, `move` | Inputs as a person makes them |
| `wait`, `par`, `seq`, `if` `{ sel, steps }`, `mark`, `fade`, `cursor`, `release` | Flow |
| `ui`, `legend`, `markers` | UI in the picture (see above) |
| `follow` `{ at, dur, back, side, h, ahead }` | Chase camera on a moving spot (editor `runner:<i>`, a trial runner) |
| `upload` `{ sel, file }` | A local file into a file input (the runner's `setInputFiles`; the W3X import) |
| `act` `{ name, ... }` | Stage action. Game: `intro` (wait for the game's intro flight to land), `man` `{ dur, wait, spot? }` (into a tower's first-person view, aim and shoot, out), `photo`, `routes`, `markers`, `hints`, `credits`, `research`, `jumpWave`, `speed`, `planTowers` `{count, tower, from, to, route, offsets, step}`, `build` `{tower, spot, hold}`, `wave`, `waveDone` `{timeout}` (until none alive and none to come), `enemiesNear` `{near | at, radius, kind?, timeout}` (until an enemy, of that type when given, is within `radius` m of a named spot or a map point `at`), `upgradeAll` (every tower to its last level), `healthBars` `{on}`, `environment` `{patch, fresh?, to?, hours?, dur?, ease?}` (`fresh`: on the map's environment before the scene's first change; `to` numbers, wind and planet too, and `hours` [from, to] as the time slider sets sun and sky, over `dur` s, each frame), `osmDrag` `{spawn, to: [east, north] m from the HQ, dur, hold}` (a spawn of the menu's OSM frame dragged on its map). Editor: `settings` `{patch}` (EditorSettings, deep merge), `environment`, `trialSpeed`, `viewReady`, `idle`, `save`, `history` `{ to: 0 \| 'end', stepS }` |

Intro pages: a scene with `intro: true` loads its page with `showreel=intro`: the hook hides the game's HUD from the
first frame (lane lines, HQ and spawns stay), the runner starts the sound and the sync flash while the map loads, and
the scene's `intro` action waits until the game's intro flight has landed before a shot takes the camera. The flash
then lies over the loading screen; in take 3 the runner did not find it there and placed those pages' sound by the
clock.

Programme files: `script.mjs` assembles `scenes/intro.mjs`, `editor.mjs`, `editor2.mjs`, `w3x.mjs`, `worlds.mjs`, `game.mjs`, `outro.mjs`
(helpers in `scenes/common.mjs`). `--script <file>` runs another programme (probes). Effect moments carry a mark
`effect:<what>` (the change visibly done), map blocks a mark with the map's name: the cut
(`tmp/showreel/edit/build.py`) cuts around them.

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
