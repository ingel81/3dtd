import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAPS_DIR, buildMapManifest, manifestText } from './map-manifest';

describe('the manifest of the map files', () => {
  it('names every file the site serves with the hash of its content (npm run maps:manifest writes it)', () => {
    // As git keeps it (a Windows checkout writes CRLF)
    expect(readFileSync(join(MAPS_DIR, 'manifest.json'), 'utf8').replace(/\r\n/g, '\n')).toBe(manifestText(buildMapManifest()));
  });
});
