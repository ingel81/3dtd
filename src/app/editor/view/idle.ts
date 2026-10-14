/** The page's next idle moment, at the latest after `timeout` ms (a frame's wait where the browser has no idle callback) */
export function idle(timeout = 500): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 16);
  });
}
