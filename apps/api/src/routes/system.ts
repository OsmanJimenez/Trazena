import { Hono } from 'hono';
import { z } from 'zod';
import {
  buildCanonicalPagePath,
  type BreadcrumbSegment,
  type ResolvedRouteResult,
  type SearchResultItem,
  type StorageStats,
} from '@trazena/shared';
import type { AppContext } from '../env.js';
import {
  mapOrg,
  mapPage,
  mapPageWithContent,
  mapPreferences,
  mapWorkspace,
  type OrgRow,
  type PageContentRow,
  type PageRow,
  type PreferencesRow,
  type WorkspaceRow,
} from '../repositories/db.js';

const updatePrefsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  sidebarWidth: z.number().int().min(200).max(520).optional(),
  lastOrganizationId: z.string().nullable().optional(),
  lastWorkspaceId: z.string().nullable().optional(),
  lastPageId: z.string().nullable().optional(),
  editorMode: z.enum(['edit', 'split', 'preview']).optional(),
});

export const systemRoutes = new Hono<AppContext>();

systemRoutes.get('/me', async (c) => {
  const user = c.get('user');
  const prefs = await c.env.DB.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`)
    .bind(user.id)
    .first<PreferencesRow>();

  return c.json({
    user,
    preferences: prefs
      ? mapPreferences(prefs)
      : {
          userId: user.id,
          theme: 'system',
          sidebarWidth: 280,
          lastOrganizationId: null,
          lastWorkspaceId: null,
          lastPageId: null,
          editorMode: 'split',
          updatedAt: user.updatedAt,
        },
  });
});

systemRoutes.patch('/me/preferences', async (c) => {
  const user = c.get('user');
  const parsed = updatePrefsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid preferences.' } }, 400);
  }

  const current = await c.env.DB.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`)
    .bind(user.id)
    .first<PreferencesRow>();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO user_preferences (user_id, theme, sidebar_width, last_organization_id, last_workspace_id, last_page_id, editor_mode, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       theme = excluded.theme,
       sidebar_width = excluded.sidebar_width,
       last_organization_id = excluded.last_organization_id,
       last_workspace_id = excluded.last_workspace_id,
       last_page_id = excluded.last_page_id,
       editor_mode = excluded.editor_mode,
       updated_at = excluded.updated_at`,
  )
    .bind(
      user.id,
      parsed.data.theme ?? current?.theme ?? 'system',
      parsed.data.sidebarWidth ?? current?.sidebar_width ?? 280,
      parsed.data.lastOrganizationId !== undefined
        ? parsed.data.lastOrganizationId
        : (current?.last_organization_id ?? null),
      parsed.data.lastWorkspaceId !== undefined
        ? parsed.data.lastWorkspaceId
        : (current?.last_workspace_id ?? null),
      parsed.data.lastPageId !== undefined
        ? parsed.data.lastPageId
        : (current?.last_page_id ?? null),
      parsed.data.editorMode ?? current?.editor_mode ?? 'split',
      now,
    )
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`)
    .bind(user.id)
    .first<PreferencesRow>();

  return c.json({ preferences: mapPreferences(updated!) });
});

systemRoutes.get('/bootstrap', async (c) => {
  const user = c.get('user');
  const orgs = await c.env.DB.prepare(
    `SELECT o.* FROM organizations o
     INNER JOIN organization_members m ON m.organization_id = o.id
     WHERE m.user_id = ? AND o.status != 'deleted'
     ORDER BY o.position ASC, o.name ASC`,
  )
    .bind(user.id)
    .all<OrgRow>();

  if (orgs.results.length === 0) {
    return c.json({ organizations: [], workspaces: [], pages: [] });
  }

  const workspaces = await c.env.DB.prepare(
    `SELECT w.* FROM workspaces w
     INNER JOIN organization_members m ON m.organization_id = w.organization_id
     WHERE m.user_id = ? AND w.status != 'deleted'
     ORDER BY w.position ASC, w.name ASC`,
  )
    .bind(user.id)
    .all<WorkspaceRow>();

  const pages = await c.env.DB.prepare(
    `SELECT p.* FROM pages p
     INNER JOIN organization_members m ON m.organization_id = p.organization_id
     WHERE m.user_id = ? AND p.status != 'deleted'
     ORDER BY p.position ASC, p.title ASC`,
  )
    .bind(user.id)
    .all<PageRow>();

  return c.json({
    organizations: orgs.results.map(mapOrg),
    workspaces: workspaces.results.map(mapWorkspace),
    pages: pages.results.map(mapPage),
  });
});

