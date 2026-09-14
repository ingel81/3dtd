/**
 * Report where `el`'s bottom edge is, in px from the top of its offset
 * parent: once when it is first laid out and after every change of its
 * size. A hidden element (display: none) reports 0. Without a
 * ResizeObserver (jsdom) it reports nothing.
 *
 * @returns stops the reports
 */
export function observeBottomEdge(el: HTMLElement, report: (px: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  const observer = new ResizeObserver(() => report(el.offsetTop + el.offsetHeight));
  observer.observe(el, { box: 'border-box' });
  return () => observer.disconnect();
}
