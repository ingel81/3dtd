import {
  Color,
  CubeCamera,
  Mesh,
  NearestFilter,
  NoColorSpace,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
  Material,
} from 'three';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { losPerf } from '../utils/los-perf';

/**
 * TowerShadowMapper — rendert eine Tiefen-Cubemap vom Tower-Tip aus.
 *
 * Single source of truth für GPU-LOS: jede Cell sampled die Cubemap am
 * `direction(towerTip → cell)`-Vektor und vergleicht die gepackte
 * Distanz mit der eigenen Distanz zum Tower.
 *
 * Alle 10 Lessons aus dem Handover (docs/HANDOVER_ROUTE_GRID_GPU_LOS.md)
 * sind hier umgesetzt:
 *   1.  Custom ShaderMaterial mit `packDepthToRGBA`, KEIN MeshDistanceMaterial.
 *   2.  USE_INSTANCING + USE_BATCHING im Vertex-Shader.
 *   3.  `<batching_pars_vertex>` + `<batching_vertex>` für 3DTilesRendererJS-BatchedMesh.
 *   4.  scene.overrideMaterial reicht für 3DTiles NICHT — Mesh-Material +
 *       onBeforeRender werden pro Render geswapped, hart-reset des Distance-
 *       Material-State.
 *   5.  WebGLCubeRenderTarget: NearestFilter (kein bilineares Mixing von
 *       packed-depth-Bytes).
 *   6.  WebGLCubeRenderTarget: colorSpace=NoColorSpace.
 *   7.  Renderer-ClearColor wird auf (0,0,0,0) gesetzt und nach dem Render
 *       wiederhergestellt.
 *   8.  `includeOnly: Object3D` — alle Scene-Children außer dieser eine Group
 *       werden für den Cube-Render unsichtbar gemacht.
 *   9.  Move-Gate: Cubemap wird nur neu gerendert wenn Tower-Tip > threshold
 *       bewegt oder `invalidate()` aufgerufen wurde.
 *   10. textureCube(map, worldDir) ohne X-Flip — kein flipEnvMap für
 *       CubeRenderTarget.
 *   11. scene.background / scene.environment save/restore. Three.js
 *       rendert Background-Texturen unabhängig vom child.visible-Filter
 *       und ohne overrideMaterial — Skybox-RGBA-Bytes leaken sonst als
 *       false-Blocker in jede Cubemap-Face.
 */
export class TowerShadowMapper {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;

  private readonly renderTarget: WebGLCubeRenderTarget;
  private readonly cubeCamera: CubeCamera;
  private readonly distanceMaterial: ShaderMaterial;

  /** Letzter Tower-Tip in World-Space — als Referenz für Probe-Lookups. */
  private readonly referencePos = new Vector3();
  /** Tip, mit dem zuletzt tatsächlich gerendert wurde (Move-Gate). */
  private readonly lastRenderedTip = new Vector3();
  private hasRendered = false;
  private invalidated = true;
  private lastEncodedFar = 1;

  /** Backup-Slots für ClearColor save/restore (Lesson 7). */
  private readonly prevClearColor = new Color();

  // Lazy-allocated Debug-Resources für face → ImageData Visualisierung.
  // Aufgebaut bei erstem `getFaceImageData`-Call, danach wiederverwendet.
  private debugFaceRT: WebGLRenderTarget | null = null;
  private debugFaceMaterial: ShaderMaterial | null = null;
  private debugFaceQuad: Mesh | null = null;
  private debugFaceScene: Scene | null = null;
  private debugFaceCamera: OrthographicCamera | null = null;
  // Pro-Face Cache: separater Uint8Array+ImageData, sodass mehrere Faces
  // gleichzeitig gelesen werden können ohne dass sich die Buffer
  // überschreiben.
  private debugFaceCaches: Array<{ buf: Uint8Array; img: ImageData; renderVersion: number }> | null = null;

  /**
   * Inkrement pro erfolgreichem `update()`-Render — Konsumenten (z.B. das
   * LOS-Debug-Panel) prüfen `getRenderVersion()` um zu erkennen ob ihre
   * gecachte Face-ImageData stale ist.
   */
  private renderVersion = 0;

  constructor(renderer: WebGLRenderer, scene: Scene) {
    this.renderer = renderer;
    this.scene = scene;

    const size = LOS_VIZ_CONFIG.cubeSize;
    this.renderTarget = new WebGLCubeRenderTarget(size, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,        // Lesson 3 — kein bilineares Pack-Mixing
      magFilter: NearestFilter,
      generateMipmaps: false,
      colorSpace: NoColorSpace,        // Lesson 4 — kein sRGB-Roundtrip
    });

    // near=0.1 fängt Self-Hits ab; far wird pro update() gesetzt.
    this.cubeCamera = new CubeCamera(0.1, 1, this.renderTarget);

