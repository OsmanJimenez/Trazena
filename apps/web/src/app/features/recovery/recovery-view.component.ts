import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { APP_BUILD_META } from '../../core/diagnostics/app-version';
import { DiagnosticsService } from '../../core/diagnostics/diagnostics.service';
import { IndexedDbService } from '../../core/storage/indexeddb.service';

/**
 * Minimal standalone recovery view.
 * Does NOT depend on KnowledgeStore or the Markdown editor, so it remains accessible
 * if a local IndexedDB migration or Service Worker update fails.
 * Never offers "wipe all data" as a first action and never discards pending Outbox items.
 */
@Component({
  selector: 'trz-recovery-view',
  standalone: true,
  imports: [RouterLink, AtralumeButton, AtralumeCard, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="recovery-page">
      <atr-card appearance="elevated" class="recovery-card">
        <div class="card-inner">
          <div class="top">
            <div class="logo">T</div>
            <div>
              <h1>Modo de recuperación — Trazena</h1>
              <p>Versión v{{ meta.appVersion }} · Esquema local v{{ meta.localSchemaVersion }} · Build {{ meta.buildId }}</p>
            </div>
          </div>

          @if (diagnostics.fatalError(); as err) {
            <div class="alert-box" role="alert">
              <atr-icon name="warning" size="small" />
              <div>
                <strong>Código: {{ err.code }}</strong>
                <p>{{ err.message }}</p>
                @if (err.migrationId) {
                  <small>Migración: {{ err.migrationId }} · {{ err.timestamp }}</small>
                }
              </div>
            </div>
          } @else if (idb.schemaBlocked()) {
            <div class="alert-box" role="alert">
              <atr-icon name="warning" size="small" />
              <div>
                <strong>Actualización bloqueada por otra pestaña</strong>
                <p>Cierra las demás pestañas abiertas de Trazena y presiona Reintentar para completar la migración de forma segura.</p>
              </div>
            </div>
          } @else {
            <div class="ok-box" role="status">
              <atr-icon name="check" size="small" />
              <span>No se detectan errores fatales activos. Tus datos locales en IndexedDB están intactos.</span>
            </div>
          }

          @if (retryMessage()) {
            <p class="retry-msg">{{ retryMessage() }}</p>
          }

          <div class="actions">
            <button atrButton type="button" appearance="filled" [loading]="retrying()" (click)="retryOpen()">
              Reintentar apertura segura
            </button>
            <button atrButton type="button" appearance="outlined" (click)="exportReport()">
              Exportar diagnóstico JSON
            </button>
            <a atrButton routerLink="/" appearance="text">
              Volver a Trazena
            </a>
          </div>

          <section class="log-section">
            <h2>Eventos recientes locales ({{ diagnostics.recentEvents().length }})</h2>
            @for (ev of diagnostics.recentEvents().slice(0, 12); track ev.id) {
              <div class="log-row" [attr.data-level]="ev.level">
                <span class="lvl">{{ ev.level.toUpperCase() }}</span>
                <code>{{ ev.eventCode }}</code>
                <span class="msg">{{ ev.sanitizedMessage || ev.phase }}</span>
              </div>
            } @empty {
              <p class="empty">Sin eventos diagnósticos registrados aún.</p>
            }
          </section>
        </div>
      </atr-card>
    </main>
  `,
  styles: `
    .recovery-page {
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 1.5rem 1rem;
      background: var(--trz-bg-sidebar);
    }
    .recovery-card { width: 100%; max-width: 680px; }
    .card-inner { padding: 1.75rem; display: flex; flex-direction: column; gap: 1.25rem; }
    .top { display: flex; align-items: center; gap: 0.85rem; }
    .logo {
      width: 38px; height: 38px; border-radius: 9px;
      background: var(--trz-text); color: var(--trz-bg);
      display: grid; place-items: center; font-weight: 700; flex-shrink: 0;
    }
    h1 { margin: 0; font-size: 1.25rem; }
    .top p { margin: 0.2rem 0 0; font-size: 0.8rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); }
    .alert-box, .ok-box {
      display: flex; align-items: flex-start; gap: 0.6rem;
      padding: 0.85rem 1rem; border-radius: var(--trz-radius-sm); font-size: 0.85rem;
      p { margin: 0.25rem 0 0; }
    }
    .alert-box {
      background: color-mix(in srgb, var(--trz-danger) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--trz-danger) 30%, transparent);
    }
    .ok-box {
      background: color-mix(in srgb, var(--trz-success) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--trz-success) 30%, transparent);
    }
    .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .retry-msg { margin: 0; font-size: 0.84rem; color: var(--trz-text-muted); }
    .log-section {
      border-top: 1px solid var(--trz-border); padding-top: 1rem;
      display: flex; flex-direction: column; gap: 0.4rem;
      h2 { margin: 0 0 0.35rem; font-size: 0.78rem; text-transform: uppercase; color: var(--trz-text-subtle); }
    }
    .log-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem;
      font-size: 0.78rem; padding: 0.35rem 0.5rem; border-radius: 4px; background: var(--trz-bg-subtle);
      .lvl { font-weight: 700; font-size: 0.7rem; }
      &[data-level="error"] .lvl { color: var(--trz-danger); }
      &[data-level="warn"] .lvl { color: var(--trz-warning); }
      code { font-family: var(--trz-font-mono); }
      .msg { color: var(--trz-text-muted); }
    }
    .empty { margin: 0; font-size: 0.82rem; color: var(--trz-text-subtle); }
  `,
})
export class RecoveryViewComponent implements OnInit {
  protected readonly diagnostics = inject(DiagnosticsService);
  protected readonly idb = inject(IndexedDbService);
  private readonly router = inject(Router);

  protected readonly meta = APP_BUILD_META;
  protected readonly retrying = signal(false);
  protected readonly retryMessage = signal<string | null>(null);

  ngOnInit(): void {
    void this.diagnostics.loadEvents(50);
  }

  protected async retryOpen(): Promise<void> {
    this.retrying.set(true);
    this.retryMessage.set(null);
    try {
      await this.idb.retryOpen();
      await this.diagnostics.log({
        level: 'info',
        category: 'recovery',
        phase: 'retry-success',
        eventCode: 'RECOVERY_RETRY_SUCCEEDED',
      });
      this.retryMessage.set('Base local abierta correctamente. Redirigiendo…');
      await this.router.navigate(['/']);
    } catch (err) {
      this.retryMessage.set(
        err instanceof Error ? err.message : 'No fue posible abrir IndexedDB todavía.',
      );
    } finally {
      this.retrying.set(false);
    }
  }

  protected async exportReport(): Promise<void> {
    await this.diagnostics.exportDiagnosticsReport({
      migrationState: this.idb.migrationState(),
      schemaBlocked: this.idb.schemaBlocked(),
    });
  }
}
