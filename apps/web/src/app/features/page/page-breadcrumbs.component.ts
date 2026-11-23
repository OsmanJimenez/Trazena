import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BreadcrumbSegment } from '@trazena/shared';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';

@Component({
  selector: 'trz-page-breadcrumbs',
  standalone: true,
  imports: [RouterLink, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="trz-breadcrumbs" aria-label="Ruta jerárquica">
      <ol class="crumb-list">
        @for (seg of segments(); track seg.id; let last = $last) {
          <li class="crumb-item">
            @if (last) {
              <span class="crumb-current" aria-current="page">{{ seg.label }}</span>
            } @else {
              <a [routerLink]="seg.route" class="crumb-link">{{ seg.label }}</a>
              <atr-icon name="chevron-right" size="small" class="crumb-sep" />
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    .crumb-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
    }

    .crumb-item {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }

    .crumb-link {
      color: var(--trz-text-muted);
      text-decoration: none;
      font-size: 0.84rem;
      padding: 0.15rem 0.3rem;
      border-radius: 4px;

      &:hover {
        color: var(--trz-text);
        background: var(--trz-bg-hover);
      }
    }

    .crumb-current {
      color: var(--trz-text);
      font-weight: 600;
      font-size: 0.84rem;
      padding: 0.15rem 0.3rem;
    }

    .crumb-sep {
      color: var(--trz-text-subtle);
    }
  `,
})
export class PageBreadcrumbsComponent {
  readonly segments = input.required<readonly BreadcrumbSegment[]>();
}
