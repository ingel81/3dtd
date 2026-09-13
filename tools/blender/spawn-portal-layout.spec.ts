/**
 * Layout of the spawn portal for the Blender script that builds its frame
 * (tools/blender/spawn_portal.py): the opening and the extents the game
 * holds the frame to (marker-geometry.config.ts), and the sigils with the
 * frame cells they are carved into (spawn-portal-sigils.ts). The script
 * reads the sigils from here, so the set has one source.
 *
 * Runs as a vitest spec on `npm test`, like the AI schema: a change to the
 * configs rewrites tools/blender/spawn_portal_layout.json, and the dirty
 * file says the asset needs a new bake
 * (`blender --background --python tools/blender/spawn_portal.py -- all`).
 */

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGeneratedFile } from '../generated-file';
import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_RADIUS,
} from '../../src/app/configs/marker-geometry.config';
import {
  CRESCENT_HOLLOW,
  CRESCENT_SHIFT,
  PORTAL_SIGILS,
  SIGIL_LAYOUT,
  SIGIL_STROKE,
  frameSigilCells,
  sigilForCell,
} from '../../src/app/three-engine/renderers/marker/spawn-portal-sigils';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'spawn_portal_layout.json');

function spawnPortalLayout() {
  return {
    generatedBy: 'tools/blender/spawn-portal-layout.spec.ts',
    opening: { width: PORTAL_OPENING_WIDTH, height: PORTAL_OPENING_HEIGHT },
    frameTop: PORTAL_FRAME_TOP,
    radius: PORTAL_RADIUS,
    depth: PORTAL_DEPTH,
    sigil: {
      stroke: SIGIL_STROKE, size: SIGIL_LAYOUT.size, crescentHollow: CRESCENT_HOLLOW, crescentShift: CRESCENT_SHIFT,
    },
    sigils: PORTAL_SIGILS.map((s) => ({ name: s.name, parts: s.parts })),
    cells: frameSigilCells().map((c) => ({ ...c, sigil: sigilForCell(c.cell) })),
  };
}

describe('Spawn-Portal-Layout für Blender', () => {
  it('schreibt tools/blender/spawn_portal_layout.json aus den Configs', () => {
    const layout = spawnPortalLayout();
    writeGeneratedFile(OUT, JSON.stringify(layout, null, 2) + '\n');
    expect(layout.cells).toHaveLength(2 * SIGIL_LAYOUT.pillarRows + SIGIL_LAYOUT.lintelColumns);
    expect(layout.sigils).toHaveLength(PORTAL_SIGILS.length);
  });
});
