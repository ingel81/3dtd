import { Mesh, Vector3, type BufferAttribute, type BufferGeometry, type IUniform, type Scene, type ShaderMaterial } from 'three';
import { BURST_PALETTES, OOZE_DEATH_LOOK, OOZE_LOOK, type BurstPalette } from '../../../configs/visual-effects.config';
import { ROUTE_BODY_COVER, type RouteBodyStations } from '../../../utils/route-body';
import { SeededRandom, seedOf } from '../../../utils/seeded-random';
import { bloodMoonMultiplier } from '../../blood-moon/blood-moon-mood';
import type { GooSplash } from '../ground-decals';
import { buildOozeBandGeometry, refreshOozeBandHeights, type OozeGround } from './ooze-band-geometry';
import { createOozeBandMaterial } from './ooze-band-material';
import type { OozeDebrisRenderer } from './ooze-debris.renderer';
import { planOozeDeath, type OozeMessEvent } from './ooze-death-plan';

/** Stations of ground refreshed past each end of the body */
const REFRESH_MARGIN = 3;

/** The mess of a band that lives, sinks after a leak or has nowhere to put it */
const NO_MESS: readonly OozeMessEvent[] = [];

/** The effects a killed ooze's mess spawns through (ThreeEffectsRenderer) */
export interface OozeMessEffects {
  readonly impactEffectsEnabled: boolean;
  readonly groundMarksEnabled: boolean;
  spawnBurstAtGeo(lat: number, lon: number, height: number, count: number, palette: BurstPalette): void;
  spawnBloodSplatter(lat: number, lon: number, height: number, count?: number, color?: number): unknown;
  spawnGooDecal(lat: number, lon: number, height: number, splash: Readonly<GooSplash>): unknown;
}

/**
 * Where a killed ooze's mess goes (OOZE_DEATH_LOOK): bubbles, spray and
 * splashes through the effects, the debris to its renderer, which the band
 * renderer takes over (animates, clears and disposes it).
 */
export interface OozeMess {
  effects: OozeMessEffects;
  debris: OozeDebrisRenderer;
}

interface OozeBand {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly stations: RouteBodyStations;
  readonly ground: OozeGround;
  tailM: number;
  tipM: number;
  /** Share of the sinking done once the ooze is gone, null while it lives */
  dissolve: number | null;
  /** Seconds the sinking takes: OOZE_LOOK.dissolve, OOZE_LOOK.collapse for a killed ooze */
  dissolveS: number;
  /** A killed ooze's mess, sorted by its share of the collapse, and the next part to go */
  mess: readonly OozeMessEvent[];
  messNext: number;
}

