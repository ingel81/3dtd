# Showreel handover (2026-10-14 evening, after take 3)

Read README.md first (rig, steps, pitfalls). This file is the state for the next worker.

## State

- Branch `wt/showreel`, on wt/round3 67e3fe51. Takes so far: take 2 (13-35-16), take 3 (15-20-08) in the lead's
  scratchpad `showreel/`; reviews of take 3 in `D:/Source/3dtd/tmp/showreel/reviews/review-a.md` and `review-b.md`
  (the work list for take 4).
- Done for take 4 already:
  - 704c98ab: map clicks and strokes check their points against the canvas first; off screen the camera reframes
    and the console prints `[showreel] <scene>#<step>: ... off screen, the camera reframes` (a script bug to fix,
    the reframe only saves the take). Root cause of most "click with no result" in take 3: points off the canvas,
    behind the camera or under a panel; a stroke then landed on the tool column.
  - `frame` step: camera on a group of map points from a side (`from`), `pitch`, `margin`, `pad`, turning `turn`
    over `dur`. Use it instead of guessed keyframes, also inside `par` beside strokes.
  - `--verify`: every step on its own, a picture after it and a log line of what changed in the map
    (`verify.txt`, `verify/<scene>-NN.png`). A stroke or map click that changes nothing is a failure.
  - Scenes fixed with it: higher cliff and the ramp from the side, forest grows over the first mountain, valley
    through the third, snow on a peak, symmetry on map 2 from above (Mirror X: two mountains, Both: four craters),
    a crater made and filled right after.
  - 32e4999b: intro-page flashes (18 to 22 frames, the load stalls frames) are found; take 3 re-aligned with
    `--finish` (all 14 flashes).
- A full headless run with sound of this state was started (`rehearse/` in the scratchpad) and its result not
  read; run it again.

## Open (from the reviews, with notes)

- Contact sheets per scene are the new acceptance rule (lead, 2026-10-14): every labelled step needs a control
  frame after its action at 1600x900 with the cursor on screen, sheet per scene, an independent review, then
  take 4. `--verify` gives the frames; a sheet maker (PIL, before/after per step, labels) is still to write.
- stamps: copy and paste land in --verify now (heights, paint, objects change), check the frames; 2nd target near
  the edge.
- look: HQ click shows "Nothing yet": click the HQ marker itself, not its ground point.
- fill / second lake: Fill a hollow fills the chosen body only up to its level; a new hollow needs "Add lake" (a
  new body) or Ctrl+click (rim level). The script uses Ctrl; verify on frames.
- sky: wind with trees in view (fixed camera, verify); use one of Dusk or the time slider; moonlight frame too
  dark (night with lamps in view); the still-frame orbit must keep the shot's centre; set weather Clear before the
  starry night; fog vs overcast barely differs (raise fog density); the 40 s path idles 7 s at the end; "Day"
  leaves time at 18:55, so later scenes are dark: set the time of day explicitly after the sky scene.
- editor2: hell paints nothing (check layers left after arctic; status line), the snowfall click hit the fog
  input (select by the weather buttons' group, not withText alone), lava: 1 of 3 craters filled (craters onto the
  volcano, bigger and deeper, camera ends on the lava).
- trial: hide route markers during the chase; overlays/history: history rewind strobes (slower steps or fewer);
  editor-test goes to the map list before the game (check the opened address).
- w3x: pop-in at open, orbit jump at the end (start the orbit from the current pose).
- game: build spots behind the HQ crystal (exclude a radius round the HQ), black frames at the start of
  game-build (look at the loading), wave 8 has fliers only: pick a ground wave; tower view with archer or
  lightning (cannon smoke fills the frame); finale: dark mountain covers the left half, map edge shows.
- Auto paint barely shows on mountains that are rocky already (app look, see below).

## App-side issues seen (not fixed here)

- Ramp: the result is subtle on gentle ground; the status toast "Ramp start set" stays.
- Night switch: a short freeze when the sky goes to night (shader compile), seen in headless frames.
- Auto paint: on a fresh mountain the snow of the peaks goes and little else changes.
- Harbor Town intro flight passes through a roof near West Gate.

## How I verified

```bash
# own dev server, never port 4200; build-info first, live reload off (a source change reloads the page mid-run)
node tools/build-info.mjs
npx ng serve --port 4307 --live-reload=false --hmr=false        # started via cmd /c in the background, PID by port
node tools/showreel/run.mjs --from editor-new --verify --headless 1600x900 --url http://localhost:4307 --out <dir>
node tools/showreel/run.mjs --scene <a,b> --headless 1600x900 --shots 2 --url http://localhost:4307 --out <dir>
node tools/showreel/run.mjs --headless 1600x900 --sound --shots 4 --url http://localhost:4307 --out <dir>
node tools/showreel/run.mjs --script <probe.mjs> ...              # a probe programme with its own scenes
```

Montages of the pictures with PIL (a few lines; mine lived in the scratchpad). Read frames, not only "no error":
a step without effect does not fail.

## Traps not in the README yet

- `scenes/*.mjs` points are shares of the map; the editor's camera frustum at 1600x900 shows less than it looks:
  prefer `frame` over hand keyframes.
- `click` with `withText` matches the first shown element whose text includes the string: 'Snow' also matches
  inputs near the weather group; give a narrower `sel`.
- The editor's tool click resets the brush to that tool's own (per tool brushes): set `settings` after the tool
  and mode clicks.
- Editor panels stay in the DOM under `visibility: hidden`; `find` skips them.
- A long wait loop in this shell gets killed (exit 137); poll the log with short until-loops in the background.
