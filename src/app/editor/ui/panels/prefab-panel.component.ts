import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { SavedStamp, StampKeep } from '../../model/stamp-store';
import { capturePrefab } from '../../ops/stamp';
import { EditorSession } from '../editor-session.service';

/** A saved piece and where it is kept */
export interface KeptStamp {
  saved: SavedStamp;
  keep: StampKeep;
}

/**
 * Prefabs in the Objects panel: the selected objects saved as a prefab (with
 * the ground under them when asked), for every map or in this map's file,
 * and the saved prefabs to place again. Placing goes through Copy and stamps
 * in Place mode, where R turns and a click puts the prefab down as one group.
 */
@Component({
  selector: 'app-prefab-panel',
  standalone: true,
  imports: [TdIconComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group' },
  template: `
    <h3 class="td-section">Prefabs</h3>
    @if (count(); as n) {
      <div class="pf-save">
        <input class="td-input is-sm" type="text" maxlength="40" placeholder="Name" [value]="name()" (input)="name.set($any($event.target).value)" aria-label="Prefab name" />
        <button class="td-btn-secondary td-btn-sm" type="button" (click)="save()" data-test="save-prefab" [matTooltip]="'Keep the ' + n + ' selected objects to place again'">Save as prefab</button>
      </div>
      <div class="td-setting">
        <span matTooltip="The heights, ground paint and water under the objects come along">With the ground under them</span>
        <input class="td-switch" type="checkbox" [checked]="ground()" (change)="ground.set($any($event.target).checked)" aria-label="With the ground under them" />
      </div>
      <div class="td-seg is-sm" role="radiogroup" aria-label="Keep for">
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'library'" (click)="keep.set('library')" matTooltip="In this browser, for every map">Every map</button>
        <button type="button" role="radio" [attr.aria-checked]="keep() === 'map'" (click)="keep.set('map')" matTooltip="In this map's file: it travels with the map">This map</button>
      </div>
    }
    <div class="td-rows">
      @for (k of prefabs(); track k.saved.id) {
        <div class="td-row pf-row" role="option" tabindex="0" [attr.aria-selected]="placing() === k.saved.stamp" (click)="use(k)" (keydown.enter)="use(k)" [attr.data-prefab]="k.saved.name">
          @if (k.saved.preview) {
            <img class="pf-thumb" [src]="k.saved.preview" alt="" />
          } @else {
            <span class="pf-thumb td-well" aria-hidden="true"></span>
          }
          <span class="pf-text">
            <span class="td-name">{{ k.saved.name }}</span>
            <span class="td-sub">{{ k.saved.stamp.objects.length }} objects{{ k.saved.stamp.parts?.heights ? ' with ground' : '' }} | {{ k.keep === 'map' ? 'this map' : 'every map' }}</span>
          </span>
          <button class="td-tool is-sm" type="button" aria-label="Delete prefab" matTooltip="Delete" (click)="$event.stopPropagation(); remove(k)">
            <td-icon name="trash" [size]="14" />
          </button>
        </div>
      } @empty {
        <p class="td-note">Select objects and save them as a prefab; it shows here to place again, turned with R.</p>
      }
    </div>
  `,
  styles: [
    `.pf-save { display: flex; gap: 8px; } .pf-save .td-input { flex: 1 1 auto; }
     .pf-row { justify-content: flex-start; gap: 8px; min-height: 48px; cursor: pointer; }
     .pf-thumb { width: 40px; height: 40px; flex: 0 0 auto; object-fit: cover; }
     .pf-text { flex: 1 1 auto; min-width: 0; }`,
  ],
})
export class PrefabPanelComponent implements OnInit {
  private readonly session = inject(EditorSession);
  readonly name = signal('');
  readonly ground = signal(false);
  readonly keep = signal<StampKeep>('library');
  /** Objects selected now */
  readonly count = computed(() => {
    const sel = this.session.selection();
    return sel?.kind === 'objects' ? sel.ids.length : 0;
  });
  /** The piece Copy and stamps places now, if any */
  readonly placing = computed(() => {
    this.session.settingsRev();
    const st = this.session.settings.stamp;
    return st.mode === 'paste' ? st.current : null;
  });
  /** The map's prefabs first, then the library's */
  readonly prefabs = computed<KeptStamp[]>(() => {
    this.session.docRev();
    return [
      ...this.session.mapStamps().filter((s) => s.stamp.prefab).map((saved) => ({ saved, keep: 'map' as const })),
      ...this.session.libraryStamps().filter((s) => s.stamp.prefab).map((saved) => ({ saved, keep: 'library' as const })),
    ];
  });

  ngOnInit(): void {
    void this.reload();
  }

  async reload(): Promise<void> {
    await this.session.reloadStamps();
  }

  async save(): Promise<void> {
    const sel = this.session.selection();
    const doc = this.session.doc;
    if (sel?.kind !== 'objects' || !doc) return;
    const catalog = this.session.catalog();
    const taken = capturePrefab(doc, sel.ids, this.ground(), (asset) => catalog.object(asset).radius);
    if (!taken) return;
    const name = this.name().trim() || `Prefab ${this.prefabs().length + 1}`;
    const saved = await this.session.saveStamp(name, taken.stamp, taken.rect, this.keep());
    if (!saved) return;
    this.name.set('');
    this.session.flash(`Saved prefab ${saved.name}${this.keep() === 'map' ? ' in this map' : ''}: click it below to place it`);
  }

  /** Place it with Copy and stamps */
  use(k: KeptStamp): void {
    this.session.selectTool('stamp');
    this.session.patchSettings((s) => {
      s.stamp.current = k.saved.stamp;
      s.stamp.currentName = k.saved.name;
      s.stamp.rotation = 0;
      s.stamp.mode = 'paste';
    });
  }

  async remove(k: KeptStamp): Promise<void> {
    if (k.keep === 'map') this.session.removeMapStamp(k.saved.id);
    else await this.session.deleteStamp(k.saved.id);
  }
}
