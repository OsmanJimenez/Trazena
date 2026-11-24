import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import {
  KnowledgeHealthService,
  type KnowledgeHealthReport,
} from '../../core/productivity/knowledge-health.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-knowledge-health',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="health-page">
      <header class="header">
        <div>
          <h1>Salud del conocimiento</h1>
          <p>Audita localmente revisiones pendientes, enlaces internos rotos, duplicados, páginas huérfanas y etiquetas sin uso.</p>
        </div>
        <div class="header-actions">
          <label class="check-row">
            <input
              type="checkbox"
              [ngModel]="includeArchived()"
              (ngModelChange)="includeArchived.set($event); runAudit()"
            />
            <span>Incluir archivadas</span>
          </label>
          <button atrButton type="button" size="small" appearance="filled" (click)="runAudit()">
            Reanalizar
          </button>
        </div>
      </header>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Política de revisión por organización</h2>
          <div class="policy-list">
            @for (org of store.activeOrganizations(); track org.id) {
              <div class="policy-row">
                <strong>{{ org.name }}</strong>
                <div class="policy-ctrl">
                  <span>Plazo (días):</span>
                  <input
                    type="number"
                    min="7"
                    max="365"
                    [ngModel]="health.getReviewCycleDays(org.id)"
                    (ngModelChange)="updateCycle(org.id, $event)"
                  />
                </div>
              </div>
            }
          </div>
        </div>
      </atr-card>

      @if (report(); as rep) {
        <div class="summary-strip">
          <div class="stat"><strong>{{ rep.totalActivePages }}</strong><span>Documentos analizados</span></div>
          <div class="stat"><strong>{{ rep.unreviewedPages.length }}</strong><span>Sin revisar</span></div>
          <div class="stat"><strong>{{ rep.brokenInternalLinks.length }}</strong><span>Enlaces internos rotos</span></div>
          <div class="stat"><strong>{{ rep.potentialDuplicates.length }}</strong><span>Posibles duplicados</span></div>
          <div class="stat"><strong>{{ rep.orphanPages.length }}</strong><span>Sin backlinks</span></div>
          <div class="stat"><strong>{{ rep.unusedTags.length }}</strong><span>Etiquetas sin uso</span></div>
        </div>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Documentos pendientes de revisión ({{ rep.unreviewedPages.length }})</h2>
            @if (rep.unreviewedPages.length > 0) {
              <div class="item-list">
                @for (item of rep.unreviewedPages; track item.page.id) {
                  <div class="item-row">
                    <div>
                      <a [routerLink]="item.path" class="item-link">{{ item.page.title }}</a>
                      <div class="item-meta">
                        {{ item.daysSinceReview === null ? 'Nunca revisado explícitamente' : 'Revisado hace ' + item.daysSinceReview + ' días' }}
                        (ciclo: {{ item.cycleDays }} días)
                      </div>
                    </div>
                    <button atrButton type="button" size="small" appearance="outlined" (click)="markReviewed(item.page.id)">
                      Marcar revisado
                    </button>
                  </div>
                }
              </div>
            } @else {
              <atr-empty-state appearance="compact" title="Todo revisado" description="Todos los documentos activos están dentro del plazo de revisión." />
            }
          </div>
        </atr-card>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Enlaces internos rotos ({{ rep.brokenInternalLinks.length }})</h2>
            @if (rep.brokenInternalLinks.length > 0) {
              <div class="item-list">
                @for (b of rep.brokenInternalLinks; track b.sourcePageId + b.targetPageId) {
                  <div class="item-row">
                    <div>
                      <a [routerLink]="b.sourcePath" class="item-link">{{ b.sourceTitle }}</a>
                      <div class="item-meta">
                        Enlace "{{ b.linkLabel }}" → <code>trazena://page/{{ b.targetPageId }}</code>
                        ({{ b.reason === 'deleted' ? 'en papelera' : 'destino inexistente' }})
                      </div>
                    </div>
                    <a atrButton size="small" appearance="text" [routerLink]="b.sourcePath">Corregir</a>
                  </div>
                }
              </div>
            } @else {
              <atr-empty-state appearance="compact" title="Sin enlaces internos rotos" description="Todas las referencias trazena://page/ apuntan a páginas válidas." />
            }
          </div>
        </atr-card>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Posibles duplicados ({{ rep.potentialDuplicates.length }})</h2>
            @if (rep.potentialDuplicates.length > 0) {
              <div class="item-list">
                @for (dup of rep.potentialDuplicates; track dup.reason + dup.key) {
                  <div class="dup-block">
                    <span class="dup-label">
                      {{ dup.reason === 'identical_content' ? 'Contenido idéntico' : 'Título idéntico' }}
                    </span>
                    <div class="dup-links">
                      @for (p of dup.pages; track p.id) {
                        <a [routerLink]="p.path">{{ p.title }} (<code>{{ p.path }}</code>)</a>
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <atr-empty-state appearance="compact" title="Sin duplicados detectados" description="No se encontraron títulos ni contenidos idénticos." />
            }
          </div>
        </atr-card>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Páginas sin referencias entrantes ({{ rep.orphanPages.length }})</h2>
            <p class="hint">Informativo: una página raíz o independiente puede no tener backlinks sin ser un error.</p>
            <div class="chips-row">
              @for (o of rep.orphanPages.slice(0, 30); track o.page.id) {
                <a class="chip-link" [routerLink]="o.path">{{ o.page.title }}</a>
              }
            </div>
          </div>
        </atr-card>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Etiquetas sin uso ({{ rep.unusedTags.length }})</h2>
            @if (rep.unusedTags.length > 0) {
              <div class="item-list">
                @for (tag of rep.unusedTags; track tag.id) {
                  <div class="item-row">
                    <span>#{{ tag.name }}</span>
                    <button atrButton type="button" size="small" appearance="text" (click)="deleteUnusedTag(tag.id)">
                      Eliminar etiqueta
                    </button>
                  </div>
                }
              </div>
            } @else {
              <p class="hint">Todas las etiquetas activas están asignadas al menos a un documento.</p>
            }
          </div>
        </atr-card>

        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Enlaces externos detectados ({{ rep.externalLinks.length }})</h2>
            <p class="hint">
              Por seguridad y restricciones CORS del navegador, los enlaces externos no se consultan automáticamente;
              puedes abrir cualquiera manualmente para verificarlo.
            </p>
            @if (rep.externalLinks.length > 0) {
              <div class="item-list">
                @for (ext of rep.externalLinks.slice(0, 25); track ext.sourcePageId + ext.url) {
                  <div class="item-row">
                    <div>
                      <a [href]="ext.url" target="_blank" rel="noopener noreferrer" class="item-link">{{ ext.url }}</a>
                      <div class="item-meta">En: <a [routerLink]="ext.sourcePath">{{ ext.sourceTitle }}</a></div>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </atr-card>
      }
    </div>
  `,
  styles: `
    .health-page { max-width: 920px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.75rem;
      h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.85rem); letter-spacing: -0.025em; }
      p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; max-width: 68ch; }
    }
    .header-actions { display: flex; align-items: center; gap: 0.75rem; }
    .check-row { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.84rem; cursor: pointer; input { accent-color: var(--trz-accent); } }
    .summary-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 0.6rem; }
    .stat {
      padding: 0.65rem 0.8rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm); background: var(--trz-bg-elevated);
      display: flex; flex-direction: column; gap: 0.15rem;
      strong { font-size: 1.15rem; font-variant-numeric: tabular-nums; }
      span { font-size: 0.74rem; color: var(--trz-text-muted); }
    }
    .card-inner { padding: 1.15rem 1.3rem; display: flex; flex-direction: column; gap: 0.8rem; h2 { margin: 0; font-size: 0.96rem; font-weight: 650; } }
    .policy-list { display: flex; flex-direction: column; gap: 0.45rem; }
    .policy-row {
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.45rem 0; border-bottom: 1px solid var(--trz-border); font-size: 0.86rem;
      &:last-child { border-bottom: 0; }
    }
    .policy-ctrl {
      display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; color: var(--trz-text-muted);
      input { width: 78px; height: 30px; padding: 0 0.5rem; border: 1px solid var(--trz-border-strong); border-radius: 5px; background: var(--trz-bg); color: var(--trz-text); font: inherit; }
    }
    .item-list { display: flex; flex-direction: column; }
    .item-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem;
      padding: 0.55rem 0; border-bottom: 1px solid var(--trz-border); font-size: 0.85rem;
      &:last-child { border-bottom: 0; }
    }
    .item-link { color: var(--trz-text); font-weight: 600; text-decoration: none; &:hover { color: var(--trz-accent); text-decoration: underline; } }
    .item-meta { font-size: 0.76rem; color: var(--trz-text-subtle); margin-top: 0.12rem; a { color: var(--trz-accent); } }
    .dup-block { padding: 0.55rem 0; border-bottom: 1px solid var(--trz-border); &:last-child { border-bottom: 0; } }
    .dup-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--trz-warning); font-weight: 600; }
    .dup-links { display: flex; flex-direction: column; gap: 0.25rem; margin-top: 0.3rem; font-size: 0.83rem; a { color: var(--trz-text); text-decoration: none; &:hover { color: var(--trz-accent); } } }
    .chips-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .chip-link {
      padding: 0.28rem 0.6rem; border: 1px solid var(--trz-border); border-radius: 999px;
      background: var(--trz-bg-subtle); color: var(--trz-text); text-decoration: none; font-size: 0.78rem;
      &:hover { border-color: var(--trz-accent); color: var(--trz-accent); }
    }
    .hint { margin: 0; font-size: 0.82rem; color: var(--trz-text-muted); }
  `,
})
export class KnowledgeHealthComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly health = inject(KnowledgeHealthService);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly includeArchived = signal(false);
  protected readonly report = signal<KnowledgeHealthReport | null>(null);

  async ngOnInit(): Promise<void> {
    await this.runAudit();
  }

  protected async runAudit(): Promise<void> {
    const rep = await this.health.analyzeHealth(this.includeArchived());
    this.report.set(rep);
  }

  protected async updateCycle(orgId: string, days: number): Promise<void> {
    if (!Number.isFinite(Number(days))) return;
    await this.health.setReviewCycleDays(orgId, Number(days));
    await this.runAudit();
  }

  protected async markReviewed(pageId: string): Promise<void> {
    const page = this.store.pages().find((p) => p.id === pageId);
    if (!page) return;
    await this.health.markPageReviewed(page);
    this.snackbar.open({ message: `"${page.title}" marcada como revisada.`, tone: 'success' });
    await this.runAudit();
  }

  protected async deleteUnusedTag(tagId: string): Promise<void> {
    await this.meta.deleteTag(tagId);
    this.snackbar.open({ message: 'Etiqueta eliminada.', tone: 'info' });
    await this.runAudit();
  }
}
