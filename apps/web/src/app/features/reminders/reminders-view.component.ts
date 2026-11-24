import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeEmptyState } from '@osmanjimenez/atralume/empty-state';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { toLocalCalendarDate } from '../../core/productivity/daily-notes.service';
import { RemindersService } from '../../core/productivity/reminders.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-reminders-view',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton, AtralumeCard, AtralumeEmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rem-page">
      <header class="header">
        <div>
          <h1>Recordatorios locales</h1>
          <p>
            Asocia recordatorios a cualquier documento. Se muestran al abrir Trazena o al regresar a la pestaña,
            sin servicios push externos ni costos adicionales.
          </p>
        </div>
      </header>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Nuevo recordatorio</h2>
          <div class="form-grid">
            <label>
              <span>Documento relacionado</span>
              <select [ngModel]="selectedPageId()" (ngModelChange)="selectedPageId.set($event)">
                @for (p of activePages(); track p.id) {
                  <option [value]="p.id">{{ p.title }}</option>
                }
              </select>
            </label>
            <label>
              <span>Título del recordatorio</span>
              <input
                type="text"
                placeholder="Ej. Revisar arquitectura antes del release…"
                [ngModel]="title()"
                (ngModelChange)="title.set($event)"
              />
            </label>
            <label>
              <span>Fecha</span>
              <input type="date" [ngModel]="dueDate()" (ngModelChange)="dueDate.set($event)" />
            </label>
            <label>
              <span>Hora (opcional)</span>
              <input type="time" [ngModel]="dueTime()" (ngModelChange)="dueTime.set($event)" />
            </label>
          </div>
          <div>
            <button atrButton type="button" size="small" appearance="filled" (click)="create()">
              Crear recordatorio
            </button>
          </div>
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Vencidos ({{ reminders.overdueReminders().length }})</h2>
          @if (reminders.overdueReminders().length > 0) {
            <div class="rem-list">
              @for (r of reminders.overdueReminders(); track r.id) {
                <div class="rem-row overdue">
                  <div>
                    <strong>{{ r.title }}</strong>
                    <div class="rem-meta">
                      {{ r.dueDate }}{{ r.dueTime ? ' · ' + r.dueTime : '' }} ·
                      <a [routerLink]="store.getCanonicalPath(r.pageId)">Abrir documento</a>
                    </div>
                  </div>
                  <div class="rem-actions">
                    <button atrButton type="button" size="small" appearance="filled" (click)="reminders.completeReminder(r.id)">Completar</button>
                    <button atrButton type="button" size="small" appearance="outlined" (click)="reminders.snoozeReminder(r.id, 1)">+1 día</button>
                    <button atrButton type="button" size="small" appearance="outlined" (click)="reminders.snoozeReminder(r.id, 7)">+7 días</button>
                    <button atrButton type="button" size="small" appearance="text" (click)="reminders.deleteReminder(r.id)">Eliminar</button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <atr-empty-state appearance="compact" title="Sin recordatorios vencidos" description="Estás al día con tus recordatorios locales." />
          }
        </div>
      </atr-card>

      <atr-card appearance="outlined">
        <div class="card-inner">
          <h2>Próximos ({{ reminders.upcomingReminders().length }})</h2>
          @if (reminders.upcomingReminders().length > 0) {
            <div class="rem-list">
              @for (r of reminders.upcomingReminders(); track r.id) {
                <div class="rem-row">
                  <div>
                    <strong>{{ r.title }}</strong>
                    <div class="rem-meta">
                      {{ r.dueDate }}{{ r.dueTime ? ' · ' + r.dueTime : '' }} ·
                      <a [routerLink]="store.getCanonicalPath(r.pageId)">Abrir documento</a>
                    </div>
                  </div>
                  <div class="rem-actions">
                    <button atrButton type="button" size="small" appearance="outlined" (click)="reminders.completeReminder(r.id)">Completar</button>
                    <button atrButton type="button" size="small" appearance="text" (click)="reminders.deleteReminder(r.id)">Eliminar</button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="hint">No hay recordatorios programados próximamente.</p>
          }
        </div>
      </atr-card>

      @if (reminders.completedReminders().length > 0) {
        <atr-card appearance="outlined">
          <div class="card-inner">
            <h2>Completados ({{ reminders.completedReminders().length }})</h2>
            <div class="rem-list">
              @for (r of reminders.completedReminders().slice(0, 20); track r.id) {
                <div class="rem-row done">
                  <div>
                    <strong>{{ r.title }}</strong>
                    <div class="rem-meta">{{ r.dueDate }} · Completado</div>
                  </div>
                  <div class="rem-actions">
                    <button atrButton type="button" size="small" appearance="text" (click)="reminders.reopenReminder(r.id)">Reabrir</button>
                    <button atrButton type="button" size="small" appearance="text" (click)="reminders.deleteReminder(r.id)">Eliminar</button>
                  </div>
                </div>
              }
            </div>
          </div>
        </atr-card>
      }
    </div>
  `,
  styles: `
    .rem-page { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.85rem); letter-spacing: -0.025em; }
    .header p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; max-width: 70ch; }
    .card-inner { padding: 1.15rem 1.3rem; display: flex; flex-direction: column; gap: 0.85rem; h2 { margin: 0; font-size: 0.95rem; font-weight: 650; } }
    .form-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 0.75rem;
      label {
        display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.8rem; color: var(--trz-text-muted); font-weight: 500;
        input { height: 34px; padding: 0 0.6rem; border: 1px solid var(--trz-border-strong); border-radius: var(--trz-radius-sm); background: var(--trz-bg); color: var(--trz-text); font: inherit; }
      }
    }
    .rem-list { display: flex; flex-direction: column; gap: 0.45rem; }
    .rem-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.6rem;
      padding: 0.65rem 0.8rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm); background: var(--trz-bg-subtle);
      &.overdue { border-color: var(--trz-danger); }
      &.done { opacity: 0.68; strong { text-decoration: line-through; } }
    }
    .rem-meta { font-size: 0.76rem; color: var(--trz-text-subtle); margin-top: 0.15rem; a { color: var(--trz-accent); text-decoration: none; &:hover { text-decoration: underline; } } }
    .rem-actions { display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .hint { margin: 0; font-size: 0.82rem; color: var(--trz-text-muted); }
  `,
})
export class RemindersViewComponent implements OnInit {
  protected readonly store = inject(KnowledgeStore);
  protected readonly reminders = inject(RemindersService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly selectedPageId = signal('');
  protected readonly title = signal('');
  protected readonly dueDate = signal(toLocalCalendarDate());
  protected readonly dueTime = signal('');

  protected readonly activePages = () =>
    this.store
      .pages()
      .filter((p) => p.status === 'active')
      .sort((a, b) => a.title.localeCompare(b.title));

  async ngOnInit(): Promise<void> {
    await Promise.all([this.store.initialize(), this.reminders.initialize()]);
    const first = this.activePages()[0];
    if (first) this.selectedPageId.set(first.id);
  }

  protected async create(): Promise<void> {
    const page = this.store.pages().find((p) => p.id === this.selectedPageId());
    if (!page || !this.title().trim() || !this.dueDate()) {
      this.snackbar.open({ message: 'Completa documento, título y fecha.', tone: 'warning' });
      return;
    }
    await this.reminders.createReminder(page, {
      title: this.title(),
      dueDate: this.dueDate(),
      dueTime: this.dueTime() || null,
    });
    this.title.set('');
    this.dueTime.set('');
    this.snackbar.open({ message: 'Recordatorio creado.', tone: 'success' });
  }
}
