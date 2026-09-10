import { SRGBColorSpace } from 'three';
import { LOS_VIZ_CONFIG, StateAppearance } from '../../configs/los-viz.config';
import { visibleLosLayers } from '../../utils/tower-los-layer-builder';

export interface LosLegendEntry {
  label: string;
  /** CSS-rgba der Cell-Farbe aus `LOS_VIZ_CONFIG.states`. */
  swatch: string;
}

const srgb = { r: 0, g: 0, b: 0 };
const to255 = (c: number): number => Math.round(Math.max(0, Math.min(1, c)) * 255);

/**
 * Config-Farbe → CSS. Dieselbe linear→sRGB-Wandlung wie `colorspace_fragment`
 * im Cell-Shader, damit der Swatch farblich zur Cell in 3D passt.
 */
export function losSwatchCss(state: StateAppearance): string {
  state.color.getRGB(srgb, SRGBColorSpace);
  // Alpha im Swatch hochgesetzt damit die Farbe gut lesbar ist
  const a = Math.max(0.6, state.alpha);
  return `rgba(${to255(srgb.r)}, ${to255(srgb.g)}, ${to255(srgb.b)}, ${a.toFixed(2)})`;
}

/**
 * Legenden-Einträge für die per-Tower-LOS-Viz. Zeigt exakt die Layer, die
 * `TowerLosLayerBuilder` sichtbar schaltet (gleiche Gating-Funktion):
 *
 *  Mixed-Tower, Filter=Both:   Ground / Air / Blocked
 *  Mixed-Tower, Filter=Ground: Ground / Blocked
 *  Mixed-Tower, Filter=Air:    Air / Blocked
 *  Pure-Ground-Tower:          Ground / Blocked (Filter egal)
 *  Pure-Air-Tower:             Air / Blocked (Filter egal)
 */
export function buildLosLegendEntries(
  filter: 'both' | 'ground' | 'air',
  canTargetGround: boolean,
  canTargetAir: boolean,
): LosLegendEntry[] {
  const states = LOS_VIZ_CONFIG.states;
  const visible = visibleLosLayers(filter, canTargetGround, canTargetAir);
  const list: LosLegendEntry[] = [];

  if (visible.ground) list.push({ label: 'Ground', swatch: losSwatchCss(states.ground) });
  if (visible.air)    list.push({ label: 'Air',    swatch: losSwatchCss(states.air) });
  if (visible.ground || visible.air) {
    list.push({ label: 'Blocked', swatch: losSwatchCss(states.blocked) });
  }

  return list;
}
