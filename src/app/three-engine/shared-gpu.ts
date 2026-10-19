/** A material, texture or geometry three can drop the GPU side of and upload again */
interface GpuResource {
  dispose(): void;
}

const shared = new Set<object>();

/**
 * Marks `resource` as the page's: made once (on module level, a class's
 * static one, a cache's) and drawn by every view that comes. The page's
 * renderer (RendererHost) keeps it when a lease ends, so the next view
 * finds it uploaded; everything else a lease drew goes with it
 * (DrawLedger). Returns it.
 */
export function shareGpu<T extends GpuResource>(resource: T): T {
  shared.add(resource);
  return resource;
}

/** `resource` is no longer the page's (its owner went and freed it) */
export function unshareGpu(resource: GpuResource): void {
  shared.delete(resource);
}

/** Whether `resource` is the page's (shareGpu) */
export function isSharedGpu(resource: object): boolean {
  return shared.has(resource);
}
