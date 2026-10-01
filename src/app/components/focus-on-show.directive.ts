import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/**
 * Moves the focus to its element once it is shown: an overlay that takes
 * over the screen (game over, connection lost) is announced by screen
 * readers, and the first Tab lands in it instead of somewhere behind. The
 * element itself takes the focus (give it tabindex="-1"), not its first
 * button: a focus put there by script counts as the keyboard's, and Space,
 * pressed out of habit to start a wave, would press the button.
 */
@Directive({ selector: '[tdFocusOnShow]', standalone: true })
export class FocusOnShowDirective {
  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => host.nativeElement.focus({ preventScroll: true }));
  }
}