systemRoutes.get('/resolve', async (c) => {
  const user = c.get('user');
  const orgSlug = c.req.query('org')?.trim();
  const wsSlug = c.req.query('workspace')?.trim();
  const pagePath = c.req.query('path')?.replace(/^\/+|\/+$/g, '') ?? '';

  if (!orgSlug) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'org query param is required.' } }, 400);
  }

  const orgRow = await c.env.DB.prepare(
    `SELECT o.* FROM organizations o
     INNER JOIN organization_members m ON m.organization_id = o.id
     WHERE m.user_id = ? AND o.slug = ? AND o.status != 'deleted' LIMIT 1`,
  )
    .bind(user.id, orgSlug)
    .first<OrgRow>();

  if (!orgRow) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Organization not found.' } }, 404);
  }

  const org = mapOrg(orgRow);
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
    const result: ResolvedRouteResult = {
      organization: org,
      workspace: null,
      page: null,
      breadcrumbs,
      canonicalPath: `/o/${org.slug}`,
      redirectedFromAlias: false,
    };
    return c.json(result);
  }

  const wsRow = await c.env.DB.prepare(
    `SELECT * FROM workspaces WHERE organization_id = ? AND slug = ? AND status != 'deleted' LIMIT 1`,
  )
    .bind(org.id, wsSlug)
    .first<WorkspaceRow>();

  if (!wsRow) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found.' } }, 404);
  }

  const ws = mapWorkspace(wsRow);
  breadcrumbs.push({
    type: 'workspace',
    id: ws.id,
    label: ws.name,
    slug: ws.slug,
    icon: ws.icon,
    route: `/o/${org.slug}/${ws.slug}`,
  });

  if (!pagePath) {
    const result: ResolvedRouteResult = {
      organization: org,
      workspace: ws,
      page: null,
      breadcrumbs,
      canonicalPath: `/o/${org.slug}/${ws.slug}`,
      redirectedFromAlias: false,
    };
    return c.json(result);
  }

  const wsPages = await c.env.DB.prepare(
    `SELECT * FROM pages WHERE workspace_id = ? AND status != 'deleted'`,
  )
    .bind(ws.id)
    .all<PageRow>();

  const segments = pagePath.split('/').filter(Boolean);
  let parentId: string | null = null;
  let matchedPage: PageRow | null = null;
  const pageChain: PageRow[] = [];

  for (const seg of segments) {
    const found = wsPages.results.find(
      (p) => p.parent_id === parentId && p.slug === seg,
    );
    if (!found) {
      matchedPage = null;
      break;
    }
    matchedPage = found;
    pageChain.push(found);
    parentId = found.id;
  }

  let redirectedFromAlias = false;

  if (!matchedPage) {
    const alias = await c.env.DB.prepare(
      `SELECT page_id FROM page_route_aliases
       WHERE organization_id = ? AND workspace_id = ? AND old_path = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(org.id, ws.id, pagePath)
      .first<{ page_id: string }>();

    if (alias) {
      const target = wsPages.results.find((p) => p.id === alias.page_id);
      if (target) {
        matchedPage = target;
        redirectedFromAlias = true;
        // Rebuild chain from target up to root
        pageChain.length = 0;
        const byId = new Map(wsPages.results.map((p) => [p.id, p]));
        const visited = new Set<string>();
        let cursor: PageRow | undefined = target;
        while (cursor && !visited.has(cursor.id)) {
          visited.add(cursor.id);
          pageChain.unshift(cursor);
          cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
        }
      }
    }
  }

  if (!matchedPage) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }

  let runningPath = `/o/${org.slug}/${ws.slug}`;
  for (const p of pageChain) {
    runningPath = `${runningPath}/${p.slug}`;
    breadcrumbs.push({
      type: 'page',
      id: p.id,
      label: p.title,
      slug: p.slug,
      icon: p.icon,
      route: runningPath,
    });
  }

  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(matchedPage.id)
    .first<PageContentRow>();

  const result: ResolvedRouteResult = {
    organization: org,
    workspace: ws,
    page: mapPageWithContent(matchedPage, content),
    breadcrumbs,
    canonicalPath: runningPath,
    redirectedFromAlias,
  };
  return c.json(result);
});

systemRoutes.get('/search', async (c) => {
  const user = c.get('user');
  const rawQuery = c.req.query('q')?.trim() ?? '';
  const orgId = c.req.query('orgId')?.trim();

  if (rawQuery.length < 2) {
    return c.json({ results: [] });
  }

  // Escape FTS5 special operators and use prefix match
  const safeQuery = rawQuery
    .replace(/["'*()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(' ');

  if (!safeQuery) {
    return c.json({ results: [] });
  }

  const rows = await c.env.DB.prepare(
    `SELECT
       p.id AS page_id,
       p.organization_id,
       o.slug AS org_slug,
       p.workspace_id,
       w.slug AS ws_slug,
       p.title,
       p.slug,
       p.updated_at,
       snippet(pages_fts, 3, '', '', '…', 24) AS snippet
     FROM pages_fts
     INNER JOIN pages p ON p.id = pages_fts.page_id
     INNER JOIN organizations o ON o.id = p.organization_id
     INNER JOIN workspaces w ON w.id = p.workspace_id
     INNER JOIN organization_members m ON m.organization_id = o.id
     WHERE m.user_id = ?
       AND p.status = 'active'
       AND (? IS NULL OR p.organization_id = ?)
       AND pages_fts MATCH ?
     ORDER BY bm25(pages_fts) ASC
     LIMIT 30`,
  )
    .bind(user.id, orgId ?? null, orgId ?? null, safeQuery)
    .all<{
      page_id: string;
      organization_id: string;
      org_slug: string;
      workspace_id: string;
      ws_slug: string;
      title: string;
      slug: string;
      updated_at: string;
      snippet: string;
    }>();

  // Build canonical paths per workspace
  const wsIds = [...new Set(rows.results.map((r) => r.workspace_id))];
  const wsPagesMap = new Map<string, { id: string; parentId: string | null; slug: string }[]>();
  for (const wsId of wsIds) {
    const pRows = await c.env.DB.prepare(
      `SELECT id, parent_id, slug FROM pages WHERE workspace_id = ? AND status != 'deleted'`,
    )
      .bind(wsId)
      .all<{ id: string; parent_id: string | null; slug: string }>();
    wsPagesMap.set(
      wsId,
      pRows.results.map((r) => ({ id: r.id, parentId: r.parent_id, slug: r.slug })),
    );
  }

  const results: SearchResultItem[] = rows.results.map((row) => ({
    pageId: row.page_id,
    organizationId: row.organization_id,
    organizationSlug: row.org_slug,
    workspaceId: row.workspace_id,
    workspaceSlug: row.ws_slug,
    title: row.title,
    slug: row.slug,
    snippet: row.snippet || '',
    canonicalPath: buildCanonicalPagePath(
      row.org_slug,
      row.ws_slug,
      wsPagesMap.get(row.workspace_id) ?? [],
      row.page_id,
    ),
    updatedAt: row.updated_at,
  }));

  return c.json({ results });
});

systemRoutes.get('/trash', async (c) => {
  const user = c.get('user');
  const pages = await c.env.DB.prepare(
    `SELECT p.* FROM pages p
     INNER JOIN organization_members m ON m.organization_id = p.organization_id
     WHERE m.user_id = ? AND p.status = 'deleted'
     ORDER BY p.updated_at DESC
     LIMIT 100`,
  )
    .bind(user.id)
    .all<PageRow>();

  return c.json({ pages: pages.results.map(mapPage) });
});

systemRoutes.get('/storage/stats', async (c) => {
  const user = c.get('user');
  const orgCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM organizations o
     INNER JOIN organization_members m ON m.organization_id = o.id
     WHERE m.user_id = ? AND o.status != 'deleted'`,
  )
    .bind(user.id)
    .first<{ count: number }>();

  const wsCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM workspaces w
     INNER JOIN organization_members m ON m.organization_id = w.organization_id
     WHERE m.user_id = ? AND w.status != 'deleted'`,
  )
    .bind(user.id)
    .first<{ count: number }>();

  const pageCounts = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active_count,
       SUM(CASE WHEN p.status = 'archived' THEN 1 ELSE 0 END) AS archived_count,
       SUM(CASE WHEN p.status = 'deleted' THEN 1 ELSE 0 END) AS deleted_count
     FROM pages p
     INNER JOIN organization_members m ON m.organization_id = p.organization_id
     WHERE m.user_id = ?`,
  )
    .bind(user.id)
    .first<{ active_count: number; archived_count: number; deleted_count: number }>();

  const bytesRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(LENGTH(CAST(pc.markdown AS BLOB))), 0) AS bytes
     FROM page_contents pc
     INNER JOIN pages p ON p.id = pc.page_id
     INNER JOIN organization_members m ON m.organization_id = p.organization_id
     WHERE m.user_id = ?`,
  )
    .bind(user.id)
    .first<{ bytes: number }>();

  const totalContentBytes = bytesRow?.bytes ?? 0;
  const stats: StorageStats = {
    organizationsCount: orgCount?.count ?? 0,
    workspacesCount: wsCount?.count ?? 0,
    pagesCount: pageCounts?.active_count ?? 0,
    archivedPagesCount: pageCounts?.archived_count ?? 0,
    deletedPagesCount: pageCounts?.deleted_count ?? 0,
    totalContentBytes,
    estimatedDbBytes: totalContentBytes * 2 + ((pageCounts?.active_count ?? 0) * 512),
    d1FreeTierLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB D1 free tier
  };

  return c.json({ stats });
});
