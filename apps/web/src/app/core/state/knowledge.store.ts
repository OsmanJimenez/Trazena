import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
  type BootstrapPayload,
  type BreadcrumbSegment,
  type CreateOrganizationDto,
  type CreatePageDto,
  type CreateWorkspaceDto,
  type MovePageDto,
  type Organization,
  type OrganizationExportPayload,
  type Page,
  type PageConflictErrorDetails,
  type PageContent,
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
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { IndexedDbService } from '../storage/indexeddb.service';

export type SaveStatus =
  | 'idle'
  | 'pending'
  | 'saving'
  | 'saved_local'
  | 'synced'
  | 'error'
  | 'conflict';

export interface ActiveConflict {
  pageId: string;
  localMarkdown: string;
  serverMarkdown: string;
  serverRevision: number;
  serverUpdatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class KnowledgeStore {
  private readonly http = inject(HttpClient);
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);

  private readonly _organizations = signal<Organization[]>([]);
  private readonly _workspaces = signal<Workspace[]>([]);
  private readonly _pages = signal<Page[]>([]);
  private readonly _routeAliases = signal<PageRouteAlias[]>([]);
  private readonly _loading = signal(false);
  private readonly _initialized = signal(false);
  private readonly _saveStatus = signal<SaveStatus>('idle');
  private readonly _saveError = signal<string | null>(null);
  private readonly _conflict = signal<ActiveConflict | null>(null);
  private readonly _pendingSyncCount = signal(0);

  readonly organizations = this._organizations.asReadonly();
  readonly workspaces = this._workspaces.asReadonly();
  readonly pages = this._pages.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly initialized = this._initialized.asReadonly();
  readonly saveStatus = this._saveStatus.asReadonly();
  readonly saveError = this._saveError.asReadonly();
  readonly conflict = this._conflict.asReadonly();
  readonly pendingSyncCount = this._pendingSyncCount.asReadonly();

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

  private get apiUrl(): string {
    return environment.apiUrl.replace(/\/+$/, '');
  }

  private get hasRemoteApi(): boolean {
    return this.apiUrl.length > 0;
  }

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    this._loading.set(true);
    try {
      const [orgs, workspaces, pages, aliases, queue] = await Promise.all([
        this.idb.getAll<Organization>('organizations'),
        this.idb.getAll<Workspace>('workspaces'),
        this.idb.getAll<Page>('pages'),
        this.idb.getAllRouteAliases(),
        this.idb.getSyncQueue(),
      ]);

      this._organizations.set(orgs);
      this._workspaces.set(workspaces);
      this._pages.set(pages);
      this._routeAliases.set(aliases);
      this._pendingSyncCount.set(queue.length);

      if (this.hasRemoteApi) {
        try {
          const remote = await firstValueFrom(
            this.http.get<BootstrapPayload>(`${this.apiUrl}/api/bootstrap`),
          );
          this._organizations.set(remote.organizations);
          this._workspaces.set(remote.workspaces);
          this._pages.set(remote.pages);
          await this.idb.replaceSnapshot(remote);
        } catch {
          // Stay operational on IndexedDB cache when offline or API unreachable
        }
      } else if (orgs.length === 0) {
        await this.seedInitialKnowledgeBase();
      }

      this._initialized.set(true);
    } finally {
      this._loading.set(false);
    }
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

    if (!matched) {
      // Try remote alias resolution if remote API is active
      if (this.hasRemoteApi) {
        try {
          const remote = await firstValueFrom(
            this.http.get<ResolvedRouteResult>(`${this.apiUrl}/api/resolve`, {
              params: { org: orgSlug, workspace: wsSlug, path: joinedPath },
            }),
          );
          if (remote.page) {
            await this.idb.savePageContent(remote.page.content);
          }
          return remote;
        } catch {
          return null;
        }
      }
      return null;
    }

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

    if (this.hasRemoteApi) {
      try {
        const res = await firstValueFrom(
          this.http.get<{ page: PageWithContent }>(`${this.apiUrl}/api/pages/${pageId}`),
        );
        await this.idb.put('pages', res.page);
        await this.idb.savePageContent(res.page.content);
        this.upsertPageInSignal(res.page);
        return res.page;
      } catch {
        // Fallback to IndexedDB cache
      }
    }

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

