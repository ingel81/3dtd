'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { UPDATE_INFORMATION, elfSections, withUpdateInformation } = require('../scripts/appimage-tools');

/** A minimal 64-bit ELF file with a section name table and an update information section of `size` bytes */
function fakeRuntime(size = 64) {
  const names = Buffer.from('\0.shstrtab\0.upd_info\0', 'latin1');
  const namesAt = 64;
  const updAt = 128;
  const headersAt = updAt + size;
  const elf = Buffer.alloc(headersAt + 3 * 64);
  elf.writeUInt32BE(0x7f454c46, 0);
  elf[4] = 2; // 64-bit
  elf[5] = 1; // little-endian
  elf.writeBigUInt64LE(BigInt(headersAt), 0x28);
  elf.writeUInt16LE(64, 0x3a);
  elf.writeUInt16LE(3, 0x3c);
  elf.writeUInt16LE(1, 0x3e);
  names.copy(elf, namesAt);
  elf.fill(0xaa, updAt, updAt + size); // something old in the section
  const header = (i, nameAt, offset, length) => {
    const at = headersAt + i * 64;
    elf.writeUInt32LE(nameAt, at);
    elf.writeBigUInt64LE(BigInt(offset), at + 0x18);
    elf.writeBigUInt64LE(BigInt(length), at + 0x20);
  };
  header(1, 1, namesAt, names.length);
  header(2, 11, updAt, size);
  return { elf, updAt, size };
}

describe('appimage-tools', () => {
  it('finds the sections by name', () => {
    const { elf, updAt, size } = fakeRuntime();
    assert.deepEqual(elfSections(elf).find((s) => s.name === '.upd_info'), { name: '.upd_info', offset: updAt, size });
  });

  it('writes the update information into its section, zero-terminated, and leaves the rest of the file', () => {
    const { elf, updAt, size } = fakeRuntime();
    const out = withUpdateInformation(elf, 'gh-releases-zsync|a|b|latest|x.zsync');
    assert.equal(out.length, elf.length);
    assert.equal(out.toString('utf8', updAt, out.indexOf(0, updAt)), 'gh-releases-zsync|a|b|latest|x.zsync');
    assert.ok(out.subarray(updAt + 36, updAt + size).every((b) => b === 0));
    assert.deepEqual(out.subarray(0, updAt), elf.subarray(0, updAt));
    assert.deepEqual(out.subarray(updAt + size), elf.subarray(updAt + size));
    // The input stays as it was
    assert.equal(elf[updAt], 0xaa);
  });

  it('refuses a line that does not fit, a runtime without the section, and a file that is no ELF', () => {
    assert.throws(() => withUpdateInformation(fakeRuntime(16).elf, 'x'.repeat(16)), /does not fit/);
    const { elf } = fakeRuntime();
    elf.write('.upd_inf0', 64 + 11, 'latin1');
    assert.throws(() => withUpdateInformation(elf, 'x'), /no \.upd_info section/);
    assert.throws(() => withUpdateInformation(Buffer.alloc(64), 'x'), /not a 64-bit/);
  });

  it('points AppImageUpdate at the versioned .zsync of the latest release', () => {
    assert.equal(UPDATE_INFORMATION, 'gh-releases-zsync|ingel81|3dtd|latest|3DTD-*x86_64.AppImage.zsync');
    // The real runtime reserves 1024 bytes
    assert.ok(Buffer.byteLength(UPDATE_INFORMATION) < 1024);
  });
});
