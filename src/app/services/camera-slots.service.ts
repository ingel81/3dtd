import { Injectable, computed, inject, signal } from '@angular/core';
import { CameraControlService, type CameraView } from './camera-control.service';
import { LocationManagementService } from './location/location-management.service';
import { WorldContext } from '../world/world-context.service';
import type { WorldRef } from '../world/world-ref';

/** Saved camera views, F1 to F5 (TODO E20) */
export const CAMERA_SLOT_COUNT = 5;

/** The views of a run in a save, slot by slot, null for an empty slot */
export type CameraSlots = (CameraView | null)[];

/** Which place a view belongs to: the world and the HQ, the local frame stands on both */
function placeKey(ref: WorldRef, hq: { lat: number; lon: number } | null): string | null {
  if (!hq) return null;
  const world = ref.kind === 'custom-map' ? `map:${ref.mapId}`
    : ref.kind === 'tileset' ? `tileset:${ref.id}`
    : ref.kind === 'devworld' ? `devworld:${ref.terrain}:${ref.seed}`
    : 'tiles';
  return `${world}@${hq.lat.toFixed(6)},${hq.lon.toFixed(6)}`;
}

/**
 * Camera views the player saves and flies back to, like an RTS (Shift+F1
 * to Shift+F5 save, F1 to F5 fly there). Local coordinates of the place
 * they were saved on: on another place (another world or HQ) the slots read
 * empty, a restart on the same place keeps them. The save game carries
 * them with the run (SaveGameService). Presentation only, the simulation
 * never sees them; in coop each player has their own.
 */
@Injectable({ providedIn: 'root' })
export class CameraSlotsService {
  private readonly cameraControl = inject(CameraControlService);
  private readonly location = inject(LocationManagementService);
  private readonly world = inject(WorldContext);

  private readonly here = computed(() => placeKey(this.world.ref(), this.location.hq()));
  private readonly saved = signal<{ place: string; views: CameraSlots } | null>(null);

  /** The views of the place here, slot by slot */
  readonly views = computed<CameraSlots>(() => {
    const saved = this.saved();
    return saved && saved.place === this.here() ? saved.views : emptySlots();
  });

  /** Save the camera's view now in `slot`; false without a place or a camera */
  store(slot: number): boolean {
    const place = this.here();
    const view = this.cameraControl.currentView();
    if (place === null || !view || !validSlot(slot)) return false;
    const views = [...this.views()];
    views[slot] = view;
    this.saved.set({ place, views });
    return true;
  }

  /** Glide to the view in `slot`; false when it is empty */
  recall(slot: number): boolean {
    const view = validSlot(slot) ? this.views()[slot] : null;
    return !!view && this.cameraControl.glideTo(view);
  }

  /** The slots for a save, null when none is set */
  saveState(): CameraSlots | null {
    const views = this.views();
    return views.some((v) => v !== null) ? views.map((v) => v && cloneView(v)) : null;
  }

  /** A save's slots, on the place the save just loaded; none in the save empties them */
  restoreState(views: CameraSlots | null | undefined): void {
    const place = this.here();
    if (place === null) return;
    const slots = emptySlots();
    views?.slice(0, CAMERA_SLOT_COUNT).forEach((v, i) => { slots[i] = v && cloneView(v); });
    this.saved.set({ place, views: slots });
  }
}

const emptySlots = (): CameraSlots => Array.from({ length: CAMERA_SLOT_COUNT }, () => null);
const validSlot = (slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < CAMERA_SLOT_COUNT;
const cloneView = (v: CameraView): CameraView => ({ position: { ...v.position }, target: { ...v.target } });
