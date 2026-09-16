import type { AnimationClip, Group } from 'three';

/** { root, animations } of a GLB file, as GLTFLoader builds them. */
export function loadGlb(path: string): Promise<{ root: Group; animations: AnimationClip[] }>;
