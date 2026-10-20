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
const CONSOLE = 'the answer of the developer console (__corridor, __routes) or a corridor trace label, English like the debug windows (docs/I18N_PLAN.md 4.10)';
const PLACE_DATA = 'a fixed name a place or spawn carries as data (saves, the world package); the HUD words it on display (i18n/place-names.ts)';

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
  // HUD and game
  'components/boss-intro/boss-intro.component.ts': { Esc: KEY },
  'components/game-sidebar/hero-panel/hero-panel.component.html': { Esc: KEY },
  'components/replay-bar/replay-bar.component.html': { Esc: KEY },
  'components/tower-control-hud/tower-control-hud.component.ts': { Esc: KEY },
  'tower-defense.component.html': { Esc: KEY },
  'interfaces/street-network-provider.interface.ts': { 'Unnamed Street': PLACE_DATA },
  'services/facade/map-relocation.service.ts': {
    'Fallback Spawn': PLACE_DATA, 'Loading...': PLACE_DATA, Spawn: PLACE_DATA,
    'HQ moved, new origin': CONSOLE, 'HQ moved in place': CONSOLE, 'spawn moved in place': CONSOLE, 'spawn added': CONSOLE,
  },
  'services/facade/visualization-facade.service.ts': {
    'Not changed: __corridor.probeLod() is running.': CONSOLE, 'visible after unmeasured freeze': CONSOLE,
    'new corridor tiles after unmeasured freeze': CONSOLE, 'location load': CONSOLE, 'tilesLoaded lod={}': DIAG, '[PerfTrace] onTilesLoaded: {}ms total | ': DIAG,
  },
  'services/tower-placement.service.ts': { 'not probed': DIAG },
  'services/world/corridor-build.ts': {
    'towers stand on the map, sell them first': CONSOLE, 'a wave is running': CONSOLE, 'enemies are on the map': CONSOLE,
    'the run has played {} wave(s), restart it first': CONSOLE, 'a coop game is running': CONSOLE, 'routes replaced': CONSOLE,
    ', and the tiles never settled': CONSOLE, 'no station found a tile ({} stations{})': CONSOLE, 'no cell got a height ({} cells{})': CONSOLE,
    'Not changed: no location loaded.': CONSOLE, 'Not changed: {}.': CONSOLE, 'Not changed: the corridor is being built.': CONSOLE,
    'settings changed': CONSOLE, 'Settings changed, the build stopped: the routes were replaced.': CONSOLE,
    'Corridor rebuilt{}: {} cells. Widths per stretch: __routes.describe()': CONSOLE, ', measured again': CONSOLE,
  },
  'services/world/intro-camera-flight.service.ts': { 'key Escape': DIAG },
  'services/world/path-route.service.ts': {
    'location changed': CONSOLE, 'routes replaced': CONSOLE, 'measurements cleared': CONSOLE, '{}, overhang: outer face': CONSOLE,
    'under way {}: street width': CONSOLE, 'passage: street width': CONSOLE, 'tunnel or covered: street width': CONSOLE,
    'not measured yet: street width': CONSOLE, '{}, short narrowing closed': CONSOLE, 'no probe': CONSOLE, 'under way {}: not measured': CONSOLE,
    'passage: not measured': CONSOLE, 'tunnel or covered: not measured': CONSOLE, 'no probe (DevWorld)': CONSOLE, 'not measured yet': CONSOLE,
  },
  'services/world/strategic-placement.service.ts': {
    'Near {} ({}m along path, {}m offset)': 'why a spot was suggested, for the bots and the debug window',
    'Zone {}/{} ({}m along path, need={})': 'why a spot was suggested, for the bots and the debug window',
  },
  'three-engine/renderers/marker/spawn-portal-sigils.ts': {
    'falling moon': NOTE, 'wandering orbit': NOTE, 'spiral shard': NOTE, 'crescents in tow': NOTE, 'tethered seeds': NOTE,
    'broken moonring': NOTE, 'eclipse trail': NOTE, 'dotted whorl': NOTE, 'haloed moon': NOTE, 'averted moon': NOTE,
    'else if (index < {}.5)': 'shader code',
  },
  'three-engine/terrain-queries.ts': { 'no tile': CONSOLE, 'coarse tile': CONSOLE, 'no approach start': CONSOLE },
  'three-engine/three-tiles-engine.ts': { '[PerfTrace] onTilesLoadCallback: {}ms total | ': DIAG },
  'utils/corridor-trace.ts': {
    'page load': CONSOLE, 'Corridor trace {}': CONSOLE, '{} corridor events since {}{}': CONSOLE, ' (trace is off: __corridor.trace(true))': CONSOLE,
  },
  'utils/corridor-walk.ts': {
    'deck or tunnel': CONSOLE, 'no sample': CONSOLE, 'coarse tile': CONSOLE, 'no band': CONSOLE, 'fixed stretch': CONSOLE, 'beyond the band': CONSOLE,
  },
  'utils/global-route-grid.ts': { 'retryUnsampled unsampledBefore={} promoted={}': DIAG },
  'utils/los-perf.ts': { '{}: avg={}ms max={}ms ': DIAG },
  'utils/route-cell-sampler.ts': {
    'miss key={}': DIAG, 'promote key={} y={} depth={} err={}': DIAG, 'reject reason=outlier key={} y={} medianN={}': DIAG, 'fill key={} y={}': DIAG,
  },
  'utils/route-corridor.ts': {
    'highwayWidths.{} must be a width from 0 to 50 m': CONSOLE, 'unknown setting {}': CONSOLE, '{} must be a number from {} to {}': CONSOLE,
    'minHalfWidth must not be above maxHalfWidth': CONSOLE, 'defaultHalfWidth must lie between minHalfWidth and maxHalfWidth': CONSOLE,
    'unmeasured: street width': CONSOLE, 'unmeasured: from neighbours': CONSOLE, 'low obstacle, raised behind': CONSOLE, 'dip closed': CONSOLE,
    'bulge cut': CONSOLE, 'no wall within the maximum': CONSOLE, 'wall less margin': CONSOLE, 'leg to the HQ: street width': CONSOLE,
  },
};
