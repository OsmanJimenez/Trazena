import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StorageStats } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { IndexedDbService } from '../../core/storage/indexeddb.service';

@Component({
  selector: 'trz-storage-dashboard',
  standalone: true,
  imports: [RouterLink, AtralumeButton, AtralumeCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="storage-page">
      <header class="header">
        <div>
          <h1>Almacenamiento y sincronización</h1>
          <p>Métricas locales de IndexedDB y uso estimado frente a la cuota gratuita de Cloudflare D1 (5 GB).</p>
        </div>
        <a atrButton routerLink="/settings" appearance="outlined" size="small">
          Volver a configuración
        </a>
      </header>

      @if (stats(); as s) {
        <div class="metrics-grid">
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Organizaciones</span>
              <strong>{{ s.organizationsCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Espacios</span>
              <strong>{{ s.workspacesCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Páginas activas</span>
              <strong>{{ s.pagesCount }}</strong>
            </div>
          </atr-card>
          <atr-card appearance="outlined">
            <div class="metric-inner">
              <span class="label">Papelera / archivadas</span>
              <strong>{{ s.deletedPagesCount }} / {{ s.archivedPagesCount }}</strong>
            </div>
          </atr-card>
        </div>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Cuota y persistencia</h2>
            <div class="row">
              <span>Contenido Markdown acumulado</span>
              <strong>{{ formatBytes(s.totalContentBytes) }}</strong>
            </div>
            <div class="row">
              <span>Uso estimado en D1 (con índices FTS5)</span>
              <strong>{{ formatBytes(s.estimatedDbBytes) }} / {{ formatBytes(s.d1FreeTierLimitBytes) }}</strong>
            </div>
            <div class="row">
              <span>Cuota IndexedDB del navegador</span>
              <strong>{{ formatBytes(browserUsage()) }} / {{ formatBytes(browserQuota()) }}</strong>
            </div>
            <div class="row">
              <span>Operaciones pendientes de sincronización</span>
              <strong>{{ store.pendingSyncCount() }}</strong>
            </div>
          </div>
        </atr-card>
      }
    </div>
  `,
  styles: `
    .storage-page { max-width: 820px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 0.85rem; }
    .metric-inner {
      padding: 1rem 1.15rem;
      display: flex; flex-direction: column; gap: 0.35rem;
      .label { font-size: 0.72rem; color: var(--trz-text-subtle); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
      strong { font-size: 1.55rem; font-weight: 700; }
    }
    .card-inner {
      padding: 1.25rem 1.35rem;
      display: flex; flex-direction: column; gap: 0.55rem;
      h2 { margin: 0 0 0.3rem; font-size: 0.96rem; font-weight: 650; }
    }
    .row {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--trz-border);
      font-size: 0.87rem;
      span { color: var(--trz-text-muted); }
      &:last-child { border-bottom: 0; padding-bottom: 0; }
    }
  `,
})
export class StorageDashboardComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  private readonly idb = inject(IndexedDbService);

  protected readonly stats = signal<StorageStats | null>(null);
  protected readonly browserUsage = signal(0);
  protected readonly browserQuota = signal(0);

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    const [stats, quota] = await Promise.all([
      this.store.getStorageStats(),
      this.idb.estimateBrowserQuota(),
    ]);
    this.stats.set(stats);
    this.browserUsage.set(quota.usageBytes);
    this.browserQuota.set(quota.quotaBytes);
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}
