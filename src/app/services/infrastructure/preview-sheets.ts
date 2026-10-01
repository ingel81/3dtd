import { TOWER_TYPES, type TowerTypeConfig } from '../../configs/tower-types.config';
import { ENEMY_TYPES, type EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { ModelPreviewService, PreviewConfig } from './model-preview.service';

/**
 * Preview turns rendered ahead (TODO E76): `npm run previews`
 * (tools/preview-sheets/bake.ts) bakes every tower's and enemy type's turn
 * in a browser and writes each as a WebP sheet into PREVIEW_SHEET_DIR, with a
 * manifest. The game shows a sheet when its view is the one the manifest
 * names; any other view (a debug override, a model changed since) bakes
 * live as before. preview-sheets.spec.ts fails while a sheet is stale.
 */
export const PREVIEW_SHEET_DIR = 'assets/previews';
export const PREVIEW_MANIFEST = `${PREVIEW_SHEET_DIR}/manifest.json`;

/** Pixels of a sheet's frame: 1.25 per CSS pixel of the card (tower 134 x 80, enemy group 64 x 64) */
export const TOWER_SHEET_SIZE = { width: 168, height: 100 };
export const ENEMY_SHEET_SIZE = { width: 80, height: 80 };

export interface PreviewSheetEntry {
  file: string;
  width: number;
  height: number;
  /** The view it shows (previewViewKey) */
  view: string;
  /** SHA-256 of the model file it was rendered from, hex */
  model: string;
}

export interface PreviewSheetManifest {
  frames: number;
  fps: number;
  columns: number;
  sheets: Record<string, PreviewSheetEntry>;
}

/** What a preview shows, whoever asks: the same text for the same model, scale, camera and light */
export function previewViewKey(config: PreviewConfig): string {
  const { isHidden: _hidden, ...view } = config;
  return JSON.stringify(view, Object.keys(view).sort());
}

/** A tower card's view (build panel) */
export function towerPreviewConfig(tower: Pick<TowerTypeConfig, 'modelUrl' | 'previewScale' | 'scale'>, previewScale?: number): PreviewConfig {
  return {
    modelUrl: tower.modelUrl,
    scale: previewScale ?? tower.previewScale ?? tower.scale * 0.4,
    cameraDistance: 20,
    cameraAngle: Math.PI / 5,
    lightIntensity: 1.2,
  };
}

/** The preview values of an enemy type a debug panel may override */
export interface EnemyPreviewOverrides {
  previewScale?: number;
  previewCameraDistance?: number;
  previewCameraAngle?: number;
  previewOffsetY?: number;
}

/** A wave group's view (wave panel); without overrides the debug panel's defaults (enemy-debug.service) */
export function enemyPreviewConfig(enemy: EnemyTypeConfig, overrides?: EnemyPreviewOverrides | null): PreviewConfig {
  return {
    modelUrl: enemy.modelUrl,
    scale: overrides?.previewScale ?? enemy.previewScale ?? enemy.scale * 0.4,
    cameraDistance: overrides?.previewCameraDistance ?? enemy.previewCameraDistance ?? 7,
    cameraAngle: overrides?.previewCameraAngle ?? enemy.previewCameraAngle ?? Math.PI / 12,
    offsetY: overrides?.previewOffsetY ?? enemy.previewOffsetY ?? 0,
    animationName: enemy.walkAnimation || undefined,
    animationTimeScale: 0.7,
    lightIntensity: enemy.previewLight ?? 1.3,
    groundModel: true,
  };
}

/** A sheet to render ahead: its name (file without extension), view and frame size */
export interface PreviewSheetJob {
  name: string;
  config: PreviewConfig;
  size: { width: number; height: number };
}

/** Every view the game shows without overrides: each tower's card, each enemy type's wave group; a view once */
export function previewSheetJobs(): PreviewSheetJob[] {
  const jobs: PreviewSheetJob[] = [];
  const views = new Set<string>();
  const add = (name: string, config: PreviewConfig, size: { width: number; height: number }) => {
    const view = previewViewKey(config);
    if (!config.modelUrl || views.has(view)) return;
    views.add(view);
    jobs.push({ name, config, size });
  };
  for (const [id, tower] of Object.entries(TOWER_TYPES)) add(`tower-${id}`, towerPreviewConfig(tower), TOWER_SHEET_SIZE);
  for (const [id, enemy] of Object.entries(ENEMY_TYPES)) add(`enemy-${id}`, enemyPreviewConfig(enemy), ENEMY_SHEET_SIZE);
  return jobs;
}

/**
 * `?previewsheets`: the page's handle for tools/preview-sheets/bake.ts,
 * `__previewSheets.jobs()` and `bake(name)`, the sheet as a WebP data URL.
 */
export function installPreviewSheetHook(previews: ModelPreviewService): void {
  const jobs = previewSheetJobs();
  (globalThis as Record<string, unknown>)['__previewSheets'] = {
    jobs: () => jobs.map(({ name, config, size }) => ({ name, modelUrl: config.modelUrl, view: previewViewKey(config), size })),
    bake: async (name: string, quality: number) => {
      const job = jobs.find((j) => j.name === name);
      if (!job) throw new Error(`no preview sheet ${name}`);
      const sheet = await previews.bakeSheet(job.config, job.size);
      return sheet.toDataURL('image/webp', quality);
    },
  };
}
