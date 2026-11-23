import { Injectable, computed, inject, signal } from '@angular/core';
import {
  buildCanonicalPagePath,
  buildPageTree,
  collectDescendantIds,
  ensureUniqueSlug,
  extractMarkdownMetrics,
  generateNextPosition,
  generatePosition,
  slugify,
  wouldCreateCycle,
  type BreadcrumbSegment,
  type CreateOrganizationDto,
  type CreatePageDto,
  type CreateWorkspaceDto,
  type LocalMutation,
  type MovePageDto,
  type Organization,
  type OrganizationExportPayload,
  type Page,
  type PageContent,
  type PageHistoryVersion,
  type PageRouteAlias,
  type PageTreeItem,
  type PageWithContent,
  type ResolvedRouteResult,
  type SearchResultItem,
  type StorageStats,
  type UpdateOrganizationDto,
  type UpdatePageDto,
  type UpdateWorkspaceDto,
  type Workspace,
} from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';

export type SaveStatus =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved_local'
  | 'synced'
  | 'error'
  | 'conflict';

export interface DetailedStorageMetrics extends StorageStats {
  historyVersionsCount: number;
  oldHistoryVersionsCount: number;
  historyContentBytes: number;
  estimatedMetadataBytes: number;
  browserUsageBytes: number;
  browserQuotaBytes: number;
  persistentStorageGranted: boolean | null;
}

/**
 * Local-First Angular Signals store for Trazena.
 * All writes commit atomically to IndexedDB + consolidated Sync Outbox.
 * Remote sync with Cloudflare Workers + D1 happens exclusively via TrazenaSyncService.syncNow().
 */
@Injectable({ providedIn: 'root' })
export class KnowledgeStore {
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(TrazenaSyncService);

  private readonly _organizations = signal<Organization[]>([]);
  private readonly _workspaces = signal<Workspace[]>([]);
  private readonly _pages = signal<Page[]>([]);
  private readonly _routeAliases = signal<PageRouteAlias[]>([]);
  private readonly _loading = signal(false);
  private readonly _initialized = signal(false);
  private readonly _saveStatus = signal<SaveStatus>('idle');
  private readonly _saveError = signal<string | null>(null);

  readonly organizations = this._organizations.asReadonly();
  readonly workspaces = this._workspaces.asReadonly();
  readonly pages = this._pages.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly saveStatus = this._saveStatus.asReadonly();
  readonly saveError = this._saveError.asReadonly();
  readonly pendingSyncCount = this.sync.pendingCount;

  readonly activeOrganizations = computed(() =>
    this._organizations()
      .filter((o) => o.status === 'active')
      .sort((a, b) => a.position.localeCompare(b.position)),
  );

  readonly archivedOrganizations = computed(() =>
    this._organizations().filter((o) => o.status === 'archived'),
  );

  readonly deletedPages = computed(() =>
    this._pages()
      .filter((p) => p.status === 'deleted')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  );

  constructor() {
    this.sync.registerStoreHooks({
      reloadFromLocal: () => this.reloadFromIndexedDb(),
      duplicateConflictCopy: async (pageId, localMarkdown) => {
        const orig = this._pages().find((p) => p.id === pageId);
        if (!orig) return;
        await this.createPage({
          organizationId: orig.organizationId,
          workspaceId: orig.workspaceId,
          parentId: orig.parentId,
          title: `${orig.title} (copia local)`,
          icon: orig.icon,
          markdown: localMarkdown,
        });
      },
    });
  }