/**
 * Draws the bodies of the oozes (EnemyTypeConfig.ooze): per ooze one mesh,
 * a band of slime along its route. The geometry covers the whole route and
 * is built once per path, shared by every ooze on it
 * (ooze-band-geometry.ts); a frame only sets uniforms (setFrame), so a body
 * 80 m long costs no more per frame than a short one. Every
 * OOZE_LOOK.groundRefresh game seconds the ground under the body's
 * stretch is read again from the route grid, which refines as tiles
 * stream in. A removed ooze sinks away over OOZE_LOOK.dissolve, a killed
 * one collapses over OOZE_LOOK.collapse (collapse()) and lets go of its
 * mess meanwhile (OOZE_DEATH_LOOK, planOozeDeath): bubbles bursting with a
 * spray of slime, splashes on the ground and debris from its whole length.
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
  /** Seeded again for each part of a mess, see letGo() */
  private readonly partRandom = new SeededRandom();
  /** Filled anew for each splash, see letGo() */
  private readonly splash: GooSplash = { size: 0, stretch: 1, rotation: 0, variation: 0, color: OOZE_DEATH_LOOK.goo };

  /** @param mess Where a killed ooze's mess goes; without it a collapse makes none */
  constructor(
    private readonly scene: Scene,
    private readonly mess: OozeMess | null = null,
  ) {}

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
    this.bands.set(id, {
      mesh, stations, ground, tailM: 0, tipM: 0, dissolve: null, dissolveS: OOZE_LOOK.dissolve, mess: NO_MESS, messNext: 0,
    });
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

  /** The ooze is gone (leaked or removed): its band sinks away. A collapsing band keeps collapsing. */
  remove(id: string): void {
    const band = this.bands.get(id);
    if (band && band.dissolve === null) {
      band.dissolve = 0;
      band.dissolveS = OOZE_LOOK.dissolve;
    }
  }

  /**
   * The ooze was killed: its band collapses over OOZE_LOOK.collapse from
   * the stretch of its last frame, see the uCollapse uniform, and plans its
   * mess for that stretch with the VFX settings of this moment, seeded with
   * `id`: the same kill makes the same mess at any timescale.
   */
  collapse(id: string): void {
    const band = this.bands.get(id);
    if (!band || band.dissolve !== null) return;
    band.dissolve = 0;
    band.dissolveS = OOZE_LOOK.collapse;
    band.mesh.material.uniforms['uCollapse'].value = 1;
    const mess = this.mess;
    if (mess) {
      const { impactEffectsEnabled, groundMarksEnabled } = mess.effects;
      band.mess = planOozeDeath(band.tipM - band.tailM, impactEffectsEnabled, groundMarksEnabled, seedOf(id));
      band.messNext = 0;
    }
  }

  /** The band of `id` goes at once, without sinking: the wave replay leaves none behind, a cleared map neither. */
  discard(id: string): void {
    this.drop(id);
  }

  /**
   * Once per render frame, `gameDeltaMs` of game time: the debris, clocks,
   * sinking and the mess of a collapse, ground refresh. At a high timescale
   * a frame lets go of every part that fell due in it.
   */
  animate(gameDeltaMs: number): void {
    const dt = gameDeltaMs / 1000;
    this.mess?.debris.update(dt);
    if (this.bands.size === 0) return;
    this.time += dt;
    this.sinceRefresh += dt;
    const refresh = this.sinceRefresh >= OOZE_LOOK.groundRefresh;
    if (refresh) this.sinceRefresh = 0;

    for (const [id, band] of this.bands) {
      const u = band.mesh.material.uniforms;
      u['uTime'].value = this.time;
      if (band.dissolve !== null) {
        band.dissolve = Math.min(1, band.dissolve + dt / band.dissolveS);
        u['uDissolve'].value = band.dissolve;
        while (band.messNext < band.mess.length && band.mess[band.messNext].t <= band.dissolve) {
          const e = band.mess[band.messNext++];
          this.letGo(band, e, (band.dissolve - e.t) * band.dissolveS);
        }
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

  /** Every band and every piece of debris gone at once (reset, location change). */
  clear(): void {
    for (const id of [...this.bands.keys()]) this.drop(id);
    this.clearDebris();
  }

  /** The debris thrown so far gone at once, the bands stay (a jump in the replay). */
  clearDebris(): void {
    this.mess?.debris.clear();
  }

  dispose(): void {
    this.clear();
    this.baseMaterial.dispose();
    this.mess?.debris.dispose();
  }

  /**
   * One part of a killed ooze's mess goes, `lateS` seconds after it fell
   * due, at its place on the body and on the ground there: the route
   * grid's, else the band's own under the station's centre. Its look comes
   * from its own seed.
   */
  private letGo(band: OozeBand, e: OozeMessEvent, lateS: number): void {
    const mess = this.mess;
    if (!mess) return;
    const st = band.stations;
    const k = st.nearestIndex(band.tailM + e.alongM);
    const offset = e.across * (e.across < 0 ? st.left[k] : st.right[k]) * ROUTE_BODY_COVER;
    const x = st.x[k] + st.rightX[k] * offset;
    const z = st.z[k] + st.rightZ[k] * offset;
    const bandGround = band.mesh.geometry.getAttribute('position') as BufferAttribute;
    const groundY = band.ground(x, z) ?? bandGround.getY(k * OOZE_LOOK.across + (OOZE_LOOK.across >> 1));
    const look = OOZE_DEATH_LOOK;
    const random = this.partRandom.seed(e.seed).next;
    if (e.debris !== null) {
      mess.debris.launch(e.debris, x, groundY + look.debris.lift, z, groundY, st.rightX[k], st.rightZ[k], random, lateS);
      return;
    }
    const lat = st.lat[k] + st.latPerRight[k] * offset;
    const lon = st.lon[k] + st.lonPerRight[k] * offset;
    const height = groundY + st.originHeight;
    if (e.kind === 'pop') {
      mess.effects.spawnBurstAtGeo(lat, lon, height + look.pops.lift, look.pops.sparks, BURST_PALETTES.slime);
      mess.effects.spawnBloodSplatter(lat, lon, height + look.pops.lift * 0.5, look.pops.spray, look.goo);
    } else {
      // Most splashes small, a few large ones
      const { sizeMin, sizeMax, stretchMax } = look.splashes;
      const splash = this.splash;
      const r = random();
      splash.size = sizeMin + (sizeMax - sizeMin) * r * r;
      splash.stretch = 1 + (stretchMax - 1) * random();
      splash.rotation = random() * Math.PI * 2;
      splash.variation = random();
      mess.effects.spawnGooDecal(lat, lon, height, splash);
    }
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
