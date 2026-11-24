import { Injectable, computed, inject, signal } from '@angular/core';
import {
  generateNextPosition,
  slugify,
  type DocumentTemplate,
  type InternalLinkRef,
  type Page,
  type PageContent,
  type PageTag,
  type PropertyDefinition,
  type PropertyScalarValue,
  type PropertyType,
  type PropertyValue,
  type RecentVisit,
  type SavedView,
  type Tag,
  type TocHeading,
  type UserFavorite,
} from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';

const TAG_PALETTE = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#c2410c',
  '#b45309',
  '#047857',
  '#be123c',
  '#475569',
];

function normalizeTagName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Manages Tags, Custom Properties, Favorites, Recents, Saved Views,
 * Editable Templates, TOC extraction, Internal Links, and Backlinks.
 * All writes are Local-First atomic IndexedDB writes integrated with Trazena Sync Outbox.
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeMetaService {
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(TrazenaSyncService);

  private readonly _tags = signal<Tag[]>([]);
  private readonly _pageTags = signal<PageTag[]>([]);
  private readonly _propertyDefs = signal<PropertyDefinition[]>([]);
  private readonly _propertyValues = signal<PropertyValue[]>([]);
  private readonly _savedViews = signal<SavedView[]>([]);
  private readonly _templates = signal<DocumentTemplate[]>([]);
  private readonly _favorites = signal<UserFavorite[]>([]);
  private readonly _recents = signal<RecentVisit[]>([]);
  private readonly _backlinkIndex = signal<Map<string, InternalLinkRef[]>>(new Map());
  private readonly _initialized = signal(false);

  readonly tags = this._tags.asReadonly();
  readonly pageTags = this._pageTags.asReadonly();
  readonly propertyDefinitions = this._propertyDefs.asReadonly();
  readonly propertyValues = this._propertyValues.asReadonly();
  readonly savedViews = computed(() =>
    this._savedViews().filter((v) => v.status === 'active'),
  );
  readonly templates = computed(() =>
    this._templates().filter((t) => t.status === 'active'),
  );
  readonly favorites = this._favorites.asReadonly();
  readonly recents = computed(() =>
    [...this._recents()]
      .sort((a, b) => b.visitedAt.localeCompare(a.visitedAt))
      .slice(0, 12),
  );

  private get ownerUid(): string {
    return this.auth.user()?.uid ?? 'local-owner';
  }

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.idb.ensureOpen();
    await this.reloadAll();
    if (this._templates().length === 0) {
      await this.seedStarterTemplates();
    }
    await this.rebuildBacklinksIndex();
    this._initialized.set(true);
  }

  async reloadAll(): Promise<void> {
    const uid = this.ownerUid;
    const [tags, pageTags, propDefs, propVals, views, templates, favs, recents] =
      await Promise.all([
        this.idb.getAll<Tag>('tags'),
        this.idb.getAll<PageTag>('page_tags'),
        this.idb.getAll<PropertyDefinition>('property_definitions'),
        this.idb.getAll<PropertyValue>('property_values'),
        this.idb.getAll<SavedView>('saved_views'),
        this.idb.getAll<DocumentTemplate>('templates'),
        this.idb.getAll<UserFavorite>('favorites'),
        this.idb.getAll<RecentVisit>('recent_visits'),
      ]);

    this._tags.set(tags.filter((t) => t.status !== 'deleted'));
    this._pageTags.set(pageTags);
    this._propertyDefs.set(propDefs.filter((p) => p.status !== 'deleted'));
    this._propertyValues.set(propVals);
    this._savedViews.set(views);
    this._templates.set(templates);
    this._favorites.set(favs.filter((f) => f.ownerUid === uid));
    this._recents.set(recents.filter((r) => r.ownerUid === uid));
  }

  // --- Tags ---

  getTagsForOrg(orgId: string): Tag[] {
    return this._tags()
      .filter((t) => t.organizationId === orgId && t.status === 'active')
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getTagsForPage(pageId: string): Tag[] {
    const ids = new Set(
      this._pageTags()
        .filter((pt) => pt.pageId === pageId)
        .map((pt) => pt.tagId),
    );
    return this._tags().filter((t) => ids.has(t.id) && t.status === 'active');
  }

  async createOrGetTag(orgId: string, name: string, color?: string): Promise<Tag> {
    const trimmed = name.trim();
    const normalized = normalizeTagName(trimmed);
    const existing = this._tags().find(
      (t) => t.organizationId === orgId && t.normalizedName === normalized && t.status === 'active',
    );
    if (existing) return existing;

    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const tag: Tag = {
      id: crypto.randomUUID(),
      organizationId: orgId,
      name: trimmed,
      normalizedName: normalized,
      color: color ?? TAG_PALETTE[this._tags().length % TAG_PALETTE.length],
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await this.idb.commitAtomicWithOutbox('tags', tag, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'tag',
      entityId: tag.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...tag },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._tags.update((list) => [...list, tag]);
    await this.sync.refreshState();
    return tag;
  }

  async renameTag(tagId: string, nextName: string): Promise<void> {
    const current = this._tags().find((t) => t.id === tagId);
    if (!current || !nextName.trim()) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const updated: Tag = {
      ...current,
      name: nextName.trim(),
      normalizedName: normalizeTagName(nextName),
      updatedAt: now,
    };
    await this.idb.commitAtomicWithOutbox('tags', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'tag',
      entityId: updated.id,
      operation: 'update',
      baseRevision: null,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._tags.update((list) => list.map((t) => (t.id === tagId ? updated : t)));
    await this.sync.refreshState();
  }

  async ensureTag(orgId: string, name: string, color?: string): Promise<Tag> {
    return this.createOrGetTag(orgId, name, color);
  }

  async deleteTag(tagId: string): Promise<void> {
    const current = this._tags().find((t) => t.id === tagId);
    if (!current) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const deleted: Tag = { ...current, status: 'deleted', updatedAt: now };
    await this.idb.commitAtomicWithOutbox('tags', deleted, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'tag',
      entityId: deleted.id,
      operation: 'delete',
      baseRevision: null,
      payload: { ...deleted },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._tags.update((list) => list.filter((t) => t.id !== tagId));
    await this.sync.refreshState();
  }

  async assignTagToPage(page: Pick<Page, 'id' | 'organizationId'>, tagId: string): Promise<void> {
    const id = `${page.id}:${tagId}`;
    if (this._pageTags().some((pt) => pt.id === id)) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const rel: PageTag = {
      id,
      pageId: page.id,
      tagId,
      organizationId: page.organizationId,
      createdAt: now,
    };
    await this.idb.commitAtomicWithOutbox('page_tags', rel, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page_tag',
      entityId: rel.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...rel },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._pageTags.update((list) => [...list, rel]);
    await this.sync.refreshState();
  }

  async removeTagFromPage(pageId: string, tagId: string, organizationId: string): Promise<void> {
    const id = `${pageId}:${tagId}`;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    await this.idb.delete('page_tags', id);
    await this.idb.put('sync_outbox', {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page_tag' as const,
      entityId: id,
      operation: 'delete' as const,
      baseRevision: null,
      payload: { id, pageId, tagId, organizationId },
      createdAt: now,
      updatedAt: now,
      status: 'pending' as const,
    });
    this._pageTags.update((list) => list.filter((pt) => pt.id !== id));
    await this.sync.refreshState();
  }

  // --- Custom Properties ---

  getPropertyDefinitionsForOrg(orgId: string): PropertyDefinition[] {
    return this._propertyDefs()
      .filter((d) => d.organizationId === orgId && d.status === 'active')
      .sort((a, b) => a.position.localeCompare(b.position));
  }

  getPropertyValue(pageId: string, propertyId: string): PropertyScalarValue {
    const found = this._propertyValues().find(
      (v) => v.pageId === pageId && v.propertyId === propertyId,
    );
    return found?.value ?? null;
  }

  getPropertyValuesForPage(pageId: string): PropertyValue[] {
    return this._propertyValues().filter((v) => v.pageId === pageId);
  }

  async createPropertyDefinition(
    orgId: string,
    name: string,
    type: PropertyType,
    options: string[] = [],
  ): Promise<PropertyDefinition> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const existing = this.getPropertyDefinitionsForOrg(orgId);
    const def: PropertyDefinition = {
      id: crypto.randomUUID(),
      organizationId: orgId,
      name: name.trim(),
      type,
      options: options.map((o) => o.trim()).filter(Boolean),
      position: generateNextPosition(existing.map((e) => e.position)),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.idb.commitAtomicWithOutbox('property_definitions', def, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'property_definition',
      entityId: def.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...def },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._propertyDefs.update((list) => [...list, def]);
    await this.sync.refreshState();
    return def;
  }

  async setPropertyValue(
    page: Pick<Page, 'id' | 'organizationId'>,
    propertyId: string,
    value: PropertyScalarValue,
  ): Promise<void> {
    const def = this._propertyDefs().find((d) => d.id === propertyId);
    if (!def || def.organizationId !== page.organizationId) return;

    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const record: PropertyValue = {
      id: `${page.id}:${propertyId}`,
      pageId: page.id,
      propertyId,
      organizationId: page.organizationId,
      value,
      updatedAt: now,
    };

    await this.idb.commitAtomicWithOutbox('property_values', record, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'property_value',
      entityId: record.id,
      operation: 'update',
      baseRevision: null,
      payload: { ...record },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._propertyValues.update((list) => {
      const exists = list.some((v) => v.id === record.id);
      return exists ? list.map((v) => (v.id === record.id ? record : v)) : [...list, record];
    });
    await this.sync.refreshState();
  }

  // --- Favorites (per-user preference) & Recents (strictly local) ---

  isFavorite(pageId: string): boolean {
    return this._favorites().some((f) => f.pageId === pageId);
  }

  async toggleFavorite(pageId: string): Promise<boolean> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const id = `${uid}:${pageId}`;
    const now = new Date().toISOString();

    if (this.isFavorite(pageId)) {
      await this.idb.delete('favorites', id);
      await this.idb.put('sync_outbox', {
        operationId: crypto.randomUUID(),
        deviceId: device.deviceId,
        ownerUid: uid,
        entityType: 'favorite' as const,
        entityId: id,
        operation: 'delete' as const,
        baseRevision: null,
        payload: { id, pageId },
        createdAt: now,
        updatedAt: now,
        status: 'pending' as const,
      });
      this._favorites.update((list) => list.filter((f) => f.id !== id));
      await this.sync.refreshState();
      return false;
    }

    const fav: UserFavorite = { id, ownerUid: uid, pageId, createdAt: now };
    await this.idb.commitAtomicWithOutbox('favorites', fav, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'favorite',
      entityId: fav.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...fav },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._favorites.update((list) => [...list, fav]);
    await this.sync.refreshState();
    return true;
  }

  /**
   * Local-only visit tracker. Never creates Outbox entries or pollutes version history.
   */
  async recordRecentVisit(pageId: string): Promise<void> {
    const uid = this.ownerUid;
    const visit: RecentVisit = {
      id: `${uid}:${pageId}`,
      ownerUid: uid,
      pageId,
      visitedAt: new Date().toISOString(),
    };
    await this.idb.put('recent_visits', visit);
    this._recents.update((list) => {
      const filtered = list.filter((r) => r.id !== visit.id);
      return [visit, ...filtered].slice(0, 20);
    });
  }

  // --- Saved Views ---

  async saveView(view: Omit<SavedView, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<SavedView> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const record: SavedView = {
      ...view,
      id: crypto.randomUUID(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    await this.idb.commitAtomicWithOutbox('saved_views', record, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'saved_view',
      entityId: record.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...record },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._savedViews.update((list) => [...list, record]);
    await this.sync.refreshState();
    return record;
  }

  async deleteSavedView(viewId: string): Promise<void> {
    const current = this._savedViews().find((v) => v.id === viewId);
    if (!current) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const deleted: SavedView = { ...current, status: 'deleted', updatedAt: now };
    await this.idb.commitAtomicWithOutbox('saved_views', deleted, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'saved_view',
      entityId: deleted.id,
      operation: 'delete',
      baseRevision: null,
      payload: { ...deleted },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._savedViews.update((list) => list.map((v) => (v.id === viewId ? deleted : v)));
    await this.sync.refreshState();
  }

  // --- Templates (editable, offline-first, safe {{title}} and {{date}} substitution) ---

  renderTemplateMarkdown(template: DocumentTemplate, title: string): string {
    const today = new Date().toISOString().slice(0, 10);
    return template.markdown
      .replace(/\{\{\s*title\s*\}\}/g, title)
      .replace(/\{\{\s*date\s*\}\}/g, today);
  }

  async saveTemplate(
    input: Partial<DocumentTemplate> & { name: string; markdown: string },
  ): Promise<DocumentTemplate> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const existing = input.id ? this._templates().find((t) => t.id === input.id) : undefined;
    const record: DocumentTemplate = {
      id: existing?.id ?? crypto.randomUUID(),
      organizationId: input.organizationId ?? existing?.organizationId ?? null,
      name: input.name.trim(),
      category: input.category?.trim() || existing?.category || 'General',
      description: input.description?.trim() ?? existing?.description ?? '',
      markdown: input.markdown,
      status: 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.idb.commitAtomicWithOutbox('templates', record, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'template',
      entityId: record.id,
      operation: existing ? 'update' : 'create',
      baseRevision: null,
      payload: { ...record },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._templates.update((list) =>
      existing ? list.map((t) => (t.id === record.id ? record : t)) : [...list, record],
    );
    await this.sync.refreshState();
    return record;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const current = this._templates().find((t) => t.id === templateId);
    if (!current) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const deleted: DocumentTemplate = { ...current, status: 'deleted', updatedAt: now };
    await this.idb.commitAtomicWithOutbox('templates', deleted, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'template',
      entityId: deleted.id,
      operation: 'delete',
      baseRevision: null,
      payload: { ...deleted },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });
    this._templates.update((list) => list.map((t) => (t.id === templateId ? deleted : t)));
    await this.sync.refreshState();
  }

  // --- TOC, Internal Links (`[[Label|page:ID]]`) & Backlinks ---

  extractTocHeadings(markdown: string): TocHeading[] {
    const lines = markdown.split('\n');
    const headings: TocHeading[] = [];
    let inCodeBlock = false;
    const usedIds = new Map<string, number>();

    for (const line of lines) {
      if (/^```/.test(line.trim())) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (!m) continue;
      const level = m[1].length;
      const text = m[2].replace(/[*_`~]/g, '').trim();
      if (!text) continue;
      const base = slugify(text, 'section');
      const count = usedIds.get(base) ?? 0;
      usedIds.set(base, count + 1);
      headings.push({
        id: count === 0 ? base : `${base}-${count + 1}`,
        level,
        text,
      });
    }
    return headings;
  }

  extractInternalLinks(sourcePageId: string, markdown: string): InternalLinkRef[] {
    const refs: InternalLinkRef[] = [];
    const seen = new Set<string>();
    // Supports [Label](trazena://page/<id>) and [[Label|page:<id>]]
    const mdLinkRe = /\[([^\]]+)\]\(trazena:\/\/page\/([a-zA-Z0-9-]+)\)/g;
    const wikiRe = /\[\[([^|\]]+)\|page:([a-zA-Z0-9-]+)\]\]/g;

    for (const re of [mdLinkRe, wikiRe]) {
      let match: RegExpExecArray | null;
      while ((match = re.exec(markdown)) !== null) {
        const targetPageId = match[2];
        if (targetPageId === sourcePageId || seen.has(targetPageId)) continue;
        seen.add(targetPageId);
        refs.push({
          sourcePageId,
          targetPageId,
          label: match[1].trim(),
        });
      }
    }
    return refs;
  }

  getBacklinksForPage(targetPageId: string): InternalLinkRef[] {
    return this._backlinkIndex().get(targetPageId) ?? [];
  }

  async updateBacklinksForPage(sourcePageId: string, markdown: string): Promise<void> {
    const refs = this.extractInternalLinks(sourcePageId, markdown);
    this._backlinkIndex.update((prev) => {
      const next = new Map<string, InternalLinkRef[]>();
      for (const [targetId, list] of prev.entries()) {
        const filtered = list.filter((r) => r.sourcePageId !== sourcePageId);
        if (filtered.length > 0) next.set(targetId, filtered);
      }
      for (const ref of refs) {
        const list = next.get(ref.targetPageId) ?? [];
        list.push(ref);
        next.set(ref.targetPageId, list);
      }
      return next;
    });
  }

  async rebuildBacklinksIndex(): Promise<void> {
    const contents = await this.idb.getAll<PageContent>('page_contents');
    const map = new Map<string, InternalLinkRef[]>();
    for (const c of contents) {
      const refs = this.extractInternalLinks(c.pageId, c.markdown);
      for (const ref of refs) {
        const list = map.get(ref.targetPageId) ?? [];
        list.push(ref);
        map.set(ref.targetPageId, list);
      }
    }
    this._backlinkIndex.set(map);
  }

  private async seedStarterTemplates(): Promise<void> {
    const now = new Date().toISOString();
    const starters: DocumentTemplate[] = [
      {
        id: 'tpl-tech-doc',
        organizationId: null,
        name: 'Documentación técnica',
        category: 'Ingeniería',
        description: 'Estructura clara para módulos, servicios y APIs.',
        markdown: `# {{title}}\n\n**Fecha:** {{date}}\n\n## Propósito\nDescribe el objetivo y alcance del componente o servicio.\n\n## Arquitectura\n\n| Componente | Responsabilidad |\n| --- | --- |\n| Módulo A | Descripción |\n\n## Uso y ejemplos\n\n\`\`\`typescript\n// Ejemplo de uso\n\`\`\`\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-adr',
        organizationId: null,
        name: 'Decisión arquitectónica (ADR)',
        category: 'Arquitectura',
        description: 'Registro de contexto, decisión y consecuencias.',
        markdown: `# ADR: {{title}}\n\n- **Fecha:** {{date}}\n- **Estado:** Propuesta\n\n## Contexto\n¿Qué problema o restricción motiva esta decisión?\n\n## Decisión\nDescribe la solución elegida.\n\n## Consecuencias\n- Positivas:\n- Riesgos / compromisos:\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-deploy',
        organizationId: null,
        name: 'Manual de despliegue',
        category: 'Operaciones',
        description: 'Pasos reproducibles de release y rollback.',
        markdown: `# Manual de despliegue — {{title}}\n\n**Actualizado:** {{date}}\n\n## Prerrequisitos\n- [ ] Variables de entorno verificadas\n- [ ] Migraciones aplicadas\n\n## Pasos de despliegue\n1. Compilar artefactos\n2. Validar smoke test\n\n## Plan de rollback\nDescribe cómo revertir de forma segura.\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-user-story',
        organizationId: null,
        name: 'Historia de usuario',
        category: 'Producto',
        description: 'Objetivo funcional y criterios de aceptación.',
        markdown: `# {{title}}\n\n**Fecha:** {{date}}\n\n## Historia\nComo **usuario**, quiero **…** para **…**.\n\n## Criterios de aceptación\n- [ ] Criterio 1\n- [ ] Criterio 2\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-incident',
        organizationId: null,
        name: 'Incidente técnico (Postmortem)',
        category: 'Operaciones',
        description: 'Línea de tiempo, causa raíz y acciones preventivas.',
        markdown: `# Incidente: {{title}}\n\n- **Fecha:** {{date}}\n- **Impacto:** Bajo / Medio / Alto\n\n## Resumen\n\n## Causa raíz\n\n## Acciones correctivas\n- [ ] Acción 1\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-component',
        organizationId: null,
        name: 'Documentación de componente',
        category: 'Design System',
        description: 'API, propiedades, accesibilidad y ejemplos.',
        markdown: `# Componente: {{title}}\n\n**Fecha:** {{date}}\n\n## API Pública\n\n| Input / Output | Tipo | Descripción |\n| --- | --- | --- |\n| \`label\` | \`string\` | Etiqueta accesible |\n\n## Accesibilidad\n- Navegación por teclado\n- Roles ARIA\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-learning',
        organizationId: null,
        name: 'Nota de aprendizaje',
        category: 'Personal',
        description: 'Resumen de conceptos, ejemplos y referencias.',
        markdown: `# {{title}}\n\n**Fecha:** {{date}}\n\n## Ideas clave\n- \n\n## Ejemplos prácticos\n\n## Referencias\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tpl-meeting',
        organizationId: null,
        name: 'Acta de reunión',
        category: 'Gestión',
        description: 'Agenda, acuerdos y tareas asignadas.',
        markdown: `# Reunión: {{title}}\n\n**Fecha:** {{date}}\n\n## Agenda\n1. \n\n## Acuerdos\n- \n\n## Próximos pasos\n- [ ] Tarea 1\n`,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ];
    await this.idb.putMany('templates', starters);
    this._templates.set(starters);
  }
}
