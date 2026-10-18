import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferPendingProgramDeletes } from './pending-program-deletes';

/** A context whose programs report whether they are built, and what it deleted */
function context(withExtension = true) {
  const status = new Map<object, boolean>();
  const deleted: object[] = [];
  let lost = false;
  const gl = {
    getExtension: (name: string) => (withExtension && name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: 0x91b1 } : null),
    getProgramParameter: (p: object) => status.get(p) ?? true,
    isContextLost: () => lost,
    deleteProgram: (p: object) => void deleted.push(p),
  };
  return { gl: gl as unknown as WebGL2RenderingContext, status, deleted, lose: () => (lost = true) };
}

describe('deferPendingProgramDeletes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('deletes a built program at once and one still linking once it is built', () => {
    const { gl, status, deleted } = context();
    deferPendingProgramDeletes(gl);
    const built = {};
    const linking = {};
    status.set(linking, false);
    gl.deleteProgram(built as WebGLProgram);
    gl.deleteProgram(linking as WebGLProgram);
    expect(deleted).toEqual([built]);
    vi.advanceTimersByTime(500);
    expect(deleted).toEqual([built]);
    status.set(linking, true);
    vi.advanceTimersByTime(60);
    expect(deleted).toEqual([built, linking]);
  });

  it('drops what waits when the context is lost, and does nothing without the extension', () => {
    const a = context();
    deferPendingProgramDeletes(a.gl);
    const linking = {};
    a.status.set(linking, false);
    a.gl.deleteProgram(linking as WebGLProgram);
    a.lose();
    vi.advanceTimersByTime(100);
    expect(a.deleted).toEqual([]);
    const b = context(false);
    deferPendingProgramDeletes(b.gl);
    b.status.set(linking, false);
    b.gl.deleteProgram(linking as WebGLProgram);
    expect(b.deleted).toEqual([linking]);
  });
});
