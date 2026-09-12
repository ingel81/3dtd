import type { ComponentType } from '@angular/cdk/portal';
import type { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';

/**
 * Opener for a dialog whose component is not part of the game chunk. `load`
 * is a dynamic import, so the component and whatever only it uses become a
 * lazy chunk of their own: the first open fetches it, later opens find it in
 * the module cache.
 *
 * Calls made while the chunk loads get the same pending dialog, so a double
 * click or a repeated key during the first open does not stack two of them.
 */
export function lazyDialog<T, D = unknown, R = unknown>(
  load: () => Promise<ComponentType<T>>,
): (dialog: MatDialog, config?: MatDialogConfig<D>) => Promise<MatDialogRef<T, R>> {
  let pending: Promise<MatDialogRef<T, R>> | null = null;
  return (dialog, config) => {
    pending ??= load()
      .then((component) => dialog.open<T, D, R>(component, config))
      .finally(() => { pending = null; });
    return pending;
  };
}
