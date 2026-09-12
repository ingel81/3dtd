import { describe, it, expect, vi } from 'vitest';
import type { MatDialog } from '@angular/material/dialog';
import { lazyDialog } from './lazy-dialog';

class TestDialogComponent {}

/** A component load that finishes when the test says so. */
function deferredLoad() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const load = vi.fn(async () => {
    await done;
    return TestDialogComponent;
  });
  return { load, finish };
}

function fakeDialog() {
  const ref = { id: 'ref' };
  const open = vi.fn(() => ref);
  return { ref, open, dialog: { open } as unknown as MatDialog };
}

describe('lazyDialog', () => {
  it('opens the loaded component with the given config', async () => {
    const { load, finish } = deferredLoad();
    const { ref, open, dialog } = fakeDialog();

    const opened = lazyDialog(load)(dialog, { panelClass: 'td-dialog-panel' });
    finish();

    await expect(opened).resolves.toBe(ref);
    expect(open).toHaveBeenCalledWith(TestDialogComponent, { panelClass: 'td-dialog-panel' });
  });

  it('opens one dialog for calls made while the component loads', async () => {
    const { load, finish } = deferredLoad();
    const { open, dialog } = fakeDialog();
    const openDialog = lazyDialog(load);

    const first = openDialog(dialog);
    const second = openDialog(dialog);
    finish();

    expect(await second).toBe(await first);
    expect(load).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens another one once the first is up', async () => {
    const { load, finish } = deferredLoad();
    const { open, dialog } = fakeDialog();
    const openDialog = lazyDialog(load);
    finish();

    await openDialog(dialog);
    await openDialog(dialog);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it('loads again after a failed load', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValue(TestDialogComponent);
    const { open, dialog } = fakeDialog();
    const openDialog = lazyDialog(load);

    await expect(openDialog(dialog)).rejects.toThrow('chunk failed');
    await openDialog(dialog);

    expect(open).toHaveBeenCalledTimes(1);
  });
});
