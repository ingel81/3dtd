// The showreel programme: scenes as data, played in order by run.mjs. A scene with `page` loads that page
// (`opened`: the window the editor's Test map asked for); one without plays on where the last one ended.
// `leave` on a scene: after its steps the runner clicks that element and follows the page the app goes to
// (Edit this map from the pause menu); `arrives` names the page a scene ends on, for a run that starts after it.
// Steps run on the page's frame clock (src/app/showreel/director.ts); `label` leaves a time mark for the cut,
// `effect:<what>` the moment a change has visibly taken effect (the cut ends a beat after it, not mid-action).
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
// { do: 'markers', on } the game's HQ diamond and name signs. Fly-overs and the outro play clean, editor and
// game with their full UI.
//
// Programme (round 2, 2026-10-15): intro over Red Canyon, Ember Crater, Ruined City, Demo Valley; into the
// editor from Demo Valley's pause menu, hopping between the four maps (own copies of the shipped ones); the
// Warcraft 3 import; a fight on Red Canyon as edited; the outro on Moon Base.

import { SCENES as INTRO } from './scenes/intro.mjs';
import { SCENES as EDITOR } from './scenes/editor.mjs';
import { SCENES as W3X } from './scenes/w3x.mjs';
import { SCENES as GAME } from './scenes/game.mjs';
import { SCENES as OUTRO } from './scenes/outro.mjs';

/** The programme in order; each part lives in scenes/ (common.mjs has the helpers) */
export const SCENES = [...INTRO, ...EDITOR, ...W3X, ...GAME, ...OUTRO];
