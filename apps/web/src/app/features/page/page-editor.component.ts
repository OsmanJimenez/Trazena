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
import { FormsModule } from '@angular/forms';
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
import type { LocalDraftRecovery } from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeIcon } from '@osmanjimenez/atralume/icon';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import { DocumentOperationsService } from '../../core/productivity/document-operations.service';
import { DraftRecoveryService } from '../../core/productivity/draft-recovery.service';
import { toLocalCalendarDate } from '../../core/productivity/daily-notes.service';
import { SearchEngineService } from '../../core/search/search-engine.service';
import { KnowledgeStore, type SaveStatus } from '../../core/state/knowledge.store';
import { ThemeService } from '../../core/state/theme.service';
import { IndexedDbService } from '../../core/storage/indexeddb.service';
import { TrazenaDialogsService } from '../../core/ui/trazena-dialogs.service';
import { TrazenaUpdateService } from '../../core/update/trazena-update.service';
import {
  TrazenaHighlight,
  TrazenaTextColor,
  TrazenaUnderline,
} from '../../core/editor/rich-marks.extensions';
import { hydrateMermaidDiagrams, renderSafeMarkdown } from '../../core/utils/markdown.util';
import { isNotionHtml, normalizePastedHtml } from '../../core/utils/notion-paste.util';
import { WorkspaceTabsService } from '../../core/workspace/workspace-tabs.service';

interface MarkdownStorage {
  markdown?: {
    getMarkdown(): string;
  };
}

interface SlashCommandItem {
  id: string;
  trigger: string;
  label: string;
  description: string;
}

interface LinkPreviewCard {
  pageId: string;
  title: string;
  canonicalPath: string;
  excerpt: string;
  exists: boolean;
}

type EditorViewMode = 'visual' | 'source' | 'preview';

const lowlight = createLowlight(common);

const SLASH_COMMANDS: readonly SlashCommandItem[] = [
  { id: 'table', trigger: '/tabla', label: 'Tabla GFM 3×3', description: 'Inserta tabla Markdown editable' },
  { id: 'code', trigger: '/codigo', label: 'Bloque de código', description: 'Bloque con resaltado de sintaxis' },
  { id: 'mermaid', trigger: '/diagrama', label: 'Diagrama Mermaid', description: 'Flujo Mermaid renderizado offline' },
  { id: 'math', trigger: '/formula', label: 'Fórmula KaTeX', description: 'Bloque matemático LaTeX ($$...$$)' },
  { id: 'callout', trigger: '/alerta', label: 'Callout / Nota', description: 'Bloque semántico [!NOTE] portable' },
  { id: 'checklist', trigger: '/checklist', label: 'Lista de tareas', description: 'Checklist interactivo (- [ ])' },
  { id: 'quote', trigger: '/cita', label: 'Cita', description: 'Bloque de cita (> )' },
  { id: 'hr', trigger: '/separador', label: 'Separador horizontal', description: 'Línea divisoria (---)' },
  { id: 'date', trigger: '/fecha', label: 'Fecha de hoy', description: 'Inserta fecha calendario local' },
];

