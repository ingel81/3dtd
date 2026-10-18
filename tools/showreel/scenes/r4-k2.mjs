// Round 4, K2 "The worlds, weather and time of day" (tmp/showreel/DREHBUCH_R4.md 2.7): the shipped maps, long and
// calm, clean frames with the map's own sound. Each scene is a take of its own on a shipped map (start.game, no
// intro flight). Weather and time change with the camera at rest or on a slow drift; a scene's looks are switched on
// once at its start and back (the shaders compile there, not in the shot: `warm`), and the cut starts at the mark
// with the map's name. Heights over water are `habs` from the water's level (dumped from the map files):
// Autumn Keep's pond 33.2, the Frost Hamlet ice -0.5, the sea and the marsh 0, Ember Crater's lava 3.8.
import { act, m, orbit, path, wait } from './common.mjs';

/** The take's window: the display's 2560x1440 at 125 % scaling */
const VIEW = { window: '2048x1152', dpr: 1.25, ui: false, markers: false, routes: false, healthBars: false };

/** An environment change: `patch` at once, then numbers toward `to` and the hour through `hours` over `dur` s */
const env = (patch, opts = {}) => act('environment', { patch, ...opts });

/**
 * The looks a scene will use, each set once and the map's own with `base` on it back (its first frames compile the new programs and
 * stall, here and not in the shot), then a still moment for the cut's start
 */
const warm = (base, ...looks) => [
  // A look with `hours` sets the clock too (the torches burn by the hour)
  ...looks.flatMap(({ hours, ...look }) => [hours ? env(look, { hours }) : env(look), wait(0.5)]),
  act('environment', { patch: base, fresh: true }),
  wait(1.5),
];

/** The camera held still at a pose */
const still = (eye, look) => path(0.1, [[eye, look], [eye, look]]);

/**
 * A shipped map in the game, clean, from its own start state: the first pose and the looks warmed there before the
 * picture counts (the runner then waits until the GPU has compiled them), the steps
 */
const world = (name, map, label, pose, looks, steps, extra = {}) => ({
  name,
  start: { game: map },
  env: { ...VIEW, ...extra },
  warm: [{ do: 'ui', on: false }, { do: 'markers', on: false }, act('routes', { on: false }), act('healthBars', { on: false }), pose, ...looks],
  steps: [{ do: 'mark', name: label }, ...steps],
});

const NIGHT = { sky: 'night', sunElevation: 30 };
const RAIN = { weather: 'rain', weatherStrength: 1 };
const STORM = { skyImage: 'thunderstorm', sky: 'overcast', sunElevation: 30, ...RAIN, wind: { strength: 0.8, direction: 200, gusts: 0.8 } };

