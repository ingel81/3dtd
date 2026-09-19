import { Color, Material, Mesh, Object3D } from 'three';

/** Share of its brightness a tower on hold fire keeps */
export const HOLD_FIRE_BRIGHTNESS = 0.45;

/** A material with the colours the grey-out changes, when it has them */
type Tinted = Material & { color?: Color; emissive?: Color };

/** The colours a greyed-out material had, in its userData */
interface SavedColours {
  color?: Color;
  emissive?: Color;
}

const KEY = 'holdFireColours';

/**
 * Grey out a tower model on hold fire (Tower.holdFire), or give it its own
 * colours back: every material's colour goes to a dim grey of its
 * brightness and a glow goes out; textures keep their pattern, dimmed.
 * Changes the materials in place, so they must be the tower's own
 * (AssetManager.cloneModel clones them). Greying twice or restoring a
 * tower that is not grey changes nothing.
 */
export function setTowerGreyedOut(root: Object3D, greyed: boolean): void {
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) greyOut(material as Tinted, greyed);
  });
}

function greyOut(material: Tinted, greyed: boolean): void {
  const saved = material.userData[KEY] as SavedColours | undefined;
  if (greyed) {
    if (saved) return;
    material.userData[KEY] = { color: material.color?.clone(), emissive: material.emissive?.clone() } satisfies SavedColours;
    const c = material.color;
    if (c) {
      const grey = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) * HOLD_FIRE_BRIGHTNESS;
      c.setRGB(grey, grey, grey);
    }
    material.emissive?.setRGB(0, 0, 0);
  } else if (saved) {
    if (saved.color) material.color?.copy(saved.color);
    if (saved.emissive) material.emissive?.copy(saved.emissive);
    delete material.userData[KEY];
  }
}