@Component({
  selector: 'trz-page-editor',
  standalone: true,
  imports: [FormsModule, AtralumeButton, AtralumeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="notion-editor-shell">
      @if (recoverableDraft(); as draft) {
        <div class="draft-banner" role="status">
          <div>
            <strong>Borrador local de recuperación detectado</strong>
            <span>Guardado el {{ formatDate(draft.savedAt) }} (base rev. v{{ draft.baseRevision }}).</span>
          </div>
          <div class="draft-actions">
            <button atrButton type="button" size="small" appearance="filled" (click)="restoreDraft(draft)">
              Restaurar borrador
            </button>
            <button atrButton type="button" size="small" appearance="text" (click)="discardDraft()">
              Descartar
            </button>
          </div>
        </div>
      }

      <div class="editor-bar" role="toolbar" aria-label="Formato y modos del documento">
        <div class="mode-switch" role="group" aria-label="Modo de edición">
          <button type="button" class="mode-btn" [class.active]="mode() === 'visual'" (click)="setMode('visual')">
            Visual
          </button>
          <button type="button" class="mode-btn" [class.active]="mode() === 'source'" (click)="setMode('source')">
            Markdown
          </button>
          <button type="button" class="mode-btn" [class.active]="mode() === 'preview'" (click)="setMode('preview')">
            Vista previa
          </button>
        </div>

        <div class="bar-controls">
          @if (mode() === 'visual') {
            <button type="button" class="fmt-btn" title="Deshacer (Ctrl+Z)" (click)="undo()">↶</button>
            <button type="button" class="fmt-btn" title="Rehacer (Ctrl+Y)" (click)="redo()">↷</button>
            <span class="bar-sep"></span>
            <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 1 })" title="Título 1 (# )" (click)="toggleHeading(1)">H1</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 2 })" title="Título 2 (## )" (click)="toggleHeading(2)">H2</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('heading', { level: 3 })" title="Título 3 (### )" (click)="toggleHeading(3)">H3</button>
            <span class="bar-sep"></span>
            <button type="button" class="fmt-btn" [class.active]="isActive('bold')" title="Negrita (Ctrl+B)" (click)="cmd('toggleBold')"><strong>B</strong></button>
            <button type="button" class="fmt-btn" [class.active]="isActive('italic')" title="Cursiva (Ctrl+I)" (click)="cmd('toggleItalic')"><em>I</em></button>
            <button type="button" class="fmt-btn" [class.active]="isActive('underline')" title="Subrayado (Ctrl+U)" (click)="cmd('toggleUnderline')"><u>U</u></button>
            <button type="button" class="fmt-btn" [class.active]="isActive('strike')" title="Tachado" (click)="cmd('toggleStrike')"><s>S</s></button>
            <button type="button" class="fmt-btn" [class.active]="isActive('highlight')" title="Resaltar texto" (click)="cmd('toggleHighlight')">Resaltar</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('code')" title="Código en línea" (click)="cmd('toggleCode')"><code>&lt;/&gt;</code></button>
            <span class="bar-sep"></span>
            <button type="button" class="fmt-btn" [class.active]="isActive('bulletList')" title="Lista" (click)="cmd('toggleBulletList')">• Lista</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('orderedList')" title="Numerada" (click)="cmd('toggleOrderedList')">1. Lista</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('taskList')" title="Checklist" (click)="cmd('toggleTaskList')">☑ Tarea</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('blockquote')" title="Cita" (click)="cmd('toggleBlockquote')">❝</button>
            <button type="button" class="fmt-btn" [class.active]="isActive('codeBlock')" title="Código" (click)="cmd('toggleCodeBlock')">Código</button>
            <button type="button" class="fmt-btn" title="Tabla" (click)="insertTable()">Tabla</button>
            <button type="button" class="fmt-btn" title="Enlace" (click)="setLink()">Enlace</button>
            <button type="button" class="fmt-btn" title="Enlace interno (trazena://page/id)" (click)="insertInternalLink()">[[Página]]</button>
            <button type="button" class="fmt-btn" title="Comandos contextuales (/)" (click)="slashMenuOpen.set(!slashMenuOpen())">/ Comandos</button>
            @if (isActive('table')) {
              <span class="bar-sep"></span>
              <button type="button" class="fmt-btn" title="Agregar fila" (click)="tableOp('addRowAfter')">+Fila</button>
              <button type="button" class="fmt-btn" title="Eliminar fila" (click)="tableOp('deleteRow')">-Fila</button>
              <button type="button" class="fmt-btn" title="Agregar columna" (click)="tableOp('addColumnAfter')">+Col</button>
              <button type="button" class="fmt-btn" title="Eliminar columna" (click)="tableOp('deleteColumn')">-Col</button>
            }
          } @else if (mode() === 'source') {
            <button type="button" class="fmt-btn" (click)="insertSourceSnippet('mermaid')">+ Mermaid</button>
            <button type="button" class="fmt-btn" (click)="insertSourceSnippet('math')">+ KaTeX</button>
            <button type="button" class="fmt-btn" (click)="insertSourceSnippet('callout')">+ Callout</button>
            <button type="button" class="fmt-btn" (click)="insertSourceSnippet('table')">+ Tabla</button>
          }

          <span class="bar-sep"></span>
          <button type="button" class="fmt-btn" [class.active]="findBarOpen()" title="Buscar y reemplazar (Ctrl+H)" (click)="findBarOpen.set(!findBarOpen())">
            Buscar/Reemplazar
          </button>
          <button type="button" class="fmt-btn" title="Extraer selección a subpágina" (click)="extractSelection()">
            Extraer
          </button>
          <button type="button" class="fmt-btn" title="Fusionar esta página con otra" (click)="mergeWithAnother()">
            Fusionar
          </button>
        </div>

        <span class="save-pill" [attr.data-status]="store.saveStatus()">
          {{ statusLabel() }}
        </span>
      </div>

      @if (findBarOpen()) {
        <div class="find-bar" role="region" aria-label="Buscar y reemplazar en el documento">
          <input
            type="text"
            placeholder="Buscar texto…"
            [ngModel]="findQuery()"
            (ngModelChange)="findQuery.set($event)"
          />
          <input
            type="text"
            placeholder="Reemplazar por…"
            [ngModel]="replaceQuery()"
            (ngModelChange)="replaceQuery.set($event)"
          />
          <label class="case-toggle">
            <input type="checkbox" [ngModel]="findCaseSensitive()" (ngModelChange)="findCaseSensitive.set($event)" />
            <span>Aa</span>
          </label>
          <span class="match-count">{{ matchCount() }} coinc.</span>
          <button atrButton type="button" size="small" appearance="outlined" (click)="replaceNext()">Reemplazar</button>
          <button atrButton type="button" size="small" appearance="outlined" (click)="replaceAll()">Todas</button>
          <button atrButton type="button" size="small" appearance="text" (click)="findBarOpen.set(false)">Cerrar</button>
        </div>
      }

      @if (slashMenuOpen() && mode() === 'visual') {
        <div class="slash-menu" role="menu" aria-label="Comandos contextuales de edición">
          <div class="slash-head">
            <input
              type="text"
              placeholder="Filtrar comando (/tabla, /diagrama, /formula, /alerta…)"
              [ngModel]="slashFilter()"
              (ngModelChange)="slashFilter.set($event)"
              (keydown.escape)="slashMenuOpen.set(false)"
            />
            <button type="button" class="slash-close" (click)="slashMenuOpen.set(false)">×</button>
          </div>
          <div class="slash-items">
            @for (item of filteredSlashCommands(); track item.id) {
              <button type="button" class="slash-item" role="menuitem" (click)="runSlashCommand(item.id)">
                <code>{{ item.trigger }}</code>
                <strong>{{ item.label }}</strong>
                <span>{{ item.description }}</span>
              </button>
            }
          </div>
        </div>
      }

      @if (linkPreview(); as lp) {
        <aside class="link-preview-popover" role="region" aria-label="Previsualización de enlace interno">
          <div class="lp-top">
            <div>
              <strong>{{ lp.title }}</strong>
              <code>{{ lp.canonicalPath }}</code>
            </div>
            <button type="button" class="slash-close" (click)="linkPreview.set(null)">×</button>
          </div>
          <p>{{ lp.exists ? (lp.excerpt || 'Sin extracto disponible.') : 'La página enlazada fue eliminada o no existe.' }}</p>
          @if (lp.exists) {
            <div class="lp-actions">
              <button atrButton type="button" size="small" appearance="filled" (click)="openLinkedPage(lp.pageId, false)">
                Abrir página
              </button>
              <button atrButton type="button" size="small" appearance="outlined" (click)="openLinkedPage(lp.pageId, true)">
                Abrir en otro panel
              </button>
            </div>
          }
        </aside>
      }

      @if (store.saveError(); as saveErr) {
        <div class="info-banner" role="status">
          <atr-icon name="info" size="small" />
          <span>{{ saveErr }}</span>
        </div>
      }

      <!-- Visual Tiptap Canvas -->
      <div
        #editorHost
        class="trz-notion-editor"
        [class.is-hidden]="mode() !== 'visual'"
        (keydown)="onKeydown($event)"
        (click)="onEditorClick($event)"
        (mouseover)="onLinkHover($event)"
      ></div>

      <!-- Raw Markdown Source Editor (preserves Mermaid, KaTeX, Callouts, Frontmatter losslessly) -->
      @if (mode() === 'source') {
        <textarea
          class="source-textarea"
          aria-label="Código fuente Markdown"
          [ngModel]="sourceMarkdown()"
          (ngModelChange)="onSourceInput($event)"
          (keydown)="onKeydown($event)"
        ></textarea>
      }

      <!-- Rich Sanitized Preview (Mermaid + KaTeX + Callouts + Collapsible Code Blocks) -->
      @if (mode() === 'preview') {
        <article
          #previewHost
          class="trz-md-preview"
          [innerHTML]="previewHtml()"
          (click)="onPreviewClick($event)"
          (mouseover)="onLinkHover($event)"
        ></article>
      }

      <footer class="editor-meta">
        <span>{{ wordCount() }} palabras</span>
        <span>Revisión v{{ revision() }}</span>
        <span class="hide-mobile">Comandos: / · Mermaid · KaTeX ($...$) · Callouts ([!NOTE])</span>
      </footer>
    </section>
  `,
  styles: `
    .notion-editor-shell { display: flex; flex-direction: column; gap: 0.75rem; position: relative; }
    .is-hidden { display: none; }

    .draft-banner {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.65rem;
      padding: 0.65rem 0.9rem; border-radius: var(--trz-radius-sm);
      border: 1px solid var(--trz-warning);
      background: color-mix(in srgb, var(--trz-warning) 10%, transparent);
      font-size: 0.82rem;
      div { display: flex; flex-direction: column; gap: 0.15rem; }
      span { color: var(--trz-text-muted); font-size: 0.76rem; }
    }
    .draft-actions { display: flex; flex-direction: row !important; gap: 0.35rem; }

    /* Level 3b Ribbon: Lightweight inline editor formatting bar */
    .editor-bar {
      position: sticky; top: 0; z-index: 10;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.45rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle);
    }

    .mode-switch {
      display: inline-flex; padding: 2px; border: 1px solid var(--trz-border-strong);
      border-radius: var(--trz-radius-sm); background: var(--trz-bg);
    }
    .mode-btn {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-muted);
      font: inherit; font-size: 0.73rem; font-weight: 500; padding: 0.2rem 0.5rem; border-radius: 4px; cursor: pointer;
      &.active { background: var(--trz-accent); color: #fff; font-weight: 600; }
    }

    .bar-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.12rem; flex: 1; }
    .fmt-btn {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-muted);
      font: inherit; font-size: 0.77rem; padding: 0.24rem 0.44rem; border-radius: 5px; cursor: pointer;
      &:hover { background: var(--trz-bg-hover); color: var(--trz-text); }
      &.active { background: var(--trz-accent-soft); color: var(--trz-accent); font-weight: 600; }
    }
    .bar-sep { width: 1px; height: 15px; background: var(--trz-border); margin: 0 0.15rem; }

    .save-pill {
      font-size: 0.73rem; font-weight: 500; padding: 0.16rem 0.52rem; border-radius: 999px;
      background: var(--trz-bg-subtle); color: var(--trz-text-muted);
      &[data-status="synced"] { color: var(--trz-success); }
      &[data-status="saved_local"] { color: var(--trz-accent); }
      &[data-status="pending"], &[data-status="saving"] { color: var(--trz-warning); }
      &[data-status="error"], &[data-status="conflict"] { color: var(--trz-danger); }
    }

    .find-bar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem;
      padding: 0.55rem 0.75rem; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg-subtle); font-size: 0.8rem;
      input[type="text"] {
        height: 30px; padding: 0 0.55rem; border: 1px solid var(--trz-border-strong);
        border-radius: 5px; background: var(--trz-bg); color: var(--trz-text); font: inherit; min-width: 140px;
      }
    }
    .case-toggle { display: inline-flex; align-items: center; gap: 0.25rem; cursor: pointer; }
    .match-count { font-size: 0.75rem; color: var(--trz-text-subtle); font-variant-numeric: tabular-nums; }

    .slash-menu {
      border: 1px solid var(--trz-border-strong); border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated); box-shadow: var(--trz-shadow-md); padding: 0.55rem;
      display: flex; flex-direction: column; gap: 0.45rem;
    }
    .slash-head {
      display: flex; align-items: center; gap: 0.4rem;
      input {
        flex: 1; height: 30px; padding: 0 0.6rem; border: 1px solid var(--trz-border);
        border-radius: 5px; background: var(--trz-bg); color: var(--trz-text); font: inherit; font-size: 0.82rem;
      }
    }
    .slash-close {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-subtle);
      width: 24px; height: 24px; border-radius: 4px; cursor: pointer; font-size: 1rem;
      &:hover { background: var(--trz-bg-hover); color: var(--trz-text); }
    }
    .slash-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.3rem; }
    .slash-item {
      appearance: none; border: 1px solid var(--trz-border); border-radius: var(--trz-radius-sm);
      background: var(--trz-bg); color: var(--trz-text); text-align: left; padding: 0.45rem 0.6rem;
      cursor: pointer; display: flex; flex-direction: column; gap: 0.15rem; font: inherit;
      code { font-family: var(--trz-font-mono); font-size: 0.74rem; color: var(--trz-accent); }
      strong { font-size: 0.82rem; }
      span { font-size: 0.73rem; color: var(--trz-text-subtle); }
      &:hover { background: var(--trz-bg-subtle); border-color: var(--trz-accent); }
    }

    .link-preview-popover {
      padding: 0.75rem 0.9rem; border: 1px solid var(--trz-border-strong); border-radius: var(--trz-radius-md);
      background: var(--trz-bg-elevated); box-shadow: var(--trz-shadow-md);
      display: flex; flex-direction: column; gap: 0.45rem; font-size: 0.82rem;
      p { margin: 0; color: var(--trz-text-muted); line-height: 1.45; }
    }
    .lp-top {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;
      div { display: flex; flex-direction: column; gap: 0.15rem; }
      code { font-family: var(--trz-font-mono); font-size: 0.72rem; color: var(--trz-text-subtle); }
    }
    .lp-actions { display: flex; gap: 0.4rem; }

    .source-textarea {
      width: 100%; min-height: 480px; padding: 1rem 1.15rem;
      border: 1px solid var(--trz-border); border-radius: var(--trz-radius-md);
      background: var(--trz-bg-subtle); color: var(--trz-text);
      font-family: var(--trz-font-mono); font-size: 0.88rem; line-height: 1.65;
      resize: vertical; outline: none;
      &:focus { border-color: var(--trz-accent); }
    }

    .info-banner {
      display: flex; align-items: center; gap: 0.5rem; padding: 0.65rem 0.9rem;
      border-radius: var(--trz-radius-sm); font-size: 0.83rem; border: 1px solid var(--trz-border);
      background: color-mix(in srgb, var(--trz-warning) 10%, transparent);
    }

    .editor-meta {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.75rem;
      padding-top: 0.75rem; border-top: 1px solid var(--trz-border);
      font-size: 0.76rem; color: var(--trz-text-subtle);
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
  private readonly drafts = inject(DraftRecoveryService);
  private readonly docOps = inject(DocumentOperationsService);
  private readonly tabs = inject(WorkspaceTabsService);
  private readonly idb = inject(IndexedDbService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly updater = inject(TrazenaUpdateService);
  private readonly dialogs = inject(TrazenaDialogsService);
  private readonly snackbar = inject(AtralumeSnackbar);
  private readonly destroyRef = inject(DestroyRef);

  private readonly editorHost = viewChild.required<ElementRef<HTMLDivElement>>('editorHost');
  private readonly previewHost = viewChild<ElementRef<HTMLElement>>('previewHost');

  private editor: Editor | null = null;
  private activeRevision = 1;
  private lastLoadedPageId = '';
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly mode = signal<EditorViewMode>('visual');
  protected readonly sourceMarkdown = signal('');
  protected readonly previewHtml = signal('');
  protected readonly wordCount = signal(0);
  protected readonly selectionTick = signal(0);
  protected readonly recoverableDraft = signal<LocalDraftRecovery | null>(null);

  protected readonly findBarOpen = signal(false);
  protected readonly findQuery = signal('');
  protected readonly replaceQuery = signal('');
  protected readonly findCaseSensitive = signal(false);

  protected readonly slashMenuOpen = signal(false);
  protected readonly slashFilter = signal('');
  protected readonly linkPreview = signal<LinkPreviewCard | null>(null);

  protected readonly filteredSlashCommands = computed(() => {
    const q = this.slashFilter().trim().toLowerCase();
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) =>
        c.trigger.includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  });

  protected readonly matchCount = computed(() => {
    const q = this.findQuery();
    if (!q) return 0;
    const text = this.currentMarkdownSnapshot();
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, this.findCaseSensitive() ? 'g' : 'gi');
    return (text.match(re) ?? []).length;
  });

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

      if (id !== this.lastLoadedPageId) {
        this.lastLoadedPageId = id;
        this.sourceMarkdown.set(md || '');
        this.linkPreview.set(null);
        this.slashMenuOpen.set(false);
        if (this.editor) {
          this.editor.commands.setContent(md || '', { emitUpdate: false });
          this.updateWordCount();
        }
        if (this.mode() === 'preview') {
          this.refreshPreview();
        }
        void this.checkDraftRecovery(id, md || '', rev);
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        void this.flushSave();
      }
      this.editor?.destroy();
      this.editor = null;
    });
  }

  ngAfterViewInit(): void {
    this.lastLoadedPageId = this.pageId();
    this.sourceMarkdown.set(this.initialMarkdown() || '');
    this.editor = new Editor({
      element: this.editorHost().nativeElement,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          link: false,
          underline: false,
        }),
        CodeBlockLowlight.configure({ lowlight }),
        Placeholder.configure({
          placeholder:
            'Empieza a escribir o escribe "/" para comandos (/tabla, /codigo, /diagrama, /formula, /alerta)…',
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
        TrazenaUnderline,
        TrazenaTextColor,
        TrazenaHighlight,
        Markdown.configure({
          html: true,
          tightLists: true,
          transformPastedText: true,
          transformCopiedText: true,
        }),
      ],
      editorProps: {
        transformPastedHTML: (html) => {
          const fromNotion = isNotionHtml(html);
          const cleaned = normalizePastedHtml(html);
          if (fromNotion) {
            this.snackbar.open({
              message: 'Contenido de Notion pegado conservando formato y estilos.',
              tone: 'success',
              duration: 3000,
            });
          }
          return cleaned;
        },
      },
      content: this.initialMarkdown() || '',
      onUpdate: () => {
        const md = this.getMarkdownFromTiptap();
        this.sourceMarkdown.set(md);
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
    void this.checkDraftRecovery(this.pageId(), this.initialMarkdown() || '', this.revision());
  }

  private async checkDraftRecovery(
    pageId: string,
    markdown: string,
    revision: number,
  ): Promise<void> {
    const draft = await this.drafts.getRecoverableDraft(pageId, markdown, revision);
    this.recoverableDraft.set(draft);
  }

  protected async restoreDraft(draft: LocalDraftRecovery): Promise<void> {
    if (draft.baseRevision < this.activeRevision) {
      const ok = await this.dialogs.confirm({
        title: 'Restaurar borrador anterior',
        message:
          'Este borrador se guardó sobre una revisión anterior. ¿Deseas restaurarlo igualmente como nuevo contenido?',
        confirmText: 'Restaurar',
      });
      if (!ok) return;
    }
    this.applyFullMarkdown(draft.markdown);
    await this.drafts.clearDraft(this.pageId());
    this.recoverableDraft.set(null);
    await this.flushSave();
    this.snackbar.open({ message: 'Borrador recuperado y guardado.', tone: 'success' });
  }

  protected async discardDraft(): Promise<void> {
    await this.drafts.clearDraft(this.pageId());
    this.recoverableDraft.set(null);
  }

  protected setMode(next: EditorViewMode): void {
    const prev = this.mode();
    if (prev === next) return;
    if (prev === 'visual') {
      this.sourceMarkdown.set(this.getMarkdownFromTiptap());
    } else if (prev === 'source' && next === 'visual' && this.editor) {
      this.editor.commands.setContent(this.sourceMarkdown(), { emitUpdate: false });
    }
    this.mode.set(next);
    if (next === 'preview') {
      this.refreshPreview();
    }
  }

  private refreshPreview(): void {
    this.previewHtml.set(renderSafeMarkdown(this.currentMarkdownSnapshot()));
    const dark = this.theme.effectiveTheme() === 'dark';
    queueMicrotask(() => {
      const host = this.previewHost()?.nativeElement;
      if (host) void hydrateMermaidDiagrams(host, dark);
    });
  }

  protected onSourceInput(md: string): void {
    this.sourceMarkdown.set(md);
    this.updateWordCount();
    this.scheduleSave();
  }

  protected insertSourceSnippet(kind: 'mermaid' | 'math' | 'callout' | 'table'): void {
    const snippets: Record<typeof kind, string> = {
      mermaid: '\n```mermaid\nflowchart TD\n    A[Inicio] --> B[Proceso]\n    B --> C[Resultado]\n```\n',
      math: '\n$$\nE = mc^2\n$$\n',
      callout: '\n> [!NOTE]\n> Escribe aquí una nota destacada.\n',
      table: '\n| Columna 1 | Columna 2 | Columna 3 |\n| --- | --- | --- |\n| Valor A | Valor B | Valor C |\n',
    };
    this.onSourceInput(this.sourceMarkdown() + snippets[kind]);
  }

  protected undo(): void {
    this.editor?.chain().focus().undo().run();
  }

  protected redo(): void {
    this.editor?.chain().focus().redo().run();
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
      | 'toggleUnderline'
      | 'toggleStrike'
      | 'toggleHighlight'
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

  protected tableOp(op: 'addRowAfter' | 'deleteRow' | 'addColumnAfter' | 'deleteColumn'): void {
    if (!this.editor) return;
    const chain = this.editor.chain().focus();
    (chain[op] as () => typeof chain)().run();
  }

  protected insertTable(): void {
    this.editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }

  protected runSlashCommand(id: string): void {
    this.slashMenuOpen.set(false);
    this.slashFilter.set('');
    if (!this.editor) return;

    if (id === 'table') {
      this.insertTable();
    } else if (id === 'code') {
      this.editor.chain().focus().toggleCodeBlock().run();
    } else if (id === 'mermaid') {
      this.editor
        .chain()
        .focus()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: 'flowchart TD\n    A[Inicio] --> B[Resultado]' }],
        })
        .run();
      this.snackbar.open({
        message: 'Diagrama Mermaid insertado. Cambia a "Vista previa" para visualizar el SVG.',
        tone: 'info',
      });
    } else if (id === 'math') {
      this.editor.chain().focus().insertContent('\n$$\n\\sum_{i=1}^{n} x_i\n$$\n').run();
    } else if (id === 'callout') {
      this.editor
        .chain()
        .focus()
        .insertContent('<blockquote><p>[!NOTE]<br>Nota importante…</p></blockquote>')
        .run();
    } else if (id === 'checklist') {
      this.editor.chain().focus().toggleTaskList().run();
    } else if (id === 'quote') {
      this.editor.chain().focus().toggleBlockquote().run();
    } else if (id === 'hr') {
      this.editor.chain().focus().setHorizontalRule().run();
    } else if (id === 'date') {
      this.editor.chain().focus().insertContent(toLocalCalendarDate()).run();
    }
  }

  protected replaceNext(): void {
    const q = this.findQuery();
    if (!q) return;
    const md = this.currentMarkdownSnapshot();
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, this.findCaseSensitive() ? '' : 'i');
    if (!re.test(md)) return;
    const next = md.replace(re, this.replaceQuery());
    this.applyFullMarkdown(next);
    this.scheduleSave();
  }

  protected replaceAll(): void {
    const q = this.findQuery();
    if (!q) return;
    const md = this.currentMarkdownSnapshot();
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, this.findCaseSensitive() ? 'g' : 'gi');
    const next = md.replace(re, this.replaceQuery());
    if (next === md) return;
    this.applyFullMarkdown(next);
    this.scheduleSave();
    this.snackbar.open({ message: 'Reemplazos aplicados en el documento.', tone: 'success' });
  }

  protected async extractSelection(): Promise<void> {
    const selectedText = this.getSelectedText();
    if (!selectedText.trim()) {
      this.snackbar.open({
        message: 'Selecciona primero el texto que deseas extraer a una subpágina.',
        tone: 'info',
      });
      return;
    }
    const newTitle = await this.dialogs.prompt({
      title: 'Extraer selección a subpágina',
      label: 'Título de la nueva subpágina',
      placeholder: 'Ej. Gestión de errores…',
      confirmText: 'Extraer',
    });
    if (!newTitle) return;

    const currentPage = this.store.pages().find((p) => p.id === this.pageId());
    if (!currentPage) return;
    await this.flushSave();
    try {
      const { childPage, updatedSourceMarkdown } = await this.docOps.extractSelectionToSubpage(
        {
          ...currentPage,
          content: {
            pageId: currentPage.id,
            markdown: this.currentMarkdownSnapshot(),
            excerpt: '',
            wordCount: this.wordCount(),
            updatedAt: currentPage.updatedAt,
            updatedBy: currentPage.updatedBy,
          },
        },
        selectedText,
        newTitle,
      );
      this.applyFullMarkdown(updatedSourceMarkdown);
      this.snackbar.open({
        message: `Subpágina "${childPage.title}" creada y enlazada.`,
        tone: 'success',
      });
    } catch (err) {
      this.snackbar.open({
        message: err instanceof Error ? err.message : 'No se pudo extraer la selección.',
        tone: 'error',
      });
    }
  }

  protected async mergeWithAnother(): Promise<void> {
    const query = await this.dialogs.prompt({
      title: 'Fusionar esta página dentro de otra',
      label: 'Escribe parte del título de la página destino (esta página se archivará de forma segura)',
      placeholder: 'Ej. Arquitectura…',
      confirmText: 'Buscar destino',
    });
    if (!query) return;
    const candidates = this.store
      .pages()
      .filter((p) => p.status === 'active' && p.id !== this.pageId());
    const target = candidates.find((p) =>
      p.title.toLowerCase().includes(query.trim().toLowerCase()),
    );
    if (!target) {
      this.snackbar.open({ message: 'No se encontró una página destino con ese título.', tone: 'warning' });
      return;
    }
    const ok = await this.dialogs.confirm({
      title: 'Confirmar fusión de páginas',
      message: `Se anexará el contenido y etiquetas dentro de "${target.title}", se actualizarán las referencias internas y esta página quedará archivada (recuperable). ¿Continuar?`,
      confirmText: 'Fusionar',
    });
    if (!ok) return;

    await this.flushSave();
    const res = await this.docOps.mergePages(this.pageId(), target.id);
    this.snackbar.open({
      message: `Páginas fusionadas en "${target.title}" (${res.updatedReferencesCount} referencias actualizadas).`,
      tone: 'success',
    });
    await this.router.navigateByUrl(this.store.getCanonicalPath(target.id));
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
    this.editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
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

  protected onLinkHover(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (!href.startsWith('trazena://page/')) return;
    const targetId = href.slice('trazena://page/'.length);
    if (this.linkPreview()?.pageId === targetId) return;
    void this.loadLinkPreview(targetId);
  }

  private async loadLinkPreview(targetId: string): Promise<void> {
    const page = this.store.pages().find((p) => p.id === targetId && p.status !== 'deleted');
    if (!page) {
      this.linkPreview.set({
        pageId: targetId,
        title: 'Enlace roto',
        canonicalPath: `trazena://page/${targetId}`,
        excerpt: '',
        exists: false,
      });
      return;
    }
    const content = await this.idb.getPageContent(page.id);
    this.linkPreview.set({
      pageId: page.id,
      title: page.title,
      canonicalPath: this.store.getCanonicalPath(page.id),
      excerpt: content?.excerpt || content?.markdown.slice(0, 180) || '',
      exists: true,
    });
  }

  protected openLinkedPage(pageId: string, inOtherPane: boolean): void {
    const page = this.store.pages().find((p) => p.id === pageId && p.status !== 'deleted');
    this.linkPreview.set(null);
    if (!page) return;
    const path = this.store.getCanonicalPath(page.id);
    if (inOtherPane) {
      this.tabs.splitRight(page, path);
    } else {
      void this.router.navigateByUrl(path);
    }
  }

  protected onEditorClick(event: MouseEvent): void {
    const anchor = (event.target as HTMLElement | null)?.closest('a');
    const href = anchor?.getAttribute('href') ?? '';
    if (href.startsWith('trazena://page/')) {
      event.preventDefault();
      const targetId = href.slice('trazena://page/'.length);
      this.openLinkedPage(targetId, event.ctrlKey || event.metaKey);
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
    this.onEditorClick(event);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.flushSave();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      this.findBarOpen.set(true);
      return;
    }
    // Contextual '/' slash menu — never intercept inside code blocks!
    if (
      event.key === '/' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      this.mode() === 'visual' &&
      !this.isActive('codeBlock') &&
      !this.isActive('code')
    ) {
      const textBefore = this.editor?.state.selection.$from.parent.textContent ?? '';
      if (textBefore.trim().length === 0) {
        event.preventDefault();
        this.slashFilter.set('');
        this.slashMenuOpen.set(true);
      }
    }
  }

  protected formatDate(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  private getSelectedText(): string {
    if (this.mode() === 'source') {
      return window.getSelection()?.toString() ?? '';
    }
    if (!this.editor) return '';
    const { from, to } = this.editor.state.selection;
    return this.editor.state.doc.textBetween(from, to, '\n');
  }

  private currentMarkdownSnapshot(): string {
    return this.mode() === 'visual' ? this.getMarkdownFromTiptap() : this.sourceMarkdown();
  }

  private applyFullMarkdown(md: string): void {
    this.sourceMarkdown.set(md);
    if (this.editor) {
      this.editor.commands.setContent(md, { emitUpdate: false });
    }
    if (this.mode() === 'preview') {
      this.refreshPreview();
    }
    this.updateWordCount();
  }

  private getMarkdownFromTiptap(): string {
    const storage = this.editor?.storage as MarkdownStorage | undefined;
    return storage?.markdown?.getMarkdown() ?? this.sourceMarkdown();
  }

  private updateWordCount(): void {
    const text =
      this.mode() === 'visual'
        ? (this.editor?.getText().trim() ?? '')
        : this.sourceMarkdown().trim();
    this.wordCount.set(text ? text.split(/\s+/).length : 0);
  }

  private scheduleSave(): void {
    this.store.markPendingSave();
    this.updater.setUnsavedEditorDraft(true);
    const currentPage = this.store.pages().find((p) => p.id === this.pageId());
    void this.drafts.saveDraft(
      this.pageId(),
      currentPage?.title ?? 'Documento',
      this.currentMarkdownSnapshot(),
      this.activeRevision,
    );

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
    const markdown = this.currentMarkdownSnapshot();
    const result = await this.store.savePageContent(
      this.pageId(),
      markdown,
      this.activeRevision,
    );
    this.updater.setUnsavedEditorDraft(false);
    if (result) {
      this.activeRevision = result.revision;
      await this.drafts.clearDraft(this.pageId());
      this.recoverableDraft.set(null);
      this.search.upsertPage(result, result.content.markdown);
      void this.meta.updateBacklinksForPage(result.id, result.content.markdown);
      this.saved.emit({ revision: result.revision, markdown: result.content.markdown });
    }
  }
}
