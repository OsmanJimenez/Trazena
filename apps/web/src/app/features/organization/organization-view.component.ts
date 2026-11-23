import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Organization } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';

@Component({
  selector: 'trz-organization-view',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (organization(); as org) {
      <div class="org-view">
        <header class="view-header">
          <div>
            <span class="eyebrow">Organización · /o/{{ org.slug }}</span>
            <h1>{{ org.name }}</h1>
            <p class="desc">{{ org.description || 'Sin descripción configurada.' }}</p>
          </div>
          <div class="actions">
            <button atrButton type="button" size="small" appearance="filled" (click)="createWorkspace(org)">
              + Nuevo espacio
            </button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="editing.set(!editing())">
              Editar
            </button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="exportOrg(org)">
              Exportar JSON
            </button>
            <button atrButton type="button" size="small" appearance="text" (click)="deleteOrg(org)">
              Eliminar
            </button>
          </div>
        </header>

        @if (editing()) {
          <atr-card appearance="outlined">
            <div class="card-inner">
              <h3>Propiedades de la organización</h3>
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
                <button atrButton type="button" size="small" (click)="saveOrg(org)">Guardar cambios</button>
                <button atrButton type="button" size="small" appearance="text" (click)="editing.set(false)">Cancelar</button>
              </div>
            </div>
          </atr-card>
        }

        <section>
          <h2>Espacios ({{ workspaces().length }})</h2>
          @if (workspaces().length > 0) {
            <div class="ws-grid">
              @for (ws of workspaces(); track ws.id) {
                <a class="ws-card-link" [routerLink]="['/o', org.slug, ws.slug]">
                  <atr-card appearance="outlined" class="ws-card">
                    <div class="card-inner">
                      <div class="ws-top">
                        <atr-icon [name]="ws.icon || 'book'" size="small" />
                        <h3>{{ ws.name }}</h3>
                      </div>
                      <p>{{ ws.description || 'Espacio de documentación.' }}</p>
                      <span class="meta">{{ store.getPagesForWorkspace(ws.id).length }} página(s)</span>
                    </div>
                  </atr-card>
                </a>
              }
            </div>
          } @else {
            <atr-empty-state
              title="Sin espacios todavía"
              description="Crea un espacio dentro de esta organización para comenzar a redactar páginas."
            />
          }
        </section>
      </div>
    } @else {
      <atr-empty-state title="Organización no encontrada" description="Verifica el slug en la URL." />
    }
  `,
  styles: `
    .org-view { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.65rem; }
    .view-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 1rem; align-items: flex-start; }
    .eyebrow { font-size: 0.76rem; font-family: var(--trz-font-mono); color: var(--trz-text-subtle); }
    h1 { margin: 0.2rem 0 0; font-size: clamp(1.5rem, 2.5vw, 1.9rem); letter-spacing: -0.025em; }
    .desc { margin: 0.35rem 0 0; color: var(--trz-text-muted); font-size: 0.92rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .card-inner {
      padding: 1.15rem 1.25rem;
      display: flex; flex-direction: column; gap: 0.85rem;
      h3 { margin: 0; font-size: 1rem; }
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.85rem;
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
    h2 { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--trz-text-subtle); margin: 0 0 0.85rem; }
    .ws-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.9rem; }
    .ws-card-link { text-decoration: none; color: inherit; display: block; }
    .ws-card {
      height: 100%;
      &:hover { border-color: var(--trz-border-strong) !important; }
      p { margin: 0; font-size: 0.85rem; color: var(--trz-text-muted); line-height: 1.45; }
    }
    .ws-top { display: flex; align-items: center; gap: 0.5rem; h3 { margin: 0; font-size: 1rem; } }
    .meta { font-size: 0.74rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); }
  `,
})
export class OrganizationViewComponent {
  protected readonly store = inject(KnowledgeStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly dialogs = inject(TrazenaDialogsService);

  private readonly slug = signal('');
  protected readonly editing = signal(false);
  protected editName = '';
  protected editSlug = '';
  protected editDescription = '';

  protected readonly organization = computed(() =>
    this.store.organizations().find((o) => o.slug === this.slug() && o.status !== 'deleted') ?? null,
  );

  protected readonly workspaces = computed(() => {
    const org = this.organization();
    return org ? this.store.getWorkspacesForOrg(org.id) : [];
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(async (params) => {
      await this.store.initialize();
      const s = params.get('orgSlug') ?? '';
      this.slug.set(s);
      this.editing.set(false);
      const org = this.organization();
      if (org) {
        this.editName = org.name;
        this.editSlug = org.slug;
        this.editDescription = org.description ?? '';
      }
    });
  }

  protected async saveOrg(org: Organization): Promise<void> {
    const updated = await this.store.updateOrganization(org.id, {
      name: this.editName,
      slug: this.editSlug,
      description: this.editDescription || null,
    });
    this.editing.set(false);
    this.snackbar.open({ message: 'Organización actualizada.', tone: 'success' });
    if (updated.slug !== org.slug) {
      await this.router.navigate(['/o', updated.slug], { replaceUrl: true });
    }
  }

  protected async createWorkspace(org: Organization): Promise<void> {
    const name = await this.dialogs.prompt({
      title: 'Nuevo espacio',
      label: 'Nombre del espacio',
      placeholder: 'Ej. Documentación, Arquitectura…',
      confirmText: 'Crear',
    });
    if (!name) return;
    const ws = await this.store.createWorkspace({ organizationId: org.id, name });
    this.snackbar.open({ message: `Espacio "${ws.name}" creado.`, tone: 'success' });
    await this.router.navigate(['/o', org.slug, ws.slug]);
  }

  protected async exportOrg(org: Organization): Promise<void> {
    const payload = await this.store.exportOrganization(org.id);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trazena-${org.slug}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.snackbar.open({ message: 'Exportación JSON descargada.', tone: 'success' });
  }

  protected async deleteOrg(org: Organization): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Eliminar organización',
      message: `¿Eliminar "${org.name}"? Esta acción ocultará sus espacios y páginas.`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await this.store.deleteOrganization(org.id);
    this.snackbar.open({ message: 'Organización eliminada.', tone: 'warning' });
    await this.router.navigate(['/']);
  }
}
