import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  computeLineDiff,
  type DiffLine,
  type SyncConflictRecord,
} from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { TrazenaSyncService } from '../../core/sync/trazena-sync.service';
import { SettingsNavComponent } from './settings-nav.component';

@Component({
  selector: 'trz-sync-center',
  standalone: true,
  imports: [
    FormsModule,
    AtralumeButton,
    AtralumeCard,
    AtralumeEmptyState,
    SettingsNavComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sync-page">
      <header class="header">
        <div>
          <h1>Centro de sincronización</h1>
          <p>Sincronización manual incremental entre IndexedDB local y Cloudflare D1.</p>
        </div>
        <button
          atrButton
          type="button"
          appearance="filled"
          [loading]="sync.state() === 'syncing'"
          (click)="runSync()"
        >
          Sincronizar ahora
        </button>
      </header>

      <trz-settings-nav />

      <div class="status-grid">
        <atr-card appearance="outlined">
          <div class="stat-inner">
            <span class="label">Conexión</span>
            <strong>{{ sync.isOnline() ? 'En línea' : 'Sin conexión' }}</strong>
          </div>
        </atr-card>
        <atr-card appearance="outlined">
          <div class="stat-inner">
            <span class="label">Pendientes locales</span>
            <strong>{{ sync.pendingCount() }}</strong>
          </div>
        </atr-card>
        <atr-card appearance="outlined">
          <div class="stat-inner">
            <span class="label">Conflictos activos</span>
            <strong>{{ sync.conflictsCount() }}</strong>
          </div>
        </atr-card>
        <atr-card appearance="outlined">
          <div class="stat-inner">
            <span class="label">Última sincronización</span>
            <strong class="small-val">{{ formatDate(sync.lastSyncedAt()) }}</strong>
          </div>
        </atr-card>
      </div>

      @if (sync.phaseLabel()) {
        <div class="phase-banner" role="status">{{ sync.phaseLabel() }}</div>
      }
      @if (sync.lastError(); as err) {
        <div class="error-banner" role="alert">{{ err }}</div>
      }

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Dispositivo actual</h2>
          @if (sync.device(); as dev) {
            <div class="device-row">
              <input
                type="text"
                [(ngModel)]="deviceNameDraft"
                placeholder="Ej. PC principal, Móvil"
                aria-label="Nombre del dispositivo"
              />
              <button atrButton type="button" size="small" appearance="outlined" (click)="saveDeviceName()">
                Guardar nombre
              </button>
            </div>
            <p class="device-meta">
              ID: <code>{{ dev.deviceId }}</code> · Cursor aplicado: #{{ sync.checkpoint()?.lastAppliedSequence ?? 0 }}
            </p>
          }
        </div>
      </atr-card>

      @if (sync.conflicts().length > 0) {
        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Conflictos pendientes ({{ sync.conflicts().length }})</h2>
            @for (c of sync.conflicts(); track c.id) {
              <div class="conflict-card">
                <div class="conflict-head">
                  <strong>{{ c.pageTitle }}</strong>
                  <span>Base v{{ c.baseRevision ?? '?' }} · Servidor v{{ c.serverRevision }}</span>
                </div>

                <div class="diff-box">
                  @for (line of diffFor(c); track $index) {
                    <div class="diff-line" [attr.data-type]="line.type">
                      <span>{{ line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ' }}</span>
                      <span>{{ line.text }}</span>
                    </div>
                  }
                </div>

                @if (mergingConflictId() === c.id) {
                  <textarea
                    class="merge-area"
                    rows="8"
                    [(ngModel)]="manualMergeDraft"
                  ></textarea>
                  <div class="conflict-actions">
                    <button atrButton type="button" size="small" appearance="filled" (click)="applyManualMerge(c)">
                      Guardar combinación
                    </button>
                    <button atrButton type="button" size="small" appearance="text" (click)="mergingConflictId.set(null)">
                      Cancelar
                    </button>
                  </div>
                } @else {
                  <div class="conflict-actions">
                    <button atrButton type="button" size="small" appearance="filled" (click)="keepLocal(c)">
                      Conservar local
                    </button>
                    <button atrButton type="button" size="small" appearance="outlined" (click)="keepServer(c)">
                      Usar remota
                    </button>
                    <button atrButton type="button" size="small" appearance="outlined" (click)="keepBoth(c)">
                      Conservar ambas
                    </button>
                    <button atrButton type="button" size="small" appearance="text" (click)="openManualMerge(c)">
                      Combinar manual
                    </button>
                  </div>
                }
              </div>
            }
          </div>
        </atr-card>
      }

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Historial de sincronizaciones</h2>
          @if (sync.sessions().length > 0) {
            <div class="sessions-list">
              @for (s of sync.sessions(); track s.id) {
                <div class="session-item">
                  <div class="session-head">
                    <strong>
                      {{ s.status === 'completed' ? 'Sincronización completada' : s.status === 'partial_conflict' ? 'Completada con conflictos' : 'Error de sincronización' }}
                    </strong>
                    <span>{{ formatDate(s.finishedAt) }}</span>
                  </div>
                  @if (s.uploaded.length > 0) {
                    <div class="session-group">
                      <span class="group-title">Subidos ({{ s.uploaded.length }}):</span>
                      @for (u of s.uploaded; track u.entityId + u.action) {
                        <div class="entry">{{ u.label }} — {{ u.action }}</div>
                      }
                    </div>
                  }
                  @if (s.downloaded.length > 0) {
                    <div class="session-group">
                      <span class="group-title">Descargados ({{ s.downloaded.length }}):</span>
                      @for (d of s.downloaded; track d.entityId + d.action) {
                        <div class="entry">{{ d.label }} — {{ d.action }}</div>
                      }
                    </div>
                  }
                  @if (s.errorMessage) {
                    <div class="session-err">{{ s.errorMessage }}</div>
                  }
                </div>
              }
            </div>
          } @else {
            <atr-empty-state
              appearance="compact"
              title="Sin sesiones registradas"
              description="Cuando ejecutes 'Sincronizar ahora', aquí aparecerá el resumen de cambios subidos y descargados."
            />
          }
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .sync-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap: 0.8rem; }
    .stat-inner {
      padding: 0.95rem 1.1rem; display: flex; flex-direction: column; gap: 0.3rem;
      .label { font-size: 0.72rem; color: var(--trz-text-subtle); text-transform: uppercase; font-weight: 600; letter-spacing: 0.04em; }
      strong { font-size: 1.35rem; }
      .small-val { font-size: 0.88rem; font-weight: 600; }
    }
    .phase-banner, .error-banner {
      padding: 0.7rem 0.95rem; border-radius: var(--trz-radius-sm); font-size: 0.85rem;
    }
    .phase-banner { background: var(--trz-accent-soft); color: var(--trz-text); }
    .error-banner { background: color-mix(in srgb, var(--trz-danger) 10%, transparent); color: var(--trz-danger); }
    .card-inner { padding: 1.25rem 1.35rem; display: flex; flex-direction: column; gap: 0.85rem; h2 { margin: 0; font-size: 0.96rem; font-weight: 650; } }
    .device-row {
      display: flex; flex-wrap: wrap; gap: 0.5rem;
      input {
        flex: 1; min-width: 200px; padding: 0.5rem 0.75rem;
        border: 1px solid var(--trz-border-strong); border-radius: 6px;
        background: var(--trz-bg); color: var(--trz-text); font: inherit;
      }
    }
    .device-meta { margin: 0; font-size: 0.78rem; color: var(--trz-text-subtle); code { font-family: var(--trz-font-mono); } }
    .conflict-card {
      padding: 0.9rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle); display: flex; flex-direction: column; gap: 0.7rem;
    }
    .conflict-head { display: flex; justify-content: space-between; font-size: 0.86rem; }
    .diff-box {
      max-height: 220px; overflow: auto; font-family: var(--trz-font-mono); font-size: 0.78rem;
      border: 1px solid var(--trz-border); border-radius: 6px; background: var(--trz-bg); padding: 0.45rem;
    }
    .diff-line {
      display: flex; gap: 0.5rem; white-space: pre-wrap; padding: 0.05rem 0.25rem;
      &[data-type="added"] { background: rgba(5, 150, 105, 0.12); color: var(--trz-success); }
      &[data-type="removed"] { background: rgba(220, 38, 38, 0.12); color: var(--trz-danger); }
    }
    .merge-area {
      width: 100%; font-family: var(--trz-font-mono); font-size: 0.82rem; padding: 0.65rem;
      border: 1px solid var(--trz-border-strong); border-radius: 6px; background: var(--trz-bg); color: var(--trz-text);
    }
    .conflict-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .sessions-list { display: flex; flex-direction: column; gap: 0.65rem; }
    .session-item {
      padding: 0.8rem 0.9rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg); display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.84rem;
    }
    .session-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; span { font-size: 0.76rem; color: var(--trz-text-subtle); } }
    .session-group { padding-left: 0.5rem; }
    .group-title { font-size: 0.76rem; font-weight: 600; color: var(--trz-text-muted); }
    .entry { font-size: 0.8rem; color: var(--trz-text-muted); padding-left: 0.5rem; }
    .session-err { color: var(--trz-danger); font-size: 0.8rem; }
  `,
})
export class SyncCenterComponent implements OnInit {
  protected readonly sync = inject(TrazenaSyncService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected deviceNameDraft = '';
  protected readonly mergingConflictId = signal<string | null>(null);
  protected manualMergeDraft = '';

  async ngOnInit(): Promise<void> {
    await this.sync.refreshState();
    this.deviceNameDraft = this.sync.device()?.name ?? '';
  }

  protected async runSync(): Promise<void> {
    const res = await this.sync.syncNow();
    if (res?.status === 'completed') {
      this.snackbar.open({
        message: `Sincronizado: ${res.uploaded.length} subidos, ${res.downloaded.length} descargados.`,
        tone: 'success',
      });
    } else if (res?.status === 'partial_conflict') {
      this.snackbar.open({
        message: `Sincronización con ${res.conflictsCount} conflicto(s) por resolver.`,
        tone: 'warning',
      });
    }
  }

  protected async saveDeviceName(): Promise<void> {
    await this.sync.renameCurrentDevice(this.deviceNameDraft);
    this.snackbar.open({ message: 'Nombre de dispositivo actualizado.', tone: 'success' });
  }

  protected diffFor(c: SyncConflictRecord): DiffLine[] {
    return computeLineDiff(c.serverMarkdown, c.localMarkdown);
  }

  protected async keepLocal(c: SyncConflictRecord): Promise<void> {
    await this.sync.resolveConflictKeepLocal(c);
    this.snackbar.open({ message: 'Versión local conservada. Sincroniza para subirla.', tone: 'info' });
  }

  protected async keepServer(c: SyncConflictRecord): Promise<void> {
    await this.sync.resolveConflictKeepServer(c);
    this.snackbar.open({ message: 'Versión remota aplicada.', tone: 'success' });
  }

  protected async keepBoth(c: SyncConflictRecord): Promise<void> {
    await this.sync.resolveConflictKeepBoth(c);
    this.snackbar.open({ message: 'Copia local creada y versión remota aplicada.', tone: 'success' });
  }

  protected openManualMerge(c: SyncConflictRecord): void {
    this.mergingConflictId.set(c.id);
    this.manualMergeDraft = `${c.localMarkdown}\n\n---\n\n${c.serverMarkdown}`;
  }

  protected async applyManualMerge(c: SyncConflictRecord): Promise<void> {
    await this.sync.resolveConflictManualMerge(c, this.manualMergeDraft);
    this.mergingConflictId.set(null);
    this.snackbar.open({ message: 'Combinación guardada localmente.', tone: 'success' });
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return 'Nunca';
    return new Date(iso).toLocaleString();
  }
}
