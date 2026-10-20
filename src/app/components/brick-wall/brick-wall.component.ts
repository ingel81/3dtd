import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * One brick of the wall: its place in laying order and its tone, so the
 * wall does not read as a ruled grid.
 */
interface Brick {
  index: number;
  tone: '' | 'is-light' | 'is-dark';
}

const TONES = ['', 'is-light', '', 'is-dark'] as const;

/**
 * The wall in running bond: three courses, the middle one shifted by half a
 * brick with half bricks at both ends, laid bottom left to top right. Built
 * once; the template only moves the line of laid bricks.
 */
export const WALL_COURSES: readonly (readonly Brick[])[] = (() => {
  let index = 0;
  return [10, 11, 10].map((count, course) =>
    Array.from({ length: count }, () => {
      const brick: Brick = { index, tone: TONES[(index + course) % TONES.length] };
      index += 1;
      return brick;
    }),
  );
})();

export const WALL_BRICKS = WALL_COURSES.reduce((sum, course) => sum + course.length, 0);

/** Bricks laid for a share in percent: one brick per piece of the way, all of them at 100 */
export function bricksLaid(percent: number): number {
  const share = Math.min(Math.max(percent, 0), 100) / 100;
  return Math.floor(share * WALL_BRICKS + 1e-9);
}

/**
 * A loading bar as a wall that is built up (docs/DESIGN_SYSTEM.md, td-wall):
 * a brick per piece of progress, the brick laid last glows briefly in brass.
 * A progressbar for screen readers, named by `label`. `size="sm"` is the low
 * wall under a line of text.
 */
@Component({
  selector: 'app-brick-wall',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'td-wall',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'now()',
    '[attr.aria-label]': 'label()',
    '[class.is-sm]': "size() === 'sm'",
  },
  template: `
    @for (course of courses; track $index) {
      <span class="td-wall-course">
        @for (brick of course; track brick.index) {
          <i [class]="brick.tone" [class.is-on]="brick.index < laid()" [class.is-last]="brick.index === laid() - 1"></i>
        }
      </span>
    }
  `,
})
export class BrickWallComponent {
  /** Progress in percent, 0 to 100 */
  readonly value = input.required<number>();
  /** What loads, the progressbar's name */
  readonly label = input.required<string>();
  readonly size = input<'md' | 'sm'>('md');

  protected readonly courses = WALL_COURSES;
  protected readonly laid = computed(() => bricksLaid(this.value()));
  protected readonly now = computed(() => Math.round(Math.min(Math.max(this.value(), 0), 100)));
}
