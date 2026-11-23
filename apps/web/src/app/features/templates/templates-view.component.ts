import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { DocumentTemplate } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';

@Component({
  selector: 'trz-templates-view',
  standalone: true,
  imports: [FormsModule, AtralumeButton, AtralumeCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tpl-page">
      <header class="header">
        <div>
          <h1>Plantillas de documentación</h1>
          <p>Plantillas editables con variables seguras <code ngNonBindable>{{title}}</code> y <code ngNonBindable>{{date}}</code>.</p>
        </div>
        <button atrButton type="button" size="small" appearance="filled" (click)="startNew()">
          + Nueva plantilla
        </button>
      </header>

      @if (editing(); as draft) {
        <atr-card appearance="outlined">
          <div class="editor-inner">
            <h2>{{ draft.id ? 'Editar plantilla' : 'Nueva plantilla' }}</h2>
            <div class="grid">
              <label>
                <span>Nombre</span>
                <input type="text" [(ngModel)]="draft.name" />
              </label>
              <label>
                <span>Categoría</span>
                <input type="text" [(ngModel)]="draft.category" />
              </label>
              <label class="full">
                <span>Descripción</span>
                <input type="text" [(ngModel)]="draft.description" />
              </label>
              <label class="full">
                <span>Contenido Markdown</span>
                <textarea rows="10" [(ngModel)]="draft.markdown"></textarea>
              </label>
            </div>
            <div class="actions">
              <button atrButton type="button" size="small" appearance="filled" (click)="saveDraft()">Guardar</button>
              <button atrButton type="button" size="small" appearance="text" (click)="editing.set(null)">Cancelar</button>
            </div>
          </div>
        </atr-card>
      }

      <div class="tpl-grid">
        @for (tpl of meta.templates(); track tpl.id) {
          <atr-card appearance="outlined">
            <div class="tpl-inner">
              <div class="tpl-top">
                <span class="cat">{{ tpl.category }}</span>
                <h3>{{ tpl.name }}</h3>
                <p>{{ tpl.description || 'Plantilla Markdown reutilizable.' }}</p>
              </div>
              <div class="tpl-actions">
                <button atrButton type="button" size="small" appearance="filled" (click)="useTemplate(tpl)">
                  Crear página
                </button>
                <button atrButton type="button" size="small" appearance="outlined" (click)="editTemplate(tpl)">
                  Editar
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="duplicateTemplate(tpl)">
                  Duplicar
                </button>
                <button atrButton type="button" size="small" appearance="text" (click)="deleteTemplate(tpl)">
                  Eliminar
                </button>
              </div>
            </div>
          </atr-card>
        }
      </div>
    </div>
  `,
  styles: `
    .tpl-page { max-width: 980px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.35rem; }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.25rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .editor-inner { padding: 1.25rem; display: flex; flex-direction: column; gap: 0.9rem; h2 { margin: 0; font-size: 1rem; } }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.8rem;
      label {
        display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.82rem; font-weight: 500;
        &.full { grid-column: 1 / -1; }
        input, textarea {
          padding: 0.55rem 0.75rem; border: 1px solid var(--trz-border-strong);
          border-radius: 6px; background: var(--trz-bg); color: var(--trz-text); font: inherit;
        }
        textarea { font-family: var(--trz-font-mono); font-size: 0.84rem; }
      }
    }
    .actions { display: flex; gap: 0.45rem; }
    .tpl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 0.9rem; }
    .tpl-inner { padding: 1.15rem; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; height: 100%; }
    .cat { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--trz-accent); font-weight: 600; }
    .tpl-top h3 { margin: 0.25rem 0 0.35rem; font-size: 1rem; }
    .tpl-top p { margin: 0; font-size: 0.84rem; color: var(--trz-text-muted); line-height: 1.45; }
    .tpl-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  `,
})
export class TemplatesViewComponent implements OnInit {
  protected readonly meta = inject(KnowledgeMetaService);
  private readonly store = inject(KnowledgeStore);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly router = inject(Router);

  protected readonly editing = signal<{
    id?: string;
    name: string;
    category: string;
    description: string;
    markdown: string;
  } | null>(null);

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    await this.meta.initialize();
  }

  protected startNew(): void {
    this.editing.set({
      name: '',
      category: 'General',
      description: '',
      markdown: '# {{title}}\n\n**Fecha:** {{date}}\n\n',
    });
  }

  protected editTemplate(tpl: DocumentTemplate): void {
    this.editing.set({
      id: tpl.id,
      name: tpl.name,
      category: tpl.category,
      description: tpl.description,
      markdown: tpl.markdown,
    });
  }

  protected async saveDraft(): Promise<void> {
    const d = this.editing();
    if (!d || !d.name.trim()) return;
    await this.meta.saveTemplate(d);
    this.editing.set(null);
    this.snackbar.open({ message: 'Plantilla guardada.', tone: 'success' });
  }

  protected async duplicateTemplate(tpl: DocumentTemplate): Promise<void> {
    await this.meta.saveTemplate({
      name: `${tpl.name} (copia)`,
      category: tpl.category,
      description: tpl.description,
      markdown: tpl.markdown,
    });
    this.snackbar.open({ message: 'Plantilla duplicada.', tone: 'success' });
  }

  protected async deleteTemplate(tpl: DocumentTemplate): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Eliminar plantilla',
      message: `¿Eliminar la plantilla "${tpl.name}"?`,
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await this.meta.deleteTemplate(tpl.id);
    this.snackbar.open({ message: 'Plantilla eliminada.', tone: 'warning' });
  }

  protected async useTemplate(tpl: DocumentTemplate): Promise<void> {
    const org = this.store.activeOrganizations()[0];
    if (!org) return;
    const ws = this.store.getWorkspacesForOrg(org.id)[0];
    if (!ws) return;
    const title = await this.dialogs.prompt({
      title: `Nueva página desde "${tpl.name}"`,
      label: 'Título del documento',
      placeholder: 'Ej. Especificación de API…',
      confirmText: 'Crear página',
    });
    if (!title) return;
    const markdown = this.meta.renderTemplateMarkdown(tpl, title);
    const created = await this.store.createPage({
      organizationId: org.id,
      workspaceId: ws.id,
      parentId: null,
      title,
      markdown,
    });
    this.snackbar.open({ message: `Página "${created.title}" creada desde plantilla.`, tone: 'success' });
    await this.router.navigateByUrl(this.store.getCanonicalPath(created.id));
  }
}
