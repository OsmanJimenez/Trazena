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
          <atr-card appearance="outlined" class="metric">
            <span class="label">Organizaciones</span>
            <strong>{{ s.organizationsCount }}</strong>
          </atr-card>
          <atr-card appearance="outlined" class="metric">
            <span class="label">Espacios</span>
            <strong>{{ s.workspacesCount }}</strong>
          </atr-card>
          <atr-card appearance="outlined" class="metric">
            <span class="label">Páginas activas</span>
            <strong>{{ s.pagesCount }}</strong>
          </atr-card>
          <atr-card appearance="outlined" class="metric">
            <span class="label">En papelera / archivadas</span>
            <strong>{{ s.deletedPagesCount }} / {{ s.archivedPagesCount }}</strong>
          </atr-card>
        </div>

        <atr-card appearance="outlined" class="panel">
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
        </atr-card>
      }
    </div>
  `,
  styles: `
    .storage-page { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; }
    h1 { margin: 0; font-size: 1.7rem; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.85rem; }
    .metric {
      padding: 1rem 1.15rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      display: flex; flex-direction: column; gap: 0.35rem;
      .label { font-size: 0.78rem; color: var(--trz-text-subtle); text-transform: uppercase; letter-spacing: 0.04em; }
      strong { font-size: 1.55rem; }
    }
    .panel {
      padding: 1.25rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      display: flex; flex-direction: column; gap: 0.6rem;
      h2 { margin: 0 0 0.35rem; font-size: 1rem; }
    }
    .row {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--trz-border);
      font-size: 0.88rem;
      span { color: var(--trz-text-muted); }
      &:last-child { border-bottom: 0; }
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