  // --- Organizations CRUD ---

  async createOrganization(dto: CreateOrganizationDto): Promise<Organization> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ organization: Organization }>(
          `${this.apiUrl}/api/organizations`,
          dto,
        ),
      );
      await this.idb.put('organizations', res.organization);
      this._organizations.update((list) => [...list, res.organization]);
      return res.organization;
    }

    const userId = this.auth.user()?.uid ?? 'local-owner';
    const existing = this._organizations().filter((o) => o.status !== 'deleted');
    const slug = ensureUniqueSlug(
      slugify(dto.slug || dto.name, 'organization'),
      existing.map((o) => o.slug),
    );
    const now = new Date().toISOString();
    const org: Organization = {
      id: crypto.randomUUID(),
      ownerId: userId,
      name: dto.name.trim(),
      slug,
      description: dto.description ?? null,
      icon: dto.icon ?? 'folder',
      position: generateNextPosition(existing.map((o) => o.position)),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };
    await this.idb.put('organizations', org);
    this._organizations.update((list) => [...list, org]);
    return org;
  }

  async updateOrganization(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<Organization> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.patch<{ organization: Organization }>(
          `${this.apiUrl}/api/organizations/${id}`,
          dto,
        ),
      );
      await this.idb.put('organizations', res.organization);
      this._organizations.update((list) =>
        list.map((o) => (o.id === id ? res.organization : o)),
      );
      return res.organization;
    }

    const current = this._organizations().find((o) => o.id === id);
    if (!current) throw new Error('Organización no encontrada.');

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

    const updated: Organization = {
      ...current,
      name: dto.name?.trim() ?? current.name,
      slug: nextSlug,
      description: dto.description !== undefined ? dto.description : current.description,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: new Date().toISOString(),
      updatedBy: this.auth.user()?.uid ?? current.updatedBy,
    };
    await this.idb.put('organizations', updated);
    this._organizations.update((list) =>
      list.map((o) => (o.id === id ? updated : o)),
    );
    return updated;
  }

  async deleteOrganization(id: string, permanent = false): Promise<void> {
    if (this.hasRemoteApi) {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}/api/organizations/${id}`, {
          params: permanent ? { permanent: 'true' } : {},
        }),
      );
    }
    if (permanent) {
      await this.idb.delete('organizations', id);
      this._organizations.update((list) => list.filter((o) => o.id !== id));
    } else {
      await this.updateOrganization(id, { status: 'deleted' });
    }
  }

  async exportOrganization(id: string): Promise<OrganizationExportPayload> {
    if (this.hasRemoteApi) {
      return firstValueFrom(
        this.http.get<OrganizationExportPayload>(
          `${this.apiUrl}/api/organizations/${id}/export`,
        ),
      );
    }
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

  // --- Workspaces CRUD ---

  async createWorkspace(dto: CreateWorkspaceDto): Promise<Workspace> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ workspace: Workspace }>(`${this.apiUrl}/api/workspaces`, dto),
      );
      await this.idb.put('workspaces', res.workspace);
      this._workspaces.update((list) => [...list, res.workspace]);
      return res.workspace;
    }

    const userId = this.auth.user()?.uid ?? 'local-owner';
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
      createdBy: userId,
      updatedBy: userId,
    };
    await this.idb.put('workspaces', ws);
    this._workspaces.update((list) => [...list, ws]);
    return ws;
  }

  async updateWorkspace(id: string, dto: UpdateWorkspaceDto): Promise<Workspace> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.patch<{ workspace: Workspace }>(
          `${this.apiUrl}/api/workspaces/${id}`,
          dto,
        ),
      );
      await this.idb.put('workspaces', res.workspace);
      this._workspaces.update((list) =>
        list.map((w) => (w.id === id ? res.workspace : w)),
      );
      return res.workspace;
    }

    const current = this._workspaces().find((w) => w.id === id);
    if (!current) throw new Error('Espacio no encontrado.');

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

    const updated: Workspace = {
      ...current,
      name: dto.name?.trim() ?? current.name,
      slug: nextSlug,
      description: dto.description !== undefined ? dto.description : current.description,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: new Date().toISOString(),
      updatedBy: this.auth.user()?.uid ?? current.updatedBy,
    };
    await this.idb.put('workspaces', updated);
    this._workspaces.update((list) =>
      list.map((w) => (w.id === id ? updated : w)),
    );
    return updated;
  }

  async deleteWorkspace(id: string): Promise<void> {
    if (this.hasRemoteApi) {
      await firstValueFrom(this.http.delete(`${this.apiUrl}/api/workspaces/${id}`));
    }
    await this.updateWorkspace(id, { status: 'deleted' });
  }

  // --- Pages CRUD & Hierarchy ---

  async createPage(dto: CreatePageDto): Promise<PageWithContent> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ page: PageWithContent }>(`${this.apiUrl}/api/pages`, dto),
      );
      await this.idb.put('pages', res.page);
      await this.idb.savePageContent(res.page.content);
      this._pages.update((list) => [...list, res.page]);
      return res.page;
    }

    const userId = this.auth.user()?.uid ?? 'local-owner';
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
      createdBy: userId,
      updatedBy: userId,
    };
    const content: PageContent = {
      pageId: id,
      markdown,
      excerpt: metrics.excerpt,
      wordCount: metrics.wordCount,
      updatedAt: now,
      updatedBy: userId,
    };

    await this.idb.put('pages', page);
    await this.idb.savePageContent(content);
    this._pages.update((list) => [...list, page]);
    return { ...page, content };
  }

  async updatePageMeta(id: string, dto: UpdatePageDto): Promise<Page> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.patch<{ page: PageWithContent }>(`${this.apiUrl}/api/pages/${id}`, dto),
      );
      await this.idb.put('pages', res.page);
      this.upsertPageInSignal(res.page);
      return res.page;
    }

    const current = this._pages().find((p) => p.id === id);
    if (!current) throw new Error('Página no encontrada.');

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

    const updated: Page = {
      ...current,
      title: dto.title?.trim() ?? current.title,
      slug: nextSlug,
      icon: dto.icon !== undefined ? dto.icon : current.icon,
      position: dto.position ?? current.position,
      status: dto.status ?? current.status,
      updatedAt: new Date().toISOString(),
      updatedBy: this.auth.user()?.uid ?? current.updatedBy,
    };
    await this.idb.put('pages', updated);
    this.upsertPageInSignal(updated);
    return updated;
  }

  markPendingSave(): void {
    this._saveStatus.set('pending');
    this._saveError.set(null);
  }

  async savePageContent(
    pageId: string,
    markdown: string,
    expectedRevision: number,
  ): Promise<PageWithContent | null> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) return null;

    this._saveStatus.set('saving');
    this._saveError.set(null);
    this._conflict.set(null);

    const now = new Date().toISOString();
    const metrics = extractMarkdownMetrics(markdown);
    const localContent: PageContent = {
      pageId,
      markdown,
      excerpt: metrics.excerpt,
      wordCount: metrics.wordCount,
      updatedAt: now,
      updatedBy: this.auth.user()?.uid ?? current.updatedBy,
    };

    // Always persist locally in IndexedDB first so text is never lost on transient errors
    await this.idb.savePageContent(localContent);

    if (!this.hasRemoteApi) {
      const updatedPage: Page = {
        ...current,
        revision: current.revision + 1,
        updatedAt: now,
        updatedBy: localContent.updatedBy,
      };
      await this.idb.put('pages', updatedPage);
      this.upsertPageInSignal(updatedPage);
      this._saveStatus.set('saved_local');
      return { ...updatedPage, content: localContent };
    }

    try {
      const res = await firstValueFrom(
        this.http.put<{ page: PageWithContent }>(
          `${this.apiUrl}/api/pages/${pageId}/content`,
          { markdown, expectedRevision },
        ),
      );
      await this.idb.put('pages', res.page);
      await this.idb.savePageContent(res.page.content);
      this.upsertPageInSignal(res.page);
      this._saveStatus.set('synced');
      return res.page;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        const details = err.error?.error?.details as PageConflictErrorDetails | undefined;
        this._saveStatus.set('conflict');
        this._conflict.set({
          pageId,
          localMarkdown: markdown,
          serverMarkdown: details?.serverMarkdown ?? '',
          serverRevision: details?.currentRevision ?? expectedRevision + 1,
          serverUpdatedAt: details?.serverUpdatedAt ?? now,
        });
        return null;
      }

      // Network or transient error: keep local copy safely and queue sync
      await this.idb.enqueueSync({
        id: `content:${pageId}`,
        entityType: 'page_content',
        entityId: pageId,
        operation: 'upsert',
        payload: { markdown, expectedRevision },
        createdAt: now,
        retries: 0,
      });
      this._pendingSyncCount.set((await this.idb.getSyncQueue()).length);
      this._saveStatus.set('saved_local');
      this._saveError.set('Sin conexión con el servidor. Guardado localmente en IndexedDB.');
      return { ...current, content: localContent };
    }
  }

  async movePage(pageId: string, dto: MovePageDto): Promise<Page> {
    const current = this._pages().find((p) => p.id === pageId);
    if (!current) throw new Error('Página no encontrada.');

    const orgPages = this._pages().filter((p) => p.organizationId === current.organizationId);
    if (wouldCreateCycle(orgPages, pageId, dto.targetParentId)) {
      throw new Error('No puedes mover una página dentro de sí misma ni dentro de sus subpáginas.');
    }

    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ page: Page }>(`${this.apiUrl}/api/pages/${pageId}/move`, dto),
      );
      await this.idb.put('pages', res.page);
      this.upsertPageInSignal(res.page);
      return res.page;
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

    await this.idb.put('pages', updated);
    const updatedMap = new Map<string, Page>([[updated.id, updated]]);

    if (dto.targetWorkspaceId !== current.workspaceId && descendantIds.length > 0) {
      for (const descId of descendantIds) {
        const desc = this._pages().find((p) => p.id === descId);
        if (desc) {
          const movedDesc: Page = {
            ...desc,
            workspaceId: dto.targetWorkspaceId,
            updatedAt: now,
          };
          await this.idb.put('pages', movedDesc);
          updatedMap.set(movedDesc.id, movedDesc);
        }
      }
    }

    this._pages.update((list) => list.map((p) => updatedMap.get(p.id) ?? p));
    return updated;
  }

  async duplicatePage(pageId: string): Promise<PageWithContent> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ page: PageWithContent }>(
          `${this.apiUrl}/api/pages/${pageId}/duplicate`,
          {},
        ),
      );
      await this.idb.put('pages', res.page);
      await this.idb.savePageContent(res.page.content);
      this._pages.update((list) => [...list, res.page]);
      return res.page;
    }

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
    if (this.hasRemoteApi) {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}/api/pages/${pageId}`, {
          params: permanent ? { permanent: 'true' } : {},
        }),
      );
    }

    const target = this._pages().find((p) => p.id === pageId);
    if (!target) return;
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
      const updatedPages = this._pages().map((p) =>
        affected.has(p.id) ? { ...p, status: 'deleted' as const, updatedAt: now } : p,
      );
      await this.idb.putMany(
        'pages',
        updatedPages.filter((p) => affected.has(p.id)),
      );
      this._pages.set(updatedPages);
    }
  }

  async restorePage(pageId: string): Promise<Page> {
    if (this.hasRemoteApi) {
      const res = await firstValueFrom(
        this.http.post<{ page: Page }>(`${this.apiUrl}/api/pages/${pageId}/restore`, {}),
      );
      await this.idb.put('pages', res.page);
      this.upsertPageInSignal(res.page);
      return res.page;
    }

    const current = this._pages().find((p) => p.id === pageId);
    if (!current) throw new Error('Página no encontrada.');

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
    const updated: Page = {
      ...current,
      status: 'active',
      parentId: nextParentId,
      slug: ensureUniqueSlug(
        current.slug,
        siblings.map((p) => p.slug),
      ),
      updatedAt: new Date().toISOString(),
    };
    await this.idb.put('pages', updated);
    this.upsertPageInSignal(updated);
    return updated;
  }

  async searchPages(query: string, orgId?: string): Promise<SearchResultItem[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    if (this.hasRemoteApi) {
      try {
        const res = await firstValueFrom(
          this.http.get<{ results: SearchResultItem[] }>(`${this.apiUrl}/api/search`, {
            params: orgId ? { q, orgId } : { q },
          }),
        );
        return res.results;
      } catch {
        // Fallback to local IndexedDB search
      }
    }

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

  async getStorageStats(): Promise<StorageStats> {
    if (this.hasRemoteApi) {
      try {
        const res = await firstValueFrom(
          this.http.get<{ stats: StorageStats }>(`${this.apiUrl}/api/storage/stats`),
        );
        return res.stats;
      } catch {
        // Fallback to local calculation
      }
    }

    const contents = await this.idb.getAll<PageContent>('page_contents');
    const encoder = new TextEncoder();
    const totalContentBytes = contents.reduce(
      (acc, item) => acc + encoder.encode(item.markdown).byteLength,
      0,
    );
    const activePages = this._pages().filter((p) => p.status === 'active').length;
    const archivedPages = this._pages().filter((p) => p.status === 'archived').length;
    const deletedPages = this._pages().filter((p) => p.status === 'deleted').length;

    return {
      organizationsCount: this._organizations().filter((o) => o.status !== 'deleted').length,
      workspacesCount: this._workspaces().filter((w) => w.status !== 'deleted').length,
      pagesCount: activePages,
      archivedPagesCount: archivedPages,
      deletedPagesCount: deletedPages,
      totalContentBytes,
      estimatedDbBytes: totalContentBytes * 2 + activePages * 512,
      d1FreeTierLimitBytes: 5 * 1024 * 1024 * 1024,
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
    const userId = this.auth.user()?.uid ?? 'local-owner';
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

Bienvenido a **Trazena**. Esta página demuestra la jerarquía recursiva de documentación técnica.

## Principios clave

- [x] Separación de metadatos de navegación y contenido Markdown
- [x] Persistencia local offline-first en **IndexedDB**
- [x] Rutas jerárquicas canónicas con resolución de alias
- [ ] Conectar Firebase Authentication y Cloudflare D1 en producción

## Mapa de componentes

| Capa | Tecnología | Responsabilidad |
| --- | --- | --- |
| Frontend | Angular 22 + Atralume | Interfaz, árbol recursivo y editor Markdown |
| API | Cloudflare Workers + Hono | Autenticación JWT Web Crypto y reglas de negocio |
| Base de datos | Cloudflare D1 (SQLite) | Persistencia relacional, FTS5 y alias de rutas |

> Tip: Usa la barra de herramientas del editor o atajos como \`Ctrl+B\`, \`Ctrl+I\` y \`Ctrl+K\` para dar formato rápido.
`,
        excerpt: 'Bienvenido a Trazena. Esta página demuestra la jerarquía recursiva de documentación técnica.',
        wordCount: 95,
        updatedAt: now,
        updatedBy: userId,
      },
      {
        pageId: pageFrontend.id,
        markdown: `# Frontend

La capa de presentación utiliza **Angular Standalone**, **Signals** y **Atralume** sobre Taiga UI 5.

\`\`\`typescript
import { provideAtralume } from '@osmanjimenez/atralume';

export const appConfig = {
  providers: [provideAtralume()],
};
\`\`\`
`,
        excerpt: 'La capa de presentación utiliza Angular Standalone, Signals y Atralume sobre Taiga UI 5.',
        wordCount: 25,
        updatedAt: now,
        updatedBy: userId,
      },
      {
        pageId: pageBackend.id,
        markdown: `# Backend Serverless

Cloudflare Workers + Hono valida cada Firebase ID Token mediante **Web Crypto API (RS256)** y verifica pertenencia organizacional en D1.

\`\`\`sql
SELECT p.id, p.title, p.slug
FROM pages p
WHERE p.workspace_id = ? AND p.status = 'active'
ORDER BY p.position ASC;
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
