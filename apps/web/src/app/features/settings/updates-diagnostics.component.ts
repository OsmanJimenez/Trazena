import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { DiagnosticsService } from '../../core/diagnostics/diagnostics.service';
import { IndexedDbService } from '../../core/storage/indexeddb.service';
import { TrazenaUpdateService } from '../../core/update/trazena-update.service';
import { SettingsNavComponent } from './settings-nav.component';

@Component({
  selector: 'trz-updates-diagnostics',
  standalone: true,
  imports: [RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState, SettingsNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="updates-page">
      <header class="header">
        <div>
          <h1>Actualizaciones y diagnóstico</h1>
          <p>Trazena Update & Recovery — actualización segura de la PWA y bitácora local (nunca se envía a Cloudflare).</p>
        </div>
        <a atrButton routerLink="/recovery" appearance="outlined" size="small">
          Modo recuperación
        </a>
      </header>

      <trz-settings-nav />

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Estado de la aplicación (PWA)</h2>
          <div class="info-row">
            <span>Versión instalada</span>
            <strong>v{{ updater.currentMeta.appVersion }} ({{ updater.currentMeta.buildId }})</strong>
          </div>
          <div class="info-row">
            <span>Esquema local / Protocolo Sync</span>
            <strong>IndexedDB v{{ idb.schemaVersion }} · Protocolo v{{ updater.currentMeta.syncProtocolVersion }}</strong>
          </div>
          <div class="info-row">
            <span>Estado actual</span>
            <strong>{{ updater.phaseLabel() }}</strong>
          </div>
          <div class="info-row">
            <span>Última comprobación</span>
            <strong>{{ formatDate(updater.lastCheckedAt()) }}</strong>
          </div>

          @if (updater.errorMessage(); as err) {
            <div class="err-box" role="alert">{{ err }}</div>
          }

          <div class="actions">
            <button
              atrButton
              type="button"
              size="small"
              appearance="outlined"
              [loading]="updater.status() === 'checking'"
              (click)="updater.checkForUpdates(false)"
            >
              Buscar actualizaciones
            </button>

            @if (updater.status() === 'ready' || updater.status() === 'unrecoverable') {
              <button
                atrButton
                type="button"
                size="small"
                appearance="filled"
                (click)="updater.applyUpdateNow()"
              >
                Actualizar ahora
              </button>
            }

            @if (updater.status() === 'error') {
              <button
                atrButton
                type="button"
                size="small"
                appearance="filled"
                (click)="updater.checkForUpdates(false)"
              >
                Reintentar actualización
              </button>
            }
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <div class="diag-head">
            <h2>Diagnóstico local ({{ diagnostics.recentEvents().length }})</h2>
            <div class="actions">
              <button atrButton type="button" size="small" appearance="filled" (click)="exportDiag()">
                Exportar diagnóstico
              </button>
              <button atrButton type="button" size="small" appearance="text" (click)="clearInfoLogs()">
                Limpiar logs informativos
              </button>
            </div>
          </div>

          <p class="privacy-note">
            Los logs se almacenan exclusivamente en <code>trazena-diagnostics</code> (presupuesto 2 MB / 30 días) y jamás incluyen contenido Markdown, contraseñas ni tokens.
          </p>

          @if (diagnostics.recentEvents().length > 0) {
            <div class="log-list">
              @for (ev of diagnostics.recentEvents().slice(0, 40); track ev.id) {
                <div class="log-row" [attr.data-level]="ev.level">
                  <span class="lvl">{{ ev.level.toUpperCase() }}</span>
                  <span class="cat">{{ ev.category }}</span>
                  <code>{{ ev.eventCode }}</code>
                  <span class="msg">{{ ev.sanitizedMessage || ev.phase }}</span>
                  <span class="time">{{ formatDate(ev.timestamp) }}</span>
                </div>
              }
            </div>
          } @else {
            <atr-empty-state
              appearance="compact"
              title="Sin eventos registrados"
              description="Aquí aparecerán eventos de actualizaciones PWA, migraciones IndexedDB y fallos de sincronización."
            />
          }
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .updates-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem; }
    h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .card-inner { padding: 1.25rem 1.35rem; display: flex; flex-direction: column; gap: 0.85rem; h2 { margin: 0; font-size: 0.96rem; font-weight: 650; } }
    .diag-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem; }
    .info-row {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
      padding: 0.45rem 0; border-bottom: 1px solid var(--trz-border); font-size: 0.86rem;
      span { color: var(--trz-text-muted); }
      &:last-of-type { border-bottom: 0; }
    }
    .actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .err-box { padding: 0.65rem 0.85rem; border-radius: 6px; background: color-mix(in srgb, var(--trz-danger) 10%, transparent); color: var(--trz-danger); font-size: 0.83rem; }
    .privacy-note { margin: 0; font-size: 0.79rem; color: var(--trz-text-subtle); line-height: 1.45; }
    .log-list { display: flex; flex-direction: column; gap: 0.35rem; max-height: 360px; overflow-y: auto; }
    .log-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
      padding: 0.4rem 0.6rem; border-radius: 5px; background: var(--trz-bg-subtle); font-size: 0.77rem;
      .lvl { font-weight: 700; font-size: 0.69rem; }
      &[data-level="error"] .lvl { color: var(--trz-danger); }
      &[data-level="warn"] .lvl { color: var(--trz-warning); }
      &[data-level="info"] .lvl { color: var(--trz-accent); }
      .cat { color: var(--trz-text-subtle); }
      code { font-family: var(--trz-font-mono); }
      .msg { color: var(--trz-text-muted); flex: 1; }
      .time { color: var(--trz-text-subtle); font-size: 0.71rem; }
    }
  `,
})
export class UpdatesDiagnosticsComponent implements OnInit {
  protected readonly updater = inject(TrazenaUpdateService);
  protected readonly diagnostics = inject(DiagnosticsService);
  protected readonly idb = inject(IndexedDbService);
  private readonly snackbar = inject(AtralumeSnackbar);

  ngOnInit(): void {
    void this.diagnostics.loadEvents(100);
  }

  protected async exportDiag(): Promise<void> {
    await this.diagnostics.exportDiagnosticsReport({
      updateStatus: this.updater.status(),
      migrationState: this.idb.migrationState(),
    });
    this.snackbar.open({ message: 'Diagnóstico JSON descargado.', tone: 'success' });
  }

  protected async clearInfoLogs(): Promise<void> {
    await this.diagnostics.clearOrdinaryLogs();
    this.snackbar.open({ message: 'Logs informativos limpiados.', tone: 'info' });
  }

  protected formatDate(iso: string | null): string {
    if (!iso) return 'Sin comprobar aún';
    return new Date(iso).toLocaleString();
  }
}
