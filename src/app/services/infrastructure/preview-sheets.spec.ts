import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { PLAYBACK_FPS, SHEET_COLUMNS, TURN_FRAMES } from './model-preview.service';
import { PREVIEW_MANIFEST, PREVIEW_SHEET_DIR, enemyPreviewConfig, previewSheetJobs, previewViewKey, towerPreviewConfig, type PreviewSheetManifest } from './preview-sheets';

const PUBLIC = resolve(__dirname, '../../../../public');
const manifest = JSON.parse(readFileSync(resolve(PUBLIC, PREVIEW_MANIFEST), 'utf8')) as PreviewSheetManifest;
const sha = (path: string) => createHash('sha256').update(readFileSync(resolve(PUBLIC, path))).digest('hex');

describe('preview sheets rendered ahead (TODO E76)', () => {
  it('play as the service plays a turn', () => {
    expect(manifest).toMatchObject({ frames: TURN_FRAMES, fps: PLAYBACK_FPS, columns: SHEET_COLUMNS });
  });

  // Stale after a model or a preview view changed: `npm run build && npm run previews` (e2e/previews/bake.ts)
  it.each(previewSheetJobs().map((job) => [job.name, job] as const))('%s is current', (_name, job) => {
    const entry = manifest.sheets[job.name];
    expect(entry, 'no sheet: npm run previews').toBeDefined();
    expect(entry.view, 'another view: npm run previews').toBe(previewViewKey(job.config));
    expect(entry.model, 'another model file: npm run previews').toBe(sha(job.config.modelUrl));
    expect(existsSync(resolve(PUBLIC, PREVIEW_SHEET_DIR, entry.file))).toBe(true);
  });

  it('names a view by what it shows, not by who asks or whether it is hidden', () => {
    const tower = towerPreviewConfig(TOWER_TYPES.archer);
    expect(previewViewKey({ ...tower, isHidden: () => true })).toBe(previewViewKey(tower));
    expect(previewViewKey(towerPreviewConfig(TOWER_TYPES.archer, 1.234))).not.toBe(previewViewKey(tower));
  });

  it('shows an enemy as the debug panel does before any override', () => {
    const zombie = ENEMY_TYPES['zombie'];
    const panelDefaults = {
      previewScale: zombie.previewScale ?? zombie.scale * 0.4,
      previewCameraDistance: zombie.previewCameraDistance ?? 7,
      previewCameraAngle: zombie.previewCameraAngle ?? Math.PI / 12,
      previewOffsetY: zombie.previewOffsetY ?? 0,
    };
    expect(previewViewKey(enemyPreviewConfig(zombie, panelDefaults))).toBe(previewViewKey(enemyPreviewConfig(zombie)));
  });
});
