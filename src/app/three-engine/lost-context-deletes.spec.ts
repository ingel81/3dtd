import { describe, it, expect, vi } from 'vitest';
import { skipLostContextDeletes } from './lost-context-deletes';

/** The create and delete calls of a WebGL2 context, each object a fresh one. */
function fakeGL() {
  const make = () => vi.fn(() => ({}));
  return {
    createTexture: make(),
    deleteTexture: vi.fn(),
    createBuffer: make(),
    deleteBuffer: vi.fn(),
    createProgram: make(),
    deleteProgram: vi.fn(),
    createVertexArray: make(),
    deleteVertexArray: vi.fn(),
    createFramebuffer: make(),
    deleteFramebuffer: vi.fn(),
  };
}

function setup() {
  const fake = fakeGL();
  const { deleteTexture, deleteBuffer, deleteProgram } = fake;
  const gl = fake as unknown as WebGL2RenderingContext;
  const canvas = document.createElement('canvas');
  const loseContext = (): void => void canvas.dispatchEvent(new Event('webglcontextlost'));
  const restore = skipLostContextDeletes(gl, canvas);
  return { gl, canvas, loseContext, restore, deleteTexture, deleteBuffer, deleteProgram };
}

describe('skipLostContextDeletes', () => {
  it('deletes every object while the context was never lost', () => {
    const { gl, deleteTexture, deleteBuffer } = setup();
    const texture = gl.createTexture()!;
    const buffer = gl.createBuffer()!;

    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);

    expect(deleteTexture).toHaveBeenCalledWith(texture);
    expect(deleteBuffer).toHaveBeenCalledWith(buffer);
  });

  it('skips the objects of a lost context and deletes the ones made since', () => {
    const { gl, loseContext, deleteTexture, deleteBuffer, deleteProgram } = setup();
    const oldTexture = gl.createTexture()!;
    const oldBuffer = gl.createBuffer()!;
    const oldProgram = gl.createProgram()!;

    loseContext();
    // three's restore makes its objects again, the old ones get disposed later
    const texture = gl.createTexture()!;
    gl.deleteTexture(oldTexture);
    gl.deleteBuffer(oldBuffer);
    gl.deleteProgram(oldProgram);
    gl.deleteTexture(texture);

    expect(deleteTexture.mock.calls).toEqual([[texture]]);
    expect(deleteBuffer).not.toHaveBeenCalled();
    expect(deleteProgram).not.toHaveBeenCalled();
  });

  it('forgets the objects of each lost context', () => {
    const { gl, loseContext, deleteTexture } = setup();
    loseContext();
    const first = gl.createTexture()!;
    loseContext();
    const second = gl.createTexture()!;

    gl.deleteTexture(first);
    gl.deleteTexture(second);

    expect(deleteTexture.mock.calls).toEqual([[second]]);
  });

  it('passes a null handle through, as three may delete one', () => {
    const { gl, loseContext, deleteTexture } = setup();
    loseContext();
    gl.deleteTexture(null);
    expect(deleteTexture).toHaveBeenCalledWith(null);
  });

  it('puts the context methods back and stops listening', () => {
    const { gl, loseContext, restore, deleteTexture } = setup();
    const texture = gl.createTexture()!;
    restore();
    loseContext();

    expect(gl.deleteTexture).toBe(deleteTexture);
    gl.deleteTexture(texture);
    expect(deleteTexture).toHaveBeenCalledWith(texture);
  });
});
