/**
 * Status of a single boot-sequence step in the loading screen.
 * - pending: not started yet
 * - current: actively running (spinner shown)
 * - done: finished (checkmark shown)
 */
export type BootStepStatus = 'pending' | 'current' | 'done';

/**
 * One step in the loading screen's boot panel.
 * `meta` is a free-form right-aligned subtext (e.g. "57 streets · OSM").
 */
export interface BootStep {
  id: string;
  title: string;
  meta?: string;
  status: BootStepStatus;
}

/**
 * Mission info shown in the loading screen's address strip.
 * `alt` is optional — heights load asynchronously and may not be ready
 * during the early boot phase.
 */
export interface MissionInfo {
  address: string;
  postal: string;
  city: string;
  lat: number;
  lng: number;
  alt?: number;
}
