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

Options: `--display DISPLAY2` (default the primary), `--quality ultra|high` (default ultra; Auto would play custom maps a level lower), `--output-idx N` (skips the colour test), `--dpr 1` (headless: the scaling to stand in for, e.g. `--headless 2048x1152 --dpr 1.25`),
`--cq 18`, `--chroma 444`, `--from <scene>`, `--scene a,b`.

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

## While it records

Nobody may touch mouse or keyboard over the recorded display: real pointer moves reach the page (the editor's
brush follows the real pointer). Windows over the display show in the picture. The editor's Test map normally
opens a second window; under the hook the runner opens it in the same one.
