import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AtralumeDialogRef } from '@osmanjimenez/atralume/dialog';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import {
  SearchEngineService,
  type EnrichedSearchResult,
} from '../../core/search/search-engine.service';

@Component({
  selector: 'trz-quick-search-dialog',
  standalone: true,
  imports: [FormsModule, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="qs-box" (keydown)="onKeydown($event)">
      <div class="qs-input-row">
        <atr-icon name="search" size="small" />
        <input
          type="text"
          placeholder="Buscar páginas, encabezados, etiquetas o contenido… (Esc para cerrar)"
          [ngModel]="query()"
          (ngModelChange)="onQuery($event)"
          autofocus
        />
        <button type="button" class="qs-explorer-link" (click)="openExplorer()">
          Explorador avanzado →
        </button>
      </div>

      @if (!query().trim() && search.recentQueries().length > 0) {
        <div class="qs-recent-queries">
          <span>Búsquedas recientes:</span>
          @for (rq of search.recentQueries(); track rq) {
            <button type="button" class="rq-chip" (click)="onQuery(rq)">{{ rq }}</button>
          }
        </div>
      }

      <div class="qs-results" role="listbox">
        @for (item of results(); track item.page.id; let idx = $index) {
          <button
            type="button"
            class="qs-item"
            [class.active]="idx === activeIndex()"
            (mouseenter)="activeIndex.set(idx)"
            (click)="selectItem(item)"
          >
            <div class="qs-item-top">
              <strong>{{ item.page.title }}</strong>
              <span class="qs-loc">{{ item.organization.name }} / {{ item.workspace.name }}</span>
            </div>
            @if (item.snippetHtml) {
              <div class="qs-snippet" [innerHTML]="item.snippetHtml"></div>
            }
          </button>
        } @empty {
          <div class="qs-empty">Sin resultados para "{{ query() }}".</div>
        }
      </div>

      <div class="qs-foot">
        <span>↑↓ Navegar · Enter Abrir · Esc Cerrar</span>
        <span>Búsqueda local offline</span>
      </div>
    </div>
  `,
  styles: `
    .qs-box { display: flex; flex-direction: column; gap: 0.7rem; color: var(--trz-text); }
    .qs-input-row {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.5rem 0.7rem; border: 1px solid var(--trz-border-strong);
      border-radius: var(--trz-radius-sm); background: var(--trz-bg);
      input {
        flex: 1; min-width: 0; border: 0; outline: none; background: transparent;
        color: var(--trz-text); font: inherit; font-size: 0.94rem;
      }
    }
    .qs-explorer-link {
      appearance: none; border: 0; background: transparent; color: var(--trz-accent);
      font: inherit; font-size: 0.76rem; font-weight: 500; cursor: pointer; white-space: nowrap;
      &:hover { text-decoration: underline; }
    }
    .qs-recent-queries {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; font-size: 0.75rem; color: var(--trz-text-subtle);
    }
    .rq-chip {
      appearance: none; border: 1px solid var(--trz-border); background: var(--trz-bg-subtle);
      color: var(--trz-text-muted); border-radius: 999px; padding: 0.12rem 0.55rem; font: inherit; cursor: pointer;
      &:hover { background: var(--trz-bg-hover); color: var(--trz-text); }
    }
    .qs-results {
      max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.25rem;
    }
    .qs-item {
      appearance: none; border: 0; text-align: left; width: 100%; cursor: pointer;
      padding: 0.6rem 0.75rem; border-radius: var(--trz-radius-sm); background: transparent; color: var(--trz-text);
      display: flex; flex-direction: column; gap: 0.2rem;
      &.active, &:hover { background: var(--trz-bg-hover); }
    }
    .qs-item-top {
      display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem;
      strong { font-size: 0.9rem; }
    }
    .qs-loc { font-size: 0.74rem; color: var(--trz-text-subtle); }
    .qs-snippet {
      font-size: 0.78rem; color: var(--trz-text-muted); line-height: 1.4;
      :global(mark) { background: var(--trz-accent-soft); color: var(--trz-accent); padding: 0 2px; border-radius: 2px; }
    }
    .qs-empty { padding: 1.5rem; text-align: center; font-size: 0.85rem; color: var(--trz-text-subtle); }
    .qs-foot {
      display: flex; justify-content: space-between; font-size: 0.73rem; color: var(--trz-text-subtle);
      padding-top: 0.45rem; border-top: 1px solid var(--trz-border);
    }
  `,
})
export class QuickSearchDialogComponent implements OnInit {
  protected readonly search = inject(SearchEngineService);
  private readonly router = inject(Router);
  private readonly ref = inject<AtralumeDialogRef<void>>(AtralumeDialogRef);

  protected readonly query = signal('');
  protected readonly results = signal<EnrichedSearchResult[]>([]);
  protected readonly activeIndex = signal(0);

  async ngOnInit(): Promise<void> {
    this.results.set(await this.search.quickSearch('', 10));
  }

  protected async onQuery(value: string): Promise<void> {
    this.query.set(value);
    this.activeIndex.set(0);
    this.results.set(await this.search.quickSearch(value, 15));
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.results();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.min(items.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter' && items[this.activeIndex()]) {
      event.preventDefault();
      void this.selectItem(items[this.activeIndex()]);
    } else if (event.key === 'Escape') {
      this.ref.close();
    }
  }

  protected async selectItem(item: EnrichedSearchResult): Promise<void> {
    if (this.query().trim()) this.search.recordQuery(this.query());
    this.ref.close();
    await this.router.navigateByUrl(item.canonicalPath);
  }

  protected async openExplorer(): Promise<void> {
    const q = this.query().trim();
    this.ref.close();
    await this.router.navigate(['/explore'], { queryParams: q ? { q } : undefined });
  }
}
