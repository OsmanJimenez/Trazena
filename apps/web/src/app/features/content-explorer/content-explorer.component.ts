import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type {
  ExplorerGroupBy,
  ExplorerSortBy,
  FilterCondition,
  FilterField,
  FilterGroup,
  FilterOperator,
  SavedView,
} from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeDialog } from '@osmanjimenez/atralume/dialog';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import {
  SearchEngineService,
  type EnrichedSearchResult,
} from '../../core/search/search-engine.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';
import {
  PageExportDialogComponent,
  type ExportDialogData,
} from '../export/page-export-dialog.component';

@Component({
  selector: 'trz-content-explorer',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    AtralumeButton,
    AtralumeCard,
    AtralumeEmptyState,
    AtralumeIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="explorer">
      <header class="exp-header">
        <div>
          <h1>Explorador de conocimiento</h1>
          <p>Búsqueda de texto completo offline, filtros AND/OR, vistas guardadas y acciones masivas.</p>
        </div>
        <div class="header-actions">
          <button atrButton type="button" size="small" appearance="outlined" (click)="saveCurrentView()">
            Guardar vista
          </button>
          <button
            atrButton
            type="button"
            size="small"
            appearance="filled"
            [disabled]="results().length === 0"
            (click)="exportVisible()"
          >
            Exportar resultados
          </button>
        </div>
      </header>

      @if (meta.savedViews().length > 0) {
        <div class="saved-views-bar">
          <span class="sv-label">Vistas guardadas:</span>
          @for (view of meta.savedViews(); track view.id) {
            <div class="sv-chip">
              <button type="button" class="sv-btn" (click)="applySavedView(view)">{{ view.name }}</button>
              <button type="button" class="sv-del" title="Eliminar vista" (click)="deleteView(view)">×</button>
            </div>
          }
        </div>
      }

      <atr-card appearance="outlined">
        <div class="controls-inner">
          <div class="search-row">
            <div class="search-input">
              <atr-icon name="search" size="small" />
              <input
                type="search"
                placeholder="Buscar en títulos, encabezados, etiquetas, propiedades y Markdown…"
                [ngModel]="query()"
                (ngModelChange)="query.set($event); runSearch()"
              />
            </div>

            <select [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event); runSearch()" aria-label="Ordenar por">
              <option value="relevance">Relevancia</option>
              <option value="updated_desc">Más recientes</option>
              <option value="updated_asc">Más antiguos</option>
              <option value="title_asc">Nombre (A-Z)</option>
              <option value="title_desc">Nombre (Z-A)</option>
              <option value="created_desc">Creación reciente</option>
            </select>

            <select [ngModel]="groupBy()" (ngModelChange)="groupBy.set($event)" aria-label="Agrupar por">
              <option value="none">Sin agrupar</option>
              <option value="organization">Por organización</option>
              <option value="workspace">Por espacio</option>
              <option value="status">Por estado</option>
              <option value="tag">Por etiqueta</option>
            </select>

            <div class="view-toggle" role="group" aria-label="Tipo de vista">
              <button type="button" [class.active]="viewMode() === 'list'" (click)="viewMode.set('list')">Lista</button>
              <button type="button" [class.active]="viewMode() === 'table'" (click)="viewMode.set('table')">Tabla</button>
            </div>
          </div>

          <div class="filters-bar">
            <div class="filters-head">
              <span>Filtros</span>
              @if (conditions().length > 1) {
                <select [ngModel]="combinator()" (ngModelChange)="combinator.set($event); runSearch()">
                  <option value="AND">Cumplir TODOS (AND)</option>
                  <option value="OR">Cumplir CUALQUIERA (OR)</option>
                </select>
              }
              <button atrButton type="button" size="small" appearance="text" (click)="addCondition()">
                + Agregar filtro
              </button>
              @if (conditions().length > 0) {
                <button atrButton type="button" size="small" appearance="text" (click)="clearFilters()">
                  Limpiar
                </button>
              }
            </div>

            @for (cond of conditions(); track cond.id) {
              <div class="cond-row">
                <select [ngModel]="cond.field" (ngModelChange)="updateCond(cond.id, { field: $event })">
                  <option value="organizationId">Organización</option>
                  <option value="workspaceId">Espacio</option>
                  <option value="tags">Etiqueta</option>
                  <option value="status">Estado</option>
                  <option value="favorite">Favoritos</option>
                  <option value="pendingSync">Sync pendiente</option>
                  <option value="title">Título</option>
                  <option value="content">Contenido</option>
                  <option value="updatedAt">Fecha modificación</option>
                  <option value="createdAt">Fecha creación</option>
                  @for (prop of meta.propertyDefinitions(); track prop.id) {
                    <option [value]="'prop:' + prop.id">Prop: {{ prop.name }}</option>
                  }
                </select>

                <select [ngModel]="cond.operator" (ngModelChange)="updateCond(cond.id, { operator: $event })">
                  @for (op of operatorsFor(cond.field); track op.value) {
                    <option [value]="op.value">{{ op.label }}</option>
                  }
                </select>

                @if (cond.field === 'organizationId') {
                  <select [ngModel]="cond.value" (ngModelChange)="updateCond(cond.id, { value: $event })">
                    <option value="">Selecciona…</option>
                    @for (o of store.activeOrganizations(); track o.id) {
                      <option [value]="o.id">{{ o.name }}</option>
                    }
                  </select>
                } @else if (cond.field === 'workspaceId') {
                  <select [ngModel]="cond.value" (ngModelChange)="updateCond(cond.id, { value: $event })">
                    <option value="">Selecciona…</option>
                    @for (w of store.workspaces(); track w.id) {
                      @if (w.status !== 'deleted') {
                        <option [value]="w.id">{{ w.name }}</option>
                      }
                    }
                  </select>
                } @else if (cond.field === 'tags') {
                  <select [ngModel]="cond.value" (ngModelChange)="updateCond(cond.id, { value: $event })">
                    <option value="">Selecciona…</option>
                    @for (t of meta.tags(); track t.id) {
                      <option [value]="t.id">#{{ t.name }}</option>
                    }
                  </select>
                } @else if (cond.field === 'status') {
                  <select [ngModel]="cond.value" (ngModelChange)="updateCond(cond.id, { value: $event })">
                    <option value="active">Activa</option>
                    <option value="archived">Archivada</option>
                  </select>
                } @else if (cond.field === 'favorite' || cond.field === 'pendingSync') {
                  <span class="bool-hint"></span>
                } @else if (cond.field === 'createdAt' || cond.field === 'updatedAt') {
                  <input type="date" [ngModel]="cond.value" (ngModelChange)="updateCond(cond.id, { value: $event })" />
                  @if (cond.operator === 'between') {
                    <input type="date" [ngModel]="cond.valueTo || ''" (ngModelChange)="updateCond(cond.id, { valueTo: $event })" />
                  }
                } @else {
                  <input
                    type="text"
                    placeholder="Valor…"
                    [ngModel]="cond.value"
                    (ngModelChange)="updateCond(cond.id, { value: $event })"
                  />
                }

                <button type="button" class="remove-cond" (click)="removeCond(cond.id)" aria-label="Quitar filtro">×</button>
              </div>
            }
          </div>
        </div>
      </atr-card>

      @if (selectedIds().size > 0) {
        <div class="bulk-bar" role="region" aria-label="Acciones masivas">
          <strong>{{ selectedIds().size }} seleccionada(s)</strong>
          <div class="bulk-actions">
            <button atrButton type="button" size="small" appearance="filled" (click)="bulkExport()">Exportar</button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="bulkAddTag()">+ Etiqueta</button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="bulkToggleFavorite()">★ Favorito</button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="bulkSetStatus('archived')">Archivar</button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="bulkSetStatus('active')">Restaurar</button>
            <button atrButton type="button" size="small" appearance="text" (click)="selectedIds.set(newSet())">Desmarcar</button>
          </div>
        </div>
      }

      <div class="results-meta">
        <span>{{ results().length }} documento(s) encontrado(s)</span>
        @if (results().length > 0) {
          <button type="button" class="select-all-btn" (click)="toggleSelectAll()">
            {{ selectedIds().size === results().length ? 'Desmarcar todo' : 'Seleccionar todos' }}
          </button>
        }
      </div>

      @if (results().length === 0) {
        <atr-empty-state
          title="Sin documentos coincidentes"
          description="Ajusta la búsqueda o los filtros activos."
        />
      } @else if (viewMode() === 'list') {
        @for (group of grouped(); track group.groupKey) {
          <section class="group-block">
            @if (group.groupLabel) {
              <h2 class="group-title">{{ group.groupLabel }} ({{ group.items.length }})</h2>
            }
            <div class="list-box">
              @for (item of group.items; track item.page.id) {
                <div class="list-row">
                  <input
                    type="checkbox"
                    [checked]="selectedIds().has(item.page.id)"
                    (change)="toggleSelect(item.page.id)"
                    aria-label="Seleccionar página"
                  />
                  <div class="list-main">
                    <div class="list-top">
                      <a [routerLink]="item.canonicalPath" class="row-title">
                        @if (item.isFavorite) { <span class="star">★</span> }
                        {{ item.page.title }}
                      </a>
                      <span class="row-loc">{{ item.organization.name }} / {{ item.workspace.name }}</span>
                    </div>
                    @if (item.snippetHtml) {
                      <div class="row-snippet" [innerHTML]="item.snippetHtml"></div>
                    }
                    <div class="row-meta">
                      @for (t of item.tags; track t.id) {
                        <span class="tag-pill" [style.borderColor]="t.color">#{{ t.name }}</span>
                      }
                      @if (item.isPendingSync) {
                        <span class="pending-pill">Pendiente Sync</span>
                      }
                      <span>Rev. v{{ item.page.revision }} · {{ formatDate(item.page.updatedAt) }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </section>
        }
      } @else {
        <div class="table-wrap">
          <table class="exp-table">
            <thead>
              <tr>
                <th class="col-check"></th>
                <th>Nombre</th>
                <th>Organización</th>
                <th>Espacio</th>
                <th>Etiquetas</th>
                <th>Estado</th>
                <th>Modificado</th>
              </tr>
            </thead>
            <tbody>
              @for (item of results(); track item.page.id) {
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      [checked]="selectedIds().has(item.page.id)"
                      (change)="toggleSelect(item.page.id)"
                    />
                  </td>
                  <td>
                    <a [routerLink]="item.canonicalPath" class="row-title">
                      @if (item.isFavorite) { <span class="star">★</span> }
                      {{ item.page.title }}
                    </a>
                  </td>
                  <td>{{ item.organization.name }}</td>
                  <td>{{ item.workspace.name }}</td>
                  <td>
                    @for (t of item.tags; track t.id) {
                      <span class="tag-pill">#{{ t.name }}</span>
                    }
                  </td>
                  <td>{{ item.page.status === 'active' ? 'Activa' : 'Archivada' }}</td>
                  <td>{{ formatDate(item.page.updatedAt) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: `
    .explorer { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.15rem; }
    .exp-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .exp-header p { margin: 0.25rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .header-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .saved-views-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
    .sv-label { font-size: 0.78rem; color: var(--trz-text-subtle); font-weight: 600; }
    .sv-chip {
      display: inline-flex; align-items: center; border: 1px solid var(--trz-border);
      border-radius: 999px; background: var(--trz-bg-elevated); overflow: hidden;
    }
    .sv-btn, .sv-del {
      appearance: none; border: 0; background: transparent; color: var(--trz-text);
      font: inherit; font-size: 0.78rem; padding: 0.22rem 0.55rem; cursor: pointer;
      &:hover { background: var(--trz-bg-hover); }
    }
    .sv-del { padding: 0.22rem 0.4rem; color: var(--trz-text-subtle); }
    .controls-inner { padding: 1rem 1.15rem; display: flex; flex-direction: column; gap: 0.85rem; }
    .search-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .search-input {
      flex: 1; min-width: 240px; height: 36px; padding: 0 0.7rem;
      display: flex; align-items: center; gap: 0.5rem;
      border: 1px solid var(--trz-border-strong); border-radius: var(--trz-radius-sm); background: var(--trz-bg);
      input { flex: 1; border: 0; outline: none; background: transparent; color: var(--trz-text); font: inherit; font-size: 0.88rem; }
    }
    .view-toggle {
      display: inline-flex; border: 1px solid var(--trz-border-strong); border-radius: 6px; overflow: hidden;
      button {
        appearance: none; border: 0; background: var(--trz-bg); color: var(--trz-text-muted);
        padding: 0.4rem 0.7rem; font: inherit; font-size: 0.8rem; cursor: pointer;
        &.active { background: var(--trz-bg-subtle); color: var(--trz-text); font-weight: 600; }
      }
    }
    .filters-bar { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--trz-border); padding-top: 0.7rem; }
    .filters-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.8rem; font-weight: 600; color: var(--trz-text-muted); }
    .cond-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
      input {
        height: 34px; padding: 0 0.65rem; border: 1px solid var(--trz-border-strong);
        border-radius: 6px; background: var(--trz-bg); color: var(--trz-text); font: inherit; font-size: 0.84rem;
      }
    }
    .remove-cond {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-subtle);
      width: 28px; height: 28px; border-radius: 4px; cursor: pointer; font-size: 1rem;
      &:hover { background: var(--trz-bg-hover); color: var(--trz-danger); }
    }
    .bulk-bar {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.65rem 1rem; border-radius: var(--trz-radius-md);
      background: var(--trz-accent-soft); border: 1px solid var(--trz-border); font-size: 0.86rem;
    }
    .bulk-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .results-meta {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.8rem; color: var(--trz-text-subtle);
    }
    .select-all-btn {
      appearance: none; border: 0; background: transparent; color: var(--trz-accent);
      font: inherit; cursor: pointer; &:hover { text-decoration: underline; }
    }
    .group-title { font-size: 0.76rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--trz-text-subtle); margin: 0 0 0.5rem; }
    .list-box { border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md); background: var(--trz-bg-elevated); overflow: hidden; }
    .list-row {
      display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.8rem 1rem;
      border-bottom: 1px solid var(--trz-border);
      &:last-child { border-bottom: 0; }
      &:hover { background: var(--trz-bg-subtle); }
      input[type="checkbox"] { margin-top: 0.25rem; accent-color: var(--trz-accent); }
    }
    .list-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .list-top { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.4rem; }
    .row-title { font-weight: 600; color: var(--trz-text); text-decoration: none; font-size: 0.92rem; &:hover { color: var(--trz-accent); } }
    .star { color: var(--trz-warning); margin-right: 0.2rem; }
    .row-loc { font-size: 0.75rem; color: var(--trz-text-subtle); }
    .row-snippet {
      font-size: 0.8rem; color: var(--trz-text-muted); line-height: 1.45;
      :global(mark) { background: var(--trz-accent-soft); color: var(--trz-accent); padding: 0 2px; border-radius: 2px; }
    }
    .row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.74rem; color: var(--trz-text-subtle); }
    .tag-pill {
      font-size: 0.71rem; padding: 0.08rem 0.45rem; border-radius: 999px;
      background: var(--trz-bg-subtle); border: 1px solid var(--trz-border); color: var(--trz-text-muted);
    }
    .pending-pill {
      font-size: 0.7rem; padding: 0.08rem 0.45rem; border-radius: 999px;
      background: color-mix(in srgb, var(--trz-warning) 16%, transparent); color: var(--trz-warning);
    }
    .table-wrap { overflow-x: auto; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md); background: var(--trz-bg-elevated); }
    .exp-table {
      width: 100%; border-collapse: collapse; font-size: 0.85rem;
      th, td { padding: 0.65rem 0.85rem; border-bottom: 1px solid var(--trz-border); text-align: left; }
      th { background: var(--trz-bg-subtle); font-weight: 600; font-size: 0.76rem; text-transform: uppercase; color: var(--trz-text-subtle); }
      tr:last-child td { border-bottom: 0; }
      .col-check { width: 32px; }
    }
  `,
})
export class ContentExplorerComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  private readonly search = inject(SearchEngineService);
  private readonly dialog = inject(AtralumeDialog);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly route = inject(ActivatedRoute);

  protected readonly query = signal('');
  protected readonly combinator = signal<'AND' | 'OR'>('AND');
  protected readonly conditions = signal<FilterCondition[]>([]);
  protected readonly sortBy = signal<ExplorerSortBy>('updated_desc');
  protected readonly groupBy = signal<ExplorerGroupBy>('none');
  protected readonly viewMode = signal<'list' | 'table'>('list');
  protected readonly results = signal<EnrichedSearchResult[]>([]);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  protected readonly grouped = computed(() =>
    this.search.groupResults(this.results(), this.groupBy()),
  );

  async ngOnInit(): Promise<void> {
    await this.search.ensureIndex();
    const initialQ = this.route.snapshot.queryParamMap.get('q') ?? '';
    if (initialQ) {
      this.query.set(initialQ);
      this.sortBy.set('relevance');
    }
    await this.runSearch();
  }

  protected newSet(): ReadonlySet<string> {
    return new Set();
  }

  protected async runSearch(): Promise<void> {
    const filterGroup: FilterGroup = {
      combinator: this.combinator(),
      conditions: this.conditions(),
    };
    const res = await this.search.executeExplorerQuery({
      query: this.query(),
      filterGroup,
      sortBy: this.sortBy(),
      includeArchived: this.conditions().some((c) => c.field === 'status'),
    });
    this.results.set(res);
  }

  protected operatorsFor(field: FilterField): Array<{ value: FilterOperator; label: string }> {
    if (field === 'favorite' || field === 'pendingSync') {
      return [
        { value: 'is_true', label: 'Es verdadero' },
        { value: 'is_false', label: 'Es falso' },
      ];
    }
    if (field === 'createdAt' || field === 'updatedAt') {
      return [
        { value: 'after', label: 'Después de' },
        { value: 'before', label: 'Antes de' },
        { value: 'between', label: 'Entre fechas' },
      ];
    }
    if (field === 'organizationId' || field === 'workspaceId' || field === 'status' || field === 'tags') {
      return [
        { value: 'equals', label: 'Es' },
        { value: 'not_equals', label: 'No es' },
      ];
    }
    return [
      { value: 'contains', label: 'Contiene' },
      { value: 'not_contains', label: 'No contiene' },
      { value: 'equals', label: 'Es igual a' },
    ];
  }

  protected addCondition(): void {
    const cond: FilterCondition = {
      id: crypto.randomUUID(),
      field: 'organizationId',
      operator: 'equals',
      value: '',
    };
    this.conditions.update((list) => [...list, cond]);
  }

  protected updateCond(id: string, patch: Partial<FilterCondition>): void {
    this.conditions.update((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if (patch.field) {
          const ops = this.operatorsFor(patch.field);
          next.operator = ops[0].value;
          next.value = patch.field === 'status' ? 'active' : '';
        }
        return next;
      }),
    );
    void this.runSearch();
  }

  protected removeCond(id: string): void {
    this.conditions.update((list) => list.filter((c) => c.id !== id));
    void this.runSearch();
  }

  protected clearFilters(): void {
    this.conditions.set([]);
    void this.runSearch();
  }

  protected toggleSelect(id: string): void {
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected toggleSelectAll(): void {
    if (this.selectedIds().size === this.results().length) {
      this.selectedIds.set(new Set());
    } else {
      this.selectedIds.set(new Set(this.results().map((r) => r.page.id)));
    }
  }

  protected async saveCurrentView(): Promise<void> {
    const name = await this.dialogs.prompt({
      title: 'Guardar vista',
      label: 'Nombre de la vista guardada',
      placeholder: 'Ej. Documentos pendientes de sync…',
      confirmText: 'Guardar',
    });
    if (!name) return;
    await this.meta.saveView({
      organizationId: null,
      name,
      query: this.query(),
      viewMode: this.viewMode(),
      filterGroup: { combinator: this.combinator(), conditions: this.conditions() },
      sortBy: this.sortBy(),
      groupBy: this.groupBy(),
      columns: ['title', 'organization', 'workspace', 'tags', 'status', 'updatedAt'],
    });
    this.snackbar.open({ message: `Vista "${name}" guardada.`, tone: 'success' });
  }

  protected applySavedView(view: SavedView): void {
    this.query.set(view.query);
    this.viewMode.set(view.viewMode);
    this.combinator.set(view.filterGroup.combinator);
    this.conditions.set(view.filterGroup.conditions);
    this.sortBy.set(view.sortBy);
    this.groupBy.set(view.groupBy);
    void this.runSearch();
  }

  protected async deleteView(view: SavedView): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Eliminar vista guardada',
      message: `¿Eliminar la vista "${view.name}"?`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await this.meta.deleteSavedView(view.id);
  }

  protected exportVisible(): void {
    this.openExportModal(
      'filtered-results',
      this.results().map((r) => r.page.id),
      'resultados-explorador',
    );
  }

  protected bulkExport(): void {
    this.openExportModal('selection', [...this.selectedIds()], 'seleccion-trazena');
  }

  private openExportModal(
    scope: ExportDialogData['defaultScope'],
    targetIds: string[],
    title: string,
  ): void {
    this.dialog.open<PageExportDialogComponent, ExportDialogData, boolean>(
      PageExportDialogComponent,
      { data: { defaultScope: scope, targetIds, title }, size: 's', closable: false },
    );
  }

  protected async bulkAddTag(): Promise<void> {
    const tagName = await this.dialogs.prompt({
      title: 'Asignar etiqueta masiva',
      label: 'Nombre de la etiqueta',
      placeholder: 'Ej. arquitectura, urgente…',
      confirmText: 'Asignar',
    });
    if (!tagName) return;
    const ids = [...this.selectedIds()];
    for (const id of ids) {
      const page = this.store.pages().find((p) => p.id === id);
      if (!page) continue;
      const tag = await this.meta.createOrGetTag(page.organizationId, tagName);
      await this.meta.assignTagToPage(page, tag.id);
    }
    this.snackbar.open({ message: `Etiqueta "#${tagName}" asignada a ${ids.length} página(s).`, tone: 'success' });
    await this.search.rebuildIndex();
    await this.runSearch();
  }

  protected async bulkToggleFavorite(): Promise<void> {
    for (const id of this.selectedIds()) {
      if (!this.meta.isFavorite(id)) await this.meta.toggleFavorite(id);
    }
    this.snackbar.open({ message: 'Páginas marcadas como favoritas.', tone: 'success' });
    await this.runSearch();
  }

  protected async bulkSetStatus(status: 'active' | 'archived'): Promise<void> {
    const ids = [...this.selectedIds()];
    for (const id of ids) {
      await this.store.updatePageMeta(id, { status });
    }
    this.selectedIds.set(new Set());
    this.snackbar.open({
      message: `${ids.length} página(s) ${status === 'archived' ? 'archivadas' : 'restauradas'}.`,
      tone: 'info',
    });
    await this.search.rebuildIndex();
    await this.runSearch();
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }
}
