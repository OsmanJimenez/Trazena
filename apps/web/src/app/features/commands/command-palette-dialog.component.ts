import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AtralumeDialog, AtralumeDialogRef } from '@osmanjimenez/atralume/dialog';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { DailyNotesService } from '../../core/productivity/daily-notes.service';
import { ShortcutsService } from '../../core/productivity/shortcuts.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { ThemeService } from '../../core/state/theme.service';
import { TrazenaSyncService } from '../../core/sync/trazena-sync.service';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';
import { WorkspaceTabsService } from '../../core/workspace/workspace-tabs.service';
import { QuickSearchDialogComponent } from '../search/quick-search-dialog.component';

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut: string | null;
  run: () => void | Promise<void>;
}

@Component({
  selector: 'trz-command-palette-dialog',
  standalone: true,
  imports: [FormsModule, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp-box" (keydown)="onKeydown($event)">
      <div class="cp-head">
        <atr-icon name="search" size="small" />
        <input
          type="text"
          placeholder="Ejecutar comando… (Esc para cerrar)"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); activeIndex.set(0)"
          autofocus
        />
        <button type="button" class="cp-close" aria-label="Cerrar" (click)="ref.close()">×</button>
      </div>

      <div class="cp-list" role="listbox">
        @for (cmd of filtered(); track cmd.id; let idx = $index) {
          <button
            type="button"
            class="cp-item"
            role="option"
            [class.active]="idx === activeIndex()"
            (mouseenter)="activeIndex.set(idx)"
            (click)="execute(cmd)"
          >
            <div class="cp-item-left">
              <span class="cp-cat">{{ cmd.category }}</span>
              <strong>{{ cmd.label }}</strong>
            </div>
            @if (cmd.shortcut) {
              <kbd class="cp-kbd">{{ cmd.shortcut }}</kbd>
            }
          </button>
        } @empty {
          <p class="cp-empty">Sin comandos coincidentes.</p>
        }
      </div>

      <div class="cp-foot">
        <span>↑↓ Navegar · Enter Ejecutar · Esc Cerrar</span>
        <span>Paleta de comandos</span>
      </div>
    </div>
  `,
  styles: `
    .cp-box { display: flex; flex-direction: column; gap: 0.65rem; color: var(--trz-text); }
    .cp-head {
      display: flex; align-items: center; gap: 0.5rem;
      padding-bottom: 0.55rem; border-bottom: 1px solid var(--trz-border);
      input {
        flex: 1; border: 0; outline: none; background: transparent;
        color: var(--trz-text); font: inherit; font-size: 0.92rem;
      }
    }
    .cp-close {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-subtle);
      width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 1.05rem;
      &:hover { background: var(--trz-bg-hover); color: var(--trz-text); }
    }
    .cp-list {
      max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.2rem;
    }
    .cp-item {
      appearance: none; border: 0; background: transparent; color: var(--trz-text);
      padding: 0.5rem 0.65rem; border-radius: var(--trz-radius-sm); cursor: pointer;
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      text-align: left; font: inherit;
      &.active { background: var(--trz-bg-subtle); }
    }
    .cp-item-left { display: flex; align-items: center; gap: 0.55rem; min-width: 0; }
    .cp-cat {
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--trz-text-subtle); background: var(--trz-bg-subtle);
      border: 1px solid var(--trz-border); border-radius: 4px; padding: 0.08rem 0.38rem;
      flex-shrink: 0;
    }
    .cp-kbd {
      font-family: var(--trz-font-mono); font-size: 0.7rem;
      padding: 0.12rem 0.4rem; border-radius: 4px;
      border: 1px solid var(--trz-border-strong); background: var(--trz-bg-subtle);
      color: var(--trz-text-muted); flex-shrink: 0;
    }
    .cp-empty { margin: 0; padding: 1.25rem; text-align: center; color: var(--trz-text-subtle); font-size: 0.84rem; }
    .cp-foot {
      display: flex; justify-content: space-between; font-size: 0.72rem;
      color: var(--trz-text-subtle); padding-top: 0.45rem; border-top: 1px solid var(--trz-border);
    }
  `,
})
export class CommandPaletteDialogComponent implements OnInit {
  protected readonly ref = inject<AtralumeDialogRef<void>>(AtralumeDialogRef);
  private readonly router = inject(Router);
  private readonly store = inject(KnowledgeStore);
  private readonly daily = inject(DailyNotesService);
  private readonly tabs = inject(WorkspaceTabsService);
  private readonly shortcuts = inject(ShortcutsService);
  private readonly sync = inject(TrazenaSyncService);
  private readonly theme = inject(ThemeService);
  private readonly dialog = inject(AtralumeDialog);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly query = signal('');
  protected readonly activeIndex = signal(0);
  private readonly commands = signal<PaletteCommand[]>([]);

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.commands();
    return this.commands().filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );
  });

  async ngOnInit(): Promise<void> {
    await this.shortcuts.initialize();
    const s = this.shortcuts;
    this.commands.set([
      {
        id: 'new_page',
        label: 'Crear nueva página',
        category: 'Documentos',
        shortcut: s.getActiveCombo('new_page'),
        run: async () => {
          const org = this.store.activeOrganizations()[0];
          const ws = org ? this.store.getWorkspacesForOrg(org.id)[0] : null;
          if (!org || !ws) return;
          const title = await this.dialogs.prompt({
            title: 'Nueva página',
            label: 'Título de la página',
            placeholder: 'Ej. Notas técnicas…',
            confirmText: 'Crear',
          });
          if (!title) return;
          const p = await this.store.createPage({
            organizationId: org.id,
            workspaceId: ws.id,
            parentId: null,
            title,
          });
          await this.router.navigateByUrl(this.store.getCanonicalPath(p.id));
        },
      },
      {
        id: 'open_daily',
        label: 'Abrir nota diaria de hoy',
        category: 'Temporal',
        shortcut: s.getActiveCombo('open_daily_note'),
        run: async () => {
          const page = await this.daily.openOrCreateForDate();
          if (page) await this.router.navigateByUrl(this.store.getCanonicalPath(page.id));
        },
      },
      {
        id: 'open_daily_hub',
        label: 'Abrir calendario de notas diarias',
        category: 'Temporal',
        shortcut: null,
        run: () => void this.router.navigateByUrl('/daily'),
      },
      {
        id: 'open_reminders',
        label: 'Abrir panel de recordatorios locales',
        category: 'Temporal',
        shortcut: null,
        run: () => void this.router.navigateByUrl('/reminders'),
      },
      {
        id: 'quick_search',
        label: 'Búsqueda rápida global',
        category: 'Navegación',
        shortcut: s.getActiveCombo('open_quick_search'),
        run: () => {
          this.dialog.open(QuickSearchDialogComponent, { size: 'm', closable: false });
        },
      },
      {
        id: 'open_explorer',
        label: 'Abrir Explorador de conocimiento',
        category: 'Navegación',
        shortcut: s.getActiveCombo('open_explorer'),
        run: () => void this.router.navigateByUrl('/explore'),
      },
      {
        id: 'open_import',
        label: 'Importar documentación (.md, ZIP, Obsidian, Notion, JSON)',
        category: 'Documentos',
        shortcut: s.getActiveCombo('open_import'),
        run: () => void this.router.navigateByUrl('/import'),
      },
      {
        id: 'open_health',
        label: 'Abrir Salud del conocimiento (revisión, enlaces rotos, duplicados)',
        category: 'Mantenimiento',
        shortcut: s.getActiveCombo('open_health'),
        run: () => void this.router.navigateByUrl('/health'),
      },
      {
        id: 'open_templates',
        label: 'Abrir Plantillas de documentación',
        category: 'Documentos',
        shortcut: null,
        run: () => void this.router.navigateByUrl('/templates'),
      },
      {
        id: 'split_right',
        label: 'Dividir vista a la derecha (2 paneles)',
        category: 'Espacio de trabajo',
        shortcut: s.getActiveCombo('split_right'),
        run: () => this.tabs.splitRight(),
      },
      {
        id: 'close_split',
        label: 'Cerrar vista dividida',
        category: 'Espacio de trabajo',
        shortcut: s.getActiveCombo('close_split'),
        run: () => this.tabs.closeSplit(),
      },
      {
        id: 'toggle_theme',
        label: 'Alternar tema claro / oscuro',
        category: 'Apariencia',
        shortcut: null,
        run: () => this.theme.toggleTheme(),
      },
      {
        id: 'sync_now',
        label: 'Sincronizar ahora (manual)',
        category: 'Sistema',
        shortcut: s.getActiveCombo('sync_now'),
        run: async () => {
          const res = await this.sync.syncNow();
          if (res?.status === 'completed') {
            this.snackbar.open({ message: 'Sincronización completada.', tone: 'success' });
          } else {
            this.snackbar.open({
              message: this.sync.lastError() ?? 'Sincronización manual finalizada.',
              tone: 'info',
            });
          }
        },
      },
      {
        id: 'open_shortcuts',
        label: 'Personalizar atajos de teclado',
        category: 'Configuración',
        shortcut: null,
        run: () => void this.router.navigateByUrl('/settings/shortcuts'),
      },
      {
        id: 'open_settings',
        label: 'Abrir Configuración y Papelera',
        category: 'Configuración',
        shortcut: s.getActiveCombo('open_settings'),
        run: () => void this.router.navigateByUrl('/settings'),
      },
    ]);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const items = this.filtered();
    if (event.key === 'Escape') {
      event.preventDefault();
      this.ref.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (items.length > 0) this.activeIndex.set((this.activeIndex() + 1) % items.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (items.length > 0) this.activeIndex.set((this.activeIndex() - 1 + items.length) % items.length);
      return;
    }
    if (event.key === 'Enter' && items[this.activeIndex()]) {
      event.preventDefault();
      void this.execute(items[this.activeIndex()]);
    }
  }

  protected async execute(cmd: PaletteCommand): Promise<void> {
    this.ref.close();
    await cmd.run();
  }
}
