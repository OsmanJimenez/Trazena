import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { KnowledgeStore } from '../../core/state/knowledge.store';
import { ThemeService } from '../../core/state/theme.service';
import { IndexedDbService } from '../../core/storage/indexeddb.service';
import { hydrateMermaidDiagrams, renderSafeMarkdown } from '../../core/utils/markdown.util';
import { WorkspaceTabsService } from '../../core/workspace/workspace-tabs.service';

/**
 * Secondary right-hand pane for desktop Split View.
 * Shares coherent document state with IndexedDB/KnowledgeStore and allows opening,
 * switching, or moving tabs between panes without duplicating the editor state.
 */
@Component({
  selector: 'trz-split-pane-preview',
  standalone: true,
  imports: [FormsModule, AtralumeButton, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="split-pane" aria-label="Panel secundario">
      <header class="pane-head">
        <div class="pane-tabs">
          @for (tab of tabs.rightTabs(); track tab.id) {
            <div class="ptab" [class.active]="tab.id === tabs.activeRightTab()?.id">
              <button type="button" class="ptab-btn" (click)="tabs.setActiveTab('right', tab.id)">
                <span>{{ tab.title }}</span>
              </button>
              <button
                type="button"
                class="ptab-x"
                title="Mover al panel principal"
                aria-label="Mover al panel principal"
                (click)="moveToMain(tab.id)"
              >
                ←
              </button>
              <button
                type="button"
                class="ptab-x"
                title="Cerrar pestaña"
                aria-label="Cerrar pestaña"
                (click)="tabs.closeTab('right', tab.id)"
              >
                ×
              </button>
            </div>
          }
        </div>
        <div class="pane-actions">
          <select
            class="page-picker"
            aria-label="Elegir página para el panel secundario"
            [ngModel]="tabs.activeRightTab()?.pageId ?? ''"
            (ngModelChange)="pickPage($event)"
          >
            <option value="">Cambiar documento…</option>
            @for (p of activePages(); track p.id) {
              <option [value]="p.id">{{ p.title }}</option>
            }
          </select>
          <button
            atrButton
            type="button"
            size="small"
            appearance="text"
            title="Restaurar proporción 50/50"
            (click)="tabs.resetSplitRatio()"
          >
            50/50
          </button>
          <button
            atrButton
            type="button"
            size="small"
            appearance="text"
            title="Cerrar división"
            (click)="tabs.closeSplit()"
          >
            Cerrar
          </button>
        </div>
      </header>

      @if (activePageTitle(); as title) {
        <div class="pane-body">
          <div class="pane-doc-head">
            <h2>{{ title }}</h2>
            <button atrButton type="button" size="small" appearance="outlined" (click)="openInPrimary()">
              Editar en principal
            </button>
          </div>
          <article #previewHost class="trz-md-preview" [innerHTML]="renderedHtml()" (click)="onPreviewClick($event)"></article>
        </div>
      } @else {
        <div class="pane-empty">
          <atr-icon name="file-text" size="medium" />
          <p>Selecciona un documento para consultarlo en paralelo.</p>
        </div>
      }
    </section>
  `,
  styles: `
    .split-pane {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 0;
      border-left: 1px solid var(--trz-border);
      background: var(--trz-bg);
    }

    .pane-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      padding: 0.4rem 0.65rem;
      border-bottom: 1px solid var(--trz-border);
      background: var(--trz-bg-sidebar);
    }

    .pane-tabs {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      overflow-x: auto;
      min-width: 0;
      flex: 1;
    }

    .ptab {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      padding: 0.14rem 0.3rem;
      border: 1px solid transparent;
      border-radius: var(--trz-radius-sm);
      font-size: 0.76rem;
      color: var(--trz-text-muted);
      &.active {
        background: var(--trz-bg);
        border-color: var(--trz-border);
        color: var(--trz-text);
        font-weight: 600;
      }
    }

    .ptab-btn,
    .ptab-x {
      appearance: none;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      padding: 0.08rem 0.2rem;
    }

    .pane-actions {
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }

    .page-picker {
      height: 28px;
      max-width: 180px;
      font-size: 0.76rem;
    }

    .pane-body {
      flex: 1;
      overflow-y: auto;
      padding: 1.25rem 1.5rem;
    }

    .pane-doc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1rem;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid var(--trz-border);
      h2 { margin: 0; font-size: 1.2rem; letter-spacing: -0.02em; }
    }

    .pane-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--trz-text-subtle);
      font-size: 0.85rem;
      padding: 2rem;
      text-align: center;
    }
  `,
})
export class SplitPanePreviewComponent {
  protected readonly tabs = inject(WorkspaceTabsService);
  private readonly store = inject(KnowledgeStore);
  private readonly idb = inject(IndexedDbService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly previewHost = viewChild<ElementRef<HTMLElement>>('previewHost');

  protected readonly activePageTitle = signal<string | null>(null);
  protected readonly renderedHtml = signal('');

  protected readonly activePages = () =>
    this.store
      .pages()
      .filter((p) => p.status === 'active')
      .sort((a, b) => a.title.localeCompare(b.title));

  constructor() {
    effect(() => {
      const rightTab = this.tabs.activeRightTab();
      // Re-run whenever store pages update so edits in left pane reflect immediately
      const pages = this.store.pages();
      const dark = this.theme.effectiveTheme() === 'dark';
      if (!rightTab) {
        this.activePageTitle.set(null);
        this.renderedHtml.set('');
        return;
      }
      const page = pages.find((p) => p.id === rightTab.pageId && p.status !== 'deleted');
      if (!page) {
        this.activePageTitle.set('Página no disponible');
        this.renderedHtml.set('<p>Esta página fue eliminada o ya no está accesible.</p>');
        return;
      }
      this.activePageTitle.set(page.title);
      void this.loadContent(page.id, dark);
    });
  }

  private async loadContent(pageId: string, dark: boolean): Promise<void> {
    const content = await this.idb.getPageContent(pageId);
    this.renderedHtml.set(renderSafeMarkdown(content?.markdown ?? ''));
    queueMicrotask(() => {
      const host = this.previewHost()?.nativeElement;
      if (host) void hydrateMermaidDiagrams(host, dark);
    });
  }

  protected pickPage(pageId: string): void {
    if (!pageId) return;
    const page = this.store.pages().find((p) => p.id === pageId);
    if (!page) return;
    this.tabs.openPageInTab(page, this.store.getCanonicalPath(page.id), {
      pane: 'right',
      activate: true,
    });
  }

  protected moveToMain(tabId: string): void {
    const tab = this.tabs.rightTabs().find((t) => t.id === tabId);
    this.tabs.moveTabToOtherPane('right', tabId);
    if (tab?.canonicalPath) {
      void this.router.navigateByUrl(tab.canonicalPath);
    }
  }

  protected openInPrimary(): void {
    const tab = this.tabs.activeRightTab();
    if (tab?.canonicalPath) {
      void this.router.navigateByUrl(tab.canonicalPath);
    }
  }

  protected onPreviewClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const copyBtn = target?.closest<HTMLButtonElement>('[data-copy-code]');
    if (copyBtn) {
      const code = copyBtn.closest('.trz-code-block')?.querySelector('code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code);
      copyBtn.textContent = 'Copiado';
      setTimeout(() => (copyBtn.textContent = 'Copiar'), 1500);
      return;
    }
    const foldBtn = target?.closest<HTMLButtonElement>('[data-fold-code]');
    if (foldBtn) {
      const block = foldBtn.closest<HTMLElement>('.trz-code-block');
      if (block) {
        const collapsed = block.getAttribute('data-collapsed') === 'true';
        block.setAttribute('data-collapsed', collapsed ? 'false' : 'true');
        foldBtn.textContent = collapsed ? 'Plegar' : 'Expandir';
      }
      return;
    }
    const anchor = target?.closest<HTMLAnchorElement>('a.trz-internal-link');
    if (anchor) {
      event.preventDefault();
      const pageId = anchor.getAttribute('data-page-id');
      if (pageId) this.pickPage(pageId);
    }
  }
}
