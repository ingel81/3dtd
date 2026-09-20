/** What a cheat tile of the dev menu gives or takes, by the way it is used */
export interface DebugCheatSteps {
  click: number;
  shiftClick: number;
  rightClick: number;
  shiftRightClick: number;
  /** Per wheel notch, up gives and down takes */
  wheel: number;
  shiftWheel: number;
}

/** Steps of the "+HP" tile; Shift+Click fills the bar for good */
export const DEBUG_HEALTH_STEPS: DebugCheatSteps = {
  click: 1000,
  shiftClick: 100000,
  rightClick: -10,
  shiftRightClick: -1000,
  wheel: 100,
  shiftWheel: 1000,
};

/** Steps of the "Credits" tile, the same as the HP tile's */
export const DEBUG_CREDITS_STEPS: DebugCheatSteps = {
  click: 1000,
  shiftClick: 100000,
  rightClick: -10,
  shiftRightClick: -1000,
  wheel: 100,
  shiftWheel: 1000,
};

/**
 * What a cheat tile changes its value by for this event. A left click
 * gives, a right click takes, and the wheel over the tile dials it up and
 * down; Shift takes every step further.
 */
export function debugCheatAmount(
  event: Pick<MouseEvent, 'type' | 'shiftKey'> & { deltaY?: number },
  steps: DebugCheatSteps,
): number {
  if (event.type === 'wheel') {
    const step = event.shiftKey ? steps.shiftWheel : steps.wheel;
    // Wheel up (negative deltaY) gives, wheel down takes
    return (event.deltaY ?? 0) < 0 ? step : -step;
  }
  if (event.type === 'contextmenu') return event.shiftKey ? steps.shiftRightClick : steps.rightClick;
  return event.shiftKey ? steps.shiftClick : steps.click;
}
