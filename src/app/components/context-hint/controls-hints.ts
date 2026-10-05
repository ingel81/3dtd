import type { HintItem } from './context-hint.component';

/** The camera controls the hint box shows at the start of a game */
const CAMERA_HINTS: readonly HintItem[] = [
  { key: 'LMB', description: 'Pan' },
  { key: 'RMB', description: 'Rotate' },
  { key: 'Wheel', description: 'Zoom' },
  { key: 'WASD', description: 'Move' },
  { key: 'H', description: 'Shortcuts' },
];

/**
 * The start's hint box: the camera controls, and while M from a former
 * session still holds every sound off, that it does and which key turns it
 * on. Muted, the game starts silent with only the audio button's icon to
 * say why.
 */
export function controlsHints(muted: boolean): HintItem[] {
  return muted ? [...CAMERA_HINTS, { key: 'M', description: 'Sound is off' }] : [...CAMERA_HINTS];
}
