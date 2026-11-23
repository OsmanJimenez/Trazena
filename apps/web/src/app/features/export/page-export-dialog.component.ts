import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ExportFormat, ExportScope } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import {
  ATR_DIALOG_DATA,
  AtralumeDialogActions,
  AtralumeDialogContent,
  AtralumeDialogRef,
  AtralumeDialogTitle,
} from '@osmanjimenez/atralume/dialog';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeIconButton } from '@osmanjimenez/atralume/icon-button';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { ExportEngineService } from '../../core/export/export-engine.service';

export interface ExportDialogData {
  defaultScope: ExportScope;
  allowSubtreeToggle?: boolean;
  targetIds: string[];
  title: string;
}

@Component({
  selector: 'trz-page-export-dialog',
  standalone: true,
  imports: [
    FormsModule,
    AtralumeButton,
    AtralumeIcon,
    AtralumeIconButton,
    AtralumeDialogTitle,
    AtralumeDialogContent,
    AtralumeDialogActions,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="export-modal">
      <div class="modal-head">
        <h2 atrDialogTitle>Exportar — {{ data.title }}</h2>
        <button atrIconButton type="button" size="small" aria-label="Cerrar" (click)="close()">
          <atr-icon name="close" size="small" />
        </button>
      </div>

      <div atrDialogContent class="modal-body">
        <label class="field">
          <span>Formato</span>
          <select [ngModel]="format()" (ngModelChange)="format.set($event)">
            <option value="pdf">PDF (documento A4 seleccionable)</option>
            <option value="markdown">Markdown (.md / ZIP jerárquico)</option>
            <option value="html">HTML autónomo portable</option>
            <option value="json">JSON estructurado v2 (respaldo completo)</option>
          </select>
        </label>

        @if (data.allowSubtreeToggle) {
          <label class="check-row">
            <input
              type="checkbox"
              [ngModel]="includeSubpages()"
              (ngModelChange)="includeSubpages.set($event)"
            />
            <span>Incluir todas las subpáginas descendientes</span>
          </label>
        }

        @if (format() === 'pdf' && isMultiTarget()) {
          <label class="field">
            <span>Modo PDF jerárquico</span>
            <select [ngModel]="pdfMode()" (ngModelChange)="pdfMode.set($event)">
              <option value="combined">PDF único consolidado (con portada e índice)</option>
              <option value="separate">Varios PDFs independientes en ZIP</option>
            </select>
          </label>
        }

        <label class="check-row">
          <input type="checkbox" [ngModel]="includeMetadata()" (ngModelChange)="includeMetadata.set($event)" />
          <span>Incluir metadatos, etiquetas y propiedades</span>
        </label>

        <label class="check-row">
          <input type="checkbox" [ngModel]="includeArchived()" (ngModelChange)="includeArchived.set($event)" />
          <span>Incluir páginas archivadas</span>
        </label>

        @if (engine.progress().phase !== 'idle') {
          <div class="progress-box" [attr.data-phase]="engine.progress().phase">
            <strong>{{ engine.progress().message }}</strong>
            @if (engine.progress().totalPages > 0) {
              <span>{{ engine.progress().processedPages }} / {{ engine.progress().totalPages }} páginas</span>
            }
            @if (engine.progress().errorMessage; as err) {
              <p class="err">{{ err }}</p>
            }
          </div>
        }
      </div>

      <div atrDialogActions class="modal-actions">
        @if (isRunning()) {
          <button atrButton type="button" size="small" appearance="text" (click)="engine.cancelCurrentExport()">
            Cancelar
          </button>
        } @else {
          <button atrButton type="button" size="small" appearance="text" (click)="close()">
            Cerrar
          </button>
          <button atrButton type="button" size="small" appearance="filled" (click)="startExport()">
            Generar y descargar
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    .export-modal { display: flex; flex-direction: column; gap: 1rem; color: var(--trz-text); }
    .modal-head {
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      h2 { margin: 0; font-size: 1.05rem; font-weight: 650; }
    }
    .modal-body { display: flex; flex-direction: column; gap: 0.85rem; }
    .field {
      display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.82rem; font-weight: 500; color: var(--trz-text-muted);
      select { width: 100%; height: 36px; }
    }
    .check-row {
      display: flex; align-items: center; gap: 0.55rem; font-size: 0.85rem; color: var(--trz-text); cursor: pointer;
      input { accent-color: var(--trz-accent); width: 15px; height: 15px; }
    }
    .progress-box {
      padding: 0.65rem 0.85rem; border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle); border: 1px solid var(--trz-border);
      font-size: 0.82rem; display: flex; flex-direction: column; gap: 0.25rem;
      .err { margin: 0; color: var(--trz-danger); }
    }
    .modal-actions { display: flex; justify-content: flex-end; gap: 0.45rem; }
  `,
})
export class PageExportDialogComponent implements OnInit {
  protected readonly data = inject<ExportDialogData>(ATR_DIALOG_DATA);
  private readonly ref = inject<AtralumeDialogRef<boolean>>(AtralumeDialogRef);
  protected readonly engine = inject(ExportEngineService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly format = signal<ExportFormat>('pdf');
  protected readonly includeSubpages = signal(this.data.defaultScope === 'page-tree');
  protected readonly includeMetadata = signal(true);
  protected readonly includeArchived = signal(false);
  protected readonly pdfMode = signal<'combined' | 'separate'>('combined');

  async ngOnInit(): Promise<void> {
    this.engine.resetProgress();
    const prefs = await this.engine.getSavedPreferences();
    this.format.set(prefs.format);
    this.includeArchived.set(prefs.includeArchived);
    this.includeMetadata.set(prefs.includeMetadata);
    this.pdfMode.set(prefs.pdfMode);
  }

  protected isMultiTarget(): boolean {
    return (
      this.includeSubpages() ||
      this.data.defaultScope === 'workspace' ||
      this.data.defaultScope === 'organization' ||
      this.data.targetIds.length > 1
    );
  }

  protected isRunning(): boolean {
    const ph = this.engine.progress().phase;
    return ph === 'preparing' || ph === 'processing' || ph === 'generating' || ph === 'packaging';
  }

  protected async startExport(): Promise<void> {
    const scope: ExportScope = this.data.allowSubtreeToggle
      ? this.includeSubpages()
        ? 'page-tree'
        : 'page'
      : this.data.defaultScope;

    const ok = await this.engine.executeExport({
      scope,
      targetIds: this.data.targetIds,
      format: this.format(),
      includeArchived: this.includeArchived(),
      includeMetadata: this.includeMetadata(),
      pdfMode: this.pdfMode(),
      title: this.data.title,
    });

    if (ok) {
      this.snackbar.open({ message: 'Archivo exportado correctamente.', tone: 'success' });
      this.ref.close(true);
    }
  }

  protected close(): void {
    this.ref.close(false);
  }
}
