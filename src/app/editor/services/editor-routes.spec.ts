import { createMapDocument } from '../../world/custom-map/map-create';
import { EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { addNode, connect, spawnRoutes } from '../../map-ops/path-graph';
import { SnapshotCommand } from '../model/commands/snapshot';
import { EditorDocument } from '../model/editor-document';
import { EditorCore } from './editor-core';
import { EditorRoutes, type SpawnRoutes } from './editor-routes';

/** The jobs asked for so far have answered */
const settled = () => new Promise((r) => setTimeout(r, 0));

describe('EditorRoutes', () => {
  it('finds the routes in the worker when the roads or markers change, not on other changes', async () => {
    const doc = createMapDocument({ id: 'r', name: 'R', width: 256, depth: 256, cellSize: 4, seed: 2, ground: 'noise', relief: 4, now: new Date(0) });
    const a = addNode(doc.paths, { x: -80, y: 0 });
    const b = addNode(doc.paths, { x: 80, y: 0 });
    connect(doc.paths, a.id, b.id, 8, 'road');
    doc.spawns = [{ id: 's1', name: 'West', x: -80, y: 0 }];
    doc.hq = { x: 80, y: 0 };
    const editor = new EditorDocument(doc);
    const core = new EditorCore();
    core.open(editor, EMPTY_CATALOG);
    const shown: SpawnRoutes[] = [];
    const routes = new EditorRoutes(core, (r) => shown.push(r));
    const run = vi.spyOn(core, 'run');
    routes.opened();
    await settled();
    expect(routes.routes()).toEqual(spawnRoutes(doc));
    expect(shown.at(-1)).toBe(routes.routes());
    // The environment does not move a route
    editor.execute(SnapshotCommand.record(doc, 'Environment', ['environment'], (d) => (d.environment = { ...d.environment, fogDensity: 0.001 })));
    routes.changed();
    expect(run).toHaveBeenCalledTimes(1);
    // A second spawn does
    editor.execute(SnapshotCommand.record(doc, 'Spawn', ['spawns'], (d) => (d.spawns = [...d.spawns, { id: 's2', name: 'Mid', x: 0, y: 4 }]), { markers: true }));
    routes.changed();
    routes.changed();
    await settled();
    expect(run).toHaveBeenCalledTimes(2);
    expect([...routes.routes().keys()]).toEqual(['s1', 's2']);
    expect(routes.routes()).toEqual(spawnRoutes(doc));
    routes.dispose();
    core.dispose();
  });
});
