import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  AtralumeDialog,
  type AtralumeDialogConfig,
} from '@osmanjimenez/atralume/dialog';
import {
  AtralumeSnackbar,
  type AtralumeSnackbarRef,
  type SnackbarConfig,
} from '@osmanjimenez/atralume/snackbar';

const THEME_ATTRS = [
  'data-atr-theme',
  'data-atr-surface',
  'data-atr-density',
  'data-atr-shape',
  'data-atr-brand',
] as const;

/**
 * Ensures every Trazena toast renders a visible close ("×") button
 * and replaces stale toasts instead of queuing long backlogs.
 */
@Injectable()
export class TrazenaSnackbarService extends AtralumeSnackbar {
  override open(config: SnackbarConfig): AtralumeSnackbarRef {
    return super.open({
      ...config,
      dismissLabel: config.dismissLabel ?? 'Cerrar',
      policy: config.policy ?? 'replace',
    });
  }
}

/**
 * Eliminates the ~960ms main-thread stall caused by AtralumeDialog's
 * 60×16ms setInterval polling loop that called getComputedStyle + setProperty
 * on hundreds of CSS tokens every frame while opening a modal.
 * Applies theme/a11y attributes once immediately on mount so modals open instantaneously.
 */
@Injectable()
export class TrazenaFastDialogService extends AtralumeDialog {
  private readonly doc = inject(DOCUMENT);

  constructor() {
    super();
    (this as unknown as { applyPortalChrome: (config: AtralumeDialogConfig<unknown>) => void }).applyPortalChrome =
      (config: AtralumeDialogConfig<unknown>) => this.decorateOnce(config);
  }

  private decorateOnce(config: AtralumeDialogConfig<unknown>): void {
    if (typeof document === 'undefined') return;

    const apply = (): boolean => {
      const dialogs = this.doc.querySelectorAll(
        'tui-modal[role="dialog"], tui-modal[role="alertdialog"]',
      );
      const modal = dialogs.item(dialogs.length - 1) as HTMLElement | null;
      if (!modal) return false;

      const appearance = config.appearance ?? 'atr-dialog';
      const panel =
        (modal.querySelector(`tui-dialog[data-appearance="${appearance}"]`) as HTMLElement | null) ??
        modal;

      const source = config.origin ?? this.doc.documentElement;
      for (const attr of THEME_ATTRS) {
        const value = source.closest(`[${attr}]`)?.getAttribute(attr);
        if (value) {
          panel.setAttribute(attr, value);
          modal.setAttribute(attr, value);
        }
      }

      panel.classList.add('atr-overlay-context', ...(config.contextClasses ?? []));
      modal.classList.add('atr-overlay-context');

      if (config.labelledBy && this.doc.getElementById(config.labelledBy)) {
        modal.setAttribute('aria-labelledby', config.labelledBy);
      }
      if (config.describedBy && this.doc.getElementById(config.describedBy)) {
        modal.setAttribute('aria-describedby', config.describedBy);
      }
      if (config.role) {
        modal.setAttribute('role', config.role);
      }
      return true;
    };

    if (apply()) return;

    let frames = 0;
    const step = (): void => {
      frames += 1;
      if (apply() || frames >= 4) return;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
