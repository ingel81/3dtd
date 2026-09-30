import type { SimFramePacket, TowerStateDto } from '../protocol/packet';

/**
 * The packets that came since the last frame as one (docs/SIM_DECOUPLE_PLAN.md,
 * "Events und Ops"): the state of the newest (tables, scalars, heroes), the
 * stream of all of them in order (ops, events), the tower changes folded as
 * if one tick had run them all. So the main thread applies one packet per
 * frame, as with a tick of many sub-steps, and nothing of the packets it
 * skips gets lost.
 *
 * Tower changes: a removal drops the states before it; a state after a
 * removal stays (a restore puts the tower back, as removedTowers before
 * towerStates in one packet). A state without a line of sight keeps the one
 * an earlier packet sent (TowerStateDto.losMask is absent when unchanged).
 */
export function mergePackets(packets: readonly SimFramePacket[]): SimFramePacket {
  const newest = packets[packets.length - 1];
  if (packets.length === 1) return newest;
  const states = new Map<string, TowerStateDto>();
  const removed = new Set<string>();
  const ops: SimFramePacket['ops'] = [];
  const events: SimFramePacket['events'] = [];
  let stepsRun = 0;
  let tickMs = 0;
  let presented = false;
  for (const packet of packets) {
    for (const id of packet.removedTowers) {
      states.delete(id);
      removed.add(id);
    }
    for (const dto of packet.towerStates) {
      const before = states.get(dto.id);
      states.set(dto.id, before && before.losMask !== undefined && dto.losMask === undefined ? { ...dto, losMask: before.losMask } : dto);
    }
    for (const op of packet.ops) ops.push(op);
    for (const event of packet.events) events.push(event);
    stepsRun += packet.stepsRun;
    tickMs += packet.scalars.tickMs;
    presented ||= packet.presented;
  }
  return {
    ...newest,
    stepsRun,
    // The newest tables hold the state an earlier packet showed, unless a replay's jump is still on its way
    presented: newest.presented || (presented && !newest.scalars.replay?.seeking),
    scalars: { ...newest.scalars, tickMs },
    towerStates: [...states.values()],
    removedTowers: [...removed],
    ops,
    events,
  };
}
