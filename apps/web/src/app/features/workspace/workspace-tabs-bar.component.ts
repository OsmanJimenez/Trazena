import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { WorkspaceTabsService } from '../../core/workspace/workspace-tabs.service';

@Component({
  selector: 'trz-workspace-tabs-bar',
  standalone: true,
  imports: [AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tabs.leftTabs().length > 0) {
      <div class="tabs-bar" role="tablist" aria-label="Pestañas de documentos abiertos">
        <div class="tabs-scroll">
          @for (tab of tabs.leftTabs(); track tab.id; let idx = $index) {
            <div
              class="tab-pill"
              role="tab"
              [attr.aria-selected]="tab.id === tabs.activeLeftTab()?.id"
              [class.active]="tab.id === tabs.activeLeftTab()?.id"
            >
              <button
                type="button"
                class="tab-main"
                [title]="tab.canonicalPath"
                (click)="activate(tab.id)"
              >
                <atr-icon [name]="tab.icon || 'file-text'" size="small" />
                <span class="tab-label">{{ tab.title }}</span>
              </button>
              @if (!isMobile() && tabs.leftTabs().length > 1) {
                <button
                  type="button"
                  class="tab-mini"
                  title="Mover pestaña a la izquierda"
                  aria-label="Mover a la izquierda"
                  [disabled]="idx === 0"
                  (click)="tabs.reorderTab('left', idx, idx - 1)"
                >
                  ‹
                </button>
                <button
                  type="button"
                  class="tab-mini"
                  title="Mover pestaña a la derecha"
                  aria-label="Mover a la derecha"
                  [disabled]="idx === tabs.leftTabs().length - 1"
                  (click)="tabs.reorderTab('left', idx, idx + 1)"
                >
                  ›
                </button>
              }
              <button
                type="button"
                class="tab-close"
                title="Cerrar pestaña"
                aria-label="Cerrar pestaña"
                (click)="close(tab.id)"
              >
                ×
              </button>
            </div>
          }
        </div>

        <div class="tabs-tools">
          @if (!isMobile()) {
            @if (!tabs.splitEnabled()) {
              <button
                type="button"
                class="tool-btn"
                title="Dividir vista a la derecha (Alt+\\)"
                (click)="tabs.splitRight()"
              >
                Dividir vista
              </button>
            } @else {
              <button
                type="button"
                class="tool-btn active"
                title="Cerrar vista dividida"
                (click)="tabs.closeSplit()"
              >
                Cerrar división
              </button>
            }
          }
          @if (tabs.leftTabs().length > 1) {
            <button
              type="button"
              class="tool-btn"
              title="Cerrar otras pestañas"
              (click)="closeOthers()"
            >
              Cerrar otras
            </button>
          }
          <button
            type="button"
            class="tool-btn"
            title="Cerrar todas las pestañas"
            (click)="tabs.closeAllTabs('left')"
          >
            Limpiar
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    /* Level 2 Ribbon: Open document tabs strip (recessed beneath global topbar) */
    .tabs-bar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.25rem 0.85rem 0;
      border-bottom: 1px solid var(--trz-border);
      background: var(--trz-bg-sidebar);
      min-height: 36px;
      flex-shrink: 0;
    }

    .tabs-scroll {
      display: flex;
      align-items: flex-end;
      gap: 0.2rem;
      overflow-x: auto;
      min-width: 0;
      flex: 1;
      scrollbar-width: thin;
    }

    .tab-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      max-width: 210px;
      padding: 0.24rem 0.35rem 0.28rem 0.55rem;
      border: 1px solid transparent;
      border-bottom: 0;
      border-radius: var(--trz-radius-sm) var(--trz-radius-sm) 0 0;
      background: transparent;
      color: var(--trz-text-subtle);
      font-size: 0.76rem;
      flex-shrink: 0;
      transition: background 120ms ease, color 120ms ease;

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }

      &.active {
        background: var(--trz-bg);
        border-color: var(--trz-border);
        border-top: 2px solid var(--trz-accent);
        color: var(--trz-text);
        font-weight: 600;
        margin-bottom: -1px;
        padding-bottom: calc(0.28rem + 1px);
      }
    }

    .tab-main {
      appearance: none;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      min-width: 0;
      cursor: pointer;
      padding: 0.1rem 0.15rem;
    }

    .tab-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 125px;
    }

    .tab-mini,
    .tab-close {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-text-subtle);
      width: 18px;
      height: 18px;
      border-radius: 4px;
      display: grid;
      place-items: center;
      cursor: pointer;
      font-size: 0.85rem;
      line-height: 1;
      padding: 0;

      &:hover:not(:disabled) {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }
      &:disabled {
        opacity: 0.3;
        cursor: default;
      }
    }

    .tabs-tools {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    .tool-btn {
      appearance: none;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg);
      color: var(--trz-text-muted);
      font: inherit;
      font-size: 0.72rem;
      padding: 0.18rem 0.5rem;
      cursor: pointer;
      white-space: nowrap;

      &:hover {
        color: var(--trz-text);
        border-color: var(--trz-border-strong);
      }

      &.active {
        background: var(--trz-accent-soft);
        border-color: var(--trz-accent);
        color: var(--trz-accent);
      }
    }
  `,
})
export class WorkspaceTabsBarComponent {
  readonly isMobile = input<boolean>(false);

  protected readonly tabs = inject(WorkspaceTabsService);
  private readonly router = inject(Router);

  protected activate(tabId: string): void {
    const tab = this.tabs.setActiveTab('left', tabId);
    if (tab?.canonicalPath) {
      void this.router.navigateByUrl(tab.canonicalPath);
    }
  }

  protected close(tabId: string): void {
    const wasActive = this.tabs.activeLeftTab()?.id === tabId;
    const next = this.tabs.closeTab('left', tabId);
    if (wasActive && next?.canonicalPath) {
      void this.router.navigateByUrl(next.canonicalPath);
    }
  }

  protected closeOthers(): void {
    const active = this.tabs.activeLeftTab();
    if (active) {
      this.tabs.closeOtherTabs('left', active.id);
    }
  }
}
