import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'trz-settings-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="settings-tabs" aria-label="Secciones de configuración">
      <a routerLink="/settings" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
        General
      </a>
      <a routerLink="/settings/sync" routerLinkActive="active">
        Sincronización
      </a>
      <a routerLink="/settings/storage" routerLinkActive="active">
        Almacenamiento e historial
      </a>
      <a routerLink="/settings/updates" routerLinkActive="active">
        Actualizaciones y diagnóstico
      </a>
      <a routerLink="/settings/shortcuts" routerLinkActive="active">
        Atajos de teclado
      </a>
    </nav>
  `,
  styles: `
    .settings-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      border-bottom: 1px solid var(--trz-border);
      padding-bottom: 0.5rem;

      a {
        padding: 0.4rem 0.75rem;
        border-radius: var(--trz-radius-sm);
        text-decoration: none;
        color: var(--trz-text-muted);
        font-size: 0.85rem;
        font-weight: 500;
        transition: background 120ms ease, color 120ms ease;

        &:hover {
          background: var(--trz-bg-hover);
          color: var(--trz-text);
        }

        &.active {
          background: var(--trz-bg-subtle);
          color: var(--trz-text);
          font-weight: 600;
        }
      }
    }
  `,
})
export class SettingsNavComponent {}
