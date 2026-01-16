import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Engine Test Component - Sandbox for testing Three.js features
 * Route: /engine-test
 *
 * Use this for:
 * - Particle system experiments (ShaderMaterial vs PointsMaterial)
 * - Shader development without 3D tiles interference
 * - Performance testing
 * - New effect prototyping
 */
@Component({
  selector: 'app-engine-test',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="engine-test-container">
      <div #canvasContainer class="canvas-container"></div>
      <div class="controls">
        <h2>Engine Test Sandbox</h2>

        <div class="control-group">
          <h3>Spawn Particles</h3>
          <button (click)="spawnAdditive()">Spawn Additive (Fire)</button>
          <button (click)="spawnNormal()">Spawn Normal (Smoke)</button>
          <button (click)="spawnBoth()">Spawn Both</button>
          <button (click)="clearParticles()">Clear All</button>
        </div>

        <div class="control-group">
          <h3>Material Settings</h3>
          <label>
            Additive Size: {{ additiveSize }}
            <input type="range" min="0.1" max="5" step="0.1"
                   [value]="additiveSize"
                   (input)="updateAdditiveSize($event)">
          </label>
          <label>
            Normal Size: {{ normalSize }}
            <input type="range" min="0.1" max="5" step="0.1"
                   [value]="normalSize"
                   (input)="updateNormalSize($event)">
          </label>
        </div>

        <div class="control-group">
          <h3>Shader Test</h3>
          <button (click)="toggleShaderMode()">
            {{ useShaders ? 'Using Shaders' : 'Using PointsMaterial' }}
          </button>
        </div>

        <div class="stats">
          <p>Additive particles: {{ additiveCount }}</p>
          <p>Normal particles: {{ normalCount }}</p>
          <p>FPS: {{ fps }}</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .engine-test-container {
      display: flex;
      width: 100vw;
      height: 100vh;
      background: #1a1a2e;
    }
    .canvas-container {
      flex: 1;
      position: relative;
    }
    .controls {
      width: 300px;
      padding: 20px;
      background: #16213e;
      color: white;
      overflow-y: auto;
    }
    .control-group {
      margin-bottom: 20px;
      padding: 10px;
      background: #1a1a2e;
      border-radius: 8px;
    }
    h2 { margin: 0 0 20px 0; }
    h3 { margin: 0 0 10px 0; font-size: 14px; color: #888; }
    button {
      display: block;
      width: 100%;
      padding: 10px;
      margin: 5px 0;
      background: #e94560;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover { background: #ff6b6b; }
    label {
      display: block;
      margin: 10px 0;
      font-size: 12px;
    }
    input[type="range"] {
      width: 100%;
      margin-top: 5px;
    }
    .stats {
      font-size: 12px;
      color: #888;
    }
    .stats p { margin: 5px 0; }
  `]
})
export class EngineTestComponent implements OnInit, OnDestroy {
  @ViewChild('canvasContainer', { static: true }) canvasContainer!: ElementRef;

  // Three.js objects
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private animationId = 0;

  // Particle systems
  private additiveParticles!: THREE.Points;
  private normalParticles!: THREE.Points;
  private additiveMaterial!: THREE.PointsMaterial | THREE.ShaderMaterial;
  private normalMaterial!: THREE.PointsMaterial | THREE.ShaderMaterial;

  // Particle pools
  private readonly MAX_PARTICLES = 1000;
  private additivePool: ParticleData[] = [];
  private normalPool: ParticleData[] = [];

  // UI state
  additiveSize = 2.0;
  normalSize = 2.0;
  additiveCount = 0;
  normalCount = 0;
  fps = 0;
  useShaders = false;

  private lastTime = performance.now();
  private frameCount = 0;

  ngOnInit(): void {
    this.initThree();
    this.initParticleSystems();
    this.animate();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
  }

  private initThree(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a2e);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    this.camera.position.set(0, 5, 15);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Grid helper
    const grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(grid);

    // Axes helper
    const axes = new THREE.AxesHelper(5);
    this.scene.add(axes);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
  }

  private initParticleSystems(): void {
    // Initialize pools
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.additivePool.push(this.createParticleData());
      this.normalPool.push(this.createParticleData());
    }

    this.createMaterials();
    this.createGeometries();
  }

  private createParticleData(): ParticleData {
    return {
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      color: new THREE.Color(),
      size: 1,
      life: 0,
      maxLife: 1,
    };
  }

  private createMaterials(): void {
    if (this.useShaders) {
      this.createShaderMaterials();
    } else {
      this.createPointsMaterials();
    }
  }

  private createPointsMaterials(): void {
    this.additiveMaterial = new THREE.PointsMaterial({
      size: this.additiveSize,
      transparent: true,
      opacity: 0.9,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.normalMaterial = new THREE.PointsMaterial({
      size: this.normalSize,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });
  }

  private createShaderMaterials(): void {
    const vertexShader = `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShaderAdditive = `
      varying vec3 vColor;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        gl_FragColor = vec4(vColor * alpha, alpha);
      }
    `;

    const fragmentShaderNormal = `
      varying vec3 vColor;
      void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.1, 0.5, dist);
        gl_FragColor = vec4(vColor, alpha * 0.8);
      }
    `;

    this.additiveMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderAdditive,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });

    this.normalMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: fragmentShaderNormal,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexColors: true,
    });
  }

  private createGeometries(): void {
    // Remove old particles if they exist
    if (this.additiveParticles) {
      this.scene.remove(this.additiveParticles);
      this.additiveParticles.geometry.dispose();
    }
    if (this.normalParticles) {
      this.scene.remove(this.normalParticles);
      this.normalParticles.geometry.dispose();
    }

    // Additive geometry
    const additiveGeometry = new THREE.BufferGeometry();
    const additivePositions = new Float32Array(this.MAX_PARTICLES * 3);
    const additiveColors = new Float32Array(this.MAX_PARTICLES * 3);
    const additiveSizes = new Float32Array(this.MAX_PARTICLES);

    additiveGeometry.setAttribute('position', new THREE.BufferAttribute(additivePositions, 3));
    additiveGeometry.setAttribute('color', new THREE.BufferAttribute(additiveColors, 3));
    additiveGeometry.setAttribute('size', new THREE.BufferAttribute(additiveSizes, 1));

    this.additiveParticles = new THREE.Points(additiveGeometry, this.additiveMaterial);
    this.additiveParticles.frustumCulled = false;
    this.scene.add(this.additiveParticles);

    // Normal geometry
    const normalGeometry = new THREE.BufferGeometry();
    const normalPositions = new Float32Array(this.MAX_PARTICLES * 3);
    const normalColors = new Float32Array(this.MAX_PARTICLES * 3);
    const normalSizes = new Float32Array(this.MAX_PARTICLES);

    normalGeometry.setAttribute('position', new THREE.BufferAttribute(normalPositions, 3));
    normalGeometry.setAttribute('color', new THREE.BufferAttribute(normalColors, 3));
    normalGeometry.setAttribute('size', new THREE.BufferAttribute(normalSizes, 1));

    this.normalParticles = new THREE.Points(normalGeometry, this.normalMaterial);
    this.normalParticles.frustumCulled = false;
    this.scene.add(this.normalParticles);
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const deltaTime = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // FPS counter
    this.frameCount++;
    if (this.frameCount >= 30) {
      this.fps = Math.round(30 / deltaTime / 30);
      this.frameCount = 0;
    }

    // Update particles
    this.updateParticles(this.additivePool, deltaTime);
    this.updateParticles(this.normalPool, deltaTime);

    // Update buffers
    this.updateBuffers();

    // Update controls
    this.controls.update();

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  private updateParticles(pool: ParticleData[], dt: number): void {
    for (const p of pool) {
      if (p.life <= 0) continue;

      p.position.add(p.velocity.clone().multiplyScalar(dt));
      p.velocity.y -= 2 * dt; // Gravity
      p.life -= dt / p.maxLife;
    }
  }

  private updateBuffers(): void {
    // Additive buffer
    const addPos = this.additiveParticles.geometry.attributes['position'] as THREE.BufferAttribute;
    const addCol = this.additiveParticles.geometry.attributes['color'] as THREE.BufferAttribute;
    const addSize = this.additiveParticles.geometry.attributes['size'] as THREE.BufferAttribute;

    let addCount = 0;
    for (const p of this.additivePool) {
      if (p.life > 0) {
        addPos.array[addCount * 3] = p.position.x;
        addPos.array[addCount * 3 + 1] = p.position.y;
        addPos.array[addCount * 3 + 2] = p.position.z;
        addCol.array[addCount * 3] = p.color.r;
        addCol.array[addCount * 3 + 1] = p.color.g;
        addCol.array[addCount * 3 + 2] = p.color.b;
        addSize.array[addCount] = p.size * p.life;
        addCount++;
      }
    }
    addPos.needsUpdate = true;
    addCol.needsUpdate = true;
    addSize.needsUpdate = true;
    this.additiveParticles.geometry.setDrawRange(0, addCount);
    this.additiveCount = addCount;

    // Normal buffer
    const normPos = this.normalParticles.geometry.attributes['position'] as THREE.BufferAttribute;
    const normCol = this.normalParticles.geometry.attributes['color'] as THREE.BufferAttribute;
    const normSize = this.normalParticles.geometry.attributes['size'] as THREE.BufferAttribute;

    let normCount = 0;
    for (const p of this.normalPool) {
      if (p.life > 0) {
        normPos.array[normCount * 3] = p.position.x;
        normPos.array[normCount * 3 + 1] = p.position.y;
        normPos.array[normCount * 3 + 2] = p.position.z;
        normCol.array[normCount * 3] = p.color.r;
        normCol.array[normCount * 3 + 1] = p.color.g;
        normCol.array[normCount * 3 + 2] = p.color.b;
        normSize.array[normCount] = p.size * p.life;
        normCount++;
      }
    }
    normPos.needsUpdate = true;
    normCol.needsUpdate = true;
    normSize.needsUpdate = true;
    this.normalParticles.geometry.setDrawRange(0, normCount);
    this.normalCount = normCount;
  }

  private onResize(): void {
    const container = this.canvasContainer.nativeElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // UI Actions
  spawnAdditive(): void {
    this.spawnParticles(this.additivePool, 50, {
      colorMin: { r: 1, g: 0.3, b: 0 },
      colorMax: { r: 1, g: 0.8, b: 0.2 },
      sizeMin: 0.5,
      sizeMax: 1.5,
    });
  }

  spawnNormal(): void {
    this.spawnParticles(this.normalPool, 50, {
      colorMin: { r: 0.1, g: 0.1, b: 0.1 },
      colorMax: { r: 0.3, g: 0.3, b: 0.3 },
      sizeMin: 0.8,
      sizeMax: 2.0,
    });
  }

  spawnBoth(): void {
    this.spawnAdditive();
    this.spawnNormal();
  }

  private spawnParticles(pool: ParticleData[], count: number, config: SpawnConfig): void {
    let spawned = 0;
    for (const p of pool) {
      if (p.life <= 0 && spawned < count) {
        p.position.set(
          (Math.random() - 0.5) * 2,
          0,
          (Math.random() - 0.5) * 2
        );
        p.velocity.set(
          (Math.random() - 0.5) * 5,
          5 + Math.random() * 5,
          (Math.random() - 0.5) * 5
        );
        const t = Math.random();
        p.color.setRGB(
          config.colorMin.r + t * (config.colorMax.r - config.colorMin.r),
          config.colorMin.g + t * (config.colorMax.g - config.colorMin.g),
          config.colorMin.b + t * (config.colorMax.b - config.colorMin.b)
        );
        p.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);
        p.life = 1;
        p.maxLife = 1 + Math.random() * 1;
        spawned++;
      }
    }
  }

  clearParticles(): void {
    for (const p of this.additivePool) p.life = 0;
    for (const p of this.normalPool) p.life = 0;
  }

  updateAdditiveSize(event: Event): void {
    this.additiveSize = parseFloat((event.target as HTMLInputElement).value);
    if (this.additiveMaterial instanceof THREE.PointsMaterial) {
      this.additiveMaterial.size = this.additiveSize;
    }
  }

  updateNormalSize(event: Event): void {
    this.normalSize = parseFloat((event.target as HTMLInputElement).value);
    if (this.normalMaterial instanceof THREE.PointsMaterial) {
      this.normalMaterial.size = this.normalSize;
    }
  }

  toggleShaderMode(): void {
    this.useShaders = !this.useShaders;
    this.createMaterials();
    this.createGeometries();
  }
}

interface ParticleData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  maxLife: number;
}

interface SpawnConfig {
  colorMin: { r: number; g: number; b: number };
  colorMax: { r: number; g: number; b: number };
  sizeMin: number;
  sizeMax: number;
}
