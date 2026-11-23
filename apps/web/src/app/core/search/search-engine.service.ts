import { Injectable, inject, signal } from '@angular/core';
import MiniSearch from 'minisearch';
import {
  collectDescendantIds,
  type ExplorerGroupBy,
  type ExplorerSortBy,
  type FilterCondition,
  type FilterGroup,
  type Organization,
  type Page,
  type PageContent,
  type Workspace,
} from '@trazena/shared';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';

interface IndexedDoc {
  id: string;
  organizationId: string;
  workspaceId: string;
  orgName: string;
  wsName: string;
  title: string;
  headings: string;
  tagsText: string;
  propertiesText: string;
  markdown: string;
}

export interface EnrichedSearchResult {
  page: Page;
  organization: Organization;
  workspace: Workspace;
  canonicalPath: string;
  score: number;
  snippetHtml: string;
  matchedHeading: string | null;
  tags: import('@trazena/shared').Tag[];
  isFavorite: boolean;
  isPendingSync: boolean;
}

export interface GroupedExplorerResults {
  groupKey: string;
  groupLabel: string;
  items: EnrichedSearchResult[];
}

function normalizeTerm(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Local-First Full-Text Search & Content Explorer Engine powered by MiniSearch.
 * Works 100% offline from IndexedDB, supports Spanish accent folding, weighted ranking,
 * incremental index updates, AND/OR filters, sorting, grouping, and XSS-safe snippets.
 */
@Injectable({ providedIn: 'root' })
export class SearchEngineService {
  private readonly idb = inject(IndexedDbService);
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly sync = inject(TrazenaSyncService);

  private miniSearch: MiniSearch<IndexedDoc> | null = null;
  private contentCache = new Map<string, string>();
  private indexBuilt = false;

  private readonly _recentQueries = signal<string[]>([]);
  readonly recentQueries = this._recentQueries.asReadonly();

  private createIndex(): MiniSearch<IndexedDoc> {
    return new MiniSearch<IndexedDoc>({
      fields: ['title', 'headings', 'tagsText', 'propertiesText', 'orgName', 'wsName', 'markdown'],
      storeFields: ['organizationId', 'workspaceId', 'title'],
      processTerm: (term) => {
        const clean = normalizeTerm(term).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
        return clean.length >= 2 ? clean : null;
      },
      searchOptions: {
        boost: {
          title: 5,
          headings: 3.2,
          tagsText: 2.8,
          propertiesText: 2.2,
          orgName: 1.6,
          wsName: 1.5,
          markdown: 1,
        },
        prefix: true,
        fuzzy: 0.2,
        combineWith: 'AND',
      },
    });
  }

  async ensureIndex(): Promise<void> {
    await this.store.initialize();
    await this.meta.initialize();
    if (this.indexBuilt && this.miniSearch) return;
    await this.rebuildIndex();
  }

  async rebuildIndex(): Promise<void> {
    this.miniSearch = this.createIndex();
    const contents = await this.idb.getAll<PageContent>('page_contents');
    this.contentCache = new Map(contents.map((c) => [c.pageId, c.markdown]));

    const docs: IndexedDoc[] = [];
    for (const page of this.store.pages()) {
      if (page.status === 'deleted') continue;
      docs.push(this.buildDoc(page, this.contentCache.get(page.id) ?? ''));
    }
    this.miniSearch.addAll(docs);
    this.indexBuilt = true;
  }

  /**
   * Incremental index update — avoids rebuilding the full index on single-page edits.
   */
  upsertPage(page: Page, markdown: string): void {
    if (!this.miniSearch || !this.indexBuilt) return;
    this.contentCache.set(page.id, markdown);
    if (this.miniSearch.has(page.id)) {
      this.miniSearch.discard(page.id);
    }
    if (page.status !== 'deleted') {
      this.miniSearch.add(this.buildDoc(page, markdown));
    }
  }

  removePage(pageId: string): void {
    this.contentCache.delete(pageId);
    if (this.miniSearch?.has(pageId)) {
      this.miniSearch.discard(pageId);
    }
  }

  recordQuery(query: string): void {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    this._recentQueries.update((list) =>
      [trimmed, ...list.filter((q) => q.toLowerCase() !== trimmed.toLowerCase())].slice(0, 6),
    );
  }

  async quickSearch(query: string, limit = 15): Promise<EnrichedSearchResult[]> {
    await this.ensureIndex();
    const results = await this.executeExplorerQuery({
      query,
      filterGroup: { combinator: 'AND', conditions: [] },
      sortBy: query.trim() ? 'relevance' : 'updated_desc',
      includeArchived: false,
    });
    return results.slice(0, limit);
  }

  async executeExplorerQuery(params: {
    query: string;
    filterGroup: FilterGroup;
    sortBy: ExplorerSortBy;
    includeArchived?: boolean;
  }): Promise<EnrichedSearchResult[]> {
    await this.ensureIndex();
    const q = params.query.trim();
    const scoreMap = new Map<string, number>();

    if (q.length >= 1 && this.miniSearch) {
      // Exact/prefix pass first (higher weight), then fuzzy fallback
      const exactHits = this.miniSearch.search(q, { fuzzy: false, prefix: true });
      for (const hit of exactHits) {
        scoreMap.set(hit.id, hit.score * 2);
      }
      const fuzzyHits = this.miniSearch.search(q, { fuzzy: 0.2, prefix: true, combineWith: 'OR' });
      for (const hit of fuzzyHits) {
        if (!scoreMap.has(hit.id)) {
          scoreMap.set(hit.id, hit.score);
        }
      }
    }

    const orgMap = new Map(this.store.organizations().map((o) => [o.id, o]));
    const wsMap = new Map(this.store.workspaces().map((w) => [w.id, w]));
    const pendingIds = new Set(
      this.sync.outbox().filter((m) => m.entityType === 'page').map((m) => m.entityId),
    );

    const hasExplicitStatusFilter = params.filterGroup.conditions.some(
      (c) => c.field === 'status',
    );

    const results: EnrichedSearchResult[] = [];

    for (const page of this.store.pages()) {
      if (page.status === 'deleted') continue;
      if (!hasExplicitStatusFilter && !params.includeArchived && page.status === 'archived') {
        continue;
      }

      const org = orgMap.get(page.organizationId);
      const ws = wsMap.get(page.workspaceId);
      if (!org || !ws) continue;

      const md = this.contentCache.get(page.id) ?? '';
      let score = scoreMap.get(page.id) ?? 0;

      // Substring fallback for technical tokens / short queries
      if (q.length >= 1 && score === 0) {
        const normQ = normalizeTerm(q);
        const inTitle = normalizeTerm(page.title).includes(normQ);
        const inMd = normalizeTerm(md).includes(normQ);
        if (!inTitle && !inMd) continue;
        score = inTitle ? 25 : 5;
      }

      const tags = this.meta.getTagsForPage(page.id);
      const isFav = this.meta.isFavorite(page.id);
      const isPending = pendingIds.has(page.id);

      if (
        params.filterGroup.conditions.length > 0 &&
        !this.evaluateFilterGroup(
          params.filterGroup,
          page,
          md,
          tags.map((t) => t.id),
          isFav,
          isPending,
        )
      ) {
        continue;
      }

      const { snippetHtml, matchedHeading } = this.buildSafeSnippet(md, q);

      results.push({
        page,
        organization: org,
        workspace: ws,
        canonicalPath: this.store.getCanonicalPath(page.id),
        score,
        snippetHtml,
        matchedHeading,
        tags,
        isFavorite: isFav,
        isPendingSync: isPending,
      });
    }

    return this.sortResults(results, params.sortBy);
  }

  groupResults(
    items: EnrichedSearchResult[],
    groupBy: ExplorerGroupBy,
  ): GroupedExplorerResults[] {
    if (groupBy === 'none') {
      return [{ groupKey: 'all', groupLabel: '', items }];
    }

    const map = new Map<string, GroupedExplorerResults>();
    const add = (key: string, label: string, item: EnrichedSearchResult) => {
      const group = map.get(key) ?? { groupKey: key, groupLabel: label, items: [] };
      group.items.push(item);
      map.set(key, group);
    };

    for (const item of items) {
      if (groupBy === 'organization') {
        add(item.organization.id, item.organization.name, item);
      } else if (groupBy === 'workspace') {
        add(item.workspace.id, `${item.organization.name} / ${item.workspace.name}`, item);
      } else if (groupBy === 'status') {
        const label = item.page.status === 'active' ? 'Activas' : 'Archivadas';
        add(item.page.status, label, item);
      } else if (groupBy === 'tag') {
        if (item.tags.length === 0) {
          add('untagged', 'Sin etiquetas', item);
        } else {
          for (const t of item.tags) add(t.id, `#${t.name}`, item);
        }
      }
    }

    return [...map.values()].sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
  }

  private buildDoc(page: Page, markdown: string): IndexedDoc {
    const org = this.store.organizations().find((o) => o.id === page.organizationId);
    const ws = this.store.workspaces().find((w) => w.id === page.workspaceId);
    const headings = this.meta
      .extractTocHeadings(markdown)
      .map((h) => h.text)
      .join(' ');
    const tagsText = this.meta
      .getTagsForPage(page.id)
      .map((t) => t.name)
      .join(' ');
    const propertiesText = this.meta
      .getPropertyValuesForPage(page.id)
      .map((v) => (Array.isArray(v.value) ? v.value.join(' ') : String(v.value ?? '')))
      .join(' ');

    return {
      id: page.id,
      organizationId: page.organizationId,
      workspaceId: page.workspaceId,
      orgName: org?.name ?? '',
      wsName: ws?.name ?? '',
      title: page.title,
      headings,
      tagsText,
      propertiesText,
      markdown,
    };
  }

  private evaluateFilterGroup(
    group: FilterGroup,
    page: Page,
    markdown: string,
    tagIds: string[],
    isFavorite: boolean,
    isPendingSync: boolean,
  ): boolean {
    if (group.conditions.length === 0) return true;
    const evalOne = (c: FilterCondition) =>
      this.evaluateCondition(c, page, markdown, tagIds, isFavorite, isPendingSync);
    return group.combinator === 'AND'
      ? group.conditions.every(evalOne)
      : group.conditions.some(evalOne);
  }

  private evaluateCondition(
    c: FilterCondition,
    page: Page,
    markdown: string,
    tagIds: string[],
    isFavorite: boolean,
    isPendingSync: boolean,
  ): boolean {
    const val = c.value;
    if (c.field === 'organizationId') {
      return c.operator === 'not_equals'
        ? page.organizationId !== val
        : page.organizationId === val;
    }
    if (c.field === 'workspaceId') {
      return c.operator === 'not_equals' ? page.workspaceId !== val : page.workspaceId === val;
    }
    if (c.field === 'parentId') {
      const descendants = new Set([
        val,
        ...collectDescendantIds(this.store.pages(), val),
      ]);
      return descendants.has(page.id);
    }
    if (c.field === 'status') {
      return c.operator === 'not_equals' ? page.status !== val : page.status === val;
    }
    if (c.field === 'favorite') {
      return c.operator === 'is_false' ? !isFavorite : isFavorite;
    }
    if (c.field === 'pendingSync') {
      return c.operator === 'is_false' ? !isPendingSync : isPendingSync;
    }
    if (c.field === 'tags') {
      const has = tagIds.includes(val);
      return c.operator === 'not_equals' ? !has : has;
    }
    if (c.field === 'title' || c.field === 'content') {
      const hay = normalizeTerm(c.field === 'title' ? page.title : markdown);
      const needle = normalizeTerm(val);
      if (c.operator === 'equals') return hay === needle;
      if (c.operator === 'not_contains') return !hay.includes(needle);
      return hay.includes(needle);
    }
    if (c.field === 'createdAt' || c.field === 'updatedAt') {
      const targetTs = Date.parse(c.field === 'createdAt' ? page.createdAt : page.updatedAt);
      const fromTs = Date.parse(val);
      if (!Number.isFinite(targetTs) || !Number.isFinite(fromTs)) return true;
      if (c.operator === 'before') return targetTs < fromTs;
      if (c.operator === 'after') return targetTs > fromTs;
      if (c.operator === 'between' && c.valueTo) {
        const toTs = Date.parse(c.valueTo) + 86_400_000;
        return targetTs >= fromTs && targetTs <= toTs;
      }
      return true;
    }
    if (c.field.startsWith('prop:')) {
      const propId = c.field.slice(5);
      const pv = this.meta.getPropertyValue(page.id, propId);
      if (c.operator === 'is_true') return pv === true;
      if (c.operator === 'is_false') return pv !== true;
      if (Array.isArray(pv)) {
        const has = pv.some((x) => normalizeTerm(x) === normalizeTerm(val));
        return c.operator === 'not_equals' ? !has : has;
      }
      const str = normalizeTerm(String(pv ?? ''));
      const needle = normalizeTerm(val);
      if (c.operator === 'equals') return str === needle;
      if (c.operator === 'not_equals') return str !== needle;
      if (c.operator === 'not_contains') return !str.includes(needle);
      return str.includes(needle);
    }
    return true;
  }

  private sortResults(
    items: EnrichedSearchResult[],
    sortBy: ExplorerSortBy,
  ): EnrichedSearchResult[] {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.score - a.score || b.page.updatedAt.localeCompare(a.page.updatedAt);
        case 'title_asc':
          return a.page.title.localeCompare(b.page.title);
        case 'title_desc':
          return b.page.title.localeCompare(a.page.title);
        case 'updated_asc':
          return a.page.updatedAt.localeCompare(b.page.updatedAt);
        case 'created_desc':
          return b.page.createdAt.localeCompare(a.page.createdAt);
        case 'created_asc':
          return a.page.createdAt.localeCompare(b.page.createdAt);
        case 'updated_desc':
        default:
          return b.page.updatedAt.localeCompare(a.page.updatedAt);
      }
    });
  }

  private buildSafeSnippet(
    markdown: string,
    query: string,
  ): { snippetHtml: string; matchedHeading: string | null } {
    const plain = markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#>*_`~]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!query) {
      return { snippetHtml: escapeHtml(plain.slice(0, 160)), matchedHeading: null };
    }

    const normQ = normalizeTerm(query);
    const headings = this.meta.extractTocHeadings(markdown);
    const matchedHeading =
      headings.find((h) => normalizeTerm(h.text).includes(normQ))?.text ?? null;

    const normPlain = normalizeTerm(plain);
    const idx = normPlain.indexOf(normQ);
    let excerpt: string;
    if (idx >= 0) {
      const start = Math.max(0, idx - 55);
      const end = Math.min(plain.length, idx + query.length + 105);
      excerpt = (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
    } else {
      excerpt = plain.slice(0, 160);
    }

    const escaped = escapeHtml(excerpt);
    const terms = query
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (terms.length === 0) return { snippetHtml: escaped, matchedHeading };

    const regex = new RegExp(`(${terms.join('|')})`, 'gi');
    const highlighted = escaped.replace(regex, '<mark>$1</mark>');
    return { snippetHtml: highlighted, matchedHeading };
  }
}
