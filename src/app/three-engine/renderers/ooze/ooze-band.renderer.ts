import { Mesh, Vector3, type BufferGeometry, type IUniform, type Scene, type ShaderMaterial } from 'three';
import { OOZE_LOOK } from '../../../configs/visual-effects.config';
import { ROUTE_BODY_COVER, type RouteBodyStations } from '../../../utils/route-body';
import { bloodMoonMultiplier } from '../../blood-moon/blood-moon-mood';
import { buildOozeBandGeometry, refreshOozeBandHeights, type OozeGround } from './ooze-band-geometry';
import { createOozeBandMaterial } from './ooze-band-material';

/** Stations of ground refreshed past each end of the body */
const REFRESH_MARGIN = 3;

interface OozeBand {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly stations: RouteBodyStations;
  readonly ground: OozeGround;
  tailM: number;
  tipM: number;
  /** Share of the sinking done once the ooze is gone, null while it lives */
  dissolve: number | null;
}

/**
 * Draws the bodies of the oozes (EnemyTypeConfig.ooze): per ooze one mesh,
 * a band of slime along its route. The geometry covers the whole route and
 * is built once per path, shared by every ooze on it
 * (ooze-band-geometry.ts); a frame only sets uniforms (setFrame), so a body
 * 80 m long costs no more per frame than a short one. Every
 * OOZE_LOOK.groundRefresh game seconds the ground under the body's
 * stretch is read again from the route grid, which refines as tiles
 * stream in. A removed ooze sinks away over OOZE_LOOK.dissolve.
 *
 * Visual only: EnemyManager pushes the frame (OozeBodies.present); nothing
 * here feeds back into the simulation.
 */
export class OozeBandRenderer {
  private readonly bands = new Map<string, OozeBand>();
  private readonly geometries = new Map<RouteBodyStations, { geometry: BufferGeometry; users: number }>();
  private readonly baseMaterial = createOozeBandMaterial();
  /** Blood moon uniforms every band shares, see setBloodMoon() */
  private readonly bloodMoonGlow: IUniform<number> = { value: 0 };
  private readonly bloodMoonTint: IUniform<Vector3> = { value: new Vector3(1, 1, 1) };
  private time = 0;
  private sinceRefresh = 0;

  constructor(private readonly scene: Scene) {}

  /** Bands drawn, the sinking ones included. */
  get count(): number {
    return this.bands.size;
  }

  /** A band for the ooze `id` along `stations`; `ground` is the route grid's ground. */
  add(id: string, stations: RouteBodyStations, ground: OozeGround): void {
    if (this.bands.has(id)) this.drop(id);
    let shared = this.geometries.get(stations);
    if (!shared) {
      shared = {
        geometry: buildOozeBandGeometry(stations, OOZE_LOOK.across, ROUTE_BODY_COVER, ground),
        users: 0,
      };
      this.geometries.set(stations, shared);
    }
    shared.users++;
    const material = this.baseMaterial.clone();
    material.uniforms['uTime'].value = this.time;
    // clone() copied the uniforms; the blood moon ones are shared again
    material.uniforms['uBloodMoonGlow'] = this.bloodMoonGlow;
    material.uniforms['uBloodMoonTint'] = this.bloodMoonTint;
    const mesh = new Mesh(shared.geometry, material);
    mesh.name = `ooze-${id}`;
    this.scene.add(mesh);
    this.bands.set(id, { mesh, stations, ground, tailM: 0, tipM: 0, dissolve: null });
  }

