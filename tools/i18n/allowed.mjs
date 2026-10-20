/**
 * Texts the scan finds in a closed area that rightly stay as they are (TODO
 * E245, docs/I18N_PLAN.md 7.2), by file, each with why. A closed area has no
 * baseline: every other text the scan finds there fails the guard. What
 * belongs here: names (brands, fonts, key caps), the licensors' own credit
 * lines, data that goes into saves, the simulation or to the other players
 * (it must read the same in every language), and texts no player reads
 * (diagnostics, internal error causes, performance marks).
 */
const BRAND = 'a name, the same in every language';
const KEY = 'a key cap';
const CREDIT = "the licensor's credit line, as they write it";
const DATA = 'data, not words: kept in saves or the location, or sent to the other players, so the same in every language';
const DIAG = 'a diagnostic no player reads (log, performance mark, internal error cause)';

export const ALLOWED = {
  'components/main-menu/autosave-place.ts': { 'last run': 'a code (AutosavePlace.source)', 'last played': 'a code (AutosavePlace.source)' },
  'components/main-menu/pages/home/menu-home.component.html': { Esc: KEY },
  'components/main-menu/pages/settings/settings-sections.component.html': { 'Claude Code:': BRAND },
  'components/main-menu/pages/settings/settings-sections.component.ts': { 'Google Maps': BRAND, 'Cesium ion': BRAND },
  'components/osm-frame/osm-frame-map.ts': { 'Noto Sans Bold': 'a font name' },
  'components/osm-frame/osm-frame.component.ts': { 'heights: Terrain Tiles (Mapzen, AWS)': CREDIT, 'Map data © OpenStreetMap contributors': CREDIT },
  'components/token-setup/token-setup.component.html': {
    'Cesium Ion': BRAND, 'Google Maps': BRAND, 'Access Tokens': 'the name of the page at Cesium ion', 'Google Cloud Console': BRAND,
    'Map Tiles API': BRAND, Esc: KEY,
  },
  'globe/globe-view.ts': { 'upload region': DIAG, 'render first': DIAG, 'programs at render ({})': DIAG },
  'services/location/geocoding.service.ts': { 'Unknown location': DATA },
  'services/location/location-change-coordinator.service.ts': {
    'Map center': DATA, 'Random Spawn': DATA, 'Fallback Spawn': DATA, 'Loading...': DATA, Spawn: DATA,
  },
  'services/location/location-change-executor.service.ts': {
    'The change of place gave way to another place': DIAG, 'location change': DIAG,
  },
  'services/location/location-management.service.ts': { 'No location': DATA, 'No location loaded.': 'a developer copy line (showcase snippet)' },
  'services/location/osm-street.service.ts': { 'The map servers for the streets are busy or out of reach.': DIAG },
  'services/location/world-dice.service.ts': {
    'The city list did not load, so there is no random city. Reload the page, or pick a place yourself.': DIAG,
  },
  'world/tiles/tiles-world.ts': { 'Map data ©Google': CREDIT, 'Google Maps': BRAND, 'Cesium ion': BRAND },
  'world/world-provider-registry.ts': { 'The world "{}" is not available: {}': DIAG },
  'world/world-ref.ts': { 'Dev world': DATA },
  'worlds/worlds-stage.component.html': { Esc: KEY },
  'run-log/run-log-check.ts': { 'towers: {} kills on the towers, {} booked for the wave': DIAG },
  'components/coop-chat/coop-chat.component.html': { Enter: KEY, Esc: KEY, Tab: KEY },
  'coop/command-guard.ts': {
    'tower type': DIAG, 'plinth height': DIAG, 'plinth overhang': DIAG, 'tower id': DIAG, 'hold fire': DIAG, 'research queue': DIAG,
    'hero move': DIAG, 'hero ammo': DIAG, 'enemy id': DIAG,
  },
  'coop/lockstep-stats.ts': {
    'no input': DIAG, 'input {} ms (max {}, n {})': DIAG, '{} frames, blocked {}%, steps 0:{} 1:{} 2:{} 3+:{}, ': DIAG,
  },
  'services/coop-lobby-list.ts': { 'This machine': "the name of the developer's own relay, in a development build only" },
};
