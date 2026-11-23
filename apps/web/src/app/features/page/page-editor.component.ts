import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeStore, type SaveStatus } from '../../core/state/knowledge.store';
import { renderSafeMarkdown } from '../../core/utils/markdown.util';

type EditorMode = 'edit' | 'split' | 'preview';

@Component({
  selector: 'trz-page-editor',
  standalone: true,
  imports: [FormsModule, AtralumeButton, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="editor-shell">
      <div class="editor-toolbar" role="toolbar" aria-label="Formato Markdown">
        <div class="toolbar-group">
          <button type="button" class="tb-btn" title="Título H1" (click)="prefixLine('# ')">H1</button>
          <button type="button" class="tb-btn" title="Título H2" (click)="prefixLine('## ')">H2</button>
          <button type="button" class="tb-btn" title="Título H3" (click)="prefixLine('### ')">H3</button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" title="Negrita (Ctrl+B)" (click)="wrapSelection('**', '**', 'texto')"><strong>B</strong></button>
          <button type="button" class="tb-btn" title="Cursiva (Ctrl+I)" (click)="wrapSelection('_', '_', 'texto')"><em>I</em></button>
          <button type="button" class="tb-btn" title="Tachado" (click)="wrapSelection('~~', '~~', 'texto')"><s>S</s></button>
          <button type="button" class="tb-btn" title="Código en línea" (click)="wrapSelection('\`', '\`', 'codigo')"><code>&lt;/&gt;</code></button>
          <span class="tb-sep"></span>
          <button type="button" class="tb-btn" title="Lista" (click)="prefixLine('- ')">• Lista</button>
          <button type="button" class="tb-btn" title="Checklist" (click)="prefixLine('- [ ] ')">☑ Tarea</button>
          <button type="button" class="tb-btn" title="Cita" (click)="prefixLine('> ')">❝</button>
          <button type="button" class="tb-btn" title="Enlace (Ctrl+K)" (click)="insertLink()">🔗</button>
          <button type="button" class="tb-btn" title="Bloque de código" (click)="insertCodeBlock()">Bloque</button>
          <button type="button" class="tb-btn" title="Tabla" (click)="insertTable()">Tabla</button>
          <button type="button" class="tb-btn" title="Separador" (click)="insertBlock('\n---\n')">―</button>
        </div>

        <div class="toolbar-right">
          <div class="mode-switch" role="group" aria-label="Modo de vista">
            <button type="button" [class.active]="mode() === 'edit'" (click)="mode.set('edit')">Editar</button>
            <button type="button" [class.active]="mode() === 'split'" (click)="mode.set('split')">Dividido</button>
            <button type="button" [class.active]="mode() === 'preview'" (click)="mode.set('preview')">Vista previa</button>
          </div>

          <span class="save-badge" [attr.data-status]="store.saveStatus()">
            {{ statusLabel() }}
          </span>
        </div>
      </div>

      @if (store.conflict(); as conflict) {
        @if (conflict.pageId === pageId()) {
          <div class="conflict-banner" role="alert">
            <div class="conflict-text">
              <atr-icon name="warning" size="small" />
              <span>
                <strong>Conflicto de revisión:</strong> esta página fue modificada en otra sesión (rev. {{ conflict.serverRevision }}).
                Tus cambios locales están protegidos en IndexedDB.
              </span>
            </div>
            <div class="conflict-actions">
              <button atrButton type="button" size="small" appearance="outlined" (click)="acceptServerVersion()">
                Usar versión del servidor
              </button>
              <button atrButton type="button" size="small" appearance="filled" (click)="forceSaveLocal()">
                Sobrescribir con mi versión
              </button>
            </div>
          </div>
        }
      }

      @if (store.saveError(); as saveErr) {
        <div class="info-banner" role="status">
          <atr-icon name="info" size="small" />
          <span>{{ saveErr }}</span>
        </div>
      }

      <div class="editor-grid" [attr.data-mode]="mode()">
        @if (mode() !== 'preview') {
          <textarea
            #textareaRef
            class="markdown-input"
            spellcheck="true"
            placeholder="Escribe en Markdown…"
            [ngModel]="draft()"
            (ngModelChange)="onDraftChange($event)"
            (keydown)="onKeydown($event)"
          ></textarea>
        }

        @if (mode() !== 'edit') {
          <article
            class="markdown-preview trz-prose"
            [innerHTML]="renderedHtml()"
            (click)="onPreviewClick($event)"
          ></article>
        }
      </div>

      <footer class="editor-footer">
        <span>{{ wordCount() }} palabras</span>
        <span>Revisión v{{ revision() }}</span>
        <span>Atajos: Ctrl+B · Ctrl+I · Ctrl+K · Ctrl+S</span>
      </footer>
    </section>
  `,
  styles: `
    .editor-shell {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated);
      overflow: hidden;
      min-height: 540px;
    }

    .editor-toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--trz-border);
      background: var(--trz-bg-subtle);
    }

    .toolbar-group,
    .toolbar-right {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
    }

    .tb-btn {
      appearance: none;
      border: 1px solid transparent;
      background: transparent;
      color: var(--trz-text-muted);
      font: inherit;
      font-size: 0.8rem;
      padding: 0.28rem 0.48rem;
      border-radius: 5px;
      cursor: pointer;

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
        border-color: var(--trz-border);
      }
    }

    .tb-sep {
      width: 1px;
      height: 18px;
      background: var(--trz-border);
      margin: 0 0.2rem;
    }

    .mode-switch {
      display: inline-flex;
      border: 1px solid var(--trz-border);
      border-radius: 6px;
      overflow: hidden;
      background: var(--trz-bg);

      button {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--trz-text-muted);
        font: inherit;
        font-size: 0.76rem;
        padding: 0.28rem 0.55rem;
        cursor: pointer;

        &.active {
          background: var(--trz-accent-soft);
          color: var(--trz-accent);
          font-weight: 600;
        }
      }
    }

    .save-badge {
      font-size: 0.74rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 999px;
      background: var(--trz-bg);
      color: var(--trz-text-muted);
      border: 1px solid var(--trz-border);

      &[data-status="synced"] {
        color: var(--trz-success);
        border-color: color-mix(in srgb, var(--trz-success) 35%, transparent);
      }
      &[data-status="saved_local"] {
        color: var(--trz-accent);
      }
      &[data-status="pending"],
      &[data-status="saving"] {
        color: var(--trz-warning);
      }
      &[data-status="error"],
      &[data-status="conflict"] {
        color: var(--trz-danger);
        border-color: color-mix(in srgb, var(--trz-danger) 40%, transparent);
      }
    }

    .conflict-banner,
    .info-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.65rem 0.9rem;
      font-size: 0.83rem;
      border-bottom: 1px solid var(--trz-border);
    }

    .conflict-banner {
      background: color-mix(in srgb, var(--trz-danger) 10%, transparent);
      color: var(--trz-text);
    }

    .info-banner {
      background: color-mix(in srgb, var(--trz-warning) 10%, transparent);
      color: var(--trz-text);
      justify-content: flex-start;
    }

    .conflict-text {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .conflict-actions {
      display: flex;
      gap: 0.5rem;
    }

    .editor-grid {
      flex: 1;
      display: grid;
      min-height: 460px;

      &[data-mode="edit"],
      &[data-mode="preview"] {
        grid-template-columns: 1fr;
      }

      &[data-mode="split"] {
        grid-template-columns: 1fr 1fr;
      }
    }

    .markdown-input {
      width: 100%;
      min-height: 460px;
      border: 0;
      border-right: 1px solid var(--trz-border);
      padding: 1.15rem 1.25rem;
      background: var(--trz-bg-elevated);
      color: var(--trz-text);
      font-family: var(--trz-font-mono);
      font-size: 0.88rem;
      line-height: 1.65;
      resize: vertical;
      outline: none;
    }

    .markdown-preview {
      padding: 1.15rem 1.5rem;
      overflow-y: auto;
      background: var(--trz-bg-elevated);
    }

    .editor-footer {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.45rem 0.9rem;
      border-top: 1px solid var(--trz-border);
      background: var(--trz-bg-subtle);
      font-size: 0.75rem;
      color: var(--trz-text-subtle);
    }

    @media (max-width: 960px) {
      .editor-grid[data-mode="split"] {
        grid-template-columns: 1fr;
      }
      .markdown-input {
        border-right: 0;
        border-bottom: 1px solid var(--trz-border);
      }
    }
  `,
})
export class PageEditorComponent {
  readonly pageId = input.required<string>();
  readonly initialMarkdown = input.required<string>();
  readonly revision = input.required<number>();
  readonly saved = output<{ revision: number; markdown: string }>();

  protected readonly store = inject(KnowledgeStore);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly destroyRef = inject(DestroyRef);

  private readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('textareaRef');

  protected readonly draft = signal('');
  protected readonly mode = signal<EditorMode>('split');
  private activeRevision = 1;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly renderedHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(renderSafeMarkdown(this.draft())),
  );

  protected readonly wordCount = computed(() => {
    const trimmed = this.draft().trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  });

  protected readonly statusLabel = computed(() => {
    const map: Record<SaveStatus, string> = {
      idle: 'Listo',
      pending: 'Pendiente…',
      saving: 'Guardando…',
      saved_local: 'Guardado local',
      synced: 'Sincronizado',
      error: 'Error al guardar',
      conflict: 'Conflicto',
    };
    return map[this.store.saveStatus()];
  });

  constructor() {
    effect(() => {
      // Reset draft when switching to a different page
      const _id = this.pageId();
      this.draft.set(this.initialMarkdown());
      this.activeRevision = this.revision();
    });

    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
    });
  }

  protected onDraftChange(value: string): void {
    this.draft.set(value);
    this.store.markPendingSave();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flushSave();
    }, 900);
  }

  protected async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const result = await this.store.savePageContent(
      this.pageId(),
      this.draft(),
      this.activeRevision,
    );
    if (result) {
      this.activeRevision = result.revision;
      this.saved.emit({ revision: result.revision, markdown: result.content.markdown });
    }
  }

  protected async acceptServerVersion(): Promise<void> {
    const conflict = this.store.conflict();
    if (!conflict) return;
    this.draft.set(conflict.serverMarkdown);
    this.activeRevision = conflict.serverRevision;
    await this.flushSave();
  }

  protected async forceSaveLocal(): Promise<void> {
    const conflict = this.store.conflict();
    if (!conflict) return;
    this.activeRevision = conflict.serverRevision;
    await this.flushSave();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      this.wrapSelection('**', '**', 'negrita');
    } else if (key === 'i') {
      event.preventDefault();
      this.wrapSelection('_', '_', 'cursiva');
    } else if (key === 'k') {
      event.preventDefault();
      this.insertLink();
    } else if (key === 's') {
      event.preventDefault();
      void this.flushSave();
    }
  }

  protected onPreviewClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.matches('button[data-copy-code="true"]')) return;
    const block = target.closest('.trz-code-block');
    const codeText = block?.querySelector('code')?.textContent ?? '';
    if (!codeText) return;
    void navigator.clipboard.writeText(codeText).then(() => {
      target.textContent = 'Copiado';
      setTimeout(() => (target.textContent = 'Copiar'), 1500);
      this.snackbar.open({ message: 'Código copiado al portapapeles.', tone: 'success', duration: 2000 });
    });
  }

  protected wrapSelection(before: string, after: string, fallback: string): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = this.draft();
    const selected = value.slice(start, end) || fallback;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    this.onDraftChange(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  protected prefixLine(prefix: string): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;
    const start = el.selectionStart;
    const value = this.draft();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    this.onDraftChange(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  }

  protected insertLink(): void {
    this.wrapSelection('[', '](https://)', 'enlace');
  }

  protected insertCodeBlock(): void {
    this.insertBlock('\n```typescript\n// código aquí\n```\n');
  }

  protected insertTable(): void {
    this.insertBlock('\n| Columna 1 | Columna 2 |\n| --- | --- |\n| Valor A | Valor B |\n');
  }

  protected insertBlock(snippet: string): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = this.draft();
    const next = value.slice(0, start) + snippet + value.slice(end);
    this.onDraftChange(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  }
}