export const SCENES = [
  // Autumn Keep: the afternoon into the night over the keep, fixed from the south. The engine's sky has three looks
  // (day, dusk, night) and jumps between them, so the time-lapse runs in three stretches with a still moment at each
  // change and a `dissolve:` mark there for the cut's cross-fade: the sun sinks from 13:00 to 17:45 (day, the shadows
  // swing), dusk from 19:00 to 20:00, night at 21:30 with the torches and braziers on; then closer up to the
  // walls closer. Moonlight full, so the night reads (F092)
  world('wx-autumn', 'autumn-keep', 'Autumn Keep', still(m(8, -12, 30), m(18, 80, 14)), warm({ sky: 'day', moonlight: 1, sunAzimuth: 180, sunElevation: 60 }, { ...NIGHT, hours: [21.5, 21.5] }, { sky: 'dusk', sunElevation: 8, hours: [19.5, 19.5] }), [
    wait(1),
    env({}, { hours: [13, 17.75], dur: 9, ease: 'linear', label: 'effect:afternoon' }),
    wait(0.8),
    { do: 'mark', name: 'dissolve:dusk' },
    env({}, { hours: [19, 19] }),
    wait(1.8),
    env({}, { hours: [19, 20], dur: 5, ease: 'linear', label: 'effect:dusk' }),
    wait(0.8),
    { do: 'mark', name: 'dissolve:night' },
    env({}, { hours: [21.5, 21.5] }),
    { ...wait(2.5), label: 'effect:night' },
    path(7, ['current', [m(30, 18, 22), m(20, 72, 12)]], { ease: 'inOut', label: 'effect:torches' }),
    wait(1),
  ]),
  // Mountain Pass: morning fog over the pasture lifts in 8 s, the cattle on the slope below, a cable car pylon and the
  // huts beyond. The gondolas hang still (props; no mover runs them)
  world('wx-mountain', 'mountain-pass', 'Mountain Pass', still(m(-62, 8, 18), m(-130, -40, 14)), warm({ weather: 'fog', weatherStrength: 1, sky: 'day', sunAzimuth: 116, sunElevation: 26 }, NIGHT, { sky: 'day', weather: 'fog', weatherStrength: 0, hours: [10, 10] }), [
    wait(1.5),
    env({}, { to: { weatherStrength: 0 }, hours: [8, 10], dur: 8, label: 'effect:fog lifts' }),
    path(7, ['current', [m(-74, -4, 16), m(-140, -46, 12)]], { ease: 'inOut', label: 'effect:pasture' }),
  ]),
  // Frost Hamlet at night under the aurora: snow sets in over the frozen lake, 4.5 m over the ice among the fishing
  // huts (the flakes read against the dark sky)
  world('wx-frost', 'frost-hamlet', 'Frost Hamlet', still({ m: [-46, -68], habs: 3.5 }, { m: [-20, -40], habs: 1 }), warm({ sky: 'night', sunElevation: 30, moonlight: 1, weather: 'snow', weatherStrength: 0 }, { weather: 'snow', weatherStrength: 1 }), [
    wait(1),
    env({}, { to: { weatherStrength: 1 }, dur: 6, label: 'effect:snowfall' }),
    path(8, ['current', [{ m: [-38, -58], habs: 3.5 }, { m: [-18, -40], habs: 1 }]], { ease: 'inOut', label: 'effect:snow over the ice' }),
  ]),
  // Harbor Town: (a) a thunderstorm over the harbour, rain and wind, the cranes and the boats from the quay, 10 m
  // over the water; (b) the night as the map has it, the lamps' light on the water along the quay
  world('wx-harbor', 'harbor-town', 'Harbor Town', still({ m: [-160, -222], habs: 10 }, { m: [-60, -150], habs: 10 }), [
    ...warm({ sky: 'night', moonlight: 1 }, STORM),
    env(STORM),
    wait(1.8),
  ], [
    path(8, ['current', [{ m: [-120, -228], habs: 11 }, { m: [-20, -160], habs: 12 }]], { ease: 'inOut', label: 'effect:storm' }),
    // The cut goes hard to the night here
    act('environment', { fresh: true, patch: { sky: 'night', sunElevation: 40, weather: 'clear', weatherStrength: 0, moonlight: 1 } }),
    path(0.1, [[{ m: [-235, -205], habs: 10 }, { m: [-150, -165], habs: 4 }], [{ m: [-235, -205], habs: 10 }, { m: [-150, -165], habs: 4 }]]),
    wait(1.8),
    { do: 'mark', name: 'Harbor Town at night' },
    path(8, ['current', [{ m: [-80, -205], habs: 13 }, { m: [0, -130], habs: 8 }]], { ease: 'inOut', label: 'effect:lights on water' }),
  ]),
  // Archipelago at dusk: between the red and the green buoy 4 m over the sea, the boats on the water, the
  // lighthouse's rock beyond
  world('wx-archipel', 'archipelago', 'Archipelago', still({ m: [35, -197], habs: 3 }, { m: [48, -185], habs: 1.5 }), [wait(1.5)], [
    wait(1),
    path(9, ['current', [{ m: [84, -198], habs: 3.5 }, { m: [96, -185], habs: 1.5 }]], { ease: 'inOut', label: 'effect:buoys' }),
  ], { sky: { skyImage: 'afterglow', sky: 'dusk', sunElevation: 13, sunAzimuth: 250 } }),
  // Witch Marsh at night: low over the marsh water to a stilt hut, its lanterns and the jetty's mirrored in the water,
  // fireflies over the reeds
  world('wx-marsh', 'witch-marsh', 'Witch Marsh', still({ m: [-16, 164], habs: 2.2 }, { m: [-30, 182], habs: 2.5 }), [wait(1.5)], [
    wait(1),
    path(9, ['current', [{ m: [-10, 170], habs: 2.2 }, { m: [-28, 184], habs: 2.5 }]], { ease: 'inOut', label: 'effect:fireflies' }),
  ]),
  // Ember Crater: flat over the lava ring, its crust cracking, the smoke columns against the dark sky
  world('wx-ember', 'ember-crater', 'Ember Crater', still({ m: [80, 15], habs: 18 }, { m: [0, 0], habs: 5 }), [wait(1.5)], [
    wait(1),
    path(9, ['current', [{ m: [75, -25], habs: 16 }, { m: [0, -5], habs: 6 }]], { ease: 'inOut', label: 'effect:lava' }),
  ], { sky: { skyImage: 'starry-night', sky: 'night', sunElevation: 26 } }),
  // Twin Gates: the siege camp in a strong wind, the grass and the trees blowing, a trebuchet in front of the walls
  // and a siege tower, side on
  world('wx-twin', 'twin-gates', 'Twin Gates', still(m(-95, 140, 14), m(-140, 95, 6)), warm({ wind: { strength: 0.9, direction: 270, gusts: 0.7 } }), [
    wait(1),
    path(8, ['current', [m(-80, 125, 13), m(-125, 80, 6)]], { ease: 'inOut', label: 'effect:siege camp' }),
  ]),
  // Ruined City: through the smoke of the burning ruins under the overcast sky
  world('wx-ruined', 'ruined-city', 'Ruined City', still(m(-150, 60, 24), m(-96, 96, 10)), [], [
    wait(1),
    path(8, ['current', [m(-140, 125, 22), m(-90, 96, 10)]], { ease: 'inOut', label: 'effect:smoke' }),
  ]),
  // Demo Valley's meadow a metre over the ground: the wind rises from a breeze to gusts running through the grass
  world('wx-wind', 'demo-valley', 'Meadow', still(m(-127, -157, 0.9), m(-118, -144, 0)), warm({ sunAzimuth: 285, sunElevation: 20, tint: '#fff0dc', wind: { strength: 0.3, direction: 250, gusts: 0.3 } }), [
    wait(1.5),
    env({}, { to: { wind: { strength: 0.9, direction: 250, gusts: 0.8 } }, dur: 4, label: 'effect:wind' }),
    path(7, ['current', [m(-119, -146, 1.1), m(-110, -133, 0)]], { ease: 'inOut', label: 'effect:gusts' }),
  ], { floor: 0.8 }),
];
