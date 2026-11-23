import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import type { SearchResultItem } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeDialog } from '@osmanjimenez/atralume/dialog';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeIconButton } from '@osmanjimenez/atralume/icon-button';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { AuthService } from '../core/auth/auth.service';
import { KnowledgeMetaService } from '../core/knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../core/state/knowledge.store';
import { ThemeService } from '../core/state/theme.service';
import { TrazenaSyncService } from '../core/sync/trazena-sync.service';
import { TrazenaUpdateService } from '../core/update/trazena-update.service';
import { TrazenaDialogsService } from '../core/ui/trazena-dialogs.service';
import { PageTreeComponent } from '../features/page/page-tree.component';
import { QuickSearchDialogComponent } from '../features/search/quick-search-dialog.component';

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
    <div class="shell" [class.sidebar-closed]="!sidebarOpen()" [class.is-mobile]="isMobile()">
      @if (isMobile() && sidebarOpen()) {
        <div class="sidebar-backdrop" (click)="sidebarOpen.set(false)" aria-hidden="true"></div>
      }

      <aside class="sidebar" aria-label="Navegación principal">
        <div class="sidebar-header">
          <a routerLink="/" class="brand" (click)="closeOnMobile()">
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
          <div class="switcher-row">
            <select
              id="trz-org-select"
              class="org-select"
              aria-label="Organización activa"
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
            placeholder="Filtrar árbol…"
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearch($event)"
          />
          <button
            type="button"
            class="kbd-btn"
            title="Búsqueda rápida global (Ctrl+K)"
            (click)="openQuickSearch()"
          >
            Ctrl+K
          </button>
        </div>

        <div class="quick-nav">
          <a routerLink="/explore" routerLinkActive="is-active" class="quick-nav-link" (click)="closeOnMobile()">
            <atr-icon name="search" size="small" />
            <span>Explorar</span>
          </a>
          <a routerLink="/templates" routerLinkActive="is-active" class="quick-nav-link" (click)="closeOnMobile()">
            <atr-icon name="file-text" size="small" />
            <span>Plantillas</span>
          </a>
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
            @if (favoritePages().length > 0) {
              <div class="section-header">
                <span class="section-label">★ Favoritos</span>
              </div>
              <div class="mini-list">
                @for (fav of favoritePages(); track fav.id) {
                  <a class="mini-page-link" [routerLink]="fav.path" (click)="closeOnMobile()">
                    <atr-icon name="file-text" size="small" />
                    <span>{{ fav.title }}</span>
                  </a>
                }
              </div>
            }

            @if (recentPages().length > 0) {
              <div class="section-header">
                <span class="section-label">Recientes</span>
              </div>
              <div class="mini-list">
                @for (rec of recentPages(); track rec.id) {
                  <a class="mini-page-link" [routerLink]="rec.path" (click)="closeOnMobile()">
                    <atr-icon name="file-text" size="small" />
                    <span>{{ rec.title }}</span>
                  </a>
                }
              </div>
            }

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
                      <span class="ws-name">{{ ws.name }}</span>
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
          <a routerLink="/settings/sync" routerLinkActive="is-active" class="footer-link" (click)="closeOnMobile()">
            <atr-icon name="rotate-ccw" size="small" />
            <span>Sincronización</span>
            @if (sync.pendingCount() > 0) {
              <span class="nav-badge">{{ sync.pendingCount() }}</span>
            }
          </a>
          <a routerLink="/settings/storage" routerLinkActive="is-active" class="footer-link" (click)="closeOnMobile()">
            <atr-icon name="database" size="small" />
            <span>Almacenamiento</span>
          </a>
          <a routerLink="/settings" routerLinkActive="is-active" [routerLinkActiveOptions]="{ exact: true }" class="footer-link" (click)="closeOnMobile()">
            <atr-icon name="settings" size="small" />
            <span>Configuración</span>
          </a>
        </div>
      </aside>

      <div class="main-column">
        <header class="topbar">
          <div class="topbar-left">
            @if (!sidebarOpen() || isMobile()) {
              <button
                atrIconButton
                type="button"
                appearance="standard"
                size="small"
                aria-label="Abrir panel lateral"
                (click)="sidebarOpen.set(!sidebarOpen())"
              >
                <atr-icon name="menu" size="small" />
              </button>
            }
            <span class="mode-dot" [class.is-remote]="sync.isOnline()">
              <span class="dot"></span>
              <span class="mode-text">{{ sync.isOnline() ? 'Local-First' : 'Sin conexión' }}</span>
            </span>

            @if (updater.status() === 'ready') {
              <button atrButton type="button" size="small" appearance="outlined" (click)="updater.applyUpdateNow()">
                Actualizar app
              </button>
            }
          </div>

          <div class="topbar-right">
            <button
              atrButton
              type="button"
              size="small"
              appearance="text"
              title="Búsqueda rápida (Ctrl+K)"
              (click)="openQuickSearch()"
            >
              Buscar
            </button>

            <button
              atrButton
              type="button"
              size="small"
              appearance="outlined"
              [loading]="sync.state() === 'syncing'"
              (click)="triggerOneClickSync()"
            >
              Sincronizar@if (sync.pendingCount() > 0) { ({{ sync.pendingCount() }}) }
            </button>

            <button
              atrIconButton
              type="button"
              appearance="standard"
              size="small"
              [title]="theme.effectiveTheme() === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
              aria-label="Cambiar tema"
              (click)="theme.toggleTheme()"
            >
              <atr-icon [name]="theme.effectiveTheme() === 'dark' ? 'sun' : 'moon'" size="small" />
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
      grid-template-columns: 264px 1fr;
      height: 100dvh;
      overflow: hidden;
      background: var(--trz-bg);
    }

    .shell.sidebar-closed:not(.is-mobile) {
      grid-template-columns: 0 1fr;
      .sidebar {
        transform: translateX(-100%);
        border-right-color: transparent;
      }
    }

    .sidebar-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.36);
      backdrop-filter: blur(2px);
      z-index: 35;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      background: var(--trz-bg-sidebar);
      border-right: 1px solid var(--trz-border);
      overflow: hidden;
      transition: transform 180ms ease;
      z-index: 40;
    }

    .sidebar-header {
      height: var(--trz-topbar-height);
      padding: 0 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      text-decoration: none;
      color: var(--trz-text);
      font-weight: 700;
      font-size: 0.95rem;
      letter-spacing: -0.02em;
    }

    .brand-mark {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: var(--trz-text);
      color: var(--trz-bg);
      display: grid;
      place-items: center;
      font-size: 0.8rem;
    }

    .org-switcher {
      padding: 0.25rem 0.75rem 0.5rem;
    }

    .switcher-row {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .org-select {
      flex: 1;
      min-width: 0;
      height: 34px;
      font-weight: 600;
    }

    .search-box {
      margin: 0 0.75rem 0.5rem;
      padding: 0 0.6rem;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      color: var(--trz-text-subtle);

      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--trz-text);
        font: inherit;
        font-size: 0.83rem;
      }
    }

    .kbd-btn {
      appearance: none;
      border: 1px solid var(--trz-border);
      border-radius: 4px;
      background: var(--trz-bg-subtle);
      color: var(--trz-text-subtle);
      font-family: var(--trz-font-mono);
      font-size: 0.66rem;
      padding: 0.1rem 0.35rem;
      cursor: pointer;
      flex-shrink: 0;

      &:hover {
        color: var(--trz-text);
        border-color: var(--trz-border-strong);
      }
    }

    .quick-nav {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.3rem;
      padding: 0 0.75rem 0.5rem;
    }

    .quick-nav-link {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.34rem 0.45rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      color: var(--trz-text-muted);
      text-decoration: none;
      font-size: 0.78rem;
      font-weight: 500;

      &:hover,
      &.is-active {
        background: var(--trz-accent-soft);
        border-color: var(--trz-accent);
        color: var(--trz-accent);
      }
    }

    .mini-list {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      margin-bottom: 0.55rem;
    }

    .mini-page-link {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.24rem 0.45rem;
      border-radius: var(--trz-radius-sm);
      text-decoration: none;
      color: var(--trz-text-muted);
      font-size: 0.8rem;

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }
    }

    .sidebar-scroll,
    .search-results {
      flex: 1;
      overflow-y: auto;
      padding: 0.25rem 0.55rem 1rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.4rem 0.35rem 0.25rem;
    }

    .section-link,
    .section-label {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--trz-text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      text-decoration: none;
    }

    .mini-action {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-text-subtle);
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
      gap: 0.2rem;
      padding: 0.15rem 0.25rem;
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
      font-size: 0.855rem;
      font-weight: 600;
      padding: 0.22rem 0.2rem;
      border-radius: var(--trz-radius-sm);

      &.is-active {
        background: var(--trz-accent-soft);
        color: var(--trz-accent);
      }
    }

    .ws-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .search-item-title { font-size: 0.85rem; font-weight: 500; }
    .search-item-path { font-size: 0.72rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); }

    .empty-hint {
      font-size: 0.8rem;
      color: var(--trz-text-subtle);
      padding: 0.45rem 0.35rem;
      margin: 0;
    }

    .empty-org {
      padding: 0.65rem 0.35rem;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }

    .sidebar-footer {
      border-top: 1px solid var(--trz-border);
      padding: 0.5rem 0.55rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }

    .footer-link {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.42rem 0.55rem;
      border-radius: var(--trz-radius-sm);
      color: var(--trz-text-muted);
      text-decoration: none;
      font-size: 0.84rem;

      .nav-badge {
        margin-left: auto;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 0.08rem 0.42rem;
        border-radius: 999px;
        background: var(--trz-accent-soft);
        color: var(--trz-accent);
      }

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }

      &.is-active {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
        font-weight: 600;
      }
    }

    .main-column {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100dvh;
      overflow: hidden;
      background: var(--trz-bg);
    }

    .topbar {
      height: var(--trz-topbar-height);
      padding: 0 1.25rem;
      border-bottom: 1px solid var(--trz-border);
      background: var(--trz-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .topbar-left,
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .mode-dot {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.76rem;
      color: var(--trz-text-subtle);
      font-weight: 500;

      .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--trz-text-subtle);
      }

      &.is-remote .dot {
        background: var(--trz-success);
      }
    }

    .user-badge {
      font-size: 0.82rem;
      color: var(--trz-text-muted);
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .content-area {
      flex: 1;
      overflow-y: auto;
      padding: 2rem 2.5rem;
    }

    .shell.is-mobile {
      grid-template-columns: 1fr;

      .sidebar {
        position: fixed;
        inset: 0 auto 0 0;
        width: min(290px, 84vw);
        box-shadow: var(--trz-shadow-md);
      }

      &.sidebar-closed .sidebar {
        transform: translateX(-105%);
        box-shadow: none;
      }

      .topbar {
        padding: 0 0.75rem;
      }

      .user-badge {
        display: none;
      }

      .content-area {
        padding: 1.25rem 1rem 3rem;
      }
    }
  `,
})
export class AppShellComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly sync = inject(TrazenaSyncService);
  protected readonly updater = inject(TrazenaUpdateService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly dialog = inject(AtralumeDialog);
  private readonly destroyRef = inject(DestroyRef);
  private quickSearchOpen = false;

  protected readonly isMobile = signal(
    typeof window !== 'undefined' ? window.innerWidth <= 900 : false,
  );
  protected readonly sidebarOpen = signal(!this.isMobile());
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

  protected readonly favoritePages = computed(() => {
    const pages = this.store.pages();
    return this.meta
      .favorites()
      .map((f) => pages.find((p) => p.id === f.pageId && p.status !== 'deleted'))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 6)
      .map((p) => ({ id: p.id, title: p.title, path: this.store.getCanonicalPath(p.id) }));
  });

  protected readonly recentPages = computed(() => {
    const pages = this.store.pages();
    return this.meta
      .recents()
      .map((r) => pages.find((p) => p.id === r.pageId && p.status !== 'deleted'))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 5)
      .map((p) => ({ id: p.id, title: p.title, path: this.store.getCanonicalPath(p.id) }));
  });

  constructor() {
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(max-width: 900px)');
      const onChange = (e: MediaQueryListEvent) => {
        this.isMobile.set(e.matches);
        this.sidebarOpen.set(!e.matches);
      };
      mql.addEventListener('change', onChange);

      const onKeydown = (ev: KeyboardEvent) => {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
          ev.preventDefault();
          this.openQuickSearch();
        }
      };
      window.addEventListener('keydown', onKeydown);

      this.destroyRef.onDestroy(() => {
        mql.removeEventListener('change', onChange);
        window.removeEventListener('keydown', onKeydown);
      });
    }

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.syncSelectedOrgFromUrl(e.urlAfterRedirects));
  }

  async ngOnInit(): Promise<void> {
    await this.store.initialize();
    await this.meta.initialize();
    this.syncSelectedOrgFromUrl(this.router.url);
    if (!this.selectedOrgId()) {
      const first = this.store.activeOrganizations()[0];
      if (first) this.selectedOrgId.set(first.id);
    }
  }

  protected openQuickSearch(): void {
    if (this.quickSearchOpen) return;
    this.quickSearchOpen = true;
    const ref = this.dialog.open(QuickSearchDialogComponent, {
      size: 'm',
      closable: false,
    });
    ref.afterClosed.subscribe({
      complete: () => {
        this.quickSearchOpen = false;
      },
      error: () => {
        this.quickSearchOpen = false;
      },
    });
  }

  private syncSelectedOrgFromUrl(url: string): void {
    const match = url.match(/^\/o\/([^/?#]+)/);
    if (!match) return;
    const orgSlug = decodeURIComponent(match[1]);
    const found = this.store.activeOrganizations().find((o) => o.slug === orgSlug);
    if (found && found.id !== this.selectedOrgId()) {
      this.selectedOrgId.set(found.id);
    }
  }

  protected selectOrg(orgId: string): void {
    this.selectedOrgId.set(orgId);
    const org = this.store.activeOrganizations().find((o) => o.id === orgId);
    if (org) {
      this.closeOnMobile();
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
    const name = await this.dialogs.prompt({
      title: 'Nueva organización',
      label: 'Nombre de la organización',
      placeholder: 'Ej. Trabajo, Proyectos personales…',
      confirmText: 'Crear',
    });
    if (!name) return;
    const org = await this.store.createOrganization({ name });
    this.selectedOrgId.set(org.id);
    this.snackbar.open({ message: `Organización "${org.name}" creada.`, tone: 'success' });
    this.closeOnMobile();
    await this.router.navigate(['/o', org.slug]);
  }

  protected async quickCreateWorkspace(orgId: string): Promise<void> {
    const name = await this.dialogs.prompt({
      title: 'Nuevo espacio',
      label: 'Nombre del espacio',
      placeholder: 'Ej. Guía de uso, Notas, Finanzas…',
      confirmText: 'Crear',
    });
    if (!name) return;
    const ws = await this.store.createWorkspace({
      organizationId: orgId,
      name,
    });
    this.selectedOrgId.set(orgId);
    const org = this.store.activeOrganizations().find((o) => o.id === orgId);
    this.snackbar.open({ message: `Espacio "${ws.name}" creado.`, tone: 'success' });
    this.closeOnMobile();
    if (org) {
      await this.router.navigate(['/o', org.slug, ws.slug]);
    }
  }

  protected async quickCreatePage(
    orgId: string,
    wsId: string,
    parentId: string | null,
  ): Promise<void> {
    const title = await this.dialogs.prompt({
      title: parentId ? 'Nueva subpágina' : 'Nueva página',
      label: 'Título de la página',
      placeholder: 'Ej. Arquitectura, Despliegues…',
      confirmText: 'Crear',
    });
    if (!title) return;
    const page = await this.store.createPage({
      organizationId: orgId,
      workspaceId: wsId,
      parentId,
      title,
    });
    const path = this.store.getCanonicalPath(page.id);
    this.snackbar.open({ message: `Página "${page.title}" creada.`, tone: 'success' });
    this.closeOnMobile();
    await this.router.navigateByUrl(path);
  }

  protected async triggerOneClickSync(): Promise<void> {
    const res = await this.sync.syncNow();
    if (!res) {
      const msg = this.sync.lastError();
      if (msg) this.snackbar.open({ message: msg, tone: 'info' });
      return;
    }
    if (res.status === 'completed') {
      this.snackbar.open({
        message: `Sincronizado: ${res.uploaded.length} subidos, ${res.downloaded.length} descargados.`,
        tone: 'success',
      });
    } else if (res.status === 'partial_conflict') {
      this.snackbar.open({
        message: `Hay ${res.conflictsCount} conflicto(s). Revísalos en Sincronización.`,
        tone: 'warning',
      });
    } else {
      this.snackbar.open({
        message: res.errorMessage ?? 'Error al sincronizar.',
        tone: 'error',
      });
    }
  }

  protected closeOnMobile(): void {
    if (this.isMobile()) {
      this.sidebarOpen.set(false);
    }
  }
}
