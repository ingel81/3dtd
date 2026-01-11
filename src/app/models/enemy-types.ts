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
  runAnimation?: string; // Alternative zur Walk-Animation (Variation)
  deathAnimation?: string;
  animationSpeed?: number;
  animationVariation?: boolean; // Wechselt zwischen Walk und Run Animation

  // Audio (Spatial)
  movingSound?: string; // Loop-Sound während Bewegung (Asset-Pfad)
  movingSoundVolume?: number; // 0.0 - 1.0
  movingSoundRefDistance?: number; // Distanz für volle Lautstärke (default: 30m)

  // Random Sound (statt Loop)
  randomSound?: string; // Sound der random abgespielt wird
  randomSoundMinInterval?: number; // Min. Zeit zwischen Sounds (ms)
  randomSoundMaxInterval?: number; // Max. Zeit zwischen Sounds (ms)
  randomSoundVolumeMin?: number; // Min. Lautstärke (0.0 - 1.0)
  randomSoundVolumeMax?: number; // Max. Lautstärke (0.0 - 1.0)
  randomSoundRefDistance?: number; // Distanz für volle Lautstärke

  // Spawn Sound (einmalig beim Spawn)
  spawnSound?: string; // Sound beim Spawn
  spawnSoundVolume?: number; // Lautstärke (0.0 - 1.0)
  spawnSoundRefDistance?: number; // Distanz für volle Lautstärke

  // Visual
  heightOffset: number; // Model-Höhe über Boden
  healthBarOffset: number; // Health-Bar Höhe über Model
  canBleed: boolean; // Ob Bluteffekte angezeigt werden
  headingOffset?: number; // Rotations-Offset in Radians (Model-Ausrichtung korrigieren)
  emissiveIntensity?: number; // Leuchteffekt-Stärke (0 = aus, 0.1-0.5 = subtil, 1+ = stark)
  emissiveColor?: string; // Leuchtfarbe als Hex (default: '#ffffff')
  unlit?: boolean; // Keine Beleuchtung - zeigt Originalfarben (für Cartoon-Modelle)

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
    modelUrl: '/assets/models/enemies/zombie_01.glb',
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
    modelUrl: '/assets/models/enemies/tank.glb',
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

  wallsmasher: {
    id: 'wallsmasher',
    name: 'Wallsmasher',
    modelUrl: '/assets/models/enemies/wallsmasher_01.fbx',
    scale: 0.05,
    minimumPixelSize: 0,
    baseHp: 500,
    baseSpeed: 7,
    damage: 30,
    reward: 20,
    hasAnimations: true,
    walkAnimation: 'CharacterArmature|Walk',
    runAnimation: 'CharacterArmature|Run',
    deathAnimation: 'CharacterArmature|Death',
    animationSpeed: 1.5,
    animationVariation: true,
    // Spawn Sound
    spawnSound: '/assets/sounds/big_arm_spawn.mp3',
    spawnSoundVolume: 0.7,
    spawnSoundRefDistance: 40,
    // Random Sound während Bewegung
    randomSound: '/assets/sounds/big_arm_01.mp3',
    randomSoundMinInterval: 8000,
    randomSoundMaxInterval: 25000,
    randomSoundVolumeMin: 0.2,
    randomSoundVolumeMax: 0.6,
    randomSoundRefDistance: 35,
    heightOffset: 0,
    healthBarOffset: 12,
    canBleed: true,
    headingOffset: 0,
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 500,
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
