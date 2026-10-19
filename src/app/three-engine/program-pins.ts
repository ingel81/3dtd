import { BufferGeometry, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Points, RawShaderMaterial, ShaderMaterial, Sprite, type Camera, type Scene, type SpriteMaterial, type WebGLRenderer } from 'three';

/**
 * Keeps what the loading warm-up built for the game's life. three frees a
 * program once no material uses it any more, and the id it gives a custom
 * shader's text (WebGLShaderCache, part of every program key of that
 * shader) once no material has the text; the text gets a new id when it
 * comes again. A layer that builds its materials anew (a map's effects on a
 * quality switch, the route lines) so built its programs again in play,
 * warmed at load or not (some ten frames of 40 ms per level switch on
 * autumn keep).
 *
 * - `pinShaders`: one stand-in material per shader text, compiled once and
 *   never disposed while the pins live, holds each id
 * - `pinPrograms`: every program built so far gets one use more, which no
 *   material gives back, so three never frees it while the pins live
 *
 * `dispose(renderer)` gives both back: the page's renderer outlives the
 * engine (RendererHost), and programs pinned for a world gone stayed on the
 * GPU world after world.
 */
export class ProgramPins {
  private readonly group = new Group();
  private readonly texts = new Set<string>();
  private readonly programs = new Set<object>();

  /** Pins the shaders of every ShaderMaterial under `root` not pinned yet; resolves once their programs are built */
  pinShaders(renderer: WebGLRenderer, root: Object3D, camera: Camera, scene: Scene): Promise<unknown> {
    const added: Object3D[] = [];
    root.traverse((o) => {
      const material = (o as { material?: Material | Material[] }).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        if (!(m as ShaderMaterial).isShaderMaterial) continue;
        const s = m as ShaderMaterial;
        const text = `${s.vertexShader}\u0000${s.fragmentShader}`;
        if (this.texts.has(text)) continue;
        this.texts.add(text);
        const pin = twinMaterial(s);
        const mesh = twinObject(o, pin);
        mesh.visible = false;
        this.group.add(mesh);
        added.push(mesh);
      }
    });
    if (!added.length) return Promise.resolve();
    const batch = new Group();
    batch.children = added;
    return renderer.compileAsync(batch, camera, scene);
  }

  /**
   * One use more for every program the renderer holds and that is not
   * pinned yet. The programs stay until the renderer goes (the engine's
   * dispose); a few hundred programs are a few MB in the GPU process
   */
  pinPrograms(renderer: WebGLRenderer): void {
    for (const program of renderer.info.programs ?? []) {
      if (this.programs.has(program)) continue;
      this.programs.add(program);
      (program as unknown as { usedTimes: number }).usedTimes++;
    }
  }

  /** How many shader texts and programs are pinned */
  get count(): { shaders: number; programs: number } {
    return { shaders: this.texts.size, programs: this.programs.size };
  }

  /** Gives the pinned shaders and program uses back to `renderer`: a program no material uses any more goes */
  dispose(renderer: WebGLRenderer): void {
    for (const o of this.group.children) ((o as Mesh).material as ShaderMaterial).dispose();
    this.group.clear();
    this.texts.clear();
    if (!this.programs.size) return;
    // three frees a program only through a material that used it (WebGLPrograms.releaseProgram, which also drops
    // it from its key map): a stand-in compiled once takes the pinned uses as its own, its dispose gives them back
    const holder = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    renderer.compile(holder, new PerspectiveCamera());
    const programs = (renderer.properties.get(holder.material) as { programs?: Map<unknown, object> }).programs;
    if (programs) {
      let k = 0;
      for (const program of this.programs) programs.set(`pin:${k++}`, program);
    }
    this.programs.clear();
    holder.material.dispose();
    holder.geometry.dispose();
  }
}

/**
 * A material that builds the same program as `m`: its own object (it is
 * never disposed), every setting and the compile hooks of `m`, the uniforms
 * shared (their values are no part of a program's key)
 */
function twinMaterial(m: ShaderMaterial): ShaderMaterial {
  const twin = (m as RawShaderMaterial).isRawShaderMaterial ? new RawShaderMaterial() : new ShaderMaterial();
  Material.prototype.copy.call(twin, m);
  twin.vertexShader = m.vertexShader;
  twin.fragmentShader = m.fragmentShader;
  twin.defines = { ...m.defines };
  twin.uniforms = m.uniforms;
  twin.extensions = { ...m.extensions };
  twin.lights = m.lights;
  twin.fog = m.fog;
  twin.clipping = m.clipping;
  twin.wireframe = m.wireframe;
  twin.glslVersion = m.glslVersion;
  twin.onBeforeCompile = m.onBeforeCompile;
  twin.customProgramCacheKey = m.customProgramCacheKey;
  twin.name = `pin:${m.name}`;
  return twin;
}

/**
 * An object with `material` and the geometry of `o`, of the kind the program
 * depends on (instanced, points, sprite, else a mesh); a subclass's own
 * constructor is not run
 */
function twinObject(o: Object3D, material: ShaderMaterial): Object3D {
  const kind = o as Partial<Record<'isInstancedMesh' | 'isSprite' | 'isPoints', boolean>> & { geometry?: BufferGeometry };
  if (kind.isInstancedMesh) return new InstancedMesh(kind.geometry, material, 1);
  if (kind.isSprite) return new Sprite(material as unknown as SpriteMaterial);
  if (kind.isPoints) return new Points(kind.geometry, material);
  return new Mesh(kind.geometry, material);
}
