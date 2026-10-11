/**
 * war3map.w3i: map info. Versions 18 (Reign of Chaos), 25 (The Frozen
 * Throne), 28 (1.31: game version, script language) and 31 (1.32+: modes,
 * game data version, enemy masks per player). Later versions are read like
 * 31 as far as the fields the importer needs (they come before the player
 * list's extensions).
 *
 * The whole file is read: header, players, forces, then the upgrade and
 * tech availability and the random unit and item tables. The importer keeps
 * the fields it uses and the tables' sizes; `trailing` counts bytes past the
 * known layout (0 for a file read to its end). Tables that do not read (a
 * protector's junk, an optimiser that cut them off) leave `tablesRead` false
 * and the rest intact; forces that do not read are left empty.
 */

import { BinaryReader, W3xFormatError } from '../binary-reader';
import { type WtsTable, resolveTrigStr } from './wts';

export interface W3iPlayer {
  id: number;
  /** 1 human, 2 computer, 3 neutral, 4 rescuable */
  type: number;
  race: number;
  name: string;
  startX: number;
  startY: number;
}

export interface W3iInfo {
  version: number;
  /** Major, minor, patch, build (v28+), else null */
  gameVersion: [number, number, number, number] | null;
  name: string;
  author: string;
  description: string;
  /** Camera bounds as four corner points x0,y0 .. x3,y3 */
  cameraBounds: number[];
  /** Tiles outside the playable area: left, right, bottom, top */
  margins: [number, number, number, number];
  playableWidth: number;
  playableHeight: number;
  flags: number;
  /** Tileset letter: A Ashenvale, L Lordaeron Summer, X Dalaran ... */
  tileset: string;
  /** 0 none, 1 linear, 2 exponential (v25+), else null */
  fogStyle: number | null;
  fogStart: number;
  fogEnd: number;
  fogDensity: number;
  /** RGBA */
  fogColor: [number, number, number, number];
  weather: string;
  lightEnvironment: string;
  waterTint: [number, number, number, number];
  /** 0 JASS, 1 Lua (v28+) */
  scriptLanguage: number;
  /** Supported modes and game data version (v31+), else null */
  supportedModes: number | null;
  gameDataVersion: number | null;
  players: W3iPlayer[];
  forces: W3iForce[];
  /** Entries of the upgrade and tech availability and the random unit and item tables */
  upgrades: number;
  techs: number;
  randomUnitTables: number;
  randomItemTables: number;
  /** The tables after the forces read as the layout says */
  tablesRead: boolean;
  /** Bytes past the known layout */
  trailing: number;
}

export interface W3iForce {
  name: string;
  /** 1 allied, 2 allied victory, 4 shared vision, 16 shared unit control, 32 shared advanced control */
  flags: number;
  /** Bit per player id */
  players: number;
}

/** Most entries of one table; more is a damaged or hostile file */
const MAX_ENTRIES = 100000;

function count(r: BinaryReader, what: string): number {
  const n = r.i32();
  if (n < 0 || n > MAX_ENTRIES) throw new W3xFormatError(`war3map.w3i: bad ${what} count ${n}`);
  return n;
}

