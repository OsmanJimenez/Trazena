import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type {
  Page,
  PropertyDefinition,
  PropertyType,
} from '@trazena/shared';
import { AtralumeButton } from '@osmanjimenez/atralume/button';
import { AtralumeSnackbar } from '@osmanjimenez/atralume/snackbar';
import { KnowledgeMetaService } from '../../core/knowledge/knowledge-meta.service';
import { SearchEngineService } from '../../core/search/search-engine.service';
import { KnowledgeStore } from '../../core/state/knowledge.store';

@Component({
  selector: 'trz-page-knowledge-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, AtralumeButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="kp-panel">
      <!-- Tags -->
      <div class="kp-row">
        <span class="kp-label">Etiquetas</span>
        <div class="kp-tags">
          @for (tag of pageTags(); track tag.id) {
            <span class="tag-chip" [style.borderColor]="tag.color">
              #{{ tag.name }}
              <button type="button" (click)="removeTag(tag.id)" aria-label="Quitar etiqueta">×</button>
            </span>
          }
          <input
            type="text"
            class="tag-input"
            placeholder="+ Añadir etiqueta (Enter)…"
            [(ngModel)]="newTagName"
            (keydown.enter)="addTag()"
          />
        </div>
      </div>

      <!-- Custom Properties -->
      <div class="kp-row">
        <div class="kp-prop-head">
          <span class="kp-label">Propiedades</span>
          <button type="button" class="link-btn" (click)="addingProp.set(!addingProp())">
            + Nueva propiedad
          </button>
        </div>

        @if (addingProp()) {
          <div class="new-prop-form">
            <input type="text" placeholder="Nombre (ej. Prioridad)" [(ngModel)]="newPropName" />
            <select [(ngModel)]="newPropType">
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="date">Fecha</option>
              <option value="boolean">Booleano</option>
              <option value="select">Selección</option>
              <option value="multi-select">Selección múltiple</option>
            </select>
            @if (newPropType === 'select' || newPropType === 'multi-select') {
              <input
                type="text"
                placeholder="Opciones separadas por coma"
                [(ngModel)]="newPropOptions"
              />
            }
            <button atrButton type="button" size="small" appearance="filled" (click)="createProperty()">Crear</button>
          </div>
        }

        @if (orgProps().length > 0) {
          <div class="props-grid">
            @for (def of orgProps(); track def.id) {
              <label class="prop-item">
                <span>{{ def.name }}</span>
                @if (def.type === 'boolean') {
                  <input
                    type="checkbox"
                    [checked]="getPropBool(def.id)"
                    (change)="setProp(def, $any($event.target).checked)"
                  />
                } @else if (def.type === 'select') {
                  <select [ngModel]="getPropStr(def.id)" (ngModelChange)="setProp(def, $event)">
                    <option value="">—</option>
                    @for (opt of def.options; track opt) {
                      <option [value]="opt">{{ opt }}</option>
                    }
                  </select>
                } @else if (def.type === 'date') {
                  <input type="date" [ngModel]="getPropStr(def.id)" (ngModelChange)="setProp(def, $event)" />
                } @else if (def.type === 'number') {
                  <input type="number" [ngModel]="getPropStr(def.id)" (ngModelChange)="setProp(def, $event)" />
                } @else {
                  <input
                    type="text"
                    placeholder="Valor…"
                    [ngModel]="getPropStr(def.id)"
                    (ngModelChange)="setProp(def, $event)"
                  />
                }
              </label>
            }
          </div>
        }
      </div>

      <!-- TOC + Backlinks side by side when available -->
      @if (toc().length > 0 || backlinks().length > 0) {
        <div class="kp-split">
          @if (toc().length > 0) {
            <div class="kp-sub">
              <span class="kp-label">Tabla de contenidos</span>
              <ul class="toc-list">
                @for (h of toc(); track h.id) {
                  <li [style.paddingLeft.px]="(h.level - 1) * 12">
                    <button type="button" class="toc-btn" (click)="scrollToHeading(h.text)">
                      {{ h.text }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          }

          <div class="kp-sub">
            <span class="kp-label">Referencias inversas (Backlinks · {{ backlinks().length }})</span>
            @if (backlinks().length > 0) {
              <ul class="bl-list">
                @for (bl of backlinks(); track bl.sourcePageId) {
                  <li>
                    <a [routerLink]="store.getCanonicalPath(bl.sourcePageId)">
                      {{ pageTitle(bl.sourcePageId) }}
                    </a>
                  </li>
                }
              </ul>
            } @else {
              <p class="empty-bl">Ninguna página enlaza a este documento todavía.</p>
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .kp-panel {
      display: flex; flex-direction: column; gap: 0.75rem;
      padding: 0.85rem 1rem;
      border: 1px solid var(--trz-border);
      border-radius: var(--trz-radius-md);
      background: var(--trz-bg-subtle);
      font-size: 0.83rem;
    }
    .kp-row { display: flex; flex-direction: column; gap: 0.45rem; }
    .kp-prop-head { display: flex; justify-content: space-between; align-items: center; }
    .kp-label { font-size: 0.71rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--trz-text-subtle); }
    .link-btn {
      appearance: none; border: 0; background: transparent; color: var(--trz-accent);
      font: inherit; font-size: 0.78rem; cursor: pointer; &:hover { text-decoration: underline; }
    }
    .kp-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem; }
    .tag-chip {
      display: inline-flex; align-items: center; gap: 0.3rem;
      padding: 0.14rem 0.5rem; border-radius: 999px;
      background: var(--trz-bg); border: 1px solid var(--trz-border-strong); font-size: 0.76rem;
      button { appearance: none; border: 0; background: transparent; color: var(--trz-text-subtle); cursor: pointer; padding: 0; }
    }
    .tag-input {
      border: 1px dashed var(--trz-border-strong); border-radius: 999px;
      background: var(--trz-bg); color: var(--trz-text); padding: 0.18rem 0.6rem;
      font: inherit; font-size: 0.78rem; width: 175px; outline: none;
      &:focus { border-style: solid; border-color: var(--trz-accent); }
    }
    .new-prop-form {
      display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center;
      input {
        height: 32px; padding: 0 0.6rem; border: 1px solid var(--trz-border-strong);
        border-radius: 6px; background: var(--trz-bg); color: var(--trz-text); font: inherit; font-size: 0.82rem;
      }
    }
    .props-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 0.55rem; }
    .prop-item {
      display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: var(--trz-text-muted);
      input:not([type="checkbox"]) {
        height: 30px; padding: 0 0.55rem; border: 1px solid var(--trz-border-strong);
        border-radius: 6px; background: var(--trz-bg); color: var(--trz-text); font: inherit; font-size: 0.82rem;
      }
    }
    .kp-split {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem;
      padding-top: 0.55rem; border-top: 1px solid var(--trz-border);
    }
    .kp-sub { display: flex; flex-direction: column; gap: 0.35rem; }
    .toc-list, .bl-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.2rem; }
    .toc-btn {
      appearance: none; border: 0; background: transparent; color: var(--trz-text-muted);
      font: inherit; font-size: 0.8rem; cursor: pointer; text-align: left; padding: 0.1rem 0;
      &:hover { color: var(--trz-accent); text-decoration: underline; }
    }
    .bl-list a { color: var(--trz-accent); text-decoration: none; font-size: 0.82rem; &:hover { text-decoration: underline; } }
    .empty-bl { margin: 0; font-size: 0.78rem; color: var(--trz-text-subtle); }
  `,
})
export class PageKnowledgePanelComponent {
  readonly page = input.required<Page>();
  readonly markdown = input.required<string>();

  protected readonly store = inject(KnowledgeStore);
  protected readonly meta = inject(KnowledgeMetaService);
  private readonly search = inject(SearchEngineService);
  private readonly snackbar = inject(AtralumeSnackbar);

  protected newTagName = '';
  protected readonly addingProp = signal(false);
  protected newPropName = '';
  protected newPropType: PropertyType = 'text';
  protected newPropOptions = '';

  protected readonly pageTags = computed(() => this.meta.getTagsForPage(this.page().id));
  protected readonly orgProps = computed(() =>
    this.meta.getPropertyDefinitionsForOrg(this.page().organizationId),
  );
  protected readonly toc = computed(() => this.meta.extractTocHeadings(this.markdown()));
  protected readonly backlinks = computed(() => this.meta.getBacklinksForPage(this.page().id));

  protected async addTag(): Promise<void> {
    const trimmed = this.newTagName.trim();
    if (!trimmed) return;
    const p = this.page();
    const tag = await this.meta.createOrGetTag(p.organizationId, trimmed);
    await this.meta.assignTagToPage(p, tag.id);
    this.newTagName = '';
    this.search.upsertPage(p, this.markdown());
  }

  protected async removeTag(tagId: string): Promise<void> {
    const p = this.page();
    await this.meta.removeTagFromPage(p.id, tagId, p.organizationId);
    this.search.upsertPage(p, this.markdown());
  }

  protected async createProperty(): Promise<void> {
    if (!this.newPropName.trim()) return;
    const opts = this.newPropOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await this.meta.createPropertyDefinition(
      this.page().organizationId,
      this.newPropName,
      this.newPropType,
      opts,
    );
    this.newPropName = '';
    this.newPropOptions = '';
    this.addingProp.set(false);
    this.snackbar.open({ message: 'Propiedad personalizada creada.', tone: 'success' });
  }

  protected getPropStr(propId: string): string {
    const v = this.meta.getPropertyValue(this.page().id, propId);
    if (Array.isArray(v)) return v.join(', ');
    return v === null || v === undefined ? '' : String(v);
  }

  protected getPropBool(propId: string): boolean {
    return this.meta.getPropertyValue(this.page().id, propId) === true;
  }

  protected async setProp(def: PropertyDefinition, raw: unknown): Promise<void> {
    const p = this.page();
    let val: import('@trazena/shared').PropertyScalarValue = null;
    if (def.type === 'boolean') val = Boolean(raw);
    else if (def.type === 'number') val = raw === '' ? null : Number(raw);
    else if (def.type === 'multi-select') {
      val = String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      val = String(raw ?? '') || null;
    }
    await this.meta.setPropertyValue(p, def.id, val);
    this.search.upsertPage(p, this.markdown());
  }

  protected pageTitle(pageId: string): string {
    return this.store.pages().find((p) => p.id === pageId)?.title ?? 'Página';
  }

  protected scrollToHeading(text: string): void {
    const headings = document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6');
    for (const el of Array.from(headings)) {
      if (el.textContent?.trim() === text) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        break;
      }
    }
  }
}
