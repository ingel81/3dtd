/**
 * The spawn points enemies can come from: those with a route of two points or
 * more in `paths`, in their order. One without is no lane (TODO E232): no
 * wave picks it, it gets no coop lane and no share of the start credits. The
 * world the simulation gets carries only these (buildSimWorld), and the
 * WaveManager takes only these.
 */
export function spawnsWithRoutes<T extends { id: string }>(spawns: readonly T[], paths: ReadonlyMap<string, readonly unknown[]>): T[] {
  return spawns.filter((spawn) => (paths.get(spawn.id)?.length ?? 0) > 1);
}
