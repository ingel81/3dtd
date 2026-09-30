// A heavy tick of the real SimCore, to profile by engine (docs/SIM_WORKER.md): 78 debug spawns with long paths.
import { SimCore } from '../../../src/app/sim/core/sim-core';
import { OriginSync } from '../../../src/app/sim/core/sim-coords';
import { worldKeyOf } from '../../../src/app/sim/protocol/world-key';
import { GlobalRouteGridService } from '../../../src/app/services/world/global-route-grid.service';
import { METERS_PER_DEGREE_LAT as M } from '../../../src/app/utils/geo-utils';

const O = { lat: 48.7758, lon: 9.1829, height: 300 };

export function buildCommands(commands = 78, points = 777, real?: [number, number][]): unknown[] {
  const route = real ? real.map(([lat, lon]) => ({ lat, lon })) : Array.from({ length: points }, (_, i) => ({ lat: O.lat + (i * 3) / M, lon: O.lon }));
  points = route.length;
  const list = [];
  const step = Math.max(1, Math.floor(points / commands));
  for (let k = 0; k < points - 2; k += step) list.push({ playerId: 'local', command: { type: 'debug:spawn-enemy', enemyType: 'zombie', count: 1, path: route.slice(k).map(({ lat, lon }) => ({ lat, lon })), speed: 1.5, health: 4000 } });
  return list;
}

export function spawnTick(commands = 78, points = 777, given?: unknown[]): string {
  if (given && !Array.isArray(given)) given = buildCommands(commands, points, (given as { real: [number, number][] }).real);
  const sync = new OriginSync(O.lat, O.lon, O.height);
  const route = Array.from({ length: points }, (_, i) => ({ lat: O.lat + (i * 3) / M, lon: O.lon, height: O.height, corridorLeft: 3, corridorRight: 3 }));
  const paths = new Map([['spawn-1', route]]);
  const grid = new GlobalRouteGridService();
  grid.initialize(() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }), sync);
  grid.generateFromRoutes([route]);
  const core = new SimCore();
  core.loadWorld({ origin: O, hq: route[points - 1], spawns: [{ id: 'spawn-1', name: 's', ...route[0] }], paths: [...paths], heights: grid.exportHeights(), worldKey: worldKeyOf(grid.snapshotHeights(), paths.values(), sync.getOrigin()), spawnGround: { 'spawn-1': 300 } });
  const list = given ?? buildCommands(commands, points);
  const t0 = performance.now();
  core.input({ gameSpeed: 4, paused: false, renderingEnabled: true, commands: list as never, lockstep: null, replay: null }, 1000);
  const packet = core.pass(1000)!;
  return `${list.length} commands, pass ${(performance.now() - t0).toFixed(0)} ms, enemies ${packet.enemies.count}`;
}
