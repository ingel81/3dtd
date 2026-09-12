import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeGeneratedFile } from './generated-file';

describe('writeGeneratedFile', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'generated-file-'));
    path = join(dir, 'doc.md');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes a new file with LF', () => {
    expect(writeGeneratedFile(path, 'a\r\nb\n')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('a\nb\n');
  });

  it('leaves a CRLF file alone when only the line endings differ', () => {
    writeFileSync(path, 'a\r\nb\r\n');
    expect(writeGeneratedFile(path, 'a\nb\n')).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('a\r\nb\r\n');
  });

  it('keeps CRLF when the content changes', () => {
    writeFileSync(path, 'a\r\nb\r\n');
    expect(writeGeneratedFile(path, 'a\nc\n')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('a\r\nc\r\n');
  });

  it('keeps LF when the content changes, even from mixed input', () => {
    writeFileSync(path, 'a\nb\n');
    expect(writeGeneratedFile(path, 'a\r\nc\n')).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('a\nc\n');
  });
});
