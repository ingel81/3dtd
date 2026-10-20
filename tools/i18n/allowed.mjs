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
const AGENT = 'for the agents and map scripts, which read English (the agent API)';
const DETAIL = "a parser's or a server's own detail, shown in English inside a translated line (docs/I18N_PLAN.md 4.8)";
const MAP_CONTENT = "content a map is made with (a name, a description), the map's own words like any its author writes";
const GROUP = 'the name of a group of objects in a made map, data of the map file';
const STREET = "a street's name in the street network, data like the names OpenStreetMap gives";
const KIND = 'a kind of landmark as an id; the frame words it (osm.landmarks)';
const SIGN = 'the words on a shop sign in the world, as the place itself would write them';
const NOTE = 'a note for the map makers in the code; no player reads it';

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
  // Maps and imports (map-ops, world/custom-map, world/osm, world/w3x)
  'map-ops/asset-catalog.ts': {
    'no {} {}: the asset catalogue did not load, so no material or object can be used': AGENT,
    'the catalog tool lists them': AGENT,
  },
  'world/custom-map/custom-map-streets.ts': { Bridge: STREET, Path: STREET, Road: STREET },
  'world/custom-map/folder-map-backend.ts': { '{} could not be written to the map folder': DIAG },
  'world/custom-map/map-create.ts': { West: MAP_CONTENT },
  'world/custom-map/render/asset-catalog.ts': {
    'red toadstools read as enemy markers or blood from the game camera': NOTE,
    'red poppies read as enemy markers or blood from the game camera': NOTE,
  },
  'world/osm/convert/anchors.ts': { 'car park': KIND, 'city gate': KIND, 'place of worship': KIND, 'town hall': KIND },
  'world/osm/convert/areas.ts': {
    'tennis fence': GROUP, 'table tennis': GROUP, 'riding fence': GROUP, 'boules benches': GROUP, 'ball fence': GROUP, 'skate ramps': GROUP,
    'playground benches': GROUP, 'market stalls': GROUP, 'outdoor seating': GROUP, 'cemetery hedge': GROUP, 'allotment fences': GROUP,
    'allotment beds': GROUP, 'allotment sheds': GROUP,
  },
  'world/osm/convert/furniture.ts': { 'city wall': GROUP, 'lit roads': GROUP },
  'world/osm/convert/life.ts': { 'bell at {}': MAP_CONTENT, 'ship horn on the river': MAP_CONTENT },
  'world/osm/convert/rails.ts': { 'rail bridge': GROUP, 'crossing signal': GROUP },
  'world/osm/convert/vegetation.ts': { 'tree rows': GROUP },
  'world/osm/dem-tiles.ts': {
    'Heights: Mapterhorn (mapterhorn.com) and its sources': CREDIT,
    'Heights: Terrain Tiles (Mapzen, AWS Open Data) and its sources': CREDIT,
  },
  'world/osm/import-osm.ts': { 'Made from OpenStreetMap at {}.': MAP_CONTENT },
  'world/osm/osm-query.ts': { 'world quarter {}': DIAG },
  'world/osm/overpass-client.ts': { 'No Overpass server answered': DETAIL, ' (try {} of {})': DETAIL },
  'world/osm/overpass-servers.ts': { 'overpass.atownsend.org.uk (Great Britain and Ireland)': BRAND },
  'world/osm/poi-tags.ts': {
    'Cake shop': SIGN, 'Beer garden': SIGN, 'Wine bar': SIGN, 'Snack bar': SIGN, 'Ice cream': SIGN, 'Frutta e verdura': SIGN, 'Post office': SIGN,
    "Chambres d'hôtes": SIGN, 'Guest house': SIGN, 'Petrol station': SIGN,
  },
  'world/w3x/formats/w3i.ts': { 'random unit table': DETAIL, 'random item table': DETAIL, 'item set': DETAIL },
  'world/w3x/import-w3x.ts': { 'Warcraft map': MAP_CONTENT },
  'world/w3x/jass/jass-parser.ts': {
    'nested deeper than {} levels': DETAIL, 'expected end of line': DETAIL, 'expected an expression': DETAIL, 'script not readable: {}': DETAIL,
    'missing endglobals': DETAIL, 'global skipped: {}': DETAIL, 'function skipped: {}': DETAIL,
  },
  'world/w3x/jass/lua-parser.ts': {
    'expected a name': DETAIL, 'nested deeper than {} levels': DETAIL, 'expected an assignment': DETAIL, 'a statement must be a call or an assignment': DETAIL,
    'expected an expression': DETAIL, 'script not readable: {}': DETAIL,
  },
  'world/w3x/mpq.ts': {
    'unknown header version {}, read as v0': DETAIL, 'hash table clamped from {} entries': DETAIL, 'block table clamped from {} entries': DETAIL,
    '(hash table)': DETAIL, '(block table)': DETAIL,
  },
  'world/w3x/routes/maze-routes.ts': { End: MAP_CONTENT },
  'world/w3x/routes/route-graph.ts': { 'Point {} {}': MAP_CONTENT },
  'world/w3x/routes/terrain-routes.ts': { 'Spawn {}': MAP_CONTENT, 'Waypoint {}': MAP_CONTENT },
  // Editor
  'editor/model/doc-mirror.ts': { 'the heights': DIAG, 'splat map {}': DIAG, 'the water mask': DIAG, 'the mask of body {}': DIAG },
  'editor/services/editor-core.ts': { 'The terrain job was stopped': DIAG },
  'editor/services/job-runner.ts': { 'The job was stopped': DIAG },
  'editor/ui/make/map-make.component.html': { Esc: KEY },
  'editor/ui/panels/look-panel.component.ts': { Esc: KEY },
  'editor/ui/panels/measure-panel.component.ts': { Esc: KEY },
  'editor/ui/panels/object-panel.component.html': { Del: KEY },
  'editor/ui/panels/path-panel.component.ts': { Del: KEY },
};