    this.distanceMaterial = this.createDistanceMaterial();
  }

  /**
   * Custom ShaderMaterial: packt `length(worldPos - tip) / far` als RGBA.
   *
   *  - USE_INSTANCING / USE_BATCHING werden vom Renderer pro Renderable
   *    automatisch definiert; der Vertex-Shader honoriert beides.
   *  - logdepthbuf-Chunks für korrekte Depth bei `logarithmicDepthBuffer`.
   */
  private createDistanceMaterial(): ShaderMaterial {
    const vertex = /* glsl */ `
      varying vec3 vWorldPosition;
      #include <common>
      #include <batching_pars_vertex>
      #include <logdepthbuf_pars_vertex>

      void main() {
        #include <batching_vertex>

        vec4 localPos = vec4(position, 1.0);
        #ifdef USE_BATCHING
          localPos = batchingMatrix * localPos;
        #endif
        #ifdef USE_INSTANCING
          localPos = instanceMatrix * localPos;
        #endif

        vec4 worldPos = modelMatrix * localPos;
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
        #include <logdepthbuf_vertex>
      }
    `;

    const fragment = /* glsl */ `
      precision highp float;
      #include <common>
      #include <packing>
      #include <logdepthbuf_pars_fragment>

      varying vec3 vWorldPosition;
      uniform vec3 uReferencePosition;
      uniform float uFarDistance;

      void main() {
        #include <logdepthbuf_fragment>
        float dist = length(vWorldPosition - uReferencePosition);
        float encoded = clamp(dist / uFarDistance, 0.0, 1.0);
        gl_FragColor = packDepthToRGBA(encoded);
      }
    `;

    return new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uReferencePosition: { value: new Vector3() },
        uFarDistance: { value: 1 },
      },
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: 0, // FrontSide — Backfaces sind okay zu droppen, sind keine Blocker
    });
  }

  /**
   * Update der Cubemap. Macht den Render nur wenn der Tip > Threshold
   * bewegt wurde oder `invalidate()` aufgerufen wurde.
   *
   * @param tip Tower-Tip in World-Space
   * @param range Tower-Reichweite (= far der Cubemap, kein Padding)
   * @param includeOnly Group die als einziges sichtbar bleibt während
   *        des Renders (typisch tilesRenderer.group). Lesson 8.
   * @returns true wenn neu gerendert wurde, false wenn gegated.
   */
  update(tip: Vector3, range: number, includeOnly: Object3D): boolean {
    const moved =
      !this.hasRendered ||
      this.invalidated ||
      this.lastRenderedTip.distanceTo(tip) > LOS_VIZ_CONFIG.cubeUpdateMoveThreshold;

    this.referencePos.copy(tip);

    if (!moved) return false;

    const tUpdateStart = performance.now();

    this.cubeCamera.position.copy(tip);
    this.cubeCamera.updateMatrixWorld();
    // CubeCamera's 6 face cameras are PerspectiveCameras; aktualisiere far
    // pro Face.
    for (const face of this.cubeCamera.children) {
      if (face instanceof PerspectiveCamera) {
        face.far = range;
        face.updateProjectionMatrix();
      }
    }

    this.distanceMaterial.uniforms['uReferencePosition'].value.copy(tip);
    this.distanceMaterial.uniforms['uFarDistance'].value = range;
    // Lesson 2 — Material-State hart resetten, falls ein Plugin zuvor
    // transparent/opacity mutiert hat.
    this.distanceMaterial.transparent = false;
    this.distanceMaterial.opacity = 1;
    this.distanceMaterial.depthWrite = true;
    this.distanceMaterial.depthTest = true;
    this.distanceMaterial.needsUpdate = true;

    // Lesson 8 — alle Scene-Children außer `includeOnly` für den Render
    // unsichtbar machen.
    const hiddenSiblings: Object3D[] = [];
    for (const child of this.scene.children) {
      if (child === includeOnly) continue;
      if (!child.visible) continue;
      child.visible = false;
      hiddenSiblings.push(child);
    }

    // Lesson 4 — Mesh-Material + onBeforeRender pro Render swappen.
    interface MeshBackup {
      mesh: Mesh;
      material: Material | Material[];
      onBeforeRender: Mesh['onBeforeRender'];
    }
    const meshBackup: MeshBackup[] = [];
    const noop: Mesh['onBeforeRender'] = () => {
      /* neutralisiert Plugin-Mutations am Override-Material (Lesson 2). */
    };
    const tTraverseStart = performance.now();
    includeOnly.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      meshBackup.push({
        mesh: obj,
        material: obj.material,
        onBeforeRender: obj.onBeforeRender,
      });
      obj.material = this.distanceMaterial;
      obj.onBeforeRender = noop;
    });
    losPerf.sample('cube/traverse', performance.now() - tTraverseStart, meshBackup.length);

    // Lesson 7 — ClearColor save/restore.
    this.renderer.getClearColor(this.prevClearColor);
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    // Lesson 11 — scene.background / scene.environment save/restore.
    // Three.js rendert beide UNABHÄNGIG vom child.visible-Filter (Lesson 8)
    // und der overrideMaterial / per-Mesh-Material-Swap (Lesson 4) wird
    // auf den Background NICHT angewendet. Eine Equirectangular-Skybox-
    // Texture wandert ihre RGBA-Bytes also direkt in jedes Cube-Face —
    // unpackRGBAToDepth auf eine blau-weiße Wolke (z.B. RGB=(140,180,200))
    // ergibt depth ≈ 0.55, was bei far=40m als 22m-"Wolken-Blocker"
    // erscheint. Auf null setzen während des Renders, dann restoren.
    const prevBackground = this.scene.background;
    const prevEnvironment = this.scene.environment;
    this.scene.background = null;
    this.scene.environment = null;

    const tRenderStart = performance.now();
    try {
      this.cubeCamera.update(this.renderer, this.scene);
    } finally {
      losPerf.sample('cube/render', performance.now() - tRenderStart);
      this.renderer.setClearColor(this.prevClearColor, prevClearAlpha);
      this.scene.background = prevBackground;
      this.scene.environment = prevEnvironment;
      const tRestoreStart = performance.now();
      for (const entry of meshBackup) {
        entry.mesh.material = entry.material;
        entry.mesh.onBeforeRender = entry.onBeforeRender;
      }
      for (const obj of hiddenSiblings) obj.visible = true;
      losPerf.sample('cube/restore', performance.now() - tRestoreStart);
    }

    this.lastRenderedTip.copy(tip);
    this.lastEncodedFar = range;
    this.hasRendered = true;
    this.invalidated = false;
    this.renderVersion++;
    losPerf.sample('cube/total', performance.now() - tUpdateStart);
    return true;
  }

  /** Inkrement-Counter pro erfolgreichem Render. Stale-Detection für Konsumenten. */
  getRenderVersion(): number {
    return this.renderVersion;
  }

  /**
   * Erzwingt einen Re-Render beim nächsten `update()`-Call — z.B. nach
   * Tile-Streaming-Event, wenn neue Tiles geladen wurden.
   */
  invalidate(): void {
    this.invalidated = true;
  }

  /** Die Cubemap-Textur für Cell-Shader-Lookups. */
  getRenderTarget(): WebGLCubeRenderTarget {
    return this.renderTarget;
  }

  /** Position mit der die Cubemap zuletzt gerendert wurde. */
  getReferencePos(): Readonly<Vector3> {
    return this.lastRenderedTip;
  }

  /** Far-Distance mit der die Cubemap zuletzt gerendert wurde. */
  getFarDistance(): number {
    return this.lastEncodedFar;
  }

  /** Renderer-Referenz für CPU-Readback-Konsumenten (GPU-Cube-Resolve). */
  getRenderer(): WebGLRenderer {
    return this.renderer;
  }

  /** True, wenn `update()` mindestens einmal real gerendert hat. */
  isReady(): boolean {
    return this.hasRendered;
  }

  /**
   * Rendert ein einzelnes Cubemap-Face per Quad-Shader und liest die
   * Pixel als ImageData zurück — für das LOS-Debug-Panel.
   *
   * Das Face wird per `textureCube` mit der Pixel-Mitten-Direction gesampelt
   * (gleiche Konvention wie der Live-Cell-Shader), das gepackte Distance-
   * Tupel wird via `unpackRGBAToDepth` zu einem Float zurückgewandelt und
   * dann auf die R/G/B-Kanäle der ImageData verteilt:
   *   - R = round(depth * 255)        // raw distance encoding (für Lookup)
   *   - G = round(depth * 255)        // Graustufe für visuelle Anzeige
   *   - B = (Blocker im Range? gelb : grau) — optisches Hint für ferne
   *     Geometrie. Schwarz = nah am Tip. Weiß = far oder leer.
   *
   * Performance: 1 Fullscreen-Quad pro Face + readPixels. ~1-2ms bei
   * 512² je Face. Vor dem Re-Render ist `getRenderTarget()` der bereits
   * generierte Cube — kein zusätzlicher Tile-Render.
   */
  getFaceImageData(face: number): ImageData | null {
    if (!this.hasRendered) return null;
    if (face < 0 || face > 5) return null;
    const size = this.renderTarget.width;
    this.ensureDebugResources(size);

    const cache = this.debugFaceCaches![face];
    if (cache.renderVersion === this.renderVersion) {
      // Cubemap-Version hat sich nicht geändert — gecachte ImageData
      // ist gültig. Spart die Quad-Render + readPixels-Kosten (~1 MB).
      return cache.img;
    }

    const mat = this.debugFaceMaterial!;
    mat.uniforms['uCubeMap'].value = this.renderTarget.texture;
    mat.uniforms['uFace'].value = face;

    const prevRT = this.renderer.getRenderTarget();
    this.renderer.getClearColor(this.prevClearColor);
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(this.debugFaceRT);
    try {
      this.renderer.clear();
      this.renderer.render(this.debugFaceScene!, this.debugFaceCamera!);
    } finally {
      this.renderer.setRenderTarget(prevRT);
      this.renderer.setClearColor(this.prevClearColor, prevClearAlpha);
    }

    this.renderer.readRenderTargetPixels(this.debugFaceRT!, 0, 0, size, size, cache.buf);
    cache.renderVersion = this.renderVersion;
    return cache.img;
  }

  private ensureDebugResources(size: number): void {
    if (this.debugFaceRT && this.debugFaceRT.width === size) return;
    this.disposeDebugResources();

    this.debugFaceRT = new WebGLRenderTarget(size, size, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      colorSpace: NoColorSpace,
    });

    // Vertex-Shader: passt das Quad in NDC ein und gibt UV durch.
    const vertex = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;
    // Fragment-Shader: rekonstruiert die Face-Direction aus uv + uFace,
    // sampelt textureCube, unpackt Distance, encoded R=depth8 + G=depth8 +
    // B=Range-Hint. Pixel-Mitten-Direction via (uv*2-1) — identisch zur
    // CPU-Math in los-debug-pixel-math.ts.
    const fragment = /* glsl */ `
      precision highp float;
      #include <common>
      #include <packing>
      uniform samplerCube uCubeMap;
      uniform int uFace;
      varying vec2 vUv;

      vec3 faceDir(int face, vec2 uv01) {
        float s = uv01.x * 2.0 - 1.0;
        float t = uv01.y * 2.0 - 1.0;
        if (face == 0) return normalize(vec3( 1.0, -t, -s));
        if (face == 1) return normalize(vec3(-1.0, -t,  s));
        if (face == 2) return normalize(vec3( s,  1.0,  t));
        if (face == 3) return normalize(vec3( s, -1.0, -t));
        if (face == 4) return normalize(vec3( s, -t,  1.0));
        return normalize(vec3(-s, -t, -1.0));
      }

      void main() {
        vec3 dir = faceDir(uFace, vUv);
        float depth = unpackRGBAToDepth(textureCube(uCubeMap, dir));
        float gray = depth;
        // "Real-Blocker" Hint: deutlich unter 1.0 → blau-tönen,
        // sonst neutral grau. Hilft beim schnellen Erkennen wo
        // Geometrie sitzt.
        float blockerHint = depth < 0.99 ? 1.0 - depth : 0.0;
        gl_FragColor = vec4(depth, gray, blockerHint * 0.7, 1.0);
      }
    `;

    this.debugFaceMaterial = new ShaderMaterial({
      uniforms: {
        uCubeMap: { value: this.renderTarget.texture },
        uFace:    { value: 0 },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });

    this.debugFaceQuad = new Mesh(new PlaneGeometry(2, 2), this.debugFaceMaterial);
    this.debugFaceScene = new Scene();
    this.debugFaceScene.add(this.debugFaceQuad);
    this.debugFaceCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Pro Face einen eigenen Backing-Buffer, sodass mehrere Faces im
    // selben Frame parallel gelesen werden können (alle 6 sind sichtbar
    // im Panel). ImageData teilt sich den Buffer mit dem Uint8Array
    // damit readPixels in-place schreibt.
    this.debugFaceCaches = new Array(6);
    for (let i = 0; i < 6; i++) {
      const buf = new Uint8Array(size * size * 4);
      const clamped = new Uint8ClampedArray(buf.buffer);
      const img = new ImageData(clamped, size, size);
      this.debugFaceCaches[i] = { buf, img, renderVersion: -1 };
    }
  }

  private disposeDebugResources(): void {
    if (this.debugFaceQuad) {
      (this.debugFaceQuad.geometry as PlaneGeometry).dispose();
      this.debugFaceQuad = null;
    }
    if (this.debugFaceMaterial) {
      this.debugFaceMaterial.dispose();
      this.debugFaceMaterial = null;
    }
    if (this.debugFaceRT) {
      this.debugFaceRT.dispose();
      this.debugFaceRT = null;
    }
    this.debugFaceScene = null;
    this.debugFaceCamera = null;
    this.debugFaceCaches = null;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.distanceMaterial.dispose();
    this.disposeDebugResources();
  }
}
