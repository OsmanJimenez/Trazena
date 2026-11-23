import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Organization, Workspace } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { PageBreadcrumbsComponent } from '../page/page-breadcrumbs.component';

@Component({
  selector: 'trz-workspace-view',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    AtralumeButton,
    AtralumeCard,
    AtralumeEmptyState,
    AtralumeIcon,
    PageBreadcrumbsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (workspace(); as ws) {
      @if (organization(); as org) {
        <div class="ws-view">
          <trz-page-breadcrumbs [segments]="breadcrumbs()" />

          <header class="view-header">
            <div>
              <h1>{{ ws.name }}</h1>
              <p class="desc">{{ ws.description || 'Espacio de documentación jerárquica.' }}</p>
            </div>
            <div class="actions">
              <button atrButton type="button" size="small" appearance="filled" (click)="createRootPage(org, ws)">
                + Nueva página
              </button>
              <button atrButton type="button" size="small" appearance="outlined" (click)="editing.set(!editing())">
                Editar espacio
              </button>
              <button atrButton type="button" size="small" appearance="text" (click)="deleteWs(org, ws)">
                Eliminar
              </button>
            </div>
          </header>

          @if (editing()) {
            <atr-card appearance="outlined">
              <div class="card-inner">
                <div class="form-grid">
                  <label>
                    <span>Nombre</span>
                    <input type="text" [(ngModel)]="editName" />
                  </label>
                  <label>
                    <span>Slug</span>
                    <input type="text" [(ngModel)]="editSlug" />
                  </label>
                  <label class="full">
                    <span>Descripción</span>
                    <textarea rows="2" [(ngModel)]="editDescription"></textarea>
                  </label>
                </div>
                <div class="form-actions">
                  <button atrButton type="button" size="small" (click)="saveWs(org, ws)">Guardar</button>
                  <button atrButton type="button" size="small" appearance="text" (click)="editing.set(false)">Cancelar</button>
                </div>
              </div>
            </atr-card>
          }

          <section>
            <h2>Páginas raíz ({{ rootPages().length }})</h2>
            @if (rootPages().length > 0) {
              <div class="pages-grid">
                @for (page of rootPages(); track page.id) {
                  <a class="page-card" [routerLink]="store.getCanonicalPath(page.id)">
                    <atr-icon [name]="page.icon || 'file-text'" size="small" />
                    <div>
                      <div class="page-title">{{ page.title }}</div>
                      <div class="page-meta">Rev. v{{ page.revision }} · /{{ page.slug }}</div>
                    </div>
                  </a>
                }
              </div>
            } @else {
              <atr-empty-state
                title="Este espacio no tiene páginas aún"
                description="Crea la primera página raíz para empezar a documentar."
              />
            }
          </section>
        </div>
      }
    } @else {
      <atr-empty-state title="Espacio no encontrado" description="Revisa la ruta o selecciona otro espacio." />
    }
  `,
  styles: `
    .ws-view { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem; }
    .view-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.5rem, 2.5vw, 1.9rem); letter-spacing: -0.025em; }
    .desc { margin: 0.35rem 0 0; color: var(--trz-text-muted); font-size: 0.92rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .card-inner { padding: 1.15rem 1.25rem; display: flex; flex-direction: column; gap: 0.9rem; }
    .form-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem;
      label {
        display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; font-weight: 500;
        &.full { grid-column: 1 / -1; }
        input, textarea {
          padding: 0.55rem 0.75rem;
          border: 1px solid var(--trz-border-strong);
          border-radius: 6px;
          background: var(--trz-bg);
          color: var(--trz-text);
          font: inherit;
        }
      }
    }
    .form-actions { display: flex; gap: 0.45rem; }
    h2 { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--trz-text-subtle); margin: 0 0 0.8rem; }
    .pages-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.75rem; }
    .page-card {
      display: flex; align-items: center; gap: 0.65rem;
      padding: 0.85rem 1rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      color: var(--trz-text);
      text-decoration: none;
      transition: border-color 140ms ease, background 140ms ease;
      &:hover { border-color: var(--trz-border-strong); background: var(--trz-bg-subtle); }
    }
    .page-title { font-weight: 600; font-size: 0.92rem; }
    .page-meta { font-size: 0.74rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); margin-top: 0.15rem; }
  `,
})
export class WorkspaceViewComponent {
  protected readonly store = inject(KnowledgeStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);

  private readonly orgSlug = signal('');
  private readonly wsSlug = signal('');
  protected readonly editing = signal(false);
  protected editName = '';
  protected editSlug = '';
  protected editDescription = '';

  protected readonly organization = computed(() =>
    this.store.organizations().find((o) => o.slug === this.orgSlug() && o.status !== 'deleted') ?? null,
  );

  protected readonly workspace = computed(() => {
    const org = this.organization();
    if (!org) return null;
    return (
      this.store
        .workspaces()
        .find((w) => w.organizationId === org.id && w.slug === this.wsSlug() && w.status !== 'deleted') ?? null
    );
  });

  protected readonly rootPages = computed(() => {
    const ws = this.workspace();
    return ws
      ? this.store.getPagesForWorkspace(ws.id).filter((p) => p.parentId === null)
      : [];
  });

  protected readonly breadcrumbs = computed(() => {
    const org = this.organization();
    const ws = this.workspace();
    if (!org || !ws) return [];
    return [
      { type: 'organization' as const, id: org.id, label: org.name, slug: org.slug, icon: org.icon, route: `/o/${org.slug}` },
      { type: 'workspace' as const, id: ws.id, label: ws.name, slug: ws.slug, icon: ws.icon, route: `/o/${org.slug}/${ws.slug}` },
    ];
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(async (params) => {
      await this.store.initialize();
      this.orgSlug.set(params.get('orgSlug') ?? '');
      this.wsSlug.set(params.get('wsSlug') ?? '');
      this.editing.set(false);
      const ws = this.workspace();
      if (ws) {
        this.editName = ws.name;
        this.editSlug = ws.slug;
        this.editDescription = ws.description ?? '';
      }
    });
  }

  protected async createRootPage(org: Organization, ws: Workspace): Promise<void> {
    const title = window.prompt('Título de la nueva página:');
    if (!title?.trim()) return;
    const page = await this.store.createPage({
      organizationId: org.id,
      workspaceId: ws.id,
      parentId: null,
      title: title.trim(),
    });
    const path = this.store.getCanonicalPath(page.id);
    this.snackbar.open({ message: `Página "${page.title}" creada.`, tone: 'success' });
    await this.router.navigateByUrl(path);
  }

  protected async saveWs(org: Organization, ws: Workspace): Promise<void> {
    const updated = await this.store.updateWorkspace(ws.id, {
      name: this.editName,
      slug: this.editSlug,
      description: this.editDescription || null,
    });
    this.editing.set(false);
    this.snackbar.open({ message: 'Espacio actualizado.', tone: 'success' });
    if (updated.slug !== ws.slug) {
      await this.router.navigate(['/o', org.slug, updated.slug], { replaceUrl: true });
    }
  }

  protected async deleteWs(org: Organization, ws: Workspace): Promise<void> {
    if (!window.confirm(`¿Eliminar el espacio "${ws.name}"?`)) return;
    await this.store.deleteWorkspace(ws.id);
    this.snackbar.open({ message: 'Espacio eliminado.', tone: 'warning' });
    await this.router.navigate(['/o', org.slug]);
  }
}
