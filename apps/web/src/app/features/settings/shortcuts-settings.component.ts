import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import type { ShortcutCommandId } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeCard } from '@osmanjimenez/atralume/card';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import {
  ShortcutsService,
  formatEventToCombo,
} from '../../core/productivity/shortcuts.service';
import { SettingsNavComponent } from './settings-nav.component';

@Component({
  selector: 'trz-shortcuts-settings',
  standalone: true,
  imports: [AtralumeButton, AtralumeCard, SettingsNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shortcuts-page">
      <header class="header">
        <div>
          <h1>Atajos de teclado</h1>
          <p>Personaliza combinaciones locales, evita conflictos y respeta atajos reservados del navegador.</p>
        </div>
        <button atrButton type="button" size="small" appearance="outlined" (click)="resetAll()">
          Restablecer predeterminados
        </button>
      </header>

      <trz-settings-nav />

      @if (errorMsg(); as err) {
        <p class="err-banner" role="alert">{{ err }}</p>
      }

      <atr-card appearance="outlined">
        <div class="card-inner">
          <div class="shortcut-list">
            @for (item of shortcuts.bindings(); track item.commandId) {
              <div class="shortcut-row" [class.disabled]="item.disabled">
                <div class="row-info">
                  <span class="cat">{{ item.category }}</span>
                  <strong>{{ item.label }}</strong>
                </div>

                <div class="row-controls">
                  @if (recordingId() === item.commandId) {
                    <input
                      type="text"
                      readonly
                      class="record-input"
                      placeholder="Presiona nueva combinación…"
                      (keydown)="onRecordKey($event, item.commandId)"
                      (blur)="recordingId.set(null)"
                      autofocus
                    />
                  } @else {
                    <kbd class="kbd-chip">{{ item.disabled ? 'Deshabilitado' : (item.customCombo ?? item.defaultCombo) }}</kbd>
                  }

                  <button
                    atrButton
                    type="button"
                    size="small"
                    appearance="outlined"
                    (click)="startRecording(item.commandId)"
                  >
                    Cambiar
                  </button>
                  <button
                    atrButton
                    type="button"
                    size="small"
                    appearance="text"
                    (click)="toggleDisabled(item.commandId)"
                  >
                    {{ item.disabled ? 'Habilitar' : 'Deshabilitar' }}
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </atr-card>
    </div>
  `,
  styles: `
    .shortcuts-page { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.25rem; }
    .header {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 0.75rem;
      h1 { margin: 0; font-size: clamp(1.45rem, 2.5vw, 1.8rem); letter-spacing: -0.025em; }
      p { margin: 0.3rem 0 0; color: var(--trz-text-muted); font-size: 0.9rem; }
    }
    .err-banner {
      margin: 0; padding: 0.65rem 0.9rem; border-radius: var(--trz-radius-sm);
      background: color-mix(in srgb, var(--trz-danger) 12%, transparent);
      color: var(--trz-danger); font-size: 0.84rem;
    }
    .card-inner { padding: 1.15rem 1.25rem; }
    .shortcut-list { display: flex; flex-direction: column; }
    .shortcut-row {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.65rem 0; border-bottom: 1px solid var(--trz-border);
      &:last-child { border-bottom: 0; }
      &.disabled { opacity: 0.6; }
    }
    .row-info { display: flex; align-items: center; gap: 0.55rem; strong { font-size: 0.88rem; } }
    .cat {
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;
      padding: 0.1rem 0.4rem; border-radius: 4px; background: var(--trz-bg-subtle);
      border: 1px solid var(--trz-border); color: var(--trz-text-subtle);
    }
    .row-controls { display: flex; align-items: center; gap: 0.4rem; }
    .kbd-chip {
      font-family: var(--trz-font-mono); font-size: 0.78rem; padding: 0.22rem 0.55rem;
      border-radius: 5px; border: 1px solid var(--trz-border-strong); background: var(--trz-bg-subtle);
      color: var(--trz-text);
    }
    .record-input {
      height: 30px; width: 190px; padding: 0 0.55rem; border: 1px solid var(--trz-accent);
      border-radius: 5px; background: var(--trz-bg); color: var(--trz-text); font: inherit; font-size: 0.8rem;
    }
  `,
})
export class ShortcutsSettingsComponent implements OnInit {
  protected readonly shortcuts = inject(ShortcutsService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected readonly recordingId = signal<ShortcutCommandId | null>(null);
  protected readonly errorMsg = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.shortcuts.initialize();
  }

  protected startRecording(id: ShortcutCommandId): void {
    this.errorMsg.set(null);
    this.recordingId.set(id);
  }

  protected async onRecordKey(event: KeyboardEvent, id: ShortcutCommandId): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.recordingId.set(null);
      return;
    }
    const combo = formatEventToCombo(event);
    if (!combo) return;
    const res = await this.shortcuts.setCustomCombo(id, combo);
    if (!res.ok) {
      this.errorMsg.set(res.error ?? 'Atajo inválido.');
      return;
    }
    this.errorMsg.set(null);
    this.recordingId.set(null);
    this.snackbar.open({ message: `Atajo actualizado a ${combo}.`, tone: 'success' });
  }

  protected async toggleDisabled(id: ShortcutCommandId): Promise<void> {
    await this.shortcuts.toggleDisabled(id);
  }

  protected async resetAll(): Promise<void> {
    await this.shortcuts.resetAll();
    this.errorMsg.set(null);
    this.snackbar.open({ message: 'Atajos restablecidos a valores predeterminados.', tone: 'info' });
  }
}
