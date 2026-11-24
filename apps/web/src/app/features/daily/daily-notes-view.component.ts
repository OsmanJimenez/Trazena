import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import {
  DailyNotesService,
  shiftLocalCalendarDate,
  toLocalCalendarDate,
} from '../../core/productivity/daily-notes.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-daily-notes-view',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="daily-page">
      <header class="header">
        <div>
          <h1>Notas diarias</h1>
          <p>Páginas estándar de Trazena organizadas por fecha calendario local, con plantilla configurable y almacenamiento en IndexedDB.</p>
        </div>
      </header>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <div class="date-nav">
            <button atrButton type="button" size="small" appearance="outlined" (click)="shift(-1)">
              ← Día anterior
            </button>
            <input
              type="date"
              class="date-input"
              aria-label="Seleccionar fecha de nota diaria"
              [ngModel]="selectedDate()"
              (ngModelChange)="selectedDate.set($event)"
            />
            <button atrButton type="button" size="small" appearance="outlined" (click)="goToday()">
              Hoy
            </button>
            <button atrButton type="button" size="small" appearance="outlined" (click)="shift(1)">
              Día siguiente →
            </button>
            <button atrButton type="button" size="small" appearance="filled" (click)="openOrCreate(selectedDate())">
              {{ hasSelectedNote() ? 'Abrir nota del ' + selectedDate() : 'Crear nota del ' + selectedDate() }}
            </button>
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Configuración de diario</h2>
          <div class="prefs-grid">
            <label>
              <span>Organización destino</span>
              <select [ngModel]="prefOrgId()" (ngModelChange)="onPrefOrgChange($event)">
                @for (org of store.activeOrganizations(); track org.id) {
                  <option [value]="org.id">{{ org.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Espacio de notas diarias</span>
              <select [ngModel]="prefWsId()" (ngModelChange)="prefWsId.set($event); savePrefs()">
                @for (ws of prefWorkspaces(); track ws.id) {
                  <option [value]="ws.id">{{ ws.name }}</option>
                }
              </select>
            </label>
            <label>
              <span>Plantilla predeterminada</span>
              <select [ngModel]="prefTemplateId()" (ngModelChange)="prefTemplateId.set($event); savePrefs()">
                <option value="">Plantilla diaria estándar</option>
                @for (tpl of meta.templates(); track tpl.id) {
                  <option [value]="tpl.id">{{ tpl.name }}</option>
                }
              </select>
            </label>
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Fechas con notas ({{ daily.entries().length }})</h2>
          @if (daily.entries().length > 0) {
            <div class="entries-list">
              @for (entry of daily.entries(); track entry.id) {
                <a class="entry-row" [routerLink]="store.getCanonicalPath(entry.pageId)">
                  <strong>{{ entry.noteDate }}</strong>
                  <code>{{ store.getCanonicalPath(entry.pageId) }}</code>
                </a>
              }
            </div>
          } @else {
            <atr-empty-state
              appearance="compact"
              title="Aún no has creado notas diarias"
              description="Selecciona una fecha y haz clic en Crear nota para comenzar."
            />
          }
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .daily-page { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.85rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    .card-inner { padding: 1.15rem 1.3rem; display: flex; flex-direction: column; gap: 0.85rem; h2 { margin: 0; font-size: 0.95rem; font-weight: 650; } }
    .date-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .date-input {
      height: 34px; padding: 0 0.65rem; border: 1px solid var(--trz-border-strong);
      border-radius: var(--trz-radius-sm); background: var(--trz-bg); color: var(--trz-text); font: inherit;
    }
    .prefs-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;
      label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: var(--trz-text-muted); font-weight: 500; }
    }
    .entries-list { display: flex; flex-direction: column; }
    .entry-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem;
      padding: 0.6rem 0; border-bottom: 1px solid var(--trz-border); text-decoration: none; color: var(--trz-text); font-size: 0.88rem;
      &:last-child { border-bottom: 0; }
      &:hover strong { color: var(--trz-accent); }
      code { font-family: var(--trz-font-mono); font-size: 0.74rem; color: var(--trz-text-subtle); }
    }
  `,
})
export class DailyNotesViewComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  protected readonly daily = inject(DailyNotesService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly selectedDate = signal(toLocalCalendarDate());
  protected readonly prefOrgId = signal('');
  protected readonly prefWsId = signal('');
  protected readonly prefTemplateId = signal('');

  protected readonly hasSelectedNote = computed(() =>
    this.daily.datesWithNotes().has(this.selectedDate()),
  );

  protected readonly prefWorkspaces = computed(() =>
    this.prefOrgId() ? this.store.getWorkspacesForOrg(this.prefOrgId()) : [],
  );

  async ngOnInit(): Promise<void> {
    await this.daily.initialize();
    const target = this.daily.resolveTargetWorkspace();
    this.prefOrgId.set(this.daily.preferences().organizationId ?? target?.organizationId ?? '');
    this.prefWsId.set(this.daily.preferences().workspaceId ?? target?.workspaceId ?? '');
    this.prefTemplateId.set(this.daily.preferences().templateId ?? '');
  }

  protected shift(days: number): void {
    this.selectedDate.set(shiftLocalCalendarDate(this.selectedDate(), days));
  }

  protected goToday(): void {
    this.selectedDate.set(toLocalCalendarDate());
  }

  protected onPrefOrgChange(orgId: string): void {
    this.prefOrgId.set(orgId);
    const ws = this.store.getWorkspacesForOrg(orgId)[0];
    this.prefWsId.set(ws?.id ?? '');
    void this.savePrefs();
  }

  protected async savePrefs(): Promise<void> {
    await this.daily.savePreferences({
      organizationId: this.prefOrgId() || null,
      workspaceId: this.prefWsId() || null,
      templateId: this.prefTemplateId() || null,
    });
  }

  protected async openOrCreate(dateStr: string): Promise<void> {
    const page = await this.daily.openOrCreateForDate(dateStr);
    if (!page) {
      this.snackbar.open({ message: 'Crea una organización y espacio primero.', tone: 'warning' });
      return;
    }
    await this.router.navigateByUrl(this.store.getCanonicalPath(page.id));
  }
}
