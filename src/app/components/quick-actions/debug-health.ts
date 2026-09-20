/** Steps of the "+HP" cheat, by the way it is used */
export const DEBUG_HEALTH_STEPS = {
  click: 1000,
  shiftClick: 100000,
  rightClick: -10,
  shiftRightClick: -1000,
  wheel: 100,
  shiftWheel: 1000,
} as const;

/**
 * What the "+HP" cheat in the dev menu changes the HQ health by. A left
 * click gives HP, a right click takes it, to walk the HQ fire through its
 * stages, and the wheel dials it up and down over the button. Shift takes
 * every step further; Shift+Click fills the bar for good.
 */
export function debugHealthAmount(
  event: Pick<MouseEvent, 'type' | 'shiftKey'> & { deltaY?: number },
): number {
  const s = DEBUG_HEALTH_STEPS;
  if (event.type === 'wheel') {
    const step = event.shiftKey ? s.shiftWheel : s.wheel;
    // Wheel up (negative deltaY) gives HP, wheel down takes it
    return (event.deltaY ?? 0) < 0 ? step : -step;
  }
  if (event.type === 'contextmenu') return event.shiftKey ? s.shiftRightClick : s.rightClick;
  return event.shiftKey ? s.shiftClick : s.click;
}
