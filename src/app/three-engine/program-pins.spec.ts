import { BoxGeometry, InstancedMesh, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, ShaderMaterial, type Object3D, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { ProgramPins } from './program-pins';

/** What a fake renderer was asked to compile: the objects under the root it got */
function fakeRenderer(programs: { usedTimes: number }[] = []) {
  const compiled: Object3D[] = [];
  // What a material's dispose gives back (three's releaseMaterialProgramReferences through the compiled holder)
  const props = new Map<object, { programs?: Map<unknown, { usedTimes: number }> }>();
  const renderer = {
    info: { programs },
    compileAsync: (root: Object3D) => {
      root.traverse((o) => compiled.push(o));
      return Promise.resolve(root);
    },
    compile: (root: Mesh) => {
      const material = root.material as MeshBasicMaterial;
      const entry = { programs: new Map<unknown, { usedTimes: number }>() };
      props.set(material, entry);
      material.addEventListener('dispose', () => entry.programs.forEach((p) => p.usedTimes--));
    },
    properties: { get: (o: object) => props.get(o) ?? {} },
  };
  return { renderer: renderer as unknown as WebGLRenderer, compiled };
}

describe('ProgramPins', () => {
  it('compiles one twin per shader text, of the kind of its object, with the material settings and hooks', async () => {
    const { renderer, compiled } = fakeRenderer();
    const scene = new Scene();
    const shader = new ShaderMaterial({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}', defines: { A: '' }, transparent: true });
    shader.onBeforeCompile = () => undefined;
    const geometry = new BoxGeometry();
    scene.add(new InstancedMesh(geometry, shader, 4), new Mesh(geometry, shader.clone()), new Mesh(geometry, new MeshBasicMaterial()));
    const pins = new ProgramPins();
    await pins.pinShaders(renderer, scene, new PerspectiveCamera(), scene);
    const twins = compiled.filter((o) => (o as Mesh).material);
    expect(twins).toHaveLength(1);
    const twin = twins[0] as InstancedMesh;
    expect(twin.isInstancedMesh).toBe(true);
    const material = twin.material as ShaderMaterial;
    expect(material).not.toBe(shader);
    expect(material.defines).toEqual({ A: '' });
    expect(material.transparent).toBe(true);
    expect(material.onBeforeCompile).toBe(shader.onBeforeCompile);
    expect(material.uniforms).toBe(shader.uniforms);
    // Seen once: nothing more to compile
    compiled.length = 0;
    await pins.pinShaders(renderer, scene, new PerspectiveCamera(), scene);
    expect(compiled).toEqual([]);
    pins.dispose(renderer);
  });

  it('gives every program one use more, once', () => {
    const programs = [{ usedTimes: 1 }, { usedTimes: 3 }];
    const { renderer } = fakeRenderer(programs);
    const pins = new ProgramPins();
    pins.pinPrograms(renderer);
    pins.pinPrograms(renderer);
    expect(programs.map((p) => p.usedTimes)).toEqual([2, 4]);
    expect(pins.count.programs).toBe(2);
    // Disposed with the engine: the uses go back, the page's renderer frees what no material holds
    pins.dispose(renderer);
    expect(programs.map((p) => p.usedTimes)).toEqual([1, 3]);
    expect(pins.count.programs).toBe(0);
  });
});
