import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import type { ThemePreference } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { AuthService } from '../../core/auth/auth.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { ThemeService } from '../../core/state/theme.service';
import { SettingsNavComponent } from './settings-nav.component';

@Component({
  selector: 'trz-settings',
  standalone: true,
  imports: [AtralumeButton, AtralumeCard, AtralumeEmptyState, SettingsNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="settings-page">
      <header class="header">
        <div>
          <h1>Configuración</h1>
          <p>Perfil, apariencia y gestión de papelera.</p>
        </div>
      </header>

      <trz-settings-nav />

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Cuenta y autenticación</h2>
          <div class="info-row">
            <span>Usuario</span>
            <strong>{{ auth.user()?.displayName }} ({{ auth.user()?.email }})</strong>
          </div>
          <div class="info-row">
            <span>Proveedor activo</span>
            <strong>{{ auth.isFirebaseConfigured ? 'Firebase Authentication' : 'Bóveda Local (IndexedDB)' }}</strong>
          </div>
          <div class="info-row">
            <span>Sincronización remota</span>
            <strong>{{ auth.isRemoteApiEnabled ? 'Manual (Cloudflare Workers + D1)' : 'Offline-first local' }}</strong>
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Apariencia</h2>
          <div class="theme-options">
            @for (opt of themes; track opt.value) {
              <button
                atrButton
                type="button"
                size="small"
                [appearance]="theme.theme() === opt.value ? 'filled' : 'outlined'"
                (click)="theme.setTheme(opt.value)"
              >
                {{ opt.label }}
              </button>
            }
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Papelera ({{ store.deletedPages().length }})</h2>
          @if (store.deletedPages().length > 0) {
            <div class="trash-list">
              @for (page of store.deletedPages(); track page.id) {
                <div class="trash-row">
                  <div>
                    <div class="trash-title">{{ page.title }}</div>
                    <div class="trash-meta">Slug: /{{ page.slug }}</div>
                  </div>
                  <div class="trash-actions">
                    <button atrButton type="button" size="small" appearance="outlined" (click)="restore(page.id)">
                      Restaurar
                    </button>
                    <button atrButton type="button" size="small" appearance="text" (click)="purge(page.id, page.title)">
                      Eliminar definitivo
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <atr-empty-state
              appearance="compact"
              title="La papelera está vacía"
              description="Las páginas eliminadas aparecerán aquí para poder restaurarlas."
            />
          }
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .settings-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .card-inner {
      padding: 1.25rem 1.35rem;
      display: flex; flex-direction: column; gap: 0.85rem;
      h2 { margin: 0; font-size: 0.96rem; font-weight: 650; }
    }
    .info-row {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--trz-border);
      font-size: 0.87rem;
      span { color: var(--trz-text-muted); }
      &:last-child { border-bottom: 0; padding-bottom: 0; }
    }
    .theme-options { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .trash-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .trash-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.65rem 0.8rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle);
    }
    .trash-title { font-weight: 600; font-size: 0.9rem; }
    .trash-meta { font-size: 0.75rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); }
    .trash-actions { display: flex; gap: 0.35rem; }
  `,
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
  protected readonly store = inject(KnowledgeStore);
  protected readonly theme = inject(ThemeService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly themes: readonly { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Oscuro' },
    { value: 'system', label: 'Sistema' },
  ];

  protected async restore(pageId: string): Promise<void> {
    await this.store.restorePage(pageId);
    this.snackbar.open({ message: 'Página restaurada.', tone: 'success' });
  }

  protected async purge(pageId: string, title: string): Promise<void> {
    if (!window.confirm(`¿Eliminar definitivamente "${title}"? Esta acción no se puede deshacer.`)) return;
    await this.store.deletePage(pageId, true);
    this.snackbar.open({ message: 'Página eliminada definitivamente.', tone: 'warning' });
  }
}
