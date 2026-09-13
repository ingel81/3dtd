import { describe, it, expect, vi, afterEach } from 'vitest';
import { AnimationClip, Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { HeroRenderer, type HeroCoordinates } from './hero.renderer';
import { HERO_MODEL, loadHeroModel, type HeroModelConfig } from './hero-model';
import type { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import type { HeroPresentation } from '../../managers/hero.manager';

/** Degrees straight to scene metres: x = lon * 1000, z = lat * 1000. */
const coordinates: HeroCoordinates = {
  geoToLocalSimpleInto: (lat, lon, _height, target) => target.set(lon * 1000, 0, lat * 1000),
};

const hero = (patch: Partial<HeroPresentation> = {}): HeroPresentation => ({
  lat: 0.01, lon: 0.02, heading: 0.5, pose: 'idle', anchor: { lat: 0.03, lon: 0.02 }, ...patch,
});

/** A GLB stand-in: one box two metres tall, centred on the origin, and three clips. */
function fakeAssets(fail = false) {
  const scene = new Group();
  scene.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  const animations = ['Idle', 'Run_Rifle', 'Shoot'].map((name) => new AnimationClip(name, 1, []));
  const assets = {
    loadModel: vi.fn(async () => {
      if (fail) throw new Error('404');
      return { scene, animations, refCount: 1, url: 'soldier.glb' };
    }),
    cloneModel: vi.fn(() => scene.clone()),
    releaseModel: vi.fn(),
  };
  return assets;
}

const withGlb: HeroModelConfig = { ...HERO_MODEL, url: 'soldier.glb' };

describe('HeroRenderer', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup(config: HeroModelConfig = HERO_MODEL, assets: ReturnType<typeof fakeAssets> | null = null) {
    const scene = new Scene();
    const renderer = new HeroRenderer(scene, coordinates, assets as unknown as AssetManagerService, config);
    renderer.setGround({ getGroundLocalYAt: (x) => x / 10 }); // ground rises to the east
    return { scene, renderer };
  }

  it('stands him on the route grid\'s ground, facing his heading', () => {
    const { renderer } = setup();
    expect(renderer.pickTarget()).toBeNull();

    renderer.present(hero());
    const root = renderer.pickTarget()!;
    expect(root.visible).toBe(true);
    expect(root.position.toArray()).toEqual([20, 2, 10]);
    expect(root.rotation.y).toBeCloseTo(0.5);
    expect(root.getObjectByName('hero-placeholder')).toBeDefined();
  });

  it('draws the placeholder about as tall as configured', () => {
    const { renderer } = setup();
    renderer.present(hero());
    const box = new Box3().setFromObject(renderer.pickTarget()!);
    expect(box.max.y - box.min.y).toBeGreaterThan(HERO_MODEL.heightM * 0.9);
    expect(box.max.y - box.min.y).toBeLessThan(HERO_MODEL.heightM * 1.1);
  });

  it('shows the rings under him and on his post only while he is selected', () => {
    const { scene, renderer } = setup();
    renderer.present(hero());
    const rings = () => scene.children.filter((c) => c instanceof Mesh && c.visible);
    expect(rings()).toHaveLength(0);

    renderer.setSelected(true);
    expect(rings()).toHaveLength(2);
    const post = rings().find((r) => r.position.z === 30)!;
    expect(post.position.x).toBe(20);

    renderer.showMoveTarget(new Vector3(5, 1, 5), false);
    expect(rings()).toHaveLength(3);
    renderer.setSelected(false);
    expect(rings()).toHaveLength(0);
  });

  it('hides him on clear and reports no head to rise from', () => {
    const { renderer } = setup();
    renderer.present(hero());
    expect(renderer.headPosition(new Vector3())!.y).toBeGreaterThan(2 + HERO_MODEL.heightM);

    renderer.clear();
    expect(renderer.pickTarget()).toBeNull();
    expect(renderer.headPosition(new Vector3())).toBeNull();
  });

  it('swaps the placeholder for the GLB once it has loaded', async () => {
    const assets = fakeAssets();
    const { renderer } = setup(withGlb, assets);
    renderer.present(hero());
    expect(renderer.pickTarget()!.getObjectByName('hero-placeholder')).toBeDefined();

    await vi.waitFor(() => expect(renderer.pickTarget()!.getObjectByName('hero-model')).toBeDefined());
    expect(renderer.pickTarget()!.getObjectByName('hero-placeholder')).toBeUndefined();
  });

  it('keeps the placeholder when the GLB does not load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { renderer } = setup(withGlb, fakeAssets(true));
    renderer.present(hero());
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(renderer.pickTarget()!.getObjectByName('hero-placeholder')).toBeDefined();
  });
});

describe('loadHeroModel', () => {
  it('scales the GLB to the configured height with its feet on the ground', async () => {
    const model = await loadHeroModel(fakeAssets() as unknown as AssetManagerService, withGlb);
    const box = new Box3().setFromObject(model.root);
    expect(box.max.y - box.min.y).toBeCloseTo(HERO_MODEL.heightM, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
  });

  it('plays a clip per pose, matched by name, and releases the model on dispose', async () => {
    const assets = fakeAssets();
    const model = await loadHeroModel(assets as unknown as AssetManagerService, withGlb);
    expect(() => {
      model.setPose('idle');
      model.setPose('run');
      model.setPose('shoot');
      model.update(16);
    }).not.toThrow();
    model.dispose();
    expect(assets.releaseModel).toHaveBeenCalledWith('soldier.glb');
  });
});
