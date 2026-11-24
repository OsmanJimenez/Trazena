import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { HomeSectionId } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import {
  DailyNotesService,
  toLocalCalendarDate,
} from '../../core/productivity/daily-notes.service';
import { HomePreferencesService } from '../../core/productivity/home-preferences.service';
import { KnowledgeHealthService } from '../../core/productivity/knowledge-health.service';
import { RemindersService } from '../../core/productivity/reminders.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { TrazenaSyncService } from '../../core/sync/trazena-sync.service';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';

const SECTION_LABELS: Record<HomeSectionId, string> = {
  daily: 'Nota diaria',
  reminders: 'Recordatorios',
  recent: 'Documentos recientes',
  favorites: 'Favoritos',
  pinned_workspaces: 'Espacios fijados',
  organizations: 'Organizaciones',
  saved_views: 'Vistas guardadas',
  needs_review: 'Pendientes de revisión',
  sync_status: 'Estado de sincronización',
};

@Component({
  selector: 'trz-home-dashboard',
  standalone: true,
  imports: [RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dashboard">
      <header class="dash-header">
        <div>
          <h1>Tu espacio de conocimiento</h1>
          <p>Continúa trabajando sin fricción desde tu bóveda local.</p>
        </div>
        <div class="header-actions">
          <button atrButton type="button" size="small" appearance="outlined" (click)="customizing.set(!customizing())">
            {{ customizing() ? 'Cerrar personalización' : 'Personalizar inicio' }}
          </button>
          <button atrButton type="button" size="small" appearance="filled" (click)="createOrg()">
            + Nueva organización
          </button>
        </div>
      </header>

      @if (customizing()) {
        <atr-card appearance="outlined">
          <div class="customize-inner">
            <div class="customize-head">
              <strong>Secciones visibles y orden</strong>
              <button atrButton type="button" size="small" appearance="text" (click)="homePrefs.resetDefaults()">
                Restablecer
              </button>
            </div>
            <div class="customize-grid">
              @for (sec of homePrefs.prefs().sections; track sec.id; let idx = $index) {
                <div class="sec-toggle-row">
                  <label>
                    <input
                      type="checkbox"
                      [checked]="sec.visible"
                      (change)="homePrefs.toggleSection(sec.id)"
                    />
                    <span>{{ labelFor(sec.id) }}</span>
                  </label>
                  <div class="order-btns">
                    <button type="button" [disabled]="idx === 0" (click)="homePrefs.moveSection(sec.id, -1)">↑</button>
                    <button
                      type="button"
                      [disabled]="idx === homePrefs.prefs().sections.length - 1"
                      (click)="homePrefs.moveSection(sec.id, 1)"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        </atr-card>
      }

      @for (sec of visibleSections(); track sec.id) {
        @switch (sec.id) {
          @case ('daily') {
            <section class="section">
              <div class="section-head">
                <h2>Nota diaria ({{ todayDate }})</h2>
                <a routerLink="/daily" class="sec-link">Ver calendario →</a>
              </div>
              <div class="inline-bar">
                <p class="bar-desc">
                  {{ hasTodayNote() ? 'Tu nota diaria de hoy ya está creada y lista para continuar.' : 'Crea o abre la nota correspondiente al día de hoy.' }}
                </p>
                <button atrButton type="button" size="small" appearance="filled" (click)="openTodayNote()">
                  {{ hasTodayNote() ? 'Abrir nota de hoy' : 'Crear nota de hoy' }}
                </button>
              </div>
            </section>
          }

          @case ('reminders') {
            @if (reminders.overdueReminders().length > 0 || reminders.upcomingReminders().length > 0) {
              <section class="section">
                <div class="section-head">
                  <h2>Recordatorios ({{ reminders.overdueReminders().length }} vencidos · {{ reminders.upcomingReminders().length }} próximos)</h2>
                  <a routerLink="/reminders" class="sec-link">Gestionar →</a>
                </div>
                <div class="recent-list">
                  @for (rem of topReminders(); track rem.id) {
                    <div class="recent-row">
                      <a class="recent-left" [routerLink]="store.getCanonicalPath(rem.pageId)">
                        <span class="rem-dot" [class.overdue]="isOverdue(rem.id)"></span>
                        <span class="recent-title">{{ rem.title }}</span>
                      </a>
                      <div class="row-right">
                        <code class="recent-path">{{ rem.dueDate }}{{ rem.dueTime ? ' ' + rem.dueTime : '' }}</code>
                        <button atrButton type="button" size="small" appearance="text" (click)="reminders.completeReminder(rem.id)">
                          Completar
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </section>
            }
          }

          @case ('recent') {
            @if (recentPages().length > 0) {
              <section class="section">
                <div class="section-head">
                  <h2>Documentos recientes</h2>
                  <a routerLink="/explore" class="sec-link">Explorar todo →</a>
                </div>
                <div class="recent-list">
                  @for (page of recentPages(); track page.id) {
                    <a class="recent-row" [routerLink]="store.getCanonicalPath(page.id)">
                      <div class="recent-left">
                        <atr-icon [name]="page.icon || 'file-text'" size="small" />
                        <span class="recent-title">{{ page.title }}</span>
                      </div>
                      <code class="recent-path">{{ store.getCanonicalPath(page.id) }}</code>
                    </a>
                  }
                </div>
              </section>
            }
          }

          @case ('favorites') {
            @if (favoritePages().length > 0) {
              <section class="section">
                <h2>Favoritos</h2>
                <div class="recent-list">
                  @for (page of favoritePages(); track page.id) {
                    <a class="recent-row" [routerLink]="store.getCanonicalPath(page.id)">
                      <div class="recent-left">
                        <atr-icon [name]="page.icon || 'file-text'" size="small" />
                        <span class="recent-title">{{ page.title }}</span>
                      </div>
                      <code class="recent-path">{{ store.getCanonicalPath(page.id) }}</code>
                    </a>
                  }
                </div>
              </section>
            }
          }

          @case ('pinned_workspaces') {
            @if (pinnedWorkspaces().length > 0) {
              <section class="section">
                <h2>Espacios fijados</h2>
                <div class="cards-grid">
                  @for (item of pinnedWorkspaces(); track item.ws.id) {
                    <div class="pinned-card">
                      <a class="card-link" [routerLink]="['/o', item.orgSlug, item.ws.slug]">
                        <strong>{{ item.ws.name }}</strong>
                        <span>{{ item.orgName }}</span>
                      </a>
                      <button type="button" class="unpin-btn" (click)="homePrefs.togglePinnedWorkspace(item.ws.id)">
                        Desfijar
                      </button>
                    </div>
                  }
                </div>
              </section>
            }
          }

          @case ('organizations') {
            <section class="section">
              <h2>Organizaciones</h2>
              @if (store.activeOrganizations().length > 0) {
                <div class="cards-grid">
                  @for (org of store.activeOrganizations(); track org.id) {
                    <a class="card-link" [routerLink]="['/o', org.slug]">
                      <atr-card appearance="outlined" class="org-card">
                        <div class="card-inner">
                          <div class="org-card-top">
                            <span class="org-icon">
                              <atr-icon [name]="org.icon || 'folder'" size="small" />
                            </span>
                            <h3>{{ org.name }}</h3>
                          </div>
                          <p class="org-desc">{{ org.description || 'Sin descripción' }}</p>
                          <span class="org-meta">
                            {{ store.getWorkspacesForOrg(org.id).length }} espacio(s) · /o/{{ org.slug }}
                          </span>
                        </div>
                      </atr-card>
                    </a>
                  }
                </div>
              } @else {
                <atr-empty-state
                  title="Aún no tienes organizaciones"
                  description="Crea tu primera organización para empezar a estructurar espacios y páginas."
                />
              }
            </section>
          }

          @case ('saved_views') {
            @if (meta.savedViews().length > 0) {
              <section class="section">
                <div class="section-head">
                  <h2>Vistas guardadas</h2>
                  <a routerLink="/explore" class="sec-link">Abrir Explorador →</a>
                </div>
                <div class="chips-row">
                  @for (view of meta.savedViews(); track view.id) {
                    <a class="view-chip" routerLink="/explore">{{ view.name }}</a>
                  }
                </div>
              </section>
            }
          }

          @case ('needs_review') {
            @if (unreviewedPages().length > 0) {
              <section class="section">
                <div class="section-head">
                  <h2>Pendientes de revisión ({{ unreviewedPages().length }})</h2>
                  <a routerLink="/health" class="sec-link">Salud del conocimiento →</a>
                </div>
                <div class="recent-list">
                  @for (page of unreviewedPages().slice(0, 5); track page.id) {
                    <div class="recent-row">
                      <a class="recent-left" [routerLink]="store.getCanonicalPath(page.id)">
                        <atr-icon name="file-text" size="small" />
                        <span class="recent-title">{{ page.title }}</span>
                      </a>
                      <button atrButton type="button" size="small" appearance="text" (click)="markReviewed(page.id)">
                        Marcar revisado
                      </button>
                    </div>
                  }
                </div>
              </section>
            }
          }

          @case ('sync_status') {
            <section class="section">
              <div class="inline-bar">
                <p class="bar-desc">
                  Estado local: <strong>{{ sync.pendingCount() }}</strong> cambio(s) pendientes en Outbox ·
                  {{ sync.isOnline() ? 'Con conexión (sincronización manual)' : 'Modo sin conexión' }}.
                </p>
                <a atrButton size="small" appearance="outlined" routerLink="/settings/sync">
                  Centro de sincronización
                </a>
              </div>
            </section>
          }
        }
      }
    </div>
  `,
  styles: `
    .dashboard { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.75rem; }
    .dash-header {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem;
      h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.85rem); font-weight: 750; letter-spacing: -0.03em; }
      p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    }
    .header-actions { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .customize-inner { padding: 1rem 1.2rem; display: flex; flex-direction: column; gap: 0.75rem; }
    .customize-head { display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; }
    .customize-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.45rem; }
    .sec-toggle-row {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      padding: 0.4rem 0.6rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle); font-size: 0.82rem;
      label { display: flex; align-items: center; gap: 0.45rem; cursor: pointer; input { accent-color: var(--trz-accent); } }
    }
    .order-btns {
      display: flex; gap: 0.2rem;
      button {
        appearance: none; border: 1px solid var(--trz-border); background: var(--trz-bg);
        color: var(--trz-text-muted); border-radius: 4px; width: 22px; height: 22px; cursor: pointer;
        &:disabled { opacity: 0.35; cursor: default; }
      }
    }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
    .section h2 { font-size: 0.74rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--trz-text-subtle); margin: 0 0 0.75rem; }
    .section-head h2 { margin: 0; }
    .sec-link { font-size: 0.78rem; color: var(--trz-accent); text-decoration: none; &:hover { text-decoration: underline; } }
    .inline-bar {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.8rem 1rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md); background: var(--trz-bg-elevated);
    }
    .bar-desc { margin: 0; font-size: 0.86rem; color: var(--trz-text-muted); }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.85rem; }
    .card-link { text-decoration: none; color: inherit; display: block; }
    .org-card { height: 100%; &:hover { border-color: var(--trz-border-strong) !important; } }
    .card-inner { padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.6rem; height: 100%; }
    .org-card-top { display: flex; align-items: center; gap: 0.6rem; h3 { margin: 0; font-size: 1rem; font-weight: 650; } }
    .org-icon { width: 28px; height: 28px; border-radius: 6px; background: var(--trz-bg-subtle); display: grid; place-items: center; flex-shrink: 0; }
    .org-desc { margin: 0; font-size: 0.84rem; color: var(--trz-text-muted); line-height: 1.45; flex: 1; }
    .org-meta { font-size: 0.73rem; color: var(--trz-text-subtle); font-family: var(--trz-font-mono); }
    .pinned-card {
      display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
      padding: 0.75rem 0.9rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md); background: var(--trz-bg-elevated);
      a { display: flex; flex-direction: column; gap: 0.15rem; strong { font-size: 0.9rem; } span { font-size: 0.75rem; color: var(--trz-text-subtle); } }
    }
    .unpin-btn { appearance: none; border: 0; background: transparent; color: var(--trz-text-subtle); font-size: 0.74rem; cursor: pointer; &:hover { color: var(--trz-danger); } }
    .recent-list { display: flex; flex-direction: column; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md); background: var(--trz-bg-elevated); overflow: hidden; }
    .recent-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.45rem 1rem;
      padding: 0.68rem 0.95rem; text-decoration: none; color: var(--trz-text);
      border-bottom: 1px solid var(--trz-border);
      &:last-child { border-bottom: 0; }
      &:hover { background: var(--trz-bg-subtle); }
    }
    .recent-left { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; font-size: 0.88rem; text-decoration: none; color: var(--trz-text); }
    .row-right { display: flex; align-items: center; gap: 0.5rem; }
    .rem-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--trz-accent); &.overdue { background: var(--trz-danger); } }
    .recent-path { font-family: var(--trz-font-mono); font-size: 0.73rem; color: var(--trz-text-subtle); overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .chips-row { display: flex; flex-wrap: wrap; gap: 0.45rem; }
    .view-chip {
      padding: 0.35rem 0.7rem; border: 1px solid var(--trz-border); border-radius: 999px;
      background: var(--trz-bg-elevated); color: var(--trz-text); text-decoration: none; font-size: 0.8rem;
      &:hover { border-color: var(--trz-accent); color: var(--trz-accent); }
    }
  `,
})
export class HomeDashboardComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  protected readonly daily = inject(DailyNotesService);
  protected readonly reminders = inject(RemindersService);
  protected readonly sync = inject(TrazenaSyncService);
  protected readonly homePrefs = inject(HomePreferencesService);
  private readonly health = inject(KnowledgeHealthService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly dialogs = inject(TrazenaDialogsService);

  protected readonly customizing = signal(false);
  protected readonly todayDate = toLocalCalendarDate();

  protected readonly visibleSections = computed(() =>
    this.homePrefs.prefs().sections.filter((s) => s.visible),
  );

  protected readonly hasTodayNote = computed(() =>
    this.daily.datesWithNotes().has(this.todayDate),
  );

  protected readonly topReminders = computed(() =>
    [...this.reminders.overdueReminders(), ...this.reminders.upcomingReminders()].slice(0, 5),
  );

  protected readonly recentPages = computed(() =>
    [...this.store.pages()]
      .filter((p) => p.status === 'active')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 6),
  );

  protected readonly favoritePages = computed(() => {
    const pages = this.store.pages();
    return this.meta
      .favorites()
      .map((f) => pages.find((p) => p.id === f.pageId && p.status === 'active'))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 6);
  });

  protected readonly pinnedWorkspaces = computed(() => {
    const pinnedIds = new Set(this.homePrefs.prefs().pinnedWorkspaceIds);
    const orgs = new Map(this.store.organizations().map((o) => [o.id, o]));
    return this.store
      .workspaces()
      .filter((ws) => pinnedIds.has(ws.id) && ws.status === 'active')
      .map((ws) => {
        const org = orgs.get(ws.organizationId);
        return { ws, orgName: org?.name ?? '', orgSlug: org?.slug ?? '' };
      })
      .filter((item) => Boolean(item.orgSlug));
  });

  protected readonly unreviewedPages = computed(() => {
    const now = Date.now();
    return this.store.pages().filter((p) => {
      if (p.status !== 'active') return false;
      const cycle = this.health.getReviewCycleDays(p.organizationId);
      if (!p.lastReviewedAt) return true;
      const days = Math.floor((now - new Date(p.lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24));
      return days >= cycle;
    });
  });

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.store.initialize(),
      this.meta.initialize(),
      this.daily.initialize(),
      this.reminders.initialize(),
      this.homePrefs.initialize(),
      this.health.initialize(),
    ]);
  }

  protected labelFor(id: HomeSectionId): string {
    return SECTION_LABELS[id];
  }

  protected isOverdue(id: string): boolean {
    return this.reminders.overdueReminders().some((r) => r.id === id);
  }

  protected async openTodayNote(): Promise<void> {
    const page = await this.daily.openOrCreateForDate(this.todayDate);
    if (!page) {
      this.snackbar.open({ message: 'Crea una organización y un espacio primero.', tone: 'warning' });
      return;
    }
    await this.router.navigateByUrl(this.store.getCanonicalPath(page.id));
  }

  protected async markReviewed(pageId: string): Promise<void> {
    const page = this.store.pages().find((p) => p.id === pageId);
    if (!page) return;
    await this.health.markPageReviewed(page);
    this.snackbar.open({ message: `"${page.title}" marcada como revisada.`, tone: 'success' });
  }

  protected async createOrg(): Promise<void> {
    const name = await this.dialogs.prompt({
      title: 'Nueva organización',
      label: 'Nombre de la organización',
      placeholder: 'Ej. Trabajo, Proyectos personales…',
      confirmText: 'Crear',
    });
    if (!name) return;
    const org = await this.store.createOrganization({ name });
    this.snackbar.open({ message: `Organización "${org.name}" creada.`, tone: 'success' });
    await this.router.navigate(['/o', org.slug]);
  }
}
