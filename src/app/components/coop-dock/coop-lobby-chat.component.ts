import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { CoopService } from '../../services/coop.service';
import { chatView } from '../coop-ui/chat-view';

/**
 * The chat of the coop room in the dock, its own column and the only thing
 * that scrolls there (PLAYTEST T52): name and time over the first line of a
 * run (chatView), system lines in mono, the newest line in view.
 */
@Component({
  selector: 'app-coop-lobby-chat',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './coop-lobby-chat.component.html',
  styleUrl: './coop-lobby-chat.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
    }
  `,
})
export class CoopLobbyChatComponent {
  readonly coop = inject(CoopService);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');

  readonly line = signal('');
  readonly chat = computed(() => chatView(this.coop.chat(), (id) => this.coop.nameOf(id), (id) => this.coop.laneColorOf(id)));

  constructor() {
    // The newest chat line in view
    effect(() => {
      this.chat();
      const box = this.box()?.nativeElement;
      if (box) queueMicrotask(() => { box.scrollTop = box.scrollHeight; });
    });
  }

  send(): void {
    this.coop.sendChat(this.line());
    this.line.set('');
  }
}
