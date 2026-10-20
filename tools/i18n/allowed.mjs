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
const WHY_WAVE = "the wave source's reasons for a wave, for the wave debug window and the run log, English (docs/I18N_PLAN.md 4.10)";
const OURS = 'our own words in the credits, the English key the dialog words them by (dialogs.attributions.words)';
const WAVE_NAME = "a wave's name as the run plan and the run log keep it; the HUD words it by it (hud.wave.names)";
const PLACE_NAME = "a place's own name, never translated (decision E245); its description is worded by id";
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
  'services/location/geocoding.service.ts': { 'Unknown location': PLACE_DATA },
  'services/location/location-change-coordinator.service.ts': {
    'Map center': PLACE_DATA, 'Random Spawn': PLACE_DATA, 'Fallback Spawn': PLACE_DATA, 'Loading...': PLACE_DATA, Spawn: PLACE_DATA,
  },
  'services/location/location-change-executor.service.ts': {
    'The change of place gave way to another place': DIAG, 'location change': DIAG,
  },
  'services/location/location-management.service.ts': { 'No location': PLACE_DATA, 'No location loaded.': 'a developer copy line (showcase snippet)' },
  'services/location/osm-street.service.ts': { 'The map servers for the streets are busy or out of reach.': DIAG },
  'services/location/world-dice.service.ts': {
    'The city list did not load, so there is no random city. Reload the page, or pick a place yourself.': DIAG,
  },
  'world/tiles/tiles-world.ts': { 'Map data ©Google': CREDIT, 'Google Maps': BRAND, 'Cesium ion': BRAND },
  'world/world-provider-registry.ts': { 'The world "{}" is not available: {}': DIAG },
  'world/world-ref.ts': { 'Dev world': PLACE_DATA },
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
  // Simulation (worker, director, simulator)
  'director/sources/budget/budget-source.ts': {
    'Run plan with budget': WHY_WAVE, ' × map difficulty {} %': WHY_WAVE, 'Run plan, row {}: {}, every {} ms.': WHY_WAVE,
    'Budget {} s of defense damage (curve × strength {}{} × loop ×{}).': WHY_WAVE,
    'The defense has about {} s while the wave is on the route: {} s are sent (that time × the loop, leaks included).': WHY_WAVE,
    'At their limit (time under fire): {}.': WHY_WAVE, 'Boss floor ({}× the toughest escort, at least {}× its base): {}.': WHY_WAVE,
    "The defense cannot hurt {}: HP × the row's strength {}.": WHY_WAVE, 'Blood moon: {}': WHY_WAVE,
  },
  'director/sources/table/table-source.ts': {
    'Wave table': WHY_WAVE, 'Wave list, row {}: {}.': WHY_WAVE, 'Past the list (last row W{}): row {} runs again, round {}.': WHY_WAVE,
    ' (row ×{}, grown {} round(s))': WHY_WAVE, 'Spawn every {} ms, so the wave takes about ': WHY_WAVE,
    'Written down, not sized against the defense: the same wave number is always the same wave.': WHY_WAVE,
  },
  'director/wave-explanation.ts': {
    ' (its lowest)': WHY_WAVE, ' (its highest)': WHY_WAVE, 'Still counting: {} of {} waves measured, the first wave is skipped.': WHY_WAVE,
    'The budget stays at {} until then.': WHY_WAVE, '; the last wave alone {}': WHY_WAVE, 'The last waves cost {} of the HP on average, the target is {}{}.': WHY_WAVE,
    'Too easy: the budget goes up {} to {}{}.': WHY_WAVE, 'Too hard: the budget goes down {} to {}{}.': WHY_WAVE,
    'Too easy, but every enemy type was already at its limit, so more budget would not make the wave harder: it stays at {}{}.': WHY_WAVE,
    'Close enough to the target: the budget stays at {}{}.': WHY_WAVE,
  },
  'managers/audio/spatial-audio-playback.ts': { 'distance {}m exceeds max {}m': DIAG, 'projectile budget {}/{}': DIAG, 'play() silent fail': DIAG },
  'sim/client/sim-client.service.ts': { 'the simulation did not start: {}': DETAIL },
  'sim/client/transport.ts': {
    'worker: a message from the simulation could not be read': DETAIL, 'simulation worker stopped': DETAIL, 'simulation stopped: {}': DETAIL,
  },
  'sim/core/sim-core.ts': { Simulation: DIAG },
  'sim/worker/sim.worker.ts': { 'simulation worker: a message from the main thread could not be read': DETAIL },
  // Configs
  'configs/attributions.config.ts': {
    'Amal Kumar, Poly Haven': CREDIT, 'Angular': CREDIT, 'Apache 2.0': CREDIT, 'BSD 3-Clause': CREDIT, 'Barlow Semi Condensed': CREDIT,
    'Basis Universal (texture transcoder of the menu globe)': OURS, 'Bat': CREDIT, 'Bear': CREDIT, 'Big Arm (Wallsmasher)': CREDIT,
    'Binomial LLC': CREDIT, 'CC-BY 3.0': CREDIT, 'CC-BY 4.0': CREDIT, 'CC-BY-SA 4.0': CREDIT,
    'D. Hoffleit, W. H. Warren Jr., Yale University Observatory': CREDIT, 'Dark Rock (top bar, recoloured)': OURS, 'Dragon': CREDIT,
    'Earth of the menu globe (Blue Marble Next Generation, July 2004; Black Marble 2016; clouds)': OURS,
    'Flat map of the place before a map is made (vector tiles)': OURS, 'Free use with credit': OURS, 'GEBCO, NASA Visible Earth': CREDIT,
    'Grey Plaster 02 (menu and dialog surfaces, recoloured)': OURS,
    'Ground materials and models of the custom maps (list per file in public/maps/assets/LICENSES.md)': OURS,
    'Ground materials of the custom maps': OURS, 'Herbert': CREDIT, 'Ironclad Warlord': CREDIT, 'Jeremy Tribby': CREDIT, 'JetBrains Mono': CREDIT,
    'Jumper (reduced, turret split off, animated)': OURS, 'KingKong Robotics': CREDIT, 'Mammoth': CREDIT,
    'MapLibre GL JS (flat map of a place before its map is made)': OURS, 'MapLibre contributors': CREDIT, 'Maps from a real place: heights': OURS,
    'Maps from a real place: streets and land (Overpass API)': OURS,
    'Mapterhorn and its sources; Terrain Tiles (Mapzen, AWS Open Data) as the fallback': OURS, 'Material Symbols': CREDIT,
    'Mateus Schwaab (Mehrus)': CREDIT, 'Murat Can ÜNAL (avanar)': CREDIT, 'NASA Earth Observatory, NASA Visible Earth': CREDIT,
    'Natural Earth': CREDIT, 'ODbL 1.0': CREDIT, 'ODbL 1.0 (data)': OURS, 'OFL 1.1': CREDIT,
    'OpenFreeMap, OpenMapTiles, OpenStreetMap contributors': CREDIT, 'OpenStreetMap contributors': CREDIT, 'Original work': OURS, 'Penguin': CREDIT,
    'Per source, listed by Mapterhorn': OURS, 'Poly Haven': CREDIT, 'Public Domain': OURS, 'Public domain': OURS, 'Public domain (NASA)': OURS,
    'Relief and water of the menu globe (GEBCO 2008, via NASA Visible Earth)': OURS,
    'Roads for the enemy routes (Overpass API) and place search (Nominatim)': OURS, 'Rob Tuytel, Poly Haven': CREDIT,
    'Routes © OpenStreetMap contributors': CREDIT, 'SWAT (Hero, recoloured, gun added)': OURS, 'Skeleton (Graveyard Kit)': CREDIT,
    'Sound effects': OURS, 'Soundtrack': CREDIT, 'Spider': CREDIT, 'Stars of the menu globe (Bright Star Catalogue, 5th edition)': OURS,
    'Stone Golem': CREDIT, 'Tank': CREDIT, 'Tower Round Crystals (Chaos Tower)': CREDIT,
    'World map outlines (1:110m coastline and land borders)': OURS, 'Zombie': CREDIT, 'Zombie Soldier': CREDIT,
    'ingel81, generated with Eleven Music (ElevenLabs) and ACE-Step 1.5': OURS, 'ingel81, generated with ElevenLabs': OURS,
    'ingel81, generated with Krea AI': OURS, 'three.js authors': CREDIT,
  },
  'configs/enemy-types.config.ts': {
    'GltfAnimation 0': "an animation clip's name in its model file", 'Take 001': "an animation clip's name in its model file",
  },
  'configs/showcase-locations.config.ts': {
    'Amsterdam, Dam Square': PLACE_NAME, 'Barcelona, Plaça de Catalunya': PLACE_NAME, 'Madrid, Puerta del Sol': PLACE_NAME,
    'New York, Times Square': PLACE_NAME, "Paris, Pont d'Iéna": PLACE_NAME, 'Prague, Old Town Square': PLACE_NAME,
    'Rio de Janeiro, Copacabana': PLACE_NAME, 'San Francisco, Union Square': PLACE_NAME, 'Sydney, Martin Place': PLACE_NAME,
    'Tokyo, Shibuya Crossing': PLACE_NAME,
  },
  'director/sources/budget/run-plan.json': {
    'Armor Gauntlet': WAVE_NAME, 'Armored Push': WAVE_NAME, 'Bat Swarm': WAVE_NAME, 'Bear Pack': WAVE_NAME, 'Bone Tide': WAVE_NAME,
    'Boss: Dragon Matriarch': WAVE_NAME, 'Boss: Golem King': WAVE_NAME, 'Boss: Herbert': WAVE_NAME, 'Boss: Jumper': WAVE_NAME,
    'Boss: Ooze': WAVE_NAME, 'Boss: Skarnax': WAVE_NAME, 'Chaos Wave': WAVE_NAME, 'Dragon Elite': WAVE_NAME, 'Dragon Night': WAVE_NAME,
    'Dragon Patrol': WAVE_NAME, 'Dusk Flock': WAVE_NAME, 'Ether Assault': WAVE_NAME, 'Final Mix': WAVE_NAME, 'Fortress': WAVE_NAME,
    'Ghost Riders': WAVE_NAME, 'Ghost Surge': WAVE_NAME, 'Golem Guard': WAVE_NAME, 'Golem Squad': WAVE_NAME, 'Great Horde': WAVE_NAME,
    'Horde and Hornets': WAVE_NAME, 'Hornet Raid': WAVE_NAME, 'Hornet Strike': WAVE_NAME, 'Iron Night': WAVE_NAME, 'Last Stand': WAVE_NAME,
    'Light Mix': WAVE_NAME, 'Mammoth Siege': WAVE_NAME, 'Mammoth Stampede': WAVE_NAME, 'Mech Army': WAVE_NAME, 'Mech Column': WAVE_NAME,
    'Night Flight': WAVE_NAME, 'Penguin Breather': WAVE_NAME, 'Penguin Rush': WAVE_NAME, 'Phantom March': WAVE_NAME, 'Plague and Iron': WAVE_NAME,
    'Rat Tide': WAVE_NAME, 'Siege Line': WAVE_NAME, 'Skeleton Swarm': WAVE_NAME, 'Sky Siege': WAVE_NAME, 'Spider Nest': WAVE_NAME,
    'Spider Swarm': WAVE_NAME, 'Swarm Surge': WAVE_NAME, 'Tank Column': WAVE_NAME, 'Wall Breakers': WAVE_NAME, 'Wallsmasher Crew': WAVE_NAME,
    'Wraith Night': WAVE_NAME, 'Wraith Storm': WAVE_NAME, 'Zombie Horde': WAVE_NAME,
  },
  // Desktop app (its own words are in desktop/src/i18n.js)
  'desktop/src/coop-lan.js': { '3DTD coop relay': DIAG },
  'desktop/src/log.js': { '[page] (previous message repeated {} times)': DIAG, 'vendor 0x{} device 0x{}': DIAG },
  'desktop/src/main.js': { 'renderer {}, exit code {}, 3DTD {}': DETAIL },
  'desktop/src/preload.js': {
    'The editor gave no answer': AGENT,
    'The map editor is not open. Ask the player to open a map in the editor (main menu, Map editor).': AGENT,
  },
};
