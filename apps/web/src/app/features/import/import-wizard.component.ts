import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  ImportExecutionResult,
  ImportMode,
  ImportPreviewSummary,
} from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { ImportEngineService } from '../../core/import/import-engine.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';

@Component({
  selector: 'trz-import-wizard',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="import-page">
      <header class="header">
        <div>
          <h1>Importar documentación</h1>
          <p>
            Importa archivos Markdown (<code>.md</code>), carpetas Obsidian, exportaciones ZIP de Notion
            o respaldos JSON v2 de Trazena de forma 100 % local y sin sincronización automática.
          </p>
        </div>
      </header>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>1. Destino y selección de archivos</h2>
          <div class="dest-grid">
            <label>
              <span>Organización destino</span>
              <select [ngModel]="targetOrgId()" (ngModelChange)="onOrgChange($event)">
                @for (org of store.activeOrganizations(); track org.id) {
                  <option [value]="org.id">{{ org.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Espacio destino</span>
              <select [ngModel]="targetWorkspaceId()" (ngModelChange)="targetWorkspaceId.set($event)">
                @for (ws of workspaces(); track ws.id) {
                  <option [value]="ws.id">{{ ws.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Modo de importación</span>
              <select [ngModel]="mode()" (ngModelChange)="mode.set($event)">
                <option value="new">Importar como contenido nuevo (IDs nuevos)</option>
                <option value="restore">Restaurar exportación Trazena JSON</option>
              </select>
            </label>
          </div>

          <div class="pickers">
            <label class="file-btn">
              <input
                type="file"
                accept=".md,.markdown,.zip,.json"
                multiple
                (change)="onFilesSelected($event)"
              />
              <span>Seleccionar archivos (.md, .zip, .json)</span>
            </label>
            <label class="file-btn">
              <input
                type="file"
                webkitdirectory
                multiple
                (change)="onFilesSelected($event)"
              />
              <span>Seleccionar carpeta Markdown / Obsidian</span>
            </label>
          </div>

          @if (analyzing()) {
            <p class="status-note">Analizando estructura, jerarquía, duplicados y referencias…</p>
          }
          @if (error(); as err) {
            <p class="err-box" role="alert">{{ err }}</p>
          }
        </div>
      </atr-card>

      @if (preview(); as prev) {
        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>2. Vista previa — {{ prev.sourceLabel }}</h2>
            <div class="summary-strip">
              <div class="stat">
                <strong>{{ prev.items.length }}</strong>
                <span>Páginas detectadas</span>
              </div>
              <div class="stat">
                <strong>{{ prev.folderCount }}</strong>
                <span>Carpetas / secciones</span>
              </div>
              <div class="stat">
                <strong>{{ prev.duplicateCount }}</strong>
                <span>Posibles duplicados</span>
              </div>
              <div class="stat">
                <strong>{{ prev.unresolvedLinksCount }}</strong>
                <span>Enlaces sin resolver</span>
              </div>
              <div class="stat">
                <strong>{{ prev.missingAssetsCount }}</strong>
                <span>Recursos locales faltantes</span>
              </div>
            </div>

            @if (prev.warnings.length > 0) {
              <div class="warnings-box">
                <strong>Advertencias de compatibilidad y seguridad</strong>
                <ul>
                  @for (w of prev.warnings; track w) {
                    <li>{{ w }}</li>
                  }
                </ul>
              </div>
            }

            <label class="check-row">
              <input
                type="checkbox"
                [ngModel]="skipDuplicates()"
                (ngModelChange)="skipDuplicates.set($event)"
              />
              <span>Omitir páginas detectadas como duplicadas</span>
            </label>

            <div class="preview-tree">
              @for (item of prev.items.slice(0, 60); track item.tempId) {
                <div class="tree-row" [style.paddingLeft.rem]="0.6 + item.depth * 1.1">
                  <span class="tree-title">{{ item.title }}</span>
                  <span class="tree-path">{{ item.originalPath }}</span>
                  @if (item.duplicateOfPageId) {
                    <span class="badge warn">Duplicado ({{ item.duplicateReason === 'content' ? 'contenido' : 'título' }})</span>
                  }
                  @if (item.unresolvedLinks.length > 0) {
                    <span class="badge muted">{{ item.unresolvedLinks.length }} enlace(s) sin destino</span>
                  }
                </div>
              }
              @if (prev.items.length > 60) {
                <p class="more-hint">… y {{ prev.items.length - 60 }} página(s) adicionales.</p>
              }
            </div>

            <div class="actions">
              <button
                atrButton
                type="button"
                appearance="filled"
                size="small"
                [loading]="importing()"
                (click)="runImport()"
              >
                Confirmar e importar localmente
              </button>
              <button atrButton type="button" appearance="text" size="small" (click)="preview.set(null)">
                Descartar vista previa
              </button>
            </div>
          </div>
        </atr-card>
      } @else if (!result()) {
        <atr-empty-state
          appearance="compact"
          title="Ningún archivo analizado todavía"
          description="La lectura previa no modifica ninguna página hasta que confirmes la importación."
        />
      }

      @if (result(); as res) {
        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Importación completada localmente</h2>
            <p class="status-note">
              Creadas: <strong>{{ res.createdPages }}</strong> · Actualizadas: <strong>{{ res.updatedPages }}</strong> ·
              Omitidas: <strong>{{ res.skippedPages }}</strong> · Etiquetas aplicadas: <strong>{{ res.createdTags }}</strong>.
              Los cambios quedaron registrados en la Outbox para tu próxima sincronización manual.
            </p>
            <div class="actions">
              <a atrButton size="small" appearance="outlined" routerLink="/explore">Ir al Explorador</a>
              <a atrButton size="small" appearance="text" routerLink="/settings/sync">Ver Outbox</a>
            </div>
          </div>
        </atr-card>
      }
    </div>
  `,
  styles: `
    .import-page { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.85rem); letter-spacing: -0.025em; }
    .header p { margin: 0.35rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; max-width: 72ch; }
    .card-inner { padding: 1.2rem 1.35rem; display: flex; flex-direction: column; gap: 0.9rem; h2 { margin: 0; font-size: 0.98rem; font-weight: 650; } }
    .dest-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem;
      label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: var(--trz-text-muted); font-weight: 500; }
    }
    .pickers { display: flex; flex-wrap: wrap; gap: 0.65rem; }
    .file-btn {
      display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem;
      border: 1px dashed var(--trz-border-strong); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle); color: var(--trz-text); font-size: 0.84rem; font-weight: 500; cursor: pointer;
      input { display: none; }
      &:hover { border-color: var(--trz-accent); color: var(--trz-accent); }
    }
    .summary-strip {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 0.6rem;
    }
    .stat {
      padding: 0.65rem 0.8rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm); background: var(--trz-bg-subtle);
      display: flex; flex-direction: column; gap: 0.15rem;
      strong { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
      span { font-size: 0.74rem; color: var(--trz-text-muted); }
    }
    .warnings-box {
      padding: 0.75rem 0.9rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-warning) 10%, transparent); font-size: 0.82rem;
      ul { margin: 0.35rem 0 0; padding-left: 1.15rem; }
    }
    .check-row { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; cursor: pointer; input { accent-color: var(--trz-accent); } }
    .preview-tree {
      max-height: 300px; overflow-y: auto; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
    }
    .tree-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--trz-border); font-size: 0.82rem;
      &:last-child { border-bottom: 0; }
    }
    .tree-title { font-weight: 600; }
    .tree-path { font-family: var(--trz-font-mono); font-size: 0.73rem; color: var(--trz-text-subtle); }
    .badge {
      font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 999px;
      &.warn { background: color-mix(in srgb, var(--trz-warning) 18%, transparent); color: var(--trz-warning); }
      &.muted { background: var(--trz-bg-subtle); color: var(--trz-text-muted); }
    }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .status-note { margin: 0; font-size: 0.86rem; color: var(--trz-text-muted); }
    .err-box { margin: 0; padding: 0.65rem 0.85rem; border-radius: var(--trz-radius-sm); background: color-mix(in srgb, var(--trz-danger) 12%, transparent); color: var(--trz-danger); font-size: 0.84rem; }
    .more-hint { margin: 0; padding: 0.5rem 0.75rem; font-size: 0.78rem; color: var(--trz-text-subtle); }
  `,
})
export class ImportWizardComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  private readonly importer = inject(ImportEngineService);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly targetOrgId = signal('');
  protected readonly targetWorkspaceId = signal('');
  protected readonly mode = signal<ImportMode>('new');
  protected readonly skipDuplicates = signal(false);
  protected readonly analyzing = signal(false);
  protected readonly importing = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly preview = signal<ImportPreviewSummary | null>(null);
  protected readonly result = signal<ImportExecutionResult | null>(null);

  protected readonly workspaces = computed(() =>
    this.targetOrgId() ? this.store.getWorkspacesForOrg(this.targetOrgId()) : [],
  );

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    const org = this.store.activeOrganizations()[0];
    if (org) {
      this.targetOrgId.set(org.id);
      const ws = this.store.getWorkspacesForOrg(org.id)[0];
      if (ws) this.targetWorkspaceId.set(ws.id);
    }
  }

  protected onOrgChange(orgId: string): void {
    this.targetOrgId.set(orgId);
    const ws = this.store.getWorkspacesForOrg(orgId)[0];
    this.targetWorkspaceId.set(ws?.id ?? '');
  }

  protected async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    this.error.set(null);
    this.result.set(null);
    this.analyzing.set(true);
    try {
      const prev = await this.importer.analyzeFiles(files, this.targetOrgId());
      this.preview.set(prev);
      if (prev.isTrazJsonV2) {
        this.mode.set('restore');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudieron analizar los archivos.');
      this.preview.set(null);
    } finally {
      this.analyzing.set(false);
    }
  }

  protected async runImport(): Promise<void> {
    const prev = this.preview();
    if (!prev || !this.targetOrgId() || !this.targetWorkspaceId()) return;

    if (this.mode() === 'restore') {
      const confirmed = await this.dialogs.confirm({
        title: 'Confirmar restauración de respaldo',
        message:
          'El modo Restaurar actualizará páginas existentes cuyos identificadores coincidan. ¿Deseas continuar?',
        confirmText: 'Restaurar localmente',
      });
      if (!confirmed) return;
    }

    this.importing.set(true);
    this.error.set(null);
    try {
      const res = await this.importer.executeImport(
        prev,
        this.targetOrgId(),
        this.targetWorkspaceId(),
        this.mode(),
        this.skipDuplicates(),
      );
      this.result.set(res);
      this.preview.set(null);
      this.snackbar.open({
        message: `Importación finalizada: ${res.createdPages} creadas, ${res.updatedPages} actualizadas.`,
        tone: 'success',
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error durante la importación.');
    } finally {
      this.importing.set(false);
    }
  }
}
