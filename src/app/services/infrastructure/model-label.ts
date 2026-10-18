import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import type { Messages } from '../../i18n/messages/en';
import { enemyName } from '../../i18n/lookups';

/** What the player calls a model: the tower's or enemy's name, else the file's */
export function modelLabel(t: Messages, url: string): string {
  const tower = Object.values(TOWER_TYPES).find((type) => type.modelUrl === url);
  if (tower) return t.names.towers[tower.id];
  const enemy = Object.values(ENEMY_TYPES).find((type) => type.modelUrl === url);
  if (enemy) return enemyName(t, enemy.id);
  return url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? url;
}

/** The notice for models that did not load (AssetManagerService.failedModels) */
export function modelsMissingText(t: Messages, urls: readonly string[]): string {
  const names = [...new Set(urls.map((url) => modelLabel(t, url)))].join(', ');
  return t.hud.modelsMissing(names);
}
