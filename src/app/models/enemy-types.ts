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

  // Random Sounds Pool (shuffle ohne Wiederholung)
  randomSounds?: string[]; // Array von Sounds die zufällig abgespielt werden
  randomSoundsMinInterval?: number; // Min. Zeit zwischen Sounds (ms)
  randomSoundsMaxInterval?: number; // Max. Zeit zwischen Sounds (ms)
  randomSoundsVolume?: number; // Lautstärke (0.0 - 1.0)
  randomSoundsRefDistance?: number; // Distanz für volle Lautstärke

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

  // Boss / Special
  healthBarColor?: string; // Feste Healthbar-Farbe als Hex (z.B. '#ff0000' für Boss)
  bossName?: string; // Name über der Healthbar (z.B. 'Boss')
  immunityPercent?: number; // Schadensimmunität in % (0-100, wird als "Immun X%" angezeigt)

  // Randomness
  randomAnimationStart?: boolean; // Animation bei zufälligem Frame starten
  randomSoundStart?: boolean; // Sound bei zufälliger Position starten
  lateralOffset?: number; // Max. seitlicher Versatz in Metern (0 = keine Abweichung)
  heightVariation?: number; // Max. zufällige Höhenabweichung in Metern (für Wellen)

  // Air Unit
  isAirUnit?: boolean; // true = Lufteinheit, nur von Air-Towern angreifbar

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
    baseHp: 500, // Schwer gepanzert
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

  bat: {
    id: 'bat',
    name: 'Fledermaus',
    modelUrl: '/assets/models/enemies/bat.glb',
    scale: 1.5,
    minimumPixelSize: 0,
    baseHp: 80,
    baseSpeed: 8,
    damage: 5,
    reward: 3,
    hasAnimations: true,
    walkAnimation: 'BatArmature|Bat_Flying',
    deathAnimation: 'BatArmature|Bat_Death',
    animationSpeed: 1.5,
    heightOffset: 15, // 15m über Terrain
    healthBarOffset: 4,
    canBleed: false,
    isAirUnit: true, // Nur von Air-Towern angreifbar
    heightVariation: 3, // ±3m Variation zwischen Enemies
    lateralOffset: 2.0,
    randomAnimationStart: true,
  },

  herbert: {
    id: 'herbert',
    name: 'Herbert',
    modelUrl: '/assets/models/enemies/herbert_walking.glb',
    scale: 4.0,
    minimumPixelSize: 0,
    baseHp: 5000,
    baseSpeed: 4,
    damage: 20,
    reward: 8,
    hasAnimations: true,
    walkAnimation: 'Armature|walking_man|baselayer',
    animationSpeed: 1.0,
    // Spawn Sound (einmalig)
    spawnSound: '/assets/sounds/herbert_01.mp3',
    spawnSoundVolume: 0.6,
    spawnSoundRefDistance: 40,
    // Random Sounds Pool (shuffle ohne Wiederholung)
    randomSounds: [
      '/assets/sounds/herbert_02.mp3',
      '/assets/sounds/herbert_03.mp3',
      '/assets/sounds/herbert_04.mp3',
      '/assets/sounds/herbert_05.mp3',
      '/assets/sounds/herbert_06.mp3',
      '/assets/sounds/herbert_07.mp3',
      '/assets/sounds/herbert_08.mp3',
      '/assets/sounds/herbert_09.mp3',
      '/assets/sounds/herbert_10.mp3',
      '/assets/sounds/herbert_11.mp3',
      '/assets/sounds/herbert_12.mp3',
      '/assets/sounds/herbert_13.mp3',
      '/assets/sounds/herbert_14.mp3',
    ],
    randomSoundsMinInterval: 10000,
    randomSoundsMaxInterval: 25000,
    randomSoundsVolume: 0.6,
    randomSoundsRefDistance: 40,
    heightOffset: 0,
    healthBarOffset: 12,
    healthBarColor: '#ef4444', // Rote Boss-Healthbar
    bossName: 'Boss',
    immunityPercent: 100,
    canBleed: true,
    randomAnimationStart: true,
    lateralOffset: 2.0,
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
