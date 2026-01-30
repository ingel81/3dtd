import { AudioListener, Object3D, PositionalAudio, Scene, Vector3 } from 'three';

/** Reusable Vector3 for panner updates (avoid GC pressure) */
const _pannerVec3 = new Vector3();

/**
 * Manages PositionalAudio object lifecycle: creation, cleanup, and panner updates.
 *
 * NOTE: PositionalAudio pooling is DISABLED because Three.js Audio objects
 * don't properly support reuse after play/stop cycles. The internal WebAudio
 * node connections can get into inconsistent states.
 * We always create fresh objects and properly disconnect+cleanup when done.
 */
export class AudioPoolManager {
  private listener: AudioListener;
  private scene: Scene;

  constructor(listener: AudioListener, scene: Scene) {
    this.listener = listener;
    this.scene = scene;
  }

  /**
   * Create a fresh PositionalAudio object.
   */
  createAudio(): PositionalAudio {
    return new PositionalAudio(this.listener);
  }

  /**
   * Clean up a PositionalAudio object after use.
   * Stops playback, detaches from parent, and disconnects WebAudio nodes.
   */
  cleanupAudio(audio: PositionalAudio): void {
    if (audio.isPlaying) {
      audio.stop();
    }
    if (audio.parent) {
      audio.parent.remove(audio);
    }
    audio.disconnect();
  }

  /**
   * Create a container Object3D at the given position, add audio to it,
   * add it to the scene, and force matrixWorld + panner update.
   */
  createContainerAtPosition(audio: PositionalAudio, position: Vector3): Object3D {
    const container = new Object3D();
    container.position.copy(position);
    container.add(audio);
    this.scene.add(container);

    // Force matrixWorld computation and update panner position BEFORE play()
    container.updateMatrixWorld(true);
    this.updatePannerPosition(audio);

    return container;
  }

  /**
   * Remove a container from the scene.
   */
  removeContainer(container: Object3D): void {
    this.scene.remove(container);
  }

  /**
   * Manually update panner position from audio's matrixWorld.
   *
   * Needed because PositionalAudio.updateMatrixWorld() only updates
   * the panner when isPlaying=true, but we need the correct position BEFORE play().
   */
  updatePannerPosition(audio: PositionalAudio): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panner = (audio as any).panner as PannerNode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (audio as any).context as AudioContext;

    if (!panner || !ctx) return;

    _pannerVec3.setFromMatrixPosition(audio.matrixWorld);

    panner.positionX.setValueAtTime(_pannerVec3.x, ctx.currentTime);
    panner.positionY.setValueAtTime(_pannerVec3.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(_pannerVec3.z, ctx.currentTime);
  }

  /**
   * Get the scene reference.
   */
  getScene(): Scene {
    return this.scene;
  }

  /**
   * Get the listener reference.
   */
  getListener(): AudioListener {
    return this.listener;
  }
}
