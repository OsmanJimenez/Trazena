import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-home-dashboard',
  standalone: true,
  imports: [RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dashboard">
      <header class="dash-header">
        <div>
          <h1>Tu base de conocimiento</h1>
          <p>Organiza documentación técnica y personal en organizaciones, espacios y páginas recursivas.</p>
        </div>
        <button atrButton type="button" appearance="filled" (click)="createOrg()">
          + Nueva organización
        </button>
      </header>

      <section class="section">
        <h2>Organizaciones</h2>
        @if (store.activeOrganizations().length > 0) {
          <div class="cards-grid">
            @for (org of store.activeOrganizations(); track org.id) {
              <a class="card-link" [routerLink]="['/o', org.slug]">
                <atr-card appearance="outlined" class="org-card">
                  <div class="org-card-top">
                    <atr-icon [name]="org.icon || 'folder'" size="medium" />
                    <h3>{{ org.name }}</h3>
                  </div>
                  <p class="org-desc">{{ org.description || 'Sin descripción' }}</p>
                  <span class="org-meta">
                    {{ store.getWorkspacesForOrg(org.id).length }} espacios · /o/{{ org.slug }}
                  </span>
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

      @if (recentPages().length > 0) {
        <section class="section">
          <h2>Páginas recientes</h2>
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
    </div>
  `,
  styles: `
    .dashboard {
      max-width: 1080px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }

    .dash-header {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;

      h1 {
        margin: 0;
        font-size: 1.75rem;
        letter-spacing: -0.025em;
      }

      p {
        margin: 0.35rem 0 0;
        color: var(--trz-text-muted);
      }
    }

    .section h2 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--trz-text-subtle);
      margin: 0 0 0.9rem;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }

    .card-link {
      text-decoration: none;
      color: inherit;
    }

    .org-card {
      padding: 1.15rem 1.25rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      height: 100%;
      transition: border-color 140ms ease, transform 140ms ease;

      &:hover {
        border-color: var(--trz-accent);
        transform: translateY(-1px);
      }
    }

    .org-card-top {
      display: flex;
      align-items: center;
      gap: 0.6rem;

      h3 {
        margin: 0;
        font-size: 1.05rem;
      }
    }

    .org-desc {
      margin: 0;
      font-size: 0.86rem;
      color: var(--trz-text-muted);
      line-height: 1.45;
      flex: 1;
    }

    .org-meta {
      font-size: 0.76rem;
      color: var(--trz-text-subtle);
      font-family: var(--trz-font-mono);
    }

    .recent-list {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      overflow: hidden;
    }

    .recent-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.7rem 1rem;
      text-decoration: none;
      color: var(--trz-text);
      border-bottom: 1px solid var(--trz-border);

      &:last-child { border-bottom: 0; }
      &:hover { background: var(--trz-bg-hover); }
    }

    .recent-left {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      font-weight: 500;
      font-size: 0.92rem;
    }

    .recent-path {
      font-family: var(--trz-font-mono);
      font-size: 0.76rem;
      color: var(--trz-text-subtle);
    }
  `,
})
export class HomeDashboardComponent {
  protected readonly store = inject(KnowledgeStore);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly recentPages = computed(() =>
    [...this.store.pages()]
      .filter((p) => p.status === 'active')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8),
  );

  protected async createOrg(): Promise<void> {
    const name = window.prompt('Nombre de la organización:');
    if (!name?.trim()) return;
    const org = await this.store.createOrganization({ name: name.trim() });
    this.snackbar.open({ message: `Organización "${org.name}" creada.`, tone: 'success' });
    await this.router.navigate(['/o', org.slug]);
  }
}
