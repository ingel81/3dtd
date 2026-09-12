import { describe, it, expect } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { AssetManagerService, CachedModel } from './asset-manager.service';

describe('AssetManagerService cloneModel tint', () => {
  function serviceWithModel(url: string, material: MeshStandardMaterial): AssetManagerService {
    const service = new AssetManagerService();
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), material));
    const internals = service as unknown as { modelCache: Map<string, CachedModel> };
    internals.modelCache.set(url, { scene, animations: [], refCount: 1, url });
    return service;
  }

  const materialOf = (object: Group | null): MeshStandardMaterial =>
    (object!.children[0] as Mesh).material as MeshStandardMaterial;

  it('multiplies the colour and sets the glow on the clone only', () => {
    const template = new MeshStandardMaterial({ color: 0xffffff });
    const service = serviceWithModel('tower.glb', template);
    const tint = { color: 0x9966cc, emissive: 0x4a1070, emissiveIntensity: 0.6 };

    const tinted = materialOf(service.cloneModel('tower.glb', { tint }) as Group);
    expect(tinted.color.getHex()).toBe(new Color(0x9966cc).getHex());
    expect(tinted.emissive.getHex()).toBe(new Color(0x4a1070).getHex());
    expect(tinted.emissiveIntensity).toBe(0.6);

    // The cached template and a plain clone of the same model keep their look:
    // the Chaos Tower borrows the Poison model, the Poison Tower must stay green.
    expect(template.color.getHex()).toBe(0xffffff);
    const plain = materialOf(service.cloneModel('tower.glb') as Group);
    expect(plain.color.getHex()).toBe(0xffffff);
    expect(plain.emissive.getHex()).toBe(0x000000);
  });
});
