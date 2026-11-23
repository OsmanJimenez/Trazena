import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  computeLineDiff,
  isOlderThanDays,
  type DiffLine,
  type PageHistoryVersion,
} from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-page-history-panel',
  standalone: true,
  imports: [AtralumeButton, AtralumeEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="history-panel" aria-label="Historial de versiones">
      <div class="panel-head">
        <div>
          <strong>Historial de versiones (máx. 3 anteriores)</strong>
          <p>Snapshots completos en Markdown. Restaurar crea una nueva revisión sin alterar el historial.</p>
        </div>
        <button atrButton type="button" size="small" appearance="text" (click)="closed.emit()">
          Cerrar
        </button>
      </div>

      @if (versions().length > 0) {
        <div class="version-list">
          @for (v of versions(); track v.id) {
            <div class="version-card" [class.selected]="selected()?.id === v.id">
              <div class="version-meta">
                <div>
                  <strong>Revisión v{{ v.revision }}</strong>
                  @if (isOld(v.createdAt)) {
                    <span class="old-badge">&gt; 30 días</span>
                  }
                  <div class="sub">{{ formatDate(v.createdAt) }} · {{ v.byteSize }} B</div>
                </div>
                <div class="version-actions">
                  <button atrButton type="button" size="small" appearance="outlined" (click)="selected.set(v)">
                    Comparar
                  </button>
                  <button atrButton type="button" size="small" appearance="filled" (click)="restore(v)">
                    Restaurar
                  </button>
                  <button atrButton type="button" size="small" appearance="text" (click)="remove(v)">
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          }
        </div>

        @if (selected(); as sel) {
          <div class="diff-viewer">
            <div class="diff-head">
              <span>Comparando Rev. v{{ sel.revision }} → Actual</span>
            </div>
            <div class="diff-lines">
              @for (line of diffLines(); track $index) {
                <div class="diff-line" [attr.data-type]="line.type">
                  <span class="sigil">{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
                  <span>{{ line.text }}</span>
                </div>
              }
            </div>
          </div>
        }
      } @else {
        <atr-empty-state
          appearance="compact"
          title="Sin versiones anteriores todavía"
          description="Al modificar y guardar el contenido de esta página se conservarán hasta 3 snapshots previos."
        />
      }
    </section>
  `,
  styles: `
    .history-panel {
      padding: 1rem 1.15rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-subtle);
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .panel-head {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.5rem;
      p { margin: 0.2rem 0 0; font-size: 0.78rem; color: var(--trz-text-muted); }
    }
    .version-list { display: flex; flex-direction: column; gap: 0.45rem; }
    .version-card {
      padding: 0.65rem 0.8rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      &.selected { border-color: var(--trz-accent); }
    }
    .version-meta { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; }
    .sub { font-size: 0.75rem; color: var(--trz-text-subtle); margin-top: 0.15rem; }
    .old-badge {
      margin-left: 0.4rem; font-size: 0.69rem; padding: 0.1rem 0.4rem; border-radius: 999px;
      background: color-mix(in srgb, var(--trz-warning) 16%, transparent); color: var(--trz-warning);
    }
    .version-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .diff-viewer {
      border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg); overflow: hidden;
    }
    .diff-head {
      padding: 0.4rem 0.7rem; font-size: 0.76rem; font-weight: 600;
      background: var(--trz-bg-subtle); border-bottom: 1px solid var(--trz-border); color: var(--trz-text-muted);
    }
    .diff-lines {
      max-height: 240px; overflow: auto; font-family: var(--trz-font-mono); font-size: 0.78rem; padding: 0.4rem;
    }
    .diff-line {
      display: flex; gap: 0.45rem; white-space: pre-wrap; padding: 0.05rem 0.25rem;
      &[data-type="added"] { background: rgba(5, 150, 105, 0.12); color: var(--trz-success); }
      &[data-type="removed"] { background: rgba(220, 38, 38, 0.12); color: var(--trz-danger); }
    }
  `,
})
export class PageHistoryPanelComponent {
  readonly pageId = input.required<string>();
  readonly currentMarkdown = input.required<string>();
  readonly closed = output<void>();
  readonly restored = output<{ revision: number; markdown: string }>();

  private readonly store = inject(KnowledgeStore);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly versions = signal<PageHistoryVersion[]>([]);
  protected readonly selected = signal<PageHistoryVersion | null>(null);

  protected readonly diffLines = computed<DiffLine[]>(() => {
    const sel = this.selected();
    if (!sel) return [];
    return computeLineDiff(sel.content, this.currentMarkdown());
  });

  constructor() {
    effect(() => {
      const id = this.pageId();
      void this.load(id);
    });
  }

  private async load(pageId: string): Promise<void> {
    const list = await this.store.getPageHistory(pageId);
    this.versions.set(list);
    this.selected.set(list[0] ?? null);
  }

  protected isOld(iso: string): boolean {
    return isOlderThanDays(iso, 30);
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected async restore(v: PageHistoryVersion): Promise<void> {
    const res = await this.store.restoreHistoryVersion(this.pageId(), v);
    if (res) {
      this.snackbar.open({
        message: `Versión v${v.revision} restaurada como nueva revisión v${res.revision}.`,
        tone: 'success',
      });
      this.restored.emit({ revision: res.revision, markdown: res.content.markdown });
      await this.load(this.pageId());
    }
  }

  protected async remove(v: PageHistoryVersion): Promise<void> {
    if (!window.confirm(`¿Eliminar la versión histórica v${v.revision}?`)) return;
    await this.store.deleteHistoryVersion(v.id);
    this.snackbar.open({ message: 'Versión histórica eliminada.', tone: 'info' });
    await this.load(this.pageId());
  }
}
