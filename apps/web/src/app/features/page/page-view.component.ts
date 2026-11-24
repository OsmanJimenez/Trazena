import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { ResolvedRouteResult } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeDialog } from '@osmanjimenez/atralume/dialog';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import { KnowledgeHealthService } from '../../core/productivity/knowledge-health.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';
import { WorkspaceTabsService } from '../../core/workspace/workspace-tabs.service';
import { PageExportDialogComponent, type ExportDialogData } from '../export/page-export-dialog.component';
import { PageBreadcrumbsComponent } from './page-breadcrumbs.component';
import { PageEditorComponent } from './page-editor.component';
import { PageHistoryPanelComponent } from './page-history-panel.component';
import { PageKnowledgePanelComponent } from './page-knowledge-panel.component';

@Component({
  selector: 'trz-page-view',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    AtralumeButton,
    AtralumeEmptyState,
    AtralumeIcon,
    PageBreadcrumbsComponent,
    PageEditorComponent,
    PageHistoryPanelComponent,
    PageKnowledgePanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notFound()) {
      <atr-empty-state
        title="Página no encontrada"
        description="La ruta solicitada no existe o fue eliminada."
      />
    } @else if (resolved(); as data) {
      @if (data.page; as page) {
        <div class="doc-container">
          <div class="doc-header-bar">
            <trz-page-breadcrumbs [segments]="data.breadcrumbs" />
            <div class="doc-actions">
              <div class="doc-actions-primary">
                <button
                  atrButton
                  type="button"
                  size="small"
                  appearance="outlined"
                  [title]="meta.isFavorite(page.id) ? 'Quitar de favoritos' : 'Añadir a favoritos'"
                  (click)="toggleFavorite(page.id)"
                >
                  {{ meta.isFavorite(page.id) ? '★ Favorito' : '☆ Favorito' }}
                </button>
                <button atrButton type="button" size="small" appearance="outlined" (click)="openExport(page)">
                  Exportar
                </button>
                <button atrButton type="button" size="small" appearance="outlined" (click)="openInSplit(page, data.canonicalPath)">
                  Dividir
                </button>
              </div>
              <span class="doc-actions-sep" aria-hidden="true"></span>
              <div class="doc-actions-secondary">
                <button atrButton type="button" size="small" appearance="text" (click)="knowledgeOpen.set(!knowledgeOpen())">
                  {{ knowledgeOpen() ? 'Ocultar propiedades' : 'Propiedades / TOC' }}
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="markAsReviewed(page)">
                  Revisado
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="saveAsTemplate(page)">
                  Plantilla
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="historyOpen.set(!historyOpen())">
                  Historial
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="createSubpage()">
                  + Subpágina
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="duplicatePage()">
                  Duplicar
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="toggleMovePanel()">
                  Mover
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="archivePage()">
                  Archivar
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="trashPage()">
                  Papelera
                </button>
              </div>
            </div>
          </div>

          <header class="doc-title-block">
            <input
              class="doc-title-input"
              type="text"
              placeholder="Sin título"
              [ngModel]="titleDraft()"
              (ngModelChange)="titleDraft.set($event)"
              (blur)="commitTitle()"
              (keydown.enter)="commitTitle()"
              aria-label="Título de la página"
            />
            <div class="doc-meta-row">
              <code class="slug-value">{{ data.canonicalPath }}</code>
              <button type="button" class="slug-edit-btn" (click)="renameSlug()">Editar ruta</button>
            </div>
          </header>

          @if (moveOpen()) {
            <div class="move-panel">
              <strong>Mover página</strong>
              <div class="move-controls">
                <label>
                  <span>Espacio destino</span>
                  <select [ngModel]="moveTargetWsId()" (ngModelChange)="moveTargetWsId.set($event); moveTargetParentId.set('')">
                    @for (ws of orgWorkspaces(); track ws.id) {
                      <option [value]="ws.id">{{ ws.name }}</option>
                    }
                  </select>
                </label>
                <label>
                  <span>Página padre</span>
                  <select [ngModel]="moveTargetParentId()" (ngModelChange)="moveTargetParentId.set($event)">
                    <option value="">(Raíz del espacio)</option>
                    @for (candidate of moveCandidates(); track candidate.id) {
                      <option [value]="candidate.id">{{ candidate.title }}</option>
                    }
                  </select>
                </label>
                <div class="move-btns">
                  <button atrButton type="button" size="small" appearance="filled" (click)="confirmMove()">Mover aquí</button>
                  <button atrButton type="button" size="small" appearance="text" (click)="moveOpen.set(false)">Cancelar</button>
                </div>
              </div>
            </div>
          }

          @if (historyOpen()) {
            <trz-page-history-panel
              [pageId]="page.id"
              [currentMarkdown]="page.content.markdown"
              (closed)="historyOpen.set(false)"
              (restored)="onHistoryRestored($event)"
            />
          }

          @if (knowledgeOpen()) {
            <trz-page-knowledge-panel [page]="page" [markdown]="page.content.markdown" />
          }

          <trz-page-editor
            [pageId]="page.id"
            [initialMarkdown]="page.content.markdown"
            [revision]="page.revision"
            (saved)="onContentSaved($event)"
          />

          @if (childPages().length > 0) {
            <section class="subpages-section">
              <h2>Subpáginas ({{ childPages().length }})</h2>
              <div class="subpages-grid">
                @for (child of childPages(); track child.id) {
                  <a class="subpage-card" [routerLink]="store.getCanonicalPath(child.id)">
                    <atr-icon [name]="child.icon || 'file-text'" size="small" />
                    <span>{{ child.title }}</span>
                  </a>
                }
              </div>
            </section>
          }
        </div>
      }
    }
  `,
  styles: `
    .doc-container {
      max-width: 820px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    /* Level 3a Ribbon: Document contextual actions */
    .doc-header-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem 1rem;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--trz-border);
    }

    .doc-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.35rem;
    }

    .doc-actions-primary,
    .doc-actions-secondary {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.2rem;
    }

    .doc-actions-sep {
      width: 1px;
      height: 18px;
      background: var(--trz-border-strong);
      margin: 0 0.15rem;
    }

    .doc-title-block {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding-top: 0.25rem;
    }

    .doc-title-input {
      width: 100%;
      border: 0;
      outline: none;
      background: transparent;
      color: var(--trz-text);
      font-family: inherit;
      font-size: clamp(1.65rem, 3vw, 2.35rem);
      font-weight: 750;
      letter-spacing: -0.03em;
      line-height: 1.2;
      padding: 0;
    }

    .doc-meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.76rem;
      color: var(--trz-text-subtle);
    }

    .slug-value {
      font-family: var(--trz-font-mono);
      background: var(--trz-bg-subtle);
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      max-width: 100%;
      overflow-x: auto;
    }

    .slug-edit-btn {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-accent);
      font: inherit;
      cursor: pointer;
      padding: 0;
      &:hover { text-decoration: underline; }
    }

    .move-panel {
      padding: 0.9rem 1rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-subtle);
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
      font-size: 0.84rem;
    }

    .move-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem;

      label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.78rem;
        color: var(--trz-text-muted);
      }

      select {
        height: 34px;
        min-width: 180px;
      }
    }

    .move-btns {
      display: flex;
      gap: 0.35rem;
    }

    .subpages-section {
      margin-top: 0.5rem;
      padding-top: 1rem;
      border-top: 1px solid var(--trz-border);

      h2 {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--trz-text-subtle);
        margin: 0 0 0.7rem;
      }
    }

    .subpages-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 0.6rem;
    }

    .subpage-card {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-elevated);
      color: var(--trz-text);
      text-decoration: none;
      font-size: 0.88rem;
      font-weight: 500;
      transition: border-color 140ms ease, background 140ms ease;

      &:hover {
        border-color: var(--trz-border-strong);
        background: var(--trz-bg-subtle);
      }
    }
  `,
})
export class PageViewComponent {
  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  private readonly health = inject(KnowledgeHealthService);
  private readonly tabs = inject(WorkspaceTabsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly dialog = inject(AtralumeDialog);

  protected readonly resolved = signal<ResolvedRouteResult | null>(null);
  protected readonly notFound = signal(false);
  protected readonly titleDraft = signal('');
  protected readonly moveOpen = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly knowledgeOpen = signal(true);
  protected readonly moveTargetWsId = signal('');
  protected readonly moveTargetParentId = signal('');

  protected readonly childPages = computed(() => {
    const page = this.resolved()?.page;
    if (!page) return [];
    return this.store
      .getPagesForWorkspace(page.workspaceId)
      .filter((p) => p.parentId === page.id);
  });

  protected readonly orgWorkspaces = computed(() => {
    const org = this.resolved()?.organization;
    return org ? this.store.getWorkspacesForOrg(org.id) : [];
  });

  protected readonly moveCandidates = computed(() => {
    const page = this.resolved()?.page;
    const wsId = this.moveTargetWsId();
    if (!page || !wsId) return [];
    return this.store
      .getPagesForWorkspace(wsId)
      .filter((p) => p.id !== page.id);
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const orgSlug = params.get('orgSlug') ?? '';
      const wsSlug = params.get('wsSlug') ?? '';
      const pagePath = params.get('pagePath') ?? '';
      void this.load(orgSlug, wsSlug, pagePath);
    });
  }

  private async load(orgSlug: string, wsSlug: string, pagePath: string): Promise<void> {
    this.notFound.set(false);
    this.moveOpen.set(false);
    const segments = pagePath.split('/').filter(Boolean);
    const res = await this.store.resolveRoute(orgSlug, wsSlug, segments);
    if (!res?.page) {
      this.resolved.set(null);
      this.notFound.set(true);
      return;
    }

    if (res.redirectedFromAlias) {
      await this.router.navigateByUrl(res.canonicalPath, { replaceUrl: true });
      return;
    }

    this.resolved.set(res);
    this.titleDraft.set(res.page.title);
    await this.meta.initialize();
    void this.meta.recordRecentVisit(res.page.id);
    this.tabs.openPageInTab(res.page, res.canonicalPath, { pane: 'left', activate: true });
  }

  protected openInSplit(page: { id: string; title: string; icon: string | null }, canonicalPath: string): void {
    this.tabs.splitRight(page, canonicalPath);
  }

  protected async markAsReviewed(page: Parameters<KnowledgeHealthService['markPageReviewed']>[0]): Promise<void> {
    await this.health.markPageReviewed(page);
    this.snackbar.open({
      message: 'Documento marcado como revisado hoy (sin alterar historial).',
      tone: 'success',
    });
  }

  protected async toggleFavorite(pageId: string): Promise<void> {
    const added = await this.meta.toggleFavorite(pageId);
    this.snackbar.open({
      message: added ? 'Añadida a favoritos.' : 'Quitada de favoritos.',
      tone: 'info',
    });
  }

  protected openExport(page: { id: string; title: string }): void {
    const data: ExportDialogData = {
      defaultScope: 'page',
      allowSubtreeToggle: true,
      targetIds: [page.id],
      title: page.title,
    };
    this.dialog.open(PageExportDialogComponent, {
      data,
      size: 'm',
      closable: false,
    });
  }

  protected async saveAsTemplate(page: {
    organizationId: string;
    title: string;
    content: { markdown: string };
  }): Promise<void> {
    const name = await this.dialogs.prompt({
      title: 'Guardar como plantilla',
      label: 'Nombre de la plantilla reutilizable',
      initialValue: page.title,
      confirmText: 'Guardar plantilla',
    });
    if (!name) return;
    await this.meta.saveTemplate({
      organizationId: page.organizationId,
      name,
      category: 'Personalizada',
      description: `Plantilla creada a partir de "${page.title}".`,
      markdown: page.content.markdown,
    });
    this.snackbar.open({
      message: `Plantilla "${name}" guardada en /templates.`,
      tone: 'success',
    });
  }

  protected async commitTitle(): Promise<void> {
    const page = this.resolved()?.page;
    const next = this.titleDraft().trim();
    if (!page || !next || next === page.title) return;
    await this.store.updatePageMeta(page.id, { title: next });
    const current = this.resolved();
    if (current?.page) {
      this.resolved.set({
        ...current,
        page: { ...current.page, title: next },
        breadcrumbs: current.breadcrumbs.map((b) =>
          b.id === page.id ? { ...b, label: next } : b,
        ),
      });
    }
  }

  protected async renameSlug(): Promise<void> {
    const page = this.resolved()?.page;
    if (!page) return;
    const next = await this.dialogs.prompt({
      title: 'Editar ruta (slug)',
      label: 'Nuevo slug URL (la ruta anterior seguirá redirigiendo)',
      initialValue: page.slug,
      confirmText: 'Actualizar',
    });
    if (!next || next === page.slug) return;
    await this.store.updatePageMeta(page.id, { slug: next });
    const newPath = this.store.getCanonicalPath(page.id);
    this.snackbar.open({ message: 'Ruta actualizada con alias de redirección.', tone: 'success' });
    await this.router.navigateByUrl(newPath, { replaceUrl: true });
  }

  protected async createSubpage(): Promise<void> {
    const page = this.resolved()?.page;
    if (!page) return;
    const title = await this.dialogs.prompt({
      title: 'Nueva subpágina',
      label: 'Título de la subpágina',
      placeholder: 'Ej. Detalles técnicos…',
      confirmText: 'Crear',
    });
    if (!title) return;
    const created = await this.store.createPage({
      organizationId: page.organizationId,
      workspaceId: page.workspaceId,
      parentId: page.id,
      title,
    });
    const path = this.store.getCanonicalPath(created.id);
    this.snackbar.open({ message: `Subpágina "${created.title}" creada.`, tone: 'success' });
    await this.router.navigateByUrl(path);
  }

  protected async duplicatePage(): Promise<void> {
    const page = this.resolved()?.page;
    if (!page) return;
    const copy = await this.store.duplicatePage(page.id);
    const path = this.store.getCanonicalPath(copy.id);
    this.snackbar.open({ message: `Página duplicada como "${copy.title}".`, tone: 'success' });
    await this.router.navigateByUrl(path);
  }

  protected toggleMovePanel(): void {
    const page = this.resolved()?.page;
    if (!page) return;
    this.moveTargetWsId.set(page.workspaceId);
    this.moveTargetParentId.set(page.parentId ?? '');
    this.moveOpen.update((v) => !v);
  }

  protected async confirmMove(): Promise<void> {
    const page = this.resolved()?.page;
    if (!page) return;
    try {
      await this.store.movePage(page.id, {
        targetWorkspaceId: this.moveTargetWsId(),
        targetParentId: this.moveTargetParentId() || null,
      });
      this.moveOpen.set(false);
      const newPath = this.store.getCanonicalPath(page.id);
      this.snackbar.open({ message: 'Página movida correctamente.', tone: 'success' });
      await this.router.navigateByUrl(newPath, { replaceUrl: true });
    } catch (err) {
      this.snackbar.open({
        message: err instanceof Error ? err.message : 'No se pudo mover la página.',
        tone: 'error',
      });
    }
  }

  protected async archivePage(): Promise<void> {
    const data = this.resolved();
    if (!data?.page || !data.workspace) return;
    await this.store.updatePageMeta(data.page.id, { status: 'archived' });
    this.snackbar.open({ message: 'Página archivada.', tone: 'info' });
    await this.router.navigate(['/o', data.organization.slug, data.workspace.slug]);
  }

  protected async trashPage(): Promise<void> {
    const data = this.resolved();
    if (!data?.page || !data.workspace) return;
    const ok = await this.dialogs.confirm({
      title: 'Enviar a papelera',
      message: `¿Enviar "${data.page.title}" y sus subpáginas a la papelera?`,
      confirmText: 'Enviar a papelera',
      danger: true,
    });
    if (!ok) return;
    await this.store.deletePage(data.page.id, false);
    this.snackbar.open({ message: 'Página enviada a la papelera.', tone: 'warning' });
    await this.router.navigate(['/o', data.organization.slug, data.workspace.slug]);
  }

  protected onContentSaved(ev: { revision: number; markdown: string }): void {
    const current = this.resolved();
    if (!current?.page) return;
    this.resolved.set({
      ...current,
      page: {
        ...current.page,
        revision: ev.revision,
        content: { ...current.page.content, markdown: ev.markdown },
      },
    });
  }

  protected onHistoryRestored(ev: { revision: number; markdown: string }): void {
    this.onContentSaved(ev);
    const data = this.resolved();
    if (data) {
      // Force reload of editor content with restored snapshot
      void this.router.navigateByUrl('/', { skipLocationChange: true }).then(() =>
        this.router.navigateByUrl(data.canonicalPath),
      );
    }
  }
}
