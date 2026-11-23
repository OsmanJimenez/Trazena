import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { PageTreeItem } from '@trazena/shared';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';

@Component({
  selector: 'trz-page-tree',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="tree-list" [style.--depth]="depth()">
      @for (node of nodes(); track node.id) {
        <li class="tree-item">
          <div class="tree-row">
            @if (node.children.length > 0) {
              <button
                type="button"
                class="tree-toggle"
                [attr.aria-expanded]="isExpanded(node.id)"
                [attr.aria-label]="isExpanded(node.id) ? 'Contraer' : 'Expandir'"
                (click)="toggle(node.id)"
              >
                <atr-icon
                  [name]="isExpanded(node.id) ? 'chevron-down' : 'chevron-right'"
                  size="small"
                />
              </button>
            } @else {
              <span class="tree-spacer"></span>
            }

            <a
              class="tree-link"
              [routerLink]="basePath() + '/' + node.slug"
              routerLinkActive="is-active"
              [routerLinkActiveOptions]="{ exact: true }"
              (click)="pageSelected.emit(node)"
            >
              <atr-icon [name]="node.icon || 'file-text'" size="small" />
              <span class="tree-title">{{ node.title }}</span>
            </a>

            <button
              type="button"
              class="tree-add"
              title="Nueva subpágina"
              aria-label="Nueva subpágina"
              (click)="createChild.emit(node); $event.stopPropagation()"
            >
              <atr-icon name="plus" size="small" />
            </button>
          </div>

          @if (node.children.length > 0 && isExpanded(node.id)) {
            <trz-page-tree
              [nodes]="node.children"
              [basePath]="basePath() + '/' + node.slug"
              [depth]="depth() + 1"
              (createChild)="createChild.emit($event)"
              (pageSelected)="pageSelected.emit($event)"
            />
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .tree-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .tree-row {
      display: flex;
      align-items: center;
      gap: 0.2rem;
      padding-left: calc(var(--depth, 0) * 14px);
      border-radius: var(--trz-radius-sm);
      min-height: 30px;

      &:hover {
        background: var(--trz-bg-hover);

        .tree-add {
          opacity: 1;
        }
      }
    }

    .tree-toggle,
    .tree-add {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-text-muted);
      width: 22px;
      height: 22px;
      border-radius: 4px;
      display: grid;
      place-items: center;
      cursor: pointer;
      flex-shrink: 0;

      &:hover {
        background: var(--trz-border);
        color: var(--trz-text);
      }
    }

    .tree-add {
      opacity: 0;
      margin-right: 2px;
      transition: opacity 120ms ease;
    }

    .tree-spacer {
      width: 22px;
      flex-shrink: 0;
    }

    .tree-link {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.3rem 0.35rem;
      border-radius: var(--trz-radius-sm);
      color: var(--trz-text-muted);
      text-decoration: none;
      font-size: 0.855rem;

      &:hover {
        color: var(--trz-text);
      }

      &.is-active {
        color: var(--trz-accent);
        background: var(--trz-accent-soft);
        font-weight: 600;
      }
    }

    .tree-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class PageTreeComponent {
  readonly nodes = input.required<readonly PageTreeItem[]>();
  readonly basePath = input.required<string>();
  readonly depth = input(0);

  readonly createChild = output<PageTreeItem>();
  readonly pageSelected = output<PageTreeItem>();

  private readonly collapsedIds = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(id: string): boolean {
    return !this.collapsedIds().has(id);
  }

  protected toggle(id: string): void {
    this.collapsedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
}
