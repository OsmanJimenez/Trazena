import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeIconButton } from '@osmanjimenez/atralume/icon-button';
import {
  ATR_DIALOG_DATA,
  AtralumeDialog,
  AtralumeDialogActions,
  AtralumeDialogContent,
  AtralumeDialogRef,
  AtralumeDialogTitle,
} from '@osmanjimenez/atralume/dialog';

export interface PromptDialogData {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmText?: string;
  cancelText?: string;
}

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

@Component({
  selector: 'trz-prompt-dialog',
  standalone: true,
  imports: [
    FormsModule,
    AtralumeButton,
    AtralumeIcon,
    AtralumeIconButton,
    AtralumeDialogTitle,
    AtralumeDialogContent,
    AtralumeDialogActions,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="trz-modal">
      <div class="modal-head">
        <h2 atrDialogTitle class="modal-title">{{ data.title }}</h2>
        <button atrIconButton type="button" size="small" aria-label="Cerrar" (click)="cancel()">
          <atr-icon name="close" size="small" />
        </button>
      </div>
      <div atrDialogContent class="modal-body">
        <label class="modal-field">
          <span>{{ data.label }}</span>
          <input
            type="text"
            [(ngModel)]="value"
            [placeholder]="data.placeholder || ''"
            (keydown.enter)="submit()"
            autofocus
          />
        </label>
      </div>
      <div atrDialogActions class="modal-actions">
        <button atrButton type="button" size="small" appearance="text" (click)="cancel()">
          {{ data.cancelText || 'Cancelar' }}
        </button>
        <button
          atrButton
          type="button"
          size="small"
          appearance="filled"
          [disabled]="!value.trim()"
          (click)="submit()"
        >
          {{ data.confirmText || 'Guardar' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .trz-modal {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      color: var(--trz-text);
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .modal-title {
      margin: 0;
      font-size: 1.08rem;
      font-weight: 650;
      letter-spacing: -0.015em;
    }
    .modal-field {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      font-size: 0.84rem;
      font-weight: 500;
      color: var(--trz-text-muted);

      input {
        width: 100%;
        padding: 0.6rem 0.8rem;
        border: 1px solid var(--trz-border-strong);
        border-radius: var(--trz-radius-sm);
        background: var(--trz-bg);
        color: var(--trz-text);
        font: inherit;
        font-size: 0.92rem;
        outline: none;

        &:focus {
          border-color: var(--trz-accent);
          box-shadow: 0 0 0 3px var(--trz-accent-soft);
        }
      }
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.45rem;
      padding-top: 0.25rem;
    }
  `,
})
export class TrazenaPromptDialogComponent {
  protected readonly data = inject<PromptDialogData>(ATR_DIALOG_DATA);
  private readonly ref = inject<AtralumeDialogRef<string | null>>(AtralumeDialogRef);
  protected value = this.data.initialValue ?? '';

  protected submit(): void {
    const trimmed = this.value.trim();
    if (!trimmed) return;
    this.ref.close(trimmed);
  }

  protected cancel(): void {
    this.ref.close(null);
  }
}

@Component({
  selector: 'trz-confirm-dialog',
  standalone: true,
  imports: [
    AtralumeButton,
    AtralumeIcon,
    AtralumeIconButton,
    AtralumeDialogTitle,
    AtralumeDialogContent,
    AtralumeDialogActions,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="trz-modal">
      <div class="modal-head">
        <h2 atrDialogTitle class="modal-title">{{ data.title }}</h2>
        <button atrIconButton type="button" size="small" aria-label="Cerrar" (click)="close(false)">
          <atr-icon name="close" size="small" />
        </button>
      </div>
      <div atrDialogContent class="modal-body">
        <p class="modal-msg">{{ data.message }}</p>
      </div>
      <div atrDialogActions class="modal-actions">
        <button atrButton type="button" size="small" appearance="text" (click)="close(false)">
          {{ data.cancelText || 'Cancelar' }}
        </button>
        <button
          atrButton
          type="button"
          size="small"
          appearance="filled"
          [class.is-danger]="data.danger"
          (click)="close(true)"
        >
          {{ data.confirmText || 'Confirmar' }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .trz-modal {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
      color: var(--trz-text);
    }
    .modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .modal-title {
      margin: 0;
      font-size: 1.08rem;
      font-weight: 650;
    }
    .modal-msg {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.5;
      color: var(--trz-text-muted);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.45rem;
      padding-top: 0.25rem;
    }
    .is-danger {
      background: var(--trz-danger) !important;
      color: #ffffff !important;
    }
  `,
})
export class TrazenaConfirmDialogComponent {
  protected readonly data = inject<ConfirmDialogData>(ATR_DIALOG_DATA);
  private readonly ref = inject<AtralumeDialogRef<boolean>>(AtralumeDialogRef);

  protected close(confirmed: boolean): void {
    this.ref.close(confirmed);
  }
}

@Injectable({ providedIn: 'root' })
export class TrazenaDialogsService {
  private readonly dialog = inject(AtralumeDialog);

  async prompt(config: PromptDialogData): Promise<string | null> {
    const ref = this.dialog.open<TrazenaPromptDialogComponent, PromptDialogData, string | null>(
      TrazenaPromptDialogComponent,
      {
        data: config,
        size: 's',
        closable: false,
        autoFocus: 'first-tabbable',
      },
    );
    const result = await firstValueFrom(ref.afterClosed);
    return result ?? null;
  }

  async confirm(config: ConfirmDialogData): Promise<boolean> {
    const ref = this.dialog.open<TrazenaConfirmDialogComponent, ConfirmDialogData, boolean>(
      TrazenaConfirmDialogComponent,
      {
        data: config,
        size: 's',
        role: 'alertdialog',
        closable: false,
      },
    );
    const result = await firstValueFrom(ref.afterClosed);
    return result === true;
  }
}
