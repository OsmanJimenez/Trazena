import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { isOlderThanDays, type PageHistoryVersion } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import {
  KnowledgeStore,
  type DetailedStorageMetrics,
} from '../../core/state/knowledge.store';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';
import { SettingsNavComponent } from './settings-nav.component';

@Component({
  selector: 'trz-storage-dashboard',
  standalone: true,
  imports: [FormsModule, AtralumeButton, AtralumeCard, AtralumeEmptyState, SettingsNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="storage-page">
      <header class="header">
        <div>
          <h1>Almacenamiento e historial</h1>
          <p>Capacidad estimada y administración manual de versiones anteriores (máx. 3 por página).</p>
        </div>
      </header>

      <trz-settings-nav />

      @if (metrics(); as m) {
        <div class="metrics-grid">
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Páginas activas</span>
              <strong>{{ m.pagesCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Versiones históricas</span>
              <strong>{{ m.historyVersionsCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Antiguas (&gt; 30 días)</span>
              <strong>{{ m.oldHistoryVersionsCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Papelera / archivadas</span>
              <strong>{{ m.deletedPagesCount }} / {{ m.archivedPagesCount }}</strong>
            </div>
          </atr-card>
        </div>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Desglose de capacidad (estimaciones)</h2>
            <div class="row">
              <span>Contenido Markdown vigente (lógico)</span>
              <strong>{{ formatBytes(m.totalContentBytes) }}</strong>
            </div>
            <div class="row">
              <span>Snapshots de historial (lógico)</span>
              <strong>{{ formatBytes(m.historyContentBytes) }}</strong>
            </div>
            <div class="row">
              <span>Metadatos e índices (estimado)</span>
              <strong>{{ formatBytes(m.estimatedMetadataBytes) }}</strong>
            </div>
            <div class="row">
              <span>Estimación total frente a D1 gratuito (5 GB)</span>
              <strong>{{ formatBytes(m.estimatedDbBytes) }} / {{ formatBytes(m.d1FreeTierLimitBytes) }}</strong>
            </div>
            <div class="row">
              <span>Cuota IndexedDB del navegador</span>
              <strong>{{ formatBytes(m.browserUsageBytes) }} / {{ formatBytes(m.browserQuotaBytes) }}</strong>
            </div>
            <div class="row">
              <span>Almacenamiento persistente del navegador</span>
              <strong>{{ m.persistentStorageGranted === true ? 'Concedido' : m.persistentStorageGranted === false ? 'Estándar' : 'Consultando…' }}</strong>
            </div>
          </div>
        </atr-card>
      }

      <atr-card appearance="outlined">
        <div class="card-inner">
          <div class="hist-head">
            <h2>Historial de versiones ({{ filteredHistory().length }})</h2>
            <div class="filters">
              <select [ngModel]="filterOrgId()" (ngModelChange)="filterOrgId.set($event)">
                <option value="">Todas las organizaciones</option>
                @for (org of store.activeOrganizations(); track org.id) {
                  <option [value]="org.id">{{ org.name }}</option>
                }
              </select>
              <label class="old-toggle">
                <input type="checkbox" [ngModel]="onlyOlderThan30()" (ngModelChange)="onlyOlderThan30.set($event)" />
                <span>Solo &gt; 30 días</span>
              </label>
              @if (selectedIds().size > 0) {
                <button atrButton type="button" size="small" appearance="filled" (click)="bulkDelete()">
                  Eliminar ({{ selectedIds().size }})
                </button>
              }
            </div>
          </div>

          @if (filteredHistory().length > 0) {
            <div class="hist-list">
              @for (v of filteredHistory(); track v.id) {
                <div class="hist-row">
                  <label class="hist-check">
                    <input
                      type="checkbox"
                      [checked]="selectedIds().has(v.id)"
                      (change)="toggleSelect(v.id)"
                    />
                    <div>
                      <div class="hist-title">
                        {{ pageTitle(v.pageId) }} · Rev. v{{ v.revision }}
                        @if (isOld(v.createdAt)) {
                          <span class="old-badge">&gt; 30 días</span>
                        }
                      </div>
                      <div class="hist-meta">
                        {{ formatBytes(v.byteSize) }} · {{ formatDate(v.createdAt) }}
                      </div>
                    </div>
                  </label>
                  <div class="hist-actions">
                    <button atrButton type="button" size="small" appearance="outlined" (click)="restoreVersion(v)">
                      Restaurar
                    </button>
                    <button atrButton type="button" size="small" appearance="text" (click)="deleteSingle(v)">
                      Eliminar
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <atr-empty-state
              appearance="compact"
              title="Sin versiones anteriores para este filtro"
              description="Cuando edites el contenido de una página, se guardarán automáticamente hasta 3 versiones anteriores completas."
            />
          }
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .storage-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 0.8rem; }
    .metric-inner {
      padding: 0.95rem 1.1rem; display: flex; flex-direction: column; gap: 0.3rem;
      .label { font-size: 0.72rem; color: var(--trz-text-subtle); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
      strong { font-size: 1.45rem; font-weight: 700; }
    }
    .card-inner {
      padding: 1.25rem 1.35rem; display: flex; flex-direction: column; gap: 0.65rem;
      h2 { margin: 0; font-size: 0.96rem; font-weight: 650; }
    }
    .row {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
      padding: 0.45rem 0; border-bottom: 1px solid var(--trz-border); font-size: 0.86rem;
      span { color: var(--trz-text-muted); }
      &:last-child { border-bottom: 0; padding-bottom: 0; }
    }
    .hist-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }
    .filters {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem;
      select {
        height: 34px;
      }
    }
    .old-toggle { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.82rem; color: var(--trz-text-muted); }
    .hist-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .hist-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.65rem 0.8rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm); background: var(--trz-bg);
    }
    .hist-check { display: flex; align-items: center; gap: 0.6rem; cursor: pointer; }
    .hist-title { font-size: 0.88rem; font-weight: 600; display: flex; align-items: center; gap: 0.45rem; }
    .hist-meta { font-size: 0.75rem; color: var(--trz-text-subtle); }
    .old-badge {
      font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 999px;
      background: color-mix(in srgb, var(--trz-warning) 16%, transparent); color: var(--trz-warning);
    }
    .hist-actions { display: flex; gap: 0.35rem; }
  `,
})
export class StorageDashboardComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly dialogs = inject(TrazenaDialogsService);

  protected readonly metrics = signal<DetailedStorageMetrics | null>(null);
  protected readonly allHistory = signal<PageHistoryVersion[]>([]);
  protected readonly filterOrgId = signal('');
  protected readonly onlyOlderThan30 = signal(false);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set());

  protected readonly filteredHistory = computed(() => {
    const orgId = this.filterOrgId();
    const onlyOld = this.onlyOlderThan30();
    return this.allHistory().filter((v) => {
      if (orgId && v.organizationId !== orgId) return false;
      if (onlyOld && !isOlderThanDays(v.createdAt, 30)) return false;
      return true;
    });
  });

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [m, h] = await Promise.all([
      this.store.getDetailedStorageMetrics(),
      this.store.getAllHistory(),
    ]);
    this.metrics.set(m);
    this.allHistory.set(h);
  }

  protected pageTitle(pageId: string): string {
    return this.store.pages().find((p) => p.id === pageId)?.title ?? 'Página eliminada';
  }

  protected isOld(iso: string): boolean {
    return isOlderThanDays(iso, 30);
  }

  protected toggleSelect(id: string): void {
    this.selectedIds.update((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected async restoreVersion(v: PageHistoryVersion): Promise<void> {
    await this.store.restoreHistoryVersion(v.pageId, v);
    this.snackbar.open({ message: 'Versión restaurada como nueva revisión.', tone: 'success' });
    await this.reload();
  }

  protected async deleteSingle(v: PageHistoryVersion): Promise<void> {
    const ok = await this.dialogs.confirm({
      title: 'Eliminar versión histórica',
      message: '¿Eliminar esta versión histórica? La versión actual de la página no se verá afectada.',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await this.store.deleteHistoryVersion(v.id);
    this.snackbar.open({ message: 'Versión histórica eliminada.', tone: 'info' });
    await this.reload();
  }

  protected async bulkDelete(): Promise<void> {
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;
    const ok = await this.dialogs.confirm({
      title: 'Eliminación por lotes',
      message: `¿Eliminar ${ids.length} versión(es) histórica(s) seleccionada(s)? Esta acción no afecta las versiones actuales.`,
      confirmText: `Eliminar (${ids.length})`,
      danger: true,
    });
    if (!ok) return;
    await this.store.deleteHistoryVersionsBulk(ids);
    this.selectedIds.set(new Set());
    this.snackbar.open({ message: `${ids.length} versiones eliminadas.`, tone: 'warning' });
    await this.reload();
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
