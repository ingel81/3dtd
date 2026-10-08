import type { BootStep } from './boot-step.model';

/** The loading plate's numbers, from the boot steps (EngineInitializationService.loadingSteps) */
export interface LoadingPlateView {
  /** Steps done of all, 0 to 100 */
  percent: number;
  done: number;
  total: number;
  /** The step under way, else the next one due; null when all are done */
  current: BootStep | null;
  /** Its place in the list, 1-based ("8 of 10"); total + 1 when all are done */
  position: number;
}

export function loadingPlateView(steps: readonly BootStep[]): LoadingPlateView {
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const current = steps.find((step) => step.status === 'current') ?? steps.find((step) => step.status === 'pending') ?? null;
  return {
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    done,
    total,
    current,
    position: current ? steps.indexOf(current) + 1 : total + 1,
  };
}
