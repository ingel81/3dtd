import { environment } from '../../environments/environment';
import { TOWER_TYPES, type TowerTypeConfig, type TowerTypeId } from './tower-types.config';
import { TOWER_PATHS, type TowerPath, type TowerPathId } from './tower-paths.config';
import type { ResearchConfig } from './research/research.types';
import { RESEARCH_TREE } from './research/research-tree.config';

/**
 * Release switch for tower types and tower paths (`released: false` in their
 * config). Like the custom maps (world/custom-maps-open.ts): an unreleased one
 * is there to build, research and test in a dev build and hidden in a
 * production build: not in the build panel, its research not in the tree, not
 * offered to the bots, left out of the wave planner and the balance tools, and
 * a save that names one does not load. The one place that decides; every
 * caller asks here. `production` is the build's unless given (specs, tools:
 * the generated charts show what players get, so the tools pass true).
 */
export function isReleased(item: { readonly released?: boolean }, production = environment.production): boolean {
  return item.released !== false || !production;
}

export function isTowerReleased(id: string, production = environment.production): boolean {
  const config = TOWER_TYPES[id as TowerTypeId];
  return !!config && isReleased(config, production);
}

export function isPathReleased(id: string, production = environment.production): boolean {
  const path = TOWER_PATHS[id as TowerPathId];
  return !!path && isReleased(path, production);
}

/** A research is there as long as everything it unlocks is: one for an unreleased tower or path is hidden with it. */
export function isResearchReleased(research: ResearchConfig, production = environment.production): boolean {
  return research.effects.every((effect) =>
    effect.kind === 'unlock-tower' ? isTowerReleased(effect.towerId, production)
      : effect.kind === 'unlock-path' ? isPathReleased(effect.pathId, production)
        : true);
}

/** The tower types of this build, in TOWER_TYPES order */
export function releasedTowerTypes(production = environment.production): TowerTypeConfig[] {
  return Object.values(TOWER_TYPES).filter((config) => isReleased(config, production));
}

/** The paths of this build, in TOWER_PATHS order */
export function releasedPaths(production = environment.production): TowerPath[] {
  return Object.values(TOWER_PATHS).filter((path) => isReleased(path, production));
}

/** The paths of this build a tower of `typeId` can take, in TOWER_PATHS order */
export function releasedPathsOf(typeId: string, production = environment.production): TowerPath[] {
  return releasedPaths(production).filter((path) => path.towerId === typeId);
}

/** The researches of this build, in RESEARCH_TREE order */
export function releasedResearch(production = environment.production): ResearchConfig[] {
  return Object.values(RESEARCH_TREE).filter((research) => isResearchReleased(research, production));
}

/**
 * The first unreleased tower type or path a saved run names (`towers` of a snapshot), null when it names none:
 * such a save does not load in this build (readSaveFile).
 */
export function unreleasedInSave(
  towers: readonly { typeId: string; state?: { pathId?: string | null } }[],
  production = environment.production,
): string | null {
  for (const tower of towers) {
    if (!isTowerReleased(tower.typeId, production)) return TOWER_TYPES[tower.typeId as TowerTypeId]?.name ?? tower.typeId;
    const pathId = tower.state?.pathId;
    if (pathId && !isPathReleased(pathId, production)) return TOWER_PATHS[pathId as TowerPathId]?.name ?? pathId;
  }
  return null;
}
