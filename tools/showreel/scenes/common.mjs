// Helpers the scene files share (tools/showreel/scenes/*.mjs); the programme is script.mjs.

/** A camera path through keyframes: [eye, look] pairs */
export const path = (dur, keys, opts = {}) => ({ do: 'shot', dur, keys: keys.map((k) => (k === 'current' ? k : { eye: k[0], look: k[1] })), ...opts });
export const orbit = (dur, center, opts) => ({ do: 'orbit', dur, center, ...opts });
export const act = (name, args = {}) => ({ do: 'act', name, ...args });
export const click = (sel, opts = {}) => ({ do: 'click', sel, ...opts });
export const clickMap = (at, opts = {}) => ({ do: 'clickMap', at, ...opts });
export const wait = (dur) => ({ do: 'wait', dur });
export const par = (...steps) => ({ do: 'par', steps });
export const seq = (...steps) => ({ do: 'seq', steps });
export const stroke = (dur, points, opts = {}) => ({ do: 'stroke', dur, points, ...opts });
export const settings = (patch) => act('settings', { patch });
export const m = (x, y, h) => ({ m: [x, y], ...(h === undefined ? {} : { h }) });
export const tool = (id, opts = {}) => click(`[data-tool=${id}]`, opts);
export const mode = (id, opts = {}) => click(`[data-mode=${id}]`, opts);
/** An asset from the object palette by its search */
export const asset = (search, id) => [{ do: 'type', sel: 'input[aria-label="Search assets"]', text: search, cps: 14 }, click(`[data-asset=${id}]`)];

/** A flight over a shipped map in photo mode, without the route lines and markers */
export const flyover = (name, map, label, shots) => ({
  name,
  page: `/?world=map:${map}`,
  // Without the HUD from the first frame (the page's own load is cut anyway)
  clean: true,
  steps: [{ do: 'ui', on: false }, { do: 'markers', on: false }, act('routes', { on: false }), { do: 'mark', name: label }, ...shots],
});

/** The new-map form: a name, Small, the empty ground, Create */
export const newMap = (name, label) => [
  wait(0.6),
  click('[data-test=new-map]', { label }),
  { do: 'type', sel: '[data-test=new-name]', text: name, cps: 11 },
  click('button[role=radio]', { withText: 'Small' }),
  click('[data-template=""]'),
  wait(0.3),
  click('[data-test=create-map]', { label: 'create' }),
  act('viewReady', { timeout: 90 }),
  wait(0.8),
];

/** A photographed sky (sky-images.ts) with the preset and sun height it stands for */
export const sky = (skyImage, preset, sunElevation, extra = {}) =>
  seq(
    act('environment', { patch: { skyImage, sky: preset, sunElevation, ...extra } }),
    // The new look compiles and its first frames stall: before the camera moves, not in the shot
    wait(1.6),
  );

