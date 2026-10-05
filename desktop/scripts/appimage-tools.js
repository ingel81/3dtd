'use strict';

/**
 * The AppImage tools electron-builder builds with, with the update
 * information written into the runtime (TODO E83). AppImageUpdate and the
 * AppImage catalog read it from the runtime's `.upd_info` section; it names
 * where the .zsync of the newest release lies. electron-builder has no option
 * for it, so the release job copies its toolset here, writes the line into
 * the runtime and points APPIMAGE_TOOLS_PATH at the copy: the AppImage comes
 * out with it, and the sha512 and the blockmap the updater checks are those of
 * the finished file.
 *
 * Linux only (the toolset links its tools); release.yml runs it.
 *
 * Usage: node scripts/appimage-tools.js <out-dir>
 */

const fs = require('node:fs');
const path = require('node:path');

/** Where AppImageUpdate looks: the .zsync of the latest GitHub release, by the versioned file's name */
const UPDATE_INFORMATION = 'gh-releases-zsync|ingel81|3dtd|latest|3DTD-*x86_64.AppImage.zsync';

/** The section the AppImage runtime reserves for the update information */
const SECTION = '.upd_info';

/** The sections of a 64-bit little-endian ELF file: name, offset and size in the file */
function elfSections(elf) {
  if (elf.readUInt32BE(0) !== 0x7f454c46 || elf[4] !== 2 || elf[5] !== 1) {
    throw new Error('not a 64-bit little-endian ELF file');
  }
  const shoff = Number(elf.readBigUInt64LE(0x28));
  const shentsize = elf.readUInt16LE(0x3a);
  const shnum = elf.readUInt16LE(0x3c);
  const shstrndx = elf.readUInt16LE(0x3e);
  const header = (i) => {
    const at = shoff + i * shentsize;
    return { nameAt: elf.readUInt32LE(at), offset: Number(elf.readBigUInt64LE(at + 0x18)), size: Number(elf.readBigUInt64LE(at + 0x20)) };
  };
  const names = header(shstrndx);
  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const { nameAt, offset, size } = header(i);
    const start = names.offset + nameAt;
    const name = elf.toString('latin1', start, elf.indexOf(0, start));
    sections.push({ name, offset, size });
  }
  return sections;
}

/** `runtime` with `text` in its update information section, the rest of the section zeroed. */
function withUpdateInformation(runtime, text) {
  const section = elfSections(runtime).find((s) => s.name === SECTION);
  if (!section) throw new Error(`the runtime has no ${SECTION} section`);
  const bytes = Buffer.from(text, 'utf8');
  // One zero byte at least: the runtime reads it as a C string
  if (bytes.length >= section.size) throw new Error(`update information of ${bytes.length} bytes does not fit ${section.size}`);
  const out = Buffer.from(runtime);
  out.fill(0, section.offset, section.offset + section.size);
  bytes.copy(out, section.offset);
  return out;
}

/** The toolset version electron-builder.config.js asks for, '0.0.0' (FUSE 2) without one */
function toolsetVersion() {
  return require('../electron-builder.config.js').toolsets?.appimage ?? '0.0.0';
}

async function main(outDir) {
  // electron-builder's own download, with its checksum; the same files the build would use
  const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux');
  const { Arch } = require('builder-util');
  const version = toolsetVersion();
  const tools = await getAppImageTools(version, Arch.x64);
  // The FUSE 2 toolset keeps its runtimes at the root, the static one under runtimes/
  const root = version === '0.0.0' ? path.dirname(tools.runtime) : path.dirname(path.dirname(tools.runtime));
  const out = path.resolve(outDir);
  fs.rmSync(out, { recursive: true, force: true });
  // The static toolset links its tools to a launcher at the root: keep the links as they are
  fs.cpSync(root, out, { recursive: true, verbatimSymlinks: true });
  const runtime = path.join(out, path.relative(root, tools.runtime));
  fs.writeFileSync(runtime, withUpdateInformation(fs.readFileSync(runtime), UPDATE_INFORMATION));
  console.log(`[appimage-tools] toolset ${version} in ${out}, update information "${UPDATE_INFORMATION}"`);
}

if (require.main === module) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('[appimage-tools] no output directory given');
    process.exit(1);
  }
  main(outDir).catch((err) => {
    console.error(`[appimage-tools] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { UPDATE_INFORMATION, elfSections, withUpdateInformation };
