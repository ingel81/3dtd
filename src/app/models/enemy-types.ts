/**
 * Enemy Type Configuration System
 *
 * Zentrale Registry für alle Enemy-Typen.
 * Neue Typen hier hinzufügen - keine Code-Änderungen an anderen Stellen nötig.
 */

export interface EnemyTypeConfig {
  id: string;
  name: string;
  modelUrl: string;
  scale: number;
  minimumPixelSize: number;

  // Stats
  baseHp: number;
  baseSpeed: number; // m/s
  damage: number; // Schaden an Basis
  reward: number; // Credits bei Kill

  // Animation
  hasAnimations: boolean;
  idleAnimation?: string;
  walkAnimation?: string;
  deathAnimation?: string;
  animationSpeed?: number;

  // Audio (Spatial)
  movingSound?: string; // Loop-Sound während Bewegung (Asset-Pfad)
  movingSoundVolume?: number; // 0.0 - 1.0
  movingSoundRefDistance?: number; // Distanz für volle Lautstärke (default: 30m)

  // Visual
  heightOffset: number; // Model-Höhe über Boden
  healthBarOffset: number; // Health-Bar Höhe über Model
  canBleed: boolean; // Ob Bluteffekte angezeigt werden
  headingOffset?: number; // Rotations-Offset in Radians (Model-Ausrichtung korrigieren)

  // Randomness
  randomAnimationStart?: boolean; // Animation bei zufälligem Frame starten
  randomSoundStart?: boolean; // Sound bei zufälliger Position starten
  lateralOffset?: number; // Max. seitlicher Versatz in Metern (0 = keine Abweichung)

  // Spawning
  spawnStartDelay?: number; // Delay in ms zwischen Start von Enemies dieses Typs (default: 300)
}

export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: '/assets/models/zombie_alternative.glb',
    scale: 2.0,
    minimumPixelSize: 0, // 0 = echte Größe, kein Pixel-Clamping beim Zoomen
    baseHp: 100,
    baseSpeed: 5,
    damage: 10,
    reward: 1,
    hasAnimations: true,
    idleAnimation: 'Armature|Idle',
    walkAnimation: 'Armature|Walk',
    deathAnimation: 'Armature|Die',
    animationSpeed: 2.0,
    movingSound: '/assets/sounds/zombie-sound-2-357976.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 25, // Zombies sind leiser aus der Ferne
    heightOffset: 0,
    healthBarOffset: 8, // Höher über dem Kopf
    canBleed: true, // Zombies bluten
    headingOffset: 0, // Model faces backward, rotate 180°
    randomAnimationStart: true, // Animation bei zufälligem Frame starten
    randomSoundStart: true, // Sound bei zufälliger Position starten
    lateralOffset: 3.0, // Max. 3m seitlicher Versatz
  },

  tank: {
    id: 'tank',
    name: 'Panzer',
    modelUrl: '/assets/models/tank.glb',
    scale: 2.5,
    minimumPixelSize: 0, // 0 = echte Größe, kein Pixel-Clamping
    baseHp: 300, // Doppelt so viel wie Zombie
    baseSpeed: 3,
    damage: 25,
    reward: 5,
    hasAnimations: false,
    movingSound: '/assets/sounds/tank-moving-143104.mp3',
    movingSoundVolume: 0.3,
    movingSoundRefDistance: 50, // Panzer sind lauter (größerer refDistance-Bereich)
    heightOffset: 0,
    healthBarOffset: 10, // Höher über dem Panzer
    canBleed: false, // Panzer bluten nicht
    randomSoundStart: true, // Sound bei zufälliger Position starten
    lateralOffset: 2.5, // Max. 2.5m seitlicher Versatz
    spawnStartDelay: 800, // Größerer Abstand zwischen Panzern (800ms statt 300ms)
  },
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;

export function getEnemyType(id: EnemyTypeId): EnemyTypeConfig {
  const type = ENEMY_TYPES[id];
  if (!type) {
    console.warn(`Unknown enemy type: ${id}, falling back to zombie`);
    return ENEMY_TYPES['zombie'];
  }
  return type;
}

export function getAllEnemyTypes(): EnemyTypeConfig[] {
  return Object.values(ENEMY_TYPES);
}

export function getEnemyTypeIds(): EnemyTypeId[] {
  return Object.keys(ENEMY_TYPES) as EnemyTypeId[];
}
