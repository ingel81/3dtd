import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';

/** What the player calls a model: the tower's or enemy's name, else the file's */
export function modelLabel(url: string): string {
  const owner = [...Object.values(TOWER_TYPES), ...Object.values(ENEMY_TYPES)].find((type) => type.modelUrl === url);
  return owner?.name ?? url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? url;
}

/** The notice for models that did not load (AssetManagerService.failedModels) */
export function modelsMissingText(urls: readonly string[]): string {
  const names = [...new Set(urls.map(modelLabel))].join(', ');
  return `Models did not load: ${names}. They stay unseen until a reload.`;
}