export function parseW3i(bytes: Uint8Array, strings: WtsTable | null = null): W3iInfo {
  const r = new BinaryReader(bytes, 'war3map.w3i');
  const version = r.i32();
  if (version !== 18 && version < 25) throw new W3xFormatError(`war3map.w3i: unsupported version ${version}`);
  const str = (): string => resolveTrigStr(r.cstr(), strings);
  r.i32(); // saves
  r.i32(); // editor version
  const gameVersion: W3iInfo['gameVersion'] = version >= 28 ? [r.i32(), r.i32(), r.i32(), r.i32()] : null;
  const name = str();
  const author = str();
  const description = str();
  str(); // suggested players
  const cameraBounds = Array.from({ length: 8 }, () => r.f32());
  const margins: W3iInfo['margins'] = [r.i32(), r.i32(), r.i32(), r.i32()];
  const playableWidth = r.i32();
  const playableHeight = r.i32();
  const flags = r.u32();
  const tileset = String.fromCharCode(r.u8());

  const info: W3iInfo = {
    version,
    gameVersion,
    name,
    author,
    description,
    cameraBounds,
    margins,
    playableWidth,
    playableHeight,
    flags,
    tileset,
    fogStyle: null,
    fogStart: 0,
    fogEnd: 0,
    fogDensity: 0,
    fogColor: [0, 0, 0, 255],
    weather: '',
    lightEnvironment: '',
    waterTint: [255, 255, 255, 255],
    scriptLanguage: 0,
    supportedModes: null,
    gameDataVersion: null,
    players: [],
    forces: [],
    upgrades: 0,
    techs: 0,
    randomUnitTables: 0,
    randomItemTables: 0,
    tablesRead: false,
    trailing: 0,
  };

  if (version === 18) {
    r.i32(); // campaign background
    str(); // loading text, title, subtitle
    str();
    str();
    r.i32(); // loading screen index
    str(); // prologue text, title, subtitle
    str();
    str();
  } else {
    r.i32(); // loading screen background
    r.cstr(); // loading screen model
    str(); // loading text, title, subtitle
    str();
    str();
    r.i32(); // game data set
    r.cstr(); // prologue path
    str(); // prologue text, title, subtitle
    str();
    str();
    info.fogStyle = r.i32();
    info.fogStart = r.f32();
    info.fogEnd = r.f32();
    info.fogDensity = r.f32();
    info.fogColor = [r.u8(), r.u8(), r.u8(), r.u8()];
    const weather = r.slice(4);
    info.weather = weather.every((b) => b === 0) ? '' : String.fromCharCode(...weather);
    r.cstr(); // sound environment
    const light = r.u8();
    info.lightEnvironment = light ? String.fromCharCode(light) : '';
    info.waterTint = [r.u8(), r.u8(), r.u8(), r.u8()];
    if (version >= 28) info.scriptLanguage = r.i32();
    if (version >= 31) {
      info.supportedModes = r.i32();
      info.gameDataVersion = r.i32();
    }
  }

  const playerCount = r.i32();
  if (playerCount < 0 || playerCount > 64) throw new W3xFormatError(`war3map.w3i: bad player count ${playerCount}`);
  for (let i = 0; i < playerCount; i++) {
    const id = r.i32();
    const type = r.i32();
    const race = r.i32();
    r.i32(); // fixed start position
    const playerName = str();
    const startX = r.f32();
    const startY = r.f32();
    r.u32(); // ally priorities low / high
    r.u32();
    if (version >= 31) {
      r.u32(); // enemy priorities low / high
      r.u32();
    }
    info.players.push({ id, type, race, name: playerName, startX, startY });
  }

  // Older and protected maps may end here or carry junk (optimisers cut the tables off); what came before stays
  const forcesAt = r.pos;
  try {
    if (r.left >= 4) {
      const forces = count(r, 'force');
      for (let i = 0; i < forces; i++) {
        const flags = r.u32();
        const players = r.u32();
        info.forces.push({ flags, players, name: str() });
      }
    }
  } catch {
    r.pos = forcesAt;
    info.forces = [];
  }
  const tablesAt = r.pos;
  try {
    readTables(r, info);
    info.tablesRead = true;
  } catch {
    r.pos = tablesAt;
    info.upgrades = info.techs = info.randomUnitTables = info.randomItemTables = 0;
  }
  info.trailing = r.left;
  return info;
}

/** Upgrade and tech availability, random unit tables, random item tables (v25+) */
function readTables(r: BinaryReader, info: W3iInfo): void {
  if (r.left === 0) return;
  if (r.left < 4) throw new W3xFormatError('war3map.w3i: tables cut off');
  info.upgrades = count(r, 'upgrade');
  r.skip(info.upgrades * 16); // player flags, id, level, availability
  info.techs = count(r, 'tech');
  r.skip(info.techs * 8); // player flags, id
  info.randomUnitTables = count(r, 'random unit table');
  for (let i = 0; i < info.randomUnitTables; i++) {
    r.i32(); // number
    r.cstr(); // name
    const positions = count(r, 'position');
    r.skip(positions * 4); // column types
    const lines = count(r, 'line');
    r.skip(lines * (4 + positions * 4)); // chance, a unit id per position
  }
  if (info.version < 25 || r.left === 0) return;
  info.randomItemTables = count(r, 'random item table');
  for (let i = 0; i < info.randomItemTables; i++) {
    r.i32(); // number
    r.cstr(); // name
    const sets = count(r, 'item set');
    for (let s = 0; s < sets; s++) r.skip(count(r, 'item') * 8); // chance, item id
  }
}

/** True when the map was saved by 1.32 or later (Reforged layouts with skin ids) */
export function isReforged(info: W3iInfo | null): boolean {
  const v = info?.gameVersion;
  return !!v && (v[0] > 1 || (v[0] === 1 && v[1] >= 32));
}
