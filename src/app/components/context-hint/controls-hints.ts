import type { HintItem } from './context-hint.component';
import type { Messages } from '../../i18n/messages/en';
import { keyHint } from '../../services/onboarding/onboarding';

/** The camera controls the hint box shows at the start of a game */
function cameraHints(t: Messages): HintItem[] {
  return [
    keyHint(t, 'lmb', 'pan'),
    keyHint(t, 'rmb', 'rotate'),
    keyHint(t, 'wheel', 'zoom'),
    keyHint(t, 'WASD', 'move'),
    keyHint(t, 'H', 'shortcuts'),
  ];
}

/**
 * The start's hint box: the camera controls, and while M from a former
 * session still holds every sound off, that it does and which key turns it
 * on. Muted, the game starts silent with only the audio button's icon to
 * say why.
 */
export function controlsHints(t: Messages, muted: boolean): HintItem[] {
  const hints = cameraHints(t);
  return muted ? [...hints, keyHint(t, 'M', 'soundOff')] : hints;
}
