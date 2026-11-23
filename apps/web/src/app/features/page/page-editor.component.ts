import {
  AfterViewInit,
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
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';
import { common, createLowlight } from 'lowlight';
import { Router } from '@angular/router';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import { SearchEngineService } from '../../core/search/search-engine.service';
import { KnowledgeStore, type SaveStatus } from '../../core/state/knowledge.store';
import { TrazenaUpdateService } from '../../core/update/trazena-update.service';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';

interface MarkdownStorage {
  markdown?: {
    getMarkdown(): string;
  };
}

const lowlight = createLowlight(common);

@Component({
  selector: 'trz-page-editor',
  standalone: true,
  imports: [AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="notion-editor-shell">
      <div class="editor-bar" role="toolbar" aria-label="Formato del documento">
        <div class="bar-controls">
          <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 1 })" title="Título 1 (# )" (click)="toggleHeading(1)">H1</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 2 })" title="Título 2 (## )" (click)="toggleHeading(2)">H2</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 3 })" title="Título 3 (### )" (click)="toggleHeading(3)">H3</button>
          <span class="bar-sep"></span>
          <button type="button" class="fmt-btn" [class.active]="isActive('bold')" title="Negrita (Ctrl+B)" (click)="cmd('toggleBold')"><strong>B</strong></button>
          <button type="button" class="fmt-btn" [class.active]="isActive('italic')" title="Cursiva (Ctrl+I)" (click)="cmd('toggleItalic')"><em>I</em></button>
          <button type="button" class="fmt-btn" [class.active]="isActive('strike')" title="Tachado" (click)="cmd('toggleStrike')"><s>S</s></button>
          <button type="button" class="fmt-btn" [class.active]="isActive('code')" title="Código en línea" (click)="cmd('toggleCode')"><code>&lt;/&gt;</code></button>
          <span class="bar-sep"></span>
          <button type="button" class="fmt-btn" [class.active]="isActive('bulletList')" title="Lista con viñetas" (click)="cmd('toggleBulletList')">• Lista</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('orderedList')" title="Lista numerada" (click)="cmd('toggleOrderedList')">1. Lista</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('taskList')" title="Checklist interactivo" (click)="cmd('toggleTaskList')">☑ Tarea</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('blockquote')" title="Cita" (click)="cmd('toggleBlockquote')">❝</button>
          <button type="button" class="fmt-btn" [class.active]="isActive('codeBlock')" title="Bloque de código" (click)="cmd('toggleCodeBlock')">Código</button>
          <button type="button" class="fmt-btn" title="Insertar tabla" (click)="insertTable()">Tabla</button>
          <button type="button" class="fmt-btn" title="Insertar enlace" (click)="setLink()">Enlace</button>
          <button type="button" class="fmt-btn" title="Insertar enlace interno entre páginas ([[...]])" (click)="insertInternalLink()">[[Página]]</button>
          <button type="button" class="fmt-btn" title="Separador" (click)="cmd('setHorizontalRule')">―</button>
        </div>

        <span class="save-pill" [attr.data-status]="store.saveStatus()">
          {{ statusLabel() }}
        </span>
      </div>

      @if (store.saveError(); as saveErr) {
        <div class="info-banner" role="status">
          <atr-icon name="info" size="small" />
          <span>{{ saveErr }}</span>
        </div>
      }

      <div #editorHost class="trz-notion-editor" (keydown)="onKeydown($event)" (click)="onEditorClick($event)"></div>

      <footer class="editor-meta">
        <span>{{ wordCount() }} palabras</span>
        <span>Revisión v{{ revision() }}</span>
        <span class="hide-mobile">Markdown en vivo: #, **, - [ ], &gt;, \`\`\`</span>
      </footer>
    </section>
  `,
  styles: `
    .notion-editor-shell {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .editor-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.4rem 0.55rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: color-mix(in srgb, var(--trz-bg) 92%, transparent);
      backdrop-filter: blur(8px);
    }

    .bar-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.15rem;
    }

    .fmt-btn {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--trz-text-muted);
      font: inherit;
      font-size: 0.79rem;
      padding: 0.28rem 0.48rem;
      border-radius: 5px;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;

      &:hover {
        background: var(--trz-bg-hover);
        color: var(--trz-text);
      }

      &.active {
        background: var(--trz-accent-soft);
        color: var(--trz-accent);
        font-weight: 600;
      }
    }

    .bar-sep {
      width: 1px;
      height: 16px;
      background: var(--trz-border);
      margin: 0 0.2rem;
    }

    .save-pill {
      font-size: 0.74rem;
      font-weight: 500;
      padding: 0.18rem 0.55rem;
      border-radius: 999px;
      background: var(--trz-bg-subtle);
      color: var(--trz-text-muted);

      &[data-status="synced"] { color: var(--trz-success); }
      &[data-status="saved_local"] { color: var(--trz-accent); }
      &[data-status="pending"],
      &[data-status="saving"] { color: var(--trz-warning); }
      &[data-status="error"],
      &[data-status="conflict"] { color: var(--trz-danger); }
    }

    .conflict-banner,
    .info-banner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.65rem;
      padding: 0.65rem 0.9rem;
      border-radius: var(--trz-radius-sm);
      font-size: 0.83rem;
      border: 1px solid var(--trz-border);
    }

    .conflict-banner {
      background: color-mix(in srgb, var(--trz-danger) 10%, transparent);
    }

    .info-banner {
      background: color-mix(in srgb, var(--trz-warning) 10%, transparent);
      justify-content: flex-start;
    }

    .conflict-text {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .conflict-actions {
      display: flex;
      gap: 0.45rem;
    }

    .editor-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--trz-border);
      font-size: 0.76rem;
      color: var(--trz-text-subtle);
    }

    @media (max-width: 640px) {
      .hide-mobile { display: none; }
    }
  `,
})
export class PageEditorComponent implements AfterViewInit {
  readonly pageId = input.required<string>();
  readonly initialMarkdown = input.required<string>();
  readonly revision = input.required<number>();
  readonly saved = output<{ revision: number; markdown: string }>();

  protected readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly search = inject(SearchEngineService);
  private readonly router = inject(Router);
  private readonly updater = inject(TrazenaUpdateService);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly editorHost = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');

  private editor: Editor | null = null;
  private activeRevision = 1;
  private lastLoadedPageId = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly wordCount = signal(0);
  protected readonly selectionTick = signal(0);

  protected readonly statusLabel = computed(() => {
    const map: Record<SaveStatus, string> = {
      idle: 'Guardado',
      pending: 'Editando…',
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
      const id = this.pageId();
      const md = this.initialMarkdown();
      const rev = this.revision();
      this.activeRevision = rev;

      if (this.editor && id !== this.lastLoadedPageId) {
        this.lastLoadedPageId = id;
        this.editor.commands.setContent(md || '', { emitUpdate: false });
        this.updateWordCount();
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.editor?.destroy();
      this.editor = null;
    });
  }

  ngAfterViewInit(): void {
    this.lastLoadedPageId = this.pageId();
    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: false,
        }),
        CodeBlockLowlight.configure({ lowlight }),
        Placeholder.configure({
          placeholder:
            'Empieza a escribir o usa atajos Markdown (# título, - lista, [ ] tarea, > cita, ``` código)…',
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        Link.configure({
          openOnClick: false,
          autolink: true,
        }),
        Markdown.configure({
          html: false,
          tightLists: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      content: this.initialMarkdown() || '',
      onUpdate: () => {
        this.updateWordCount();
        this.scheduleSave();
      },
      onSelectionUpdate: () => {
        this.selectionTick.update((n) => n + 1);
      },
      onTransaction: () => {
        this.selectionTick.update((n) => n + 1);
      },
    });
    this.updateWordCount();
  }

  protected isActive(name: string, attrs?: Record<string, unknown>): boolean {
    this.selectionTick();
    return this.editor?.isActive(name, attrs) ?? false;
  }

  protected toggleHeading(level: 1 | 2 | 3): void {
    this.editor?.chain().focus().toggleHeading({ level }).run();
  }

  protected cmd(
    action:
      | 'toggleBold'
      | 'toggleItalic'
      | 'toggleStrike'
      | 'toggleCode'
      | 'toggleBulletList'
      | 'toggleOrderedList'
      | 'toggleTaskList'
      | 'toggleBlockquote'
      | 'toggleCodeBlock'
      | 'setHorizontalRule',
  ): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    (chain[action] as () => typeof chain)().run();
  }

  protected insertTable(): void {
    this.editor
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  }

  protected async setLink(): Promise<void> {
    if (!this.editor) return;
    const prev = (this.editor.getAttributes('link')['href'] as string | undefined) ?? '';
    const url = await this.dialogs.prompt({
      title: 'Insertar enlace',
      label: 'URL de destino',
      initialValue: prev || 'https://',
      placeholder: 'https://ejemplo.com',
      confirmText: 'Aplicar',
    });
    if (url === null) return;
    if (!url.trim()) {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    this.editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url.trim() })
      .run();
  }

  protected async insertInternalLink(): Promise<void> {
    if (!this.editor) return;
    const query = await this.dialogs.prompt({
      title: 'Enlace interno entre páginas',
      label: 'Escribe parte del título de la página destino',
      placeholder: 'Ej. Editor Markdown…',
      confirmText: 'Insertar enlace',
    });
    if (!query) return;
    const active = this.store.pages().filter((p) => p.status === 'active' && p.id !== this.pageId());
    const target = active.find((p) => p.title.toLowerCase().includes(query.toLowerCase()));
    if (!target) return;
    this.editor
      .chain()
      .focus()
      .insertContent(`<a href="trazena://page/${target.id}">${target.title}</a> `)
      .run();
  }

  protected onEditorClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (href.startsWith('trazena://page/')) {
      event.preventDefault();
      const targetId = href.slice('trazena://page/'.length);
      const path = this.store.getCanonicalPath(targetId);
      if (path && path !== '/') {
        void this.router.navigateByUrl(path);
      }
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.flushSave();
    }
  }

  private getMarkdown(): string {
    const storage = this.editor?.storage as MarkdownStorage | undefined;
    return storage?.markdown?.getMarkdown() ?? '';
  }

  private updateWordCount(): void {
    const text = this.editor?.getText().trim() ?? '';
    this.wordCount.set(text ? text.split(/\s+/).length : 0);
  }

  private scheduleSave(): void {
    this.store.markPendingSave();
    this.updater.setUnsavedEditorDraft(true);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flushSave();
    }, 900);
  }

  private async flushSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const markdown = this.getMarkdown();
    const result = await this.store.savePageContent(
      this.pageId(),
      markdown,
      this.activeRevision,
    );
    this.updater.setUnsavedEditorDraft(false);
    if (result) {
      this.activeRevision = result.revision;
      this.search.upsertPage(result, result.content.markdown);
      void this.meta.updateBacklinksForPage(result.id, result.content.markdown);
      this.saved.emit({ revision: result.revision, markdown: result.content.markdown });
    }
  }
}