  private get ownerUid(): string {
    return this.auth.user()?.uid ?? 'local-owner';
  }

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    this._loading.set(true);
    try {
      await this.idb.ensureOpen();
      void this.idb.requestPersistentStorage();
      await this.reloadFromIndexedDb();
      await this.sync.refreshState();

      if (this._organizations().length === 0) {
        await this.seedInitialKnowledgeBase();
      }
      this._initialized.set(true);
    } finally {
      this._loading.set(false);
    }
  }

  async reloadFromIndexedDb(): Promise<void> {
    const [orgs, workspaces, pages, aliases] = await Promise.all([
      this.idb.getAll<Organization>('organizations'),
      this.idb.getAll<Workspace>('workspaces'),
      this.idb.getAll<Page>('pages'),
      this.idb.getAllRouteAliases(),
    ]);
    this._organizations.set(orgs);
    this._workspaces.set(workspaces);
    this._pages.set(pages);
    this._routeAliases.set(aliases);
  }

  getWorkspacesForOrg(orgId: string, includeArchived = false): Workspace[] {
    return this._workspaces()
      .filter(
        (w) =>
          w.organizationId === orgId &&
          (includeArchived ? w.status !== 'deleted' : w.status === 'active'),
      )
      .sort((a, b) => a.position.localeCompare(b.position));
  }

  getPagesForWorkspace(workspaceId: string, includeArchived = false): Page[] {
    return this._pages()
      .filter(
        (p) =>
          p.workspaceId === workspaceId &&
          (includeArchived ? p.status !== 'deleted' : p.status === 'active'),
      )
      .sort((a, b) => a.position.localeCompare(b.position));
  }

  getPageTree(workspaceId: string): PageTreeItem[] {
    return buildPageTree(this.getPagesForWorkspace(workspaceId));
  }

  getCanonicalPath(pageId: string): string {
    const page = this._pages().find((p) => p.id === pageId);
    if (!page) return '/';
    const org = this._organizations().find((o) => o.id === page.organizationId);
    const ws = this._workspaces().find((w) => w.id === page.workspaceId);
    if (!org || !ws) return '/';
    const wsPages = this._pages().filter(
      (p) => p.workspaceId === ws.id && p.status !== 'deleted',
    );
    return buildCanonicalPagePath(org.slug, ws.slug, wsPages, page.id);
  }

  async resolveRoute(
    orgSlug: string,
    wsSlug?: string,
    pageSegments: string[] = [],
  ): Promise<ResolvedRouteResult | null> {
    await this.initialize();

    const org = this._organizations().find(
      (o) => o.slug === orgSlug && o.status !== 'deleted',
    );
    if (!org) return null;

    const breadcrumbs: BreadcrumbSegment[] = [
      {
        type: 'organization',
        id: org.id,
        label: org.name,
        slug: org.slug,
        icon: org.icon,
        route: `/o/${org.slug}`,
      },
    ];

    if (!wsSlug) {
      return {
        organization: org,
        workspace: null,
        page: null,
        breadcrumbs,
        canonicalPath: `/o/${org.slug}`,
        redirectedFromAlias: false,
      };
    }

    const ws = this._workspaces().find(
      (w) =>
        w.organizationId === org.id &&
        w.slug === wsSlug &&
        w.status !== 'deleted',
    );
    if (!ws) return null;

    breadcrumbs.push({
      type: 'workspace',
      id: ws.id,
      label: ws.name,
      slug: ws.slug,
      icon: ws.icon,
      route: `/o/${org.slug}/${ws.slug}`,
    });

    if (pageSegments.length === 0) {
      return {
        organization: org,
        workspace: ws,
        page: null,
        breadcrumbs,
        canonicalPath: `/o/${org.slug}/${ws.slug}`,
        redirectedFromAlias: false,
      };
    }

    const wsPages = this._pages().filter(
      (p) => p.workspaceId === ws.id && p.status !== 'deleted',
    );

    let parentId: string | null = null;
    let matched: Page | null = null;
    const chain: Page[] = [];

    for (const seg of pageSegments) {
      const found = wsPages.find((p) => p.parentId === parentId && p.slug === seg);
      if (!found) {
        matched = null;
        break;
      }
      matched = found;
      chain.push(found);
      parentId = found.id;
    }

    let redirectedFromAlias = false;
    const joinedPath = pageSegments.join('/');

    if (!matched) {
      const alias = this._routeAliases().find(
        (a) =>
          a.organizationId === org.id &&
          a.workspaceId === ws.id &&
          a.oldPath === joinedPath,
      );
      if (alias) {
        const target = wsPages.find((p) => p.id === alias.pageId);
        if (target) {
          matched = target;
          redirectedFromAlias = true;
          chain.length = 0;
          const byId = new Map(wsPages.map((p) => [p.id, p]));
          const visited = new Set<string>();
          let cursor: Page | undefined = target;
          while (cursor && !visited.has(cursor.id)) {
            visited.add(cursor.id);
            chain.unshift(cursor);
            cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
          }
        }
      }
    }

    if (!matched) return null;

    let running = `/o/${org.slug}/${ws.slug}`;
    for (const item of chain) {
      running = `${running}/${item.slug}`;
      breadcrumbs.push({
        type: 'page',
        id: item.id,
        label: item.title,
        slug: item.slug,
        icon: item.icon,
        route: running,
      });
    }

    const pageWithContent = await this.loadPageWithContent(matched.id);
    if (!pageWithContent) return null;

    return {
      organization: org,
      workspace: ws,
      page: pageWithContent,
      breadcrumbs,
      canonicalPath: running,
      redirectedFromAlias,
    };
  }

  async loadPageWithContent(pageId: string): Promise<PageWithContent | null> {
    const page = this._pages().find((p) => p.id === pageId);
    if (!page) return null;
    const cached = await this.idb.getPageContent(pageId);
    const content: PageContent = cached ?? {
      pageId: page.id,
      markdown: `# ${page.title}\n\n`,
      excerpt: '',
      wordCount: 0,
      updatedAt: page.updatedAt,
      updatedBy: page.updatedBy,
    };
    return { ...page, content };
  }

  // --- Organizations CRUD (Local-First Atomic + Outbox) ---

  async createOrganization(dto: CreateOrganizationDto): Promise<Organization> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const existing = this._organizations().filter((o) => o.status !== 'deleted');
    const slug = ensureUniqueSlug(
      slugify(dto.slug || dto.name, 'organization'),
      existing.map((o) => o.slug),
    );
    const now = new Date().toISOString();
    const org: Organization = {
      id: crypto.randomUUID(),
      ownerId: uid,
      name: dto.name.trim(),
      slug,
      description: dto.description ?? null,
      icon: dto.icon ?? 'folder',
      position: generateNextPosition(existing.map((o) => o.position)),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    };

    const mutation: LocalMutation = {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'organization',
      entityId: org.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...org },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    };

    await this.idb.commitAtomicWithOutbox('organizations', org, mutation);
    this._organizations.update((list) => [...list, org]);
    await this.sync.refreshState();
    return org;
  }

  async updateOrganization(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    const current = this._organizations().find((o) => o.id === id);
    if (!current) throw new Error('Organización no encontrada.');
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);

    let nextSlug = current.slug;
    if (dto.slug !== undefined) {
      const siblings = this._organizations().filter(
        (o) => o.id !== id && o.status !== 'deleted',
      );
      nextSlug = ensureUniqueSlug(
        slugify(dto.slug, current.slug),
        siblings.map((o) => o.slug),
      );
    }

    const now = new Date().toISOString();
    const updated: Organization = {
      ...current,
      name: dto.name?.trim() ?? current.name,
      slug: nextSlug,
      description: dto.description !== undefined ? dto.description : current.description,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: now,
      updatedBy: uid,
    };

    const opKind: LocalMutation['operation'] =
      dto.status === 'deleted'
        ? 'delete'
        : dto.status === 'archived'
          ? 'archive'
          : 'update';

    await this.idb.commitAtomicWithOutbox('organizations', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'organization',
      entityId: updated.id,
      operation: opKind,
      baseRevision: null,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._organizations.update((list) => list.map((o) => (o.id === id ? updated : o)));
    await this.sync.refreshState();
    return updated;
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.updateOrganization(id, { status: 'deleted' });
  }

  async exportOrganization(id: string): Promise<OrganizationExportPayload> {
    const org = this._organizations().find((o) => o.id === id);
    if (!org) throw new Error('Organización no encontrada.');
    const workspaces = this._workspaces().filter(
      (w) => w.organizationId === id && w.status !== 'deleted',
    );
    const pages = this._pages().filter(
      (p) => p.organizationId === id && p.status !== 'deleted',
    );
    const pagesWithContent: PageWithContent[] = await Promise.all(
      pages.map(async (p) => {
        const content = (await this.idb.getPageContent(p.id)) ?? {
          pageId: p.id,
          markdown: '',
          excerpt: '',
          wordCount: 0,
          updatedAt: p.updatedAt,
          updatedBy: p.updatedBy,
        };
        return { ...p, content };
      }),
    );
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      organization: org,
      workspaces,
      pages: pagesWithContent,
    };
  }

  // --- Workspaces CRUD (Local-First Atomic + Outbox) ---

  async createWorkspace(dto: CreateWorkspaceDto): Promise<Workspace> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const existing = this._workspaces().filter(
      (w) => w.organizationId === dto.organizationId && w.status !== 'deleted',
    );
    const slug = ensureUniqueSlug(
      slugify(dto.slug || dto.name, 'space'),
      existing.map((w) => w.slug),
    );
    const now = new Date().toISOString();
    const ws: Workspace = {
      id: crypto.randomUUID(),
      organizationId: dto.organizationId,
      name: dto.name.trim(),
      slug,
      description: dto.description ?? null,
      icon: dto.icon ?? 'book',
      position: generateNextPosition(existing.map((w) => w.position)),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    };

    await this.idb.commitAtomicWithOutbox('workspaces', ws, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'workspace',
      entityId: ws.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...ws },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._workspaces.update((list) => [...list, ws]);
    await this.sync.refreshState();
    return ws;
  }

  async updateWorkspace(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    const current = this._workspaces().find((w) => w.id === id);
    if (!current) throw new Error('Espacio no encontrado.');
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);

    let nextSlug = current.slug;
    if (dto.slug !== undefined) {
      const siblings = this._workspaces().filter(
        (w) =>
          w.organizationId === current.organizationId &&
          w.id !== id &&
          w.status !== 'deleted',
      );
      nextSlug = ensureUniqueSlug(
        slugify(dto.slug, current.slug),
        siblings.map((w) => w.slug),
      );
    }

    const now = new Date().toISOString();
    const updated: Workspace = {
      ...current,
      name: dto.name?.trim() ?? current.name,
      slug: nextSlug,
      description: dto.description !== undefined ? dto.description : current.description,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: now,
      updatedBy: uid,
    };

    await this.idb.commitAtomicWithOutbox('workspaces', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'workspace',
      entityId: updated.id,
      operation: dto.status === 'deleted' ? 'delete' : 'update',
      baseRevision: null,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._workspaces.update((list) => list.map((w) => (w.id === id ? updated : w)));
    await this.sync.refreshState();
    return updated;
  }

  async deleteWorkspace(id: string): Promise<void> {
    await this.updateWorkspace(id, { status: 'deleted' });
  }

  // --- Pages CRUD, History & Local-First Outbox ---

  async createPage(dto: CreatePageDto): Promise<PageWithContent> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const parentId = dto.parentId ?? null;
    const siblings = this._pages().filter(
      (p) =>
        p.workspaceId === dto.workspaceId &&
        p.parentId === parentId &&
        p.status !== 'deleted',
    );
    const slug = ensureUniqueSlug(
      slugify(dto.slug || dto.title, 'page'),
      siblings.map((p) => p.slug),
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const markdown = dto.markdown ?? `# ${dto.title.trim()}\n\n`;
    const metrics = extractMarkdownMetrics(markdown);

    const page: Page = {
      id,
      organizationId: dto.organizationId,
      workspaceId: dto.workspaceId,
      parentId,
      title: dto.title.trim(),
      slug,
      icon: dto.icon ?? 'file-text',
      position: generateNextPosition(siblings.map((p) => p.position)),
      revision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
    };
    const content: PageContent = {
      pageId: id,
      markdown,
      excerpt: metrics.excerpt,
      wordCount: metrics.wordCount,
      updatedAt: now,
      updatedBy: uid,
    };

    await this.idb.commitAtomicWithOutbox(
      'pages',
      page,
      {
        operationId: crypto.randomUUID(),
        deviceId: device.deviceId,
        ownerUid: uid,
        entityType: 'page',
        entityId: page.id,
        operation: 'create',
        baseRevision: null,
        payload: { ...page, markdown },
        createdAt: now,
        updatedAt: now,
        status: 'pending',
      },
      content,
    );

    this._pages.update((list) => [...list, page]);
    await this.sync.refreshState();
    return { ...page, content };
  }

  async updatePageMeta(id: string, dto: UpdatePageDto): Promise<Page> {
    const current = this._pages().find((p) => p.id === id);
    if (!current) throw new Error('Página no encontrada.');
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);

    let nextSlug = current.slug;
    if (dto.slug !== undefined && dto.slug !== current.slug) {
      const oldRelPath = this.computeRelativePath(current.workspaceId, id);
      const siblings = this._pages().filter(
        (p) =>
          p.workspaceId === current.workspaceId &&
          p.parentId === current.parentId &&
          p.id !== id &&
          p.status !== 'deleted',
      );
      nextSlug = ensureUniqueSlug(
        slugify(dto.slug, current.slug),
        siblings.map((p) => p.slug),
      );
      if (oldRelPath && nextSlug !== current.slug) {
        const alias: PageRouteAlias = {
          id: crypto.randomUUID(),
          pageId: id,
          organizationId: current.organizationId,
          workspaceId: current.workspaceId,
          oldPath: oldRelPath,
          createdAt: new Date().toISOString(),
        };
        await this.idb.saveRouteAlias(alias);
        this._routeAliases.update((list) => [...list, alias]);
      }
    }

    const now = new Date().toISOString();
    const updated: Page = {
      ...current,
      title: dto.title?.trim() ?? current.title,
      slug: nextSlug,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: now,
      updatedBy: uid,
    };

    const opKind: LocalMutation['operation'] =
      dto.status === 'archived'
        ? 'archive'
        : dto.status === 'deleted'
          ? 'delete'
          : 'update';

    await this.idb.commitAtomicWithOutbox('pages', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page',
      entityId: updated.id,
      operation: opKind,
      baseRevision: current.revision,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this.upsertPageInSignal(updated);
    await this.sync.refreshState();
    return updated;
  }

  markPendingSave(): void {
    this._saveStatus.set('pending');
    this._saveError.set(null);
  }

  /**
   * Local-First atomic content persistence:
   * Saves previous snapshot (if content hash changed, max 3), writes content + consolidated Outbox entry.
   * NEVER triggers automatic remote sync with Cloudflare.
   */
  async savePageContent(
    pageId: string,
    markdown: string,
    expectedRevision: number,
  ): Promise<PageWithContent | null> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) return null;

    this._saveStatus.set('saving');
    this._saveError.set(null);

    try {
      const uid = this.ownerUid;
      const device = await this.idb.getOrCreateDevice(uid);
      const prevContent = await this.idb.getPageContent(pageId);
      const now = new Date().toISOString();

      if (prevContent && prevContent.markdown !== markdown) {
        await this.idb.saveLocalHistorySnapshot({
          pageId: current.id,
          organizationId: current.organizationId,
          workspaceId: current.workspaceId,
          previousRevision: current.revision,
          previousMarkdown: prevContent.markdown,
          nextMarkdown: markdown,
          actorUid: uid,
          deviceId: device.deviceId,
        });
      }

      const metrics = extractMarkdownMetrics(markdown);
      const localContent: PageContent = {
        pageId,
        markdown,
        excerpt: metrics.excerpt,
        wordCount: metrics.wordCount,
        updatedAt: now,
        updatedBy: uid,
      };

      const updatedPage: Page = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        updatedBy: uid,
      };

      await this.idb.commitAtomicWithOutbox(
        'pages',
        updatedPage,
        {
          operationId: crypto.randomUUID(),
          deviceId: device.deviceId,
          ownerUid: uid,
          entityType: 'page',
          entityId: pageId,
          operation: 'update',
          baseRevision: expectedRevision,
          payload: { ...updatedPage, markdown },
          createdAt: now,
          updatedAt: now,
          status: 'pending',
        },
        localContent,
      );

      this.upsertPageInSignal(updatedPage);
      this._saveStatus.set('saved_local');
      await this.sync.refreshState();
      return { ...updatedPage, content: localContent };
    } catch (err) {
      this._saveStatus.set('error');
      this._saveError.set(
        err instanceof Error ? err.message : 'Error al guardar localmente en IndexedDB.',
      );
      return null;
    }
  }

  async movePage(pageId: string, dto: MovePageDto): Promise<Page> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) throw new Error('Página no encontrada.');
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);

    const orgPages = this._pages().filter((p) => p.organizationId === current.organizationId);
    if (wouldCreateCycle(orgPages, pageId, dto.targetParentId)) {
      throw new Error('No puedes mover una página dentro de sí misma ni dentro de sus subpáginas.');
    }

    const oldPath = this.computeRelativePath(current.workspaceId, pageId);
    const siblings = this._pages().filter(
      (p) =>
        p.workspaceId === dto.targetWorkspaceId &&
        p.parentId === dto.targetParentId &&
        p.id !== pageId &&
        p.status !== 'deleted',
    );
    const nextSlug = ensureUniqueSlug(
      current.slug,
      siblings.map((p) => p.slug),
    );
    const now = new Date().toISOString();
    const descendantIds = collectDescendantIds(orgPages, pageId);

    const updated: Page = {
      ...current,
      workspaceId: dto.targetWorkspaceId,
      parentId: dto.targetParentId,
      slug: nextSlug,
      position: dto.position ?? generateNextPosition(siblings.map((p) => p.position)),
      updatedAt: now,
      updatedBy: uid,
    };

    if (oldPath) {
      const alias: PageRouteAlias = {
        id: crypto.randomUUID(),
        pageId,
        organizationId: current.organizationId,
        workspaceId: current.workspaceId,
        oldPath,
        createdAt: now,
      };
      await this.idb.saveRouteAlias(alias);
      this._routeAliases.update((list) => [...list, alias]);
    }

    await this.idb.commitAtomicWithOutbox('pages', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page',
      entityId: updated.id,
      operation: 'move',
      baseRevision: current.revision,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    const updatedMap = new Map<string, Page>([[updated.id, updated]]);
    if (dto.targetWorkspaceId !== current.workspaceId && descendantIds.length > 0) {
      for (const descId of descendantIds) {
        const desc = this._pages().find((p) => p.id === descId);
        if (desc) {
          const movedDesc: Page = {
            ...desc,
            workspaceId: dto.targetWorkspaceId,
            updatedAt: now,
            updatedBy: uid,
          };
          await this.idb.commitAtomicWithOutbox('pages', movedDesc, {
            operationId: crypto.randomUUID(),
            deviceId: device.deviceId,
            ownerUid: uid,
            entityType: 'page',
            entityId: movedDesc.id,
            operation: 'move',
            baseRevision: desc.revision,
            payload: { ...movedDesc },
            createdAt: now,
            updatedAt: now,
            status: 'pending',
          });
          updatedMap.set(movedDesc.id, movedDesc);
        }
      }
    }

    this._pages.update((list) => list.map((p) => updatedMap.get(p.id) ?? p));
    await this.sync.refreshState();
    return updated;
  }

  async duplicatePage(pageId: string): Promise<PageWithContent> {
    const source = await this.loadPageWithContent(pageId);
    if (!source) throw new Error('Página no encontrada.');
    return this.createPage({
      organizationId: source.organizationId,
      workspaceId: source.workspaceId,
      parentId: source.parentId,
      title: `${source.title} (copia)`,
      icon: source.icon,
      markdown: source.content.markdown,
    });
  }

  async deletePage(pageId: string, permanent = false): Promise<void> {
    const target = this._pages().find((p) => p.id === pageId);
    if (!target) return;
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const wsPages = this._pages().filter((p) => p.workspaceId === target.workspaceId);
    const affected = new Set([pageId, ...collectDescendantIds(wsPages, pageId)]);

    if (permanent) {
      for (const id of affected) {
        await this.idb.delete('pages', id);
        await this.idb.delete('page_contents', id);
      }
      this._pages.update((list) => list.filter((p) => !affected.has(p.id)));
    } else {
      const now = new Date().toISOString();
      const updatedPages: Page[] = [];
      for (const p of this._pages()) {
        if (affected.has(p.id)) {
          const tombstone: Page = { ...p, status: 'deleted', updatedAt: now, updatedBy: uid };
          await this.idb.commitAtomicWithOutbox('pages', tombstone, {
            operationId: crypto.randomUUID(),
            deviceId: device.deviceId,
            ownerUid: uid,
            entityType: 'page',
            entityId: tombstone.id,
            operation: 'delete',
            baseRevision: p.revision,
            payload: { ...tombstone },
            createdAt: now,
            updatedAt: now,
            status: 'pending',
          });
          updatedPages.push(tombstone);
        } else {
          updatedPages.push(p);
        }
      }
      this._pages.set(updatedPages);
    }
    await this.sync.refreshState();
  }

  async restorePage(pageId: string): Promise<Page> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) throw new Error('Página no encontrada.');
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);

    let nextParentId = current.parentId;
    if (nextParentId) {
      const parent = this._pages().find((p) => p.id === nextParentId);
      if (!parent || parent.status === 'deleted') {
        nextParentId = null;
      }
    }

    const siblings = this._pages().filter(
      (p) =>
        p.workspaceId === current.workspaceId &&
        p.parentId === nextParentId &&
        p.id !== pageId &&
        p.status !== 'deleted',
    );
    const now = new Date().toISOString();
    const updated: Page = {
      ...current,
      status: 'active',
      parentId: nextParentId,
      slug: ensureUniqueSlug(
        current.slug,
        siblings.map((p) => p.slug),
      ),
      updatedAt: now,
      updatedBy: uid,
    };

    await this.idb.commitAtomicWithOutbox('pages', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page',
      entityId: updated.id,
      operation: 'restore',
      baseRevision: current.revision,
      payload: { ...updated },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this.upsertPageInSignal(updated);
    await this.sync.refreshState();
    return updated;
  }

  // --- Page History (max 3 previous full snapshots, manual deletion, non-destructive restore) ---

  async getPageHistory(pageId: string): Promise<PageHistoryVersion[]> {
    return this.idb.getPageHistory(pageId);
  }

  async getAllHistory(): Promise<PageHistoryVersion[]> {
    return this.idb.getAllHistory();
  }

  async restoreHistoryVersion(
    pageId: string,
    version: PageHistoryVersion,
  ): Promise<PageWithContent | null> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) return null;
    // Restoration creates a NEW revision without modifying historical records
    return this.savePageContent(pageId, version.content, current.revision);
  }

  async deleteHistoryVersion(versionId: string): Promise<void> {
    await this.idb.deleteHistoryVersion(versionId);
  }

  async deleteHistoryVersionsBulk(versionIds: readonly string[]): Promise<void> {
    await this.idb.deleteHistoryVersionsBulk(versionIds);
  }

  async searchPages(query: string, orgId?: string): Promise<SearchResultItem[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const activePages = this._pages().filter(
      (p) => p.status === 'active' && (!orgId || p.organizationId === orgId),
    );
    const contents = await this.idb.getAll<PageContent>('page_contents');
    const contentMap = new Map(contents.map((c) => [c.pageId, c]));

    const matches: SearchResultItem[] = [];
    for (const page of activePages) {
      const content = contentMap.get(page.id);
      const inTitle = page.title.toLowerCase().includes(q);
      const inBody = content?.markdown.toLowerCase().includes(q) ?? false;
      if (!inTitle && !inBody) continue;

      const org = this._organizations().find((o) => o.id === page.organizationId);
      const ws = this._workspaces().find((w) => w.id === page.workspaceId);
      if (!org || !ws) continue;

      matches.push({
        pageId: page.id,
        organizationId: org.id,
        organizationSlug: org.slug,
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        title: page.title,
        slug: page.slug,
        snippet: content?.excerpt ?? '',
        canonicalPath: this.getCanonicalPath(page.id),
        updatedAt: page.updatedAt,
      });
    }
    return matches.slice(0, 25);
  }

  async getDetailedStorageMetrics(): Promise<DetailedStorageMetrics> {
    const [contents, history, quota] = await Promise.all([
      this.idb.getAll<PageContent>('page_contents'),
      this.idb.getAllHistory(),
      this.idb.estimateBrowserQuota(),
    ]);

    const encoder = new TextEncoder();
    const totalContentBytes = contents.reduce(
      (acc, item) => acc + encoder.encode(item.markdown).byteLength,
      0,
    );
    const historyContentBytes = history.reduce((acc, item) => acc + item.byteSize, 0);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const oldHistoryVersionsCount = history.filter(
      (h) => Date.parse(h.createdAt) < thirtyDaysAgo,
    ).length;

    const activePages = this._pages().filter((p) => p.status === 'active').length;
    const archivedPages = this._pages().filter((p) => p.status === 'archived').length;
    const deletedPages = this._pages().filter((p) => p.status === 'deleted').length;
    const estimatedMetadataBytes =
      (this._organizations().length + this._workspaces().length + this._pages().length) * 512;

    return {
      organizationsCount: this._organizations().filter((o) => o.status !== 'deleted').length,
      workspacesCount: this._workspaces().filter((w) => w.status !== 'deleted').length,
      pagesCount: activePages,
      archivedPagesCount: archivedPages,
      deletedPagesCount: deletedPages,
      totalContentBytes,
      historyVersionsCount: history.length,
      oldHistoryVersionsCount,
      historyContentBytes,
      estimatedMetadataBytes,
      estimatedDbBytes: (totalContentBytes + historyContentBytes) * 1.6 + estimatedMetadataBytes,
      d1FreeTierLimitBytes: 5 * 1024 * 1024 * 1024,
      browserUsageBytes: quota.usageBytes,
      browserQuotaBytes: quota.quotaBytes,
      persistentStorageGranted: this.idb.persistentStorageGranted(),
    };
  }

  private computeRelativePath(workspaceId: string, pageId: string): string {
    const wsPages = this._pages().filter((p) => p.workspaceId === workspaceId);
    const byId = new Map(wsPages.map((p) => [p.id, p]));
    const chain: string[] = [];
    const visited = new Set<string>();
    let cursor = byId.get(pageId);
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id);
      chain.unshift(cursor.slug);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return chain.join('/');
  }

  private upsertPageInSignal(page: Page): void {
    this._pages.update((list) => {
      const exists = list.some((p) => p.id === page.id);
      return exists ? list.map((p) => (p.id === page.id ? page : p)) : [...list, page];
    });
  }

  private async seedInitialKnowledgeBase(): Promise<void> {
    const userId = this.ownerUid;
    const now = new Date().toISOString();

    const orgNequi: Organization = {
      id: 'org-nequi',
      ownerId: userId,
      name: 'Nequi',
      slug: 'nequi',
      description: 'Documentación técnica, arquitectura e integraciones financieras.',
      icon: 'layers',
      position: generatePosition(0),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const orgPersonal: Organization = {
      id: 'org-proyectos',
      ownerId: userId,
      name: 'Proyectos personales',
      slug: 'proyectos-personales',
      description: 'Design systems, productos propios y arquitectura personal.',
      icon: 'folder',
      position: generatePosition(1),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const wsPaypal: Workspace = {
      id: 'ws-paypal',
      organizationId: orgNequi.id,
      name: 'PayPal',
      slug: 'paypal',
      description: 'Integración PayPal: flujos OAuth, arquitectura y despliegues.',
      icon: 'book',
      position: generatePosition(0),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const wsAtralume: Workspace = {
      id: 'ws-atralume',
      organizationId: orgPersonal.id,
      name: 'Atralume',
      slug: 'atralume',
      description: 'Design system Angular + Taiga UI y guía de tokens DTCG.',
      icon: 'book',
      position: generatePosition(0),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const pageArq: Page = {
      id: 'page-arquitectura',
      organizationId: orgNequi.id,
      workspaceId: wsPaypal.id,
      parentId: null,
      title: 'Arquitectura',
      slug: 'arquitectura',
      icon: 'file-text',
      position: generatePosition(0),
      revision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const pageFrontend: Page = {
      id: 'page-frontend',
      organizationId: orgNequi.id,
      workspaceId: wsPaypal.id,
      parentId: pageArq.id,
      title: 'Frontend',
      slug: 'frontend',
      icon: 'file-text',
      position: generatePosition(0),
      revision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const pageBackend: Page = {
      id: 'page-backend',
      organizationId: orgNequi.id,
      workspaceId: wsPaypal.id,
      parentId: pageArq.id,
      title: 'Backend',
      slug: 'backend',
      icon: 'file-text',
      position: generatePosition(1),
      revision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const pageAtralumeIntro: Page = {
      id: 'page-atralume-tokens',
      organizationId: orgPersonal.id,
      workspaceId: wsAtralume.id,
      parentId: null,
      title: 'Tokens y Temas',
      slug: 'tokens-y-temas',
      icon: 'file-text',
      position: generatePosition(0),
      revision: 1,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const contents: PageContent[] = [
      {
        pageId: pageArq.id,
        markdown: `# Arquitectura — Integración PayPal

Bienvenido a **Trazena**. Esta página demuestra la jerarquía recursiva de documentación técnica con arquitectura **Local-First**.

## Principios clave

- [x] Persistencia local offline-first en **IndexedDB** con Outbox atómica
- [x] Sincronización manual incremental de un clic (**Trazena Sync**)
- [x] Historial limitado de hasta 3 versiones anteriores por página
- [ ] Conectar Firebase Authentication y Cloudflare D1 en producción

## Mapa de componentes

| Capa | Tecnología | Responsabilidad |
| --- | --- | --- |
| Frontend | Angular 22 + Atralume + PWA | Interfaz offline, editor WYSIWYG y sincronización manual |
| API | Cloudflare Workers + Hono | Autenticación JWT Web Crypto y protocolo push/pull |
| Base de datos | Cloudflare D1 (SQLite) | Persistencia relacional, FTS5, eventos e historial |

> Tip: Escribe directamente en Markdown (\`#\`, \`**negrita**\`, \`- [ ]\`, \`>\`, \`\`\` código) — todo se formatea en vivo en el mismo lienzo.
`,
        excerpt: 'Bienvenido a Trazena. Esta página demuestra la jerarquía recursiva de documentación técnica.',
        wordCount: 110,
        updatedAt: now,
        updatedBy: userId,
      },
      {
        pageId: pageFrontend.id,
        markdown: `# Frontend

La capa de presentación utiliza **Angular Standalone**, **Signals**, **PWA** y **Atralume** sobre Taiga UI 5.

\`\`\`typescript
import { provideAtralume } from '@osmanjimenez/atralume';

export const appConfig = {
  providers: [provideAtralume()],
};
\`\`\`
`,
        excerpt: 'La capa de presentación utiliza Angular Standalone, Signals, PWA y Atralume.',
        wordCount: 28,
        updatedAt: now,
        updatedBy: userId,
      },
      {
        pageId: pageBackend.id,
        markdown: `# Backend Serverless

Cloudflare Workers + Hono valida cada Firebase ID Token mediante **Web Crypto API (RS256)** y sincroniza incrementalmente mediante \`sync_events\`.

\`\`\`sql
SELECT sequence, entity_type, entity_id, operation
FROM sync_events
WHERE sequence > ?
ORDER BY sequence ASC
LIMIT 100;
\`\`\`
`,
        excerpt: 'Cloudflare Workers + Hono valida cada Firebase ID Token mediante Web Crypto API (RS256).',
        wordCount: 38,
        updatedAt: now,
        updatedBy: userId,
      },
      {
        pageId: pageAtralumeIntro.id,
        markdown: `# Atralume — Tokens y Temas

Atralume gestiona el tema mediante \`data-atr-theme="light | dark | system"\` y superficies mediante \`data-atr-surface="glass"\`.

- **Consistencia visual:** componentes reutilizables del design system.
- **Accesibilidad:** contraste WCAG y navegación por teclado.
`,
        excerpt: 'Atralume gestiona el tema mediante data-atr-theme y superficies mediante data-atr-surface.',
        wordCount: 34,
        updatedAt: now,
        updatedBy: userId,
      },
    ];

    const orgs = [orgNequi, orgPersonal];
    const wss = [wsPaypal, wsAtralume];
    const pgs = [pageArq, pageFrontend, pageBackend, pageAtralumeIntro];

    await this.idb.putMany('organizations', orgs);
    await this.idb.putMany('workspaces', wss);
    await this.idb.putMany('pages', pgs);
    await this.idb.putMany('page_contents', contents);

    this._organizations.set(orgs);
    this._workspaces.set(wss);
    this._pages.set(pgs);
  }
}