  /**
   * The body of `id` this frame: its stretch along the route (m), its HP
   * share, which thins it, and the status effects on it. One tint at a time:
   * frozen, stunned, slowed, poisoned; burn glows on top.
   */
  setFrame(
    id: string,
    tailM: number,
    tipM: number,
    hpFraction: number,
    slowed: boolean,
    poisoned: boolean,
    burning: boolean,
    frozen = false,
    stunned = false,
  ): void {
    const band = this.bands.get(id);
    if (!band || band.dissolve !== null) return;
    band.tailM = tailM;
    band.tipM = tipM;
    const u = band.mesh.material.uniforms;
    u['uTail'].value = tailM;
    u['uTip'].value = tipM;
    const hp = Math.max(0, Math.min(1, hpFraction));
    u['uWidth'].value = OOZE_LOOK.minWidth + (1 - OOZE_LOOK.minWidth) * hp;
    u['uHeight'].value = OOZE_LOOK.height * (OOZE_LOOK.minHeight + (1 - OOZE_LOOK.minHeight) * hp);
    const tint = u['uTint'].value as Vector3;
    if (frozen) {
      tint.set(...OOZE_LOOK.iceTint);
      u['uTintAmount'].value = OOZE_LOOK.iceAmount;
    } else if (stunned) {
      tint.set(...OOZE_LOOK.stunTint);
      u['uTintAmount'].value = OOZE_LOOK.stunAmount;
    } else if (slowed) {
      tint.set(...OOZE_LOOK.slowTint);
      u['uTintAmount'].value = OOZE_LOOK.slowAmount;
    } else if (poisoned) {
      tint.set(...OOZE_LOOK.poisonTint);
      u['uTintAmount'].value = OOZE_LOOK.poisonAmount;
    } else {
      u['uTintAmount'].value = 0;
    }
    u['uBurn'].value = burning ? 1 : 0;
  }

  /**
   * Blood moon look at `amount` (0..1, BloodMoonLook): the red edge glow of
   * every band, and the mood's tint, which the transparent band draws after.
   * The band encodes its output itself, so the tint is the linear one on
   * the canvas too. Two uniform writes for all bands, later ones included.
   */
  setBloodMoon(amount: number): void {
    this.bloodMoonGlow.value = amount;
    bloodMoonMultiplier(amount, true, this.bloodMoonTint.value);
  }

  /** The ooze is gone (killed, leaked or removed): its band sinks away. */
  remove(id: string): void {
    const band = this.bands.get(id);
    if (band && band.dissolve === null) band.dissolve = 0;
  }

  /** The band of `id` goes at once, without sinking: the wave replay leaves none behind. */
  discard(id: string): void {
    this.drop(id);
  }

  /** Once per render frame, `gameDeltaMs` of game time: clocks, sinking, ground refresh. */
  animate(gameDeltaMs: number): void {
    if (this.bands.size === 0) return;
    const dt = gameDeltaMs / 1000;
    this.time += dt;
    this.sinceRefresh += dt;
    const refresh = this.sinceRefresh >= OOZE_LOOK.groundRefresh;
    if (refresh) this.sinceRefresh = 0;

    for (const [id, band] of this.bands) {
      const u = band.mesh.material.uniforms;
      u['uTime'].value = this.time;
      if (band.dissolve !== null) {
        band.dissolve = Math.min(1, band.dissolve + dt / OOZE_LOOK.dissolve);
        u['uDissolve'].value = band.dissolve;
        if (band.dissolve >= 1) this.drop(id);
        continue;
      }
      if (refresh) {
        const st = band.stations;
        refreshOozeBandHeights(
          band.mesh.geometry,
          st,
          OOZE_LOOK.across,
          band.ground,
          st.nearestIndex(band.tailM) - REFRESH_MARGIN,
          st.nearestIndex(band.tipM) + REFRESH_MARGIN,
        );
      }
    }
  }

  /** Every band gone at once (reset, location change). */
  clear(): void {
    for (const id of [...this.bands.keys()]) this.drop(id);
  }

  dispose(): void {
    this.clear();
    this.baseMaterial.dispose();
  }

  private drop(id: string): void {
    const band = this.bands.get(id);
    if (!band) return;
    this.bands.delete(id);
    this.scene.remove(band.mesh);
    band.mesh.material.dispose();
    const shared = this.geometries.get(band.stations);
    if (shared && --shared.users <= 0) {
      shared.geometry.dispose();
      this.geometries.delete(band.stations);
    }
  }
}
