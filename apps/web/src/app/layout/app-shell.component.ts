import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { PageTreeItem, SearchResultItem } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeIconButton } from '@osmanjimenez/atralume/icon-button';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { AuthService } from '../core/auth/auth.service';
import { KnowledgeStore } from '../core/state/knowledge.store';
import { ThemeService } from '../core/state/theme.service';
import { PageTreeComponent } from '../features/page/page-tree.component';

@Component({
  selector: 'trz-app-shell',
  standalone: true,
  imports: [
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AtralumeButton,
    AtralumeIcon,
    AtralumeIconButton,
    PageTreeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell" [class.sidebar-closed]="!sidebarOpen()">
      <aside class="sidebar" aria-label="Navegación principal">
        <div class="sidebar-header">
          <a routerLink="/" class="brand">
            <span class="brand-mark">T</span>
            <span class="brand-name">Trazena</span>
          </a>
          <button
            atrIconButton
            type="button"
            appearance="standard"
            size="small"
            aria-label="Ocultar panel lateral"
            (click)="sidebarOpen.set(false)"
          >
            <atr-icon name="sidebar" size="small" />
          </button>
        </div>

        <div class="org-switcher">
          <label class="switcher-label" for="trz-org-select">Organización</label>
          <div class="switcher-row">
            <select
              id="trz-org-select"
              class="org-select"
              [ngModel]="selectedOrgId()"
              (ngModelChange)="selectOrg($event)"
            >
              @for (org of store.activeOrganizations(); track org.id) {
                <option [value]="org.id">{{ org.name }}</option>
              }
            </select>
            <button
              atrIconButton
              type="button"
              appearance="standard"
              size="small"
              title="Nueva organización"
              aria-label="Nueva organización"
              (click)="quickCreateOrg()"
            >
              <atr-icon name="plus" size="small" />
            </button>
          </div>
        </div>

        <div class="search-box">
          <atr-icon name="search" size="small" />
          <input
            type="search"
            placeholder="Buscar páginas…"
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearch($event)"
          />
        </div>

        @if (searchQuery().trim().length >= 2) {
          <div class="search-results">
            <div class="section-label">Resultados ({{ searchResults().length }})</div>
            @for (item of searchResults(); track item.pageId) {
              <a
                class="search-item"
                [routerLink]="item.canonicalPath"
                (click)="searchQuery.set(''); searchResults.set([]); closeOnMobile()"
              >
                <span class="search-item-title">{{ item.title }}</span>
                <span class="search-item-path">{{ item.canonicalPath }}</span>
              </a>
            } @empty {
              <p class="empty-hint">Sin coincidencias.</p>
            }
          </div>
        } @else {
          <nav class="sidebar-scroll">
            @if (activeOrg(); as org) {
              <div class="section-header">
                <a [routerLink]="['/o', org.slug]" class="section-link" (click)="closeOnMobile()">
                  Espacios
                </a>
                <button
                  type="button"
                  class="mini-action"
                  title="Nuevo espacio"
                  aria-label="Nuevo espacio"
                  (click)="quickCreateWorkspace(org.id)"
                >
                  <atr-icon name="plus" size="small" />
                </button>
              </div>

              @for (ws of activeWorkspaces(); track ws.id) {
                <div class="ws-block">
                  <div class="ws-row">
                    <a
                      class="ws-link"
                      [routerLink]="['/o', org.slug, ws.slug]"
                      routerLinkActive="is-active"
                      [routerLinkActiveOptions]="{ exact: true }"
                      (click)="closeOnMobile()"
                    >
                      <atr-icon [name]="ws.icon || 'book'" size="small" />
                      <span>{{ ws.name }}</span>
                    </a>
                    <button
                      type="button"
                      class="mini-action"
                      title="Nueva página raíz"
                      aria-label="Nueva página raíz"
                      (click)="quickCreatePage(org.id, ws.id, null)"
                    >
                      <atr-icon name="plus" size="small" />
                    </button>
                  </div>

                  <trz-page-tree
                    [nodes]="store.getPageTree(ws.id)"
                    [basePath]="'/o/' + org.slug + '/' + ws.slug"
                    (createChild)="quickCreatePage(org.id, ws.id, $event.id)"
                    (pageSelected)="closeOnMobile()"
                  />
                </div>
              } @empty {
                <p class="empty-hint">Crea tu primer espacio para organizar páginas.</p>
              }
            } @else {
              <div class="empty-org">
                <p class="empty-hint">No tienes organizaciones activas.</p>
                <button atrButton type="button" size="small" (click)="quickCreateOrg()">
                  Crear organización
                </button>
              </div>
            }
          </nav>
        }

        <div class="sidebar-footer">
          <a routerLink="/settings" routerLinkActive="is-active" class="footer-link" (click)="closeOnMobile()">
            <atr-icon name="settings" size="small" />
            <span>Configuración</span>
          </a>
          <a routerLink="/settings/storage" routerLinkActive="is-active" class="footer-link" (click)="closeOnMobile()">
            <atr-icon name="database" size="small" />
            <span>Almacenamiento</span>
          </a>
        </div>
      </aside>

      <div class="main-column">
        <header class="topbar">
          <div class="topbar-left">
            @if (!sidebarOpen()) {
              <button
                atrIconButton
                type="button"
                appearance="standard"
                size="small"
                aria-label="Mostrar panel lateral"
                (click)="sidebarOpen.set(true)"
              >
                <atr-icon name="sidebar" size="small" />
              </button>
            }
            <span class="mode-pill" [class.is-remote]="auth.isRemoteApiEnabled">
              {{ auth.isRemoteApiEnabled ? 'Cloudflare D1' : 'IndexedDB Local' }}
            </span>
          </div>

          <div class="topbar-right">
            <button
              atrIconButton
              type="button"
              appearance="standard"
              size="small"
              [title]="'Tema: ' + theme.theme()"
              aria-label="Cambiar tema"
              (click)="theme.cycleTheme()"
            >
              <atr-icon [name]="theme.theme() === 'dark' ? 'moon' : 'sun'" size="small" />
            </button>

            <span class="user-badge" [title]="auth.user()?.email || ''">
              {{ auth.user()?.displayName }}
            </span>

            <button
              atrIconButton
              type="button"
              appearance="standard"
              size="small"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              (click)="auth.logout()"
            >
              <atr-icon name="logout" size="small" />
            </button>
          </div>
        </header>

        <main class="content-area">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    .shell {
      display: grid;
      grid-template-columns: 280px 1fr;
      height: 100vh;
      overflow: hidden;
      background: var(--trz-bg);
    }

    .shell.sidebar-closed {
      grid-template-columns: 0 1fr;
      .sidebar {
        transform: translateX(-100%);
        border-right-color: transparent;
      }
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--trz-bg-elevated);
      border-right: 1px solid var(--trz-border);
      overflow: hidden;
      transition: transform 180ms ease;
    }

    .sidebar-header {
      height: var(--trz-topbar-height);
      padding: 0 0.85rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--trz-border);
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      text-decoration: none;
      color: var(--trz-text);
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .brand-mark {
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: var(--trz-text);
      color: var(--trz-bg);
      display: grid;
      place-items: center;
      font-size: 0.85rem;
    }

    .org-switcher {
      padding: 0.75rem 0.85rem 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .switcher-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--trz-text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .switcher-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .org-select {
      flex: 1;
      min-width: 0;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--trz-border-strong);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      color: var(--trz-text);
      font: inherit;
      font-size: 0.86rem;
      font-weight: 500;
    }

    .search-box {
      margin: 0.25rem 0.85rem 0.6rem;
      padding: 0.4rem 0.65rem;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      color: var(--trz-text-muted);

      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--trz-text);
        font: inherit;
        font-size: 0.84rem;
      }
    }

    .sidebar-scroll,
    .search-results {
      flex: 1;
      overflow-y: auto;
      padding: 0.35rem 0.65rem 1rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.35rem 0.3rem;
      margin-bottom: 0.25rem;
    }

    .section-link,
    .section-label {
      font-size: 0.73rem;
      font-weight: 600;
      color: var(--trz-text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      text-decoration: none;
    }

    .mini-action {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-text-muted);
      width: 22px;
      height: 22px;
      border-radius: 4px;
      display: grid;
      place-items: center;
      cursor: pointer;

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }
    }

    .ws-block {
      margin-bottom: 0.65rem;
    }

    .ws-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.25rem;
      padding: 0.2rem 0.25rem;
      border-radius: var(--trz-radius-sm);

      &:hover {
        background: var(--trz-bg-hover);
      }
    }

    .ws-link {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      text-decoration: none;
      color: var(--trz-text);
      font-size: 0.87rem;
      font-weight: 600;
      padding: 0.2rem 0.2rem;
      border-radius: var(--trz-radius-sm);

      &.is-active {
        color: var(--trz-accent);
      }
    }

    .search-item {
      display: flex;
      flex-direction: column;
      padding: 0.45rem 0.55rem;
      border-radius: var(--trz-radius-sm);
      text-decoration: none;
      color: var(--trz-text);

      &:hover {
        background: var(--trz-bg-hover);
      }
    }

    .search-item-title {
      font-size: 0.86rem;
      font-weight: 500;
    }

    .search-item-path {
      font-size: 0.74rem;
      color: var(--trz-text-subtle);
      font-family: var(--trz-font-mono);
    }

    .empty-hint {
      font-size: 0.82rem;
      color: var(--trz-text-subtle);
      padding: 0.5rem 0.35rem;
      margin: 0;
    }

    .empty-org {
      padding: 0.75rem 0.35rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .sidebar-footer {
      border-top: 1px solid var(--trz-border);
      padding: 0.55rem 0.65rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .footer-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.42rem 0.55rem;
      border-radius: var(--trz-radius-sm);
      color: var(--trz-text-muted);
      text-decoration: none;
      font-size: 0.85rem;

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }

      &.is-active {
        background: var(--trz-accent-soft);
        color: var(--trz-accent);
        font-weight: 600;
      }
    }

    .main-column {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100vh;
      overflow: hidden;
    }

    .topbar {
      height: var(--trz-topbar-height);
      padding: 0 1.25rem;
      border-bottom: 1px solid var(--trz-border);
      background: var(--trz-bg-elevated);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-shrink: 0;
    }

    .topbar-left,
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .mode-pill {
      font-size: 0.74rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--trz-bg-subtle);
      color: var(--trz-text-muted);
      border: 1px solid var(--trz-border);

      &.is-remote {
        background: var(--trz-accent-soft);
        color: var(--trz-accent);
        border-color: transparent;
      }
    }

    .user-badge {
      font-size: 0.84rem;
      color: var(--trz-text-muted);
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 1.5rem 2rem;
    }

    @media (max-width: 860px) {
      .shell {
        grid-template-columns: 1fr;
      }
      .sidebar {
        position: fixed;
        inset: 0 auto 0 0;
        width: 280px;
        z-index: 40;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
      }
      .content-area {
        padding: 1rem;
      }
    }
  `,
})
export class AppShellComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly sidebarOpen = signal(
    typeof window !== 'undefined' ? window.innerWidth > 860 : true,
  );
  protected readonly selectedOrgId = signal<string>('');
  protected readonly searchQuery = signal('');
  protected readonly searchResults = signal<SearchResultItem[]>([]);

  protected readonly activeOrg = computed(() => {
    const orgs = this.store.activeOrganizations();
    const id = this.selectedOrgId();
    return orgs.find((o) => o.id === id) ?? orgs[0] ?? null;
  });

  protected readonly activeWorkspaces = computed(() => {
    const org = this.activeOrg();
    return org ? this.store.getWorkspacesForOrg(org.id) : [];
  });

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    const first = this.store.activeOrganizations()[0];
    if (first && !this.selectedOrgId()) {
      this.selectedOrgId.set(first.id);
    }
  }

  protected selectOrg(orgId: string): void {
    this.selectedOrgId.set(orgId);
    const org = this.store.activeOrganizations().find((o) => o.id === orgId);
    if (org) {
      void this.router.navigate(['/o', org.slug]);
    }
  }

  protected async onSearch(value: string): Promise<void> {
    this.searchQuery.set(value);
    if (value.trim().length < 2) {
      this.searchResults.set([]);
      return;
    }
    const results = await this.store.searchPages(value);
    this.searchResults.set(results);
  }

  protected async quickCreateOrg(): Promise<void> {
    const name = window.prompt('Nombre de la nueva organización:');
    if (!name?.trim()) return;
    const org = await this.store.createOrganization({ name: name.trim() });
    this.selectedOrgId.set(org.id);
    this.snackbar.open({ message: `Organización "${org.name}" creada.`, tone: 'success' });
    await this.router.navigate(['/o', org.slug]);
  }

  protected async quickCreateWorkspace(orgId: string): Promise<void> {
    const name = window.prompt('Nombre del nuevo espacio:');
    if (!name?.trim()) return;
    const ws = await this.store.createWorkspace({
      organizationId: orgId,
      name: name.trim(),
    });
    const org = this.store.activeOrganizations().find((o) => o.id === orgId);
    this.snackbar.open({ message: `Espacio "${ws.name}" creado.`, tone: 'success' });
    if (org) {
      await this.router.navigate(['/o', org.slug, ws.slug]);
    }
  }

  protected async quickCreatePage(
    orgId: string,
    wsId: string,
    parentId: string | null,
  ): Promise<void> {
    const title = window.prompt(
      parentId ? 'Título de la nueva subpágina:' : 'Título de la nueva página:',
    );
    if (!title?.trim()) return;
    const page = await this.store.createPage({
      organizationId: orgId,
      workspaceId: wsId,
      parentId,
      title: title.trim(),
    });
    const path = this.store.getCanonicalPath(page.id);
    this.snackbar.open({ message: `Página "${page.title}" creada.`, tone: 'success' });
    this.closeOnMobile();
    await this.router.navigateByUrl(path);
  }

  protected closeOnMobile(): void {
    if (typeof window !== 'undefined' && window.innerWidth <= 860) {
      this.sidebarOpen.set(false);
    }
  }
}
