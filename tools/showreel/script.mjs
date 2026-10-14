// The showreel programme: scenes as data, played in order by run.mjs. A scene with `page` loads that page
// (`opened`: the window the editor's Test map asked for); one without plays on where the last one ended.
// Steps run on the page's frame clock (src/app/showreel/director.ts); `label` leaves a time mark for the cut.
//
// Points: [fx, fy, h] are shares of the map's width and depth around its middle (east, north) with h metres
// above the ground there; { at, dx, dy, h } metres from a named spot: 'hq', 'center', 'spawn:0', in the editor
// 'node:-1' (newest road node), 'river:0:3' (a river point), 'object:<asset>' or 'object:last', in the game
// 'spot:<i>' and 'spots' (tower spots from planTowers); { m: [x, y], h } metres on the map. Without h: on the
// ground, followed live. Orbit angles in degrees, 0 = the camera south of the centre looking north,
// counter-clockwise.
//
// UI per step: { do: 'ui', on } the page's UI or a clean frame (game: photo mode; editor: without header, tool
// column, side column, status bar and minimap), { do: 'legend', on } the editor's mouse legend (off by default),
// { do: 'markers', on } the game's HQ diamond and name signs. Fly-overs and the finale play clean, editor and
// game with their full UI.
//
// Ground layers, measured on an empty map (grass): forest +3, river +3 (sand, gravel, mud),
// road +1 (cobblestone), snow +3, desert +4, arctic +5, hell +6; a map holds 12 since round 3. Green Valley
// paints gravel first (the river reuses it): grass, gravel, forest x3, sand, mud, cobblestone. Fire and Ice:
// grass, arctic x5, hell x6; its lava is water bodies (Fill a hollow), no ground layers.

import { SCENES as FLYOVERS } from './scenes/flyovers.mjs';
import { SCENES as EDITOR } from './scenes/editor.mjs';
import { SCENES as EDITOR2 } from './scenes/editor2.mjs';
import { SCENES as W3X } from './scenes/w3x.mjs';
import { SCENES as GAME } from './scenes/game.mjs';
import { SCENES as FINALE } from './scenes/finale.mjs';

/** The programme in order; each part lives in scenes/ (common.mjs has the helpers) */
export const SCENES = [...FLYOVERS, ...EDITOR, ...EDITOR2, ...W3X, ...GAME, ...FINALE];
