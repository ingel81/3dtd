/**
 * A tower's line of sight on the route grid as data: the answers its cube
 * gave for every cell in its reach, so they can be stored, sent and applied
 * again without a GPU (snapshot, re-simulation, later the host mask in
 * coop).
 *
 * Slots: the grid spots whose square touches the tower's range disc, in the
 * order GlobalRouteGrid.forEachSlotInReach walks them (grid x, then grid z,
 * both ascending). The order follows from the tower's position, the range
 * and the cell size alone, not from the cells: a spot without a cell holds
 * a slot too (its bits stay 0). Which slots hold an answer follows from the
 * frozen grid: a cell in reach has a ground answer when the tower targets
 * ground, an air answer when it targets air, nothing else has one.
 *
 * Two bits per slot, four slots per byte from the low bits up: bit 0 ground
 * visible, bit 1 air visible. A 2 m grid and range r (m) give about
 * (4 + 8 r + pi r^2) / 4 slots, the disc grown by a cell: with range and
 * flags 98 B at 20 m, 202 B at 30 m, 344 B at 40 m, 746 B at 60 m
 * (los-mask.spec.ts measures them).
 */
export interface LosMask {
  /** Range the answers were resolved for, m; it sets the slots */
  range: number;
  /** The tower holds ground answers (canTargetGround) */
  ground: boolean;
  /** The tower holds air answers (by type or by research) */
  air: boolean;
  /** Two bits per slot, see above */
  bits: Uint8Array;
}

/** Bit of a slot: the ground sample of the cell is visible. */
export const LOS_SLOT_GROUND = 1;
/** Bit of a slot: the air sample of the cell is visible. */
export const LOS_SLOT_AIR = 2;

/** Zeroed bits for `slots` slots. */
export function createLosBits(slots: number): Uint8Array {
  return new Uint8Array(Math.ceil(slots / 4));
}

/** Write the LOS_SLOT_* bits of `slot`. The slot must still be 0. */
export function writeLosSlot(bits: Uint8Array, slot: number, value: number): void {
  bits[slot >> 2] |= value << ((slot & 3) * 2);
}

/** The LOS_SLOT_* bits of `slot`. */
export function readLosSlot(bits: Uint8Array, slot: number): number {
  return (bits[slot >> 2] >> ((slot & 3) * 2)) & 3;
}

/** Bytes a mask takes: the bits plus range and flags (8 + 1). */
export function losMaskByteSize(mask: LosMask): number {
  return mask.bits.length + 9;
}

/** A mask as plain JSON data (bits in base64), for the command log and snapshots. */
export interface LosMaskJson {
  range: number;
  ground: boolean;
  air: boolean;
  bits: string;
}

export function losMaskToJson(mask: LosMask): LosMaskJson {
  let binary = '';
  for (const byte of mask.bits) binary += String.fromCharCode(byte);
  return { range: mask.range, ground: mask.ground, air: mask.air, bits: btoa(binary) };
}

export function losMaskFromJson(json: LosMaskJson): LosMask {
  const binary = atob(json.bits);
  const bits = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bits[i] = binary.charCodeAt(i);
  return { range: json.range, ground: json.ground, air: json.air, bits };
}
