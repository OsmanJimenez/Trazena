import { Hono } from 'hono';
import { z } from 'zod';
import {
  collectDescendantIds,
  ensureUniqueSlug,
  extractMarkdownMetrics,
  generateNextPosition,
  generatePosition,
  slugify,
  wouldCreateCycle,
} from '@trazena/shared';
import type { AppContext } from '../env.js';
import {
  canWrite,
  getOrganizationRole,
  mapPage,
  mapPageWithContent,
  syncPageFts,
  type PageContentRow,
  type PageRow,
  type WorkspaceRow,
} from '../repositories/db.js';

const createPageSchema = z.object({
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  slug: z.string().trim().max(80).optional(),
  icon: z.string().max(64).nullable().optional(),
  markdown: z.string().optional(),
});

const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  icon: z.string().max(64).nullable().optional(),
  position: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
});

const saveContentSchema = z.object({
  markdown: z.string(),
  expectedRevision: z.number().int().min(1),
});

const movePageSchema = z.object({
  targetWorkspaceId: z.string().min(1),
  targetParentId: z.string().min(1).nullable(),
  position: z.string().min(1).max(64).optional(),
});

const duplicatePageSchema = z.object({
  includeChildren: z.boolean().optional(),
  targetParentId: z.string().min(1).nullable().optional(),
});

const reorderSchema = z.object({
  workspaceId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  orderedIds: z.array(z.string().min(1)).min(1),
});

async function computeRelativePath(
  db: D1Database,
  workspaceId: string,
  pageId: string,
): Promise<string> {
  const rows = await db
    .prepare(`SELECT id, parent_id, slug FROM pages WHERE workspace_id = ?`)
    .bind(workspaceId)
    .all<{ id: string; parent_id: string | null; slug: string }>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(pageId);
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor.slug);
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
  }
  return chain.join('/');
}

async function getSiblingSlugs(
  db: D1Database,
  workspaceId: string,
  parentId: string | null,
  excludePageId?: string,
): Promise<{ slug: string; position: string }[]> {
  if (parentId === null) {
    const query = excludePageId
      ? db
          .prepare(
            `SELECT slug, position FROM pages WHERE workspace_id = ? AND parent_id IS NULL AND status != 'deleted' AND id != ?`,
          )
          .bind(workspaceId, excludePageId)
      : db
          .prepare(
            `SELECT slug, position FROM pages WHERE workspace_id = ? AND parent_id IS NULL AND status != 'deleted'`,
          )
          .bind(workspaceId);
    return (await query.all<{ slug: string; position: string }>()).results;
  }

  const query = excludePageId
    ? db
        .prepare(
          `SELECT slug, position FROM pages WHERE workspace_id = ? AND parent_id = ? AND status != 'deleted' AND id != ?`,
        )
        .bind(workspaceId, parentId, excludePageId)
    : db
        .prepare(
          `SELECT slug, position FROM pages WHERE workspace_id = ? AND parent_id = ? AND status != 'deleted'`,
        )
        .bind(workspaceId, parentId);
  return (await query.all<{ slug: string; position: string }>()).results;
}

export const pagesRoutes = new Hono<AppContext>();

pagesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const workspaceId = c.req.query('workspaceId');
  if (!workspaceId) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceId is required.' } }, 400);
  }
  const ws = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(workspaceId)
    .first<WorkspaceRow>();
  if (!ws) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, ws.organization_id, user.id);
  if (!role) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const includeArchived = c.req.query('includeArchived') === 'true';
  const statusFilter = includeArchived ? `status != 'deleted'` : `status = 'active'`;
  const result = await c.env.DB.prepare(
    `SELECT * FROM pages WHERE workspace_id = ? AND ${statusFilter} ORDER BY position ASC, title ASC`,
  )
    .bind(workspaceId)
    .all<PageRow>();

  return c.json({ pages: result.results.map(mapPage) });
});

pagesRoutes.get('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const page = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!page) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, page.organization_id, user.id);
  if (!role) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();

  return c.json({ page: mapPageWithContent(page, content) });
});

pagesRoutes.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createPageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid page payload.', details: parsed.error.flatten() } },
      400,
    );
  }

  const ws = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(parsed.data.workspaceId)
    .first<WorkspaceRow>();
  if (!ws || ws.organization_id !== parsed.data.organizationId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found in organization.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, ws.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parentId = parsed.data.parentId ?? null;
  if (parentId) {
    const parent = await c.env.DB.prepare(
      `SELECT id, workspace_id, status FROM pages WHERE id = ?`,
    )
      .bind(parentId)
      .first<{ id: string; workspace_id: string; status: string }>();
    if (!parent || parent.workspace_id !== ws.id || parent.status === 'deleted') {
      return c.json({ error: { code: 'INVALID_PARENT', message: 'Parent page does not belong to this workspace.' } }, 400);
    }
  }

  const siblings = await getSiblingSlugs(c.env.DB, ws.id, parentId);
  const slug = ensureUniqueSlug(
    slugify(parsed.data.slug || parsed.data.title, 'page'),
    siblings.map((s) => s.slug),
  );
  const position = generateNextPosition(siblings.map((s) => s.position));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const markdown = parsed.data.markdown ?? `# ${parsed.data.title}\n\n`;
  const metrics = extractMarkdownMetrics(markdown);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO pages (id, organization_id, workspace_id, parent_id, title, slug, icon, position, revision, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?)`,
    ).bind(
      id,
      ws.organization_id,
      ws.id,
      parentId,
      parsed.data.title,
      slug,
      parsed.data.icon ?? 'file-text',
      position,
      now,
      now,
      user.id,
      user.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO page_contents (page_id, markdown, excerpt, word_count, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, markdown, metrics.excerpt, metrics.wordCount, now, user.id),
  ]);

  await syncPageFts(c.env.DB, id, ws.organization_id, parsed.data.title, markdown, 'active');

  const created = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();

  return c.json({ page: mapPageWithContent(created!, content) }, 201);
});

pagesRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parsed = updatePageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid page update.' } }, 400);
  }

  const now = new Date().toISOString();
  let nextSlug = current.slug;
  if (parsed.data.slug !== undefined && parsed.data.slug !== current.slug) {
    const oldPath = await computeRelativePath(c.env.DB, current.workspace_id, id);
    const siblings = await getSiblingSlugs(c.env.DB, current.workspace_id, current.parent_id, id);
    nextSlug = ensureUniqueSlug(
      slugify(parsed.data.slug, current.slug),
      siblings.map((s) => s.slug),
    );
    if (oldPath && nextSlug !== current.slug) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO page_route_aliases (id, page_id, organization_id, workspace_id, old_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), id, current.organization_id, current.workspace_id, oldPath, now)
        .run();
    }
  }

  const nextStatus = parsed.data.status ?? current.status;
  const nextTitle = parsed.data.title ?? current.title;

  await c.env.DB.prepare(
    `UPDATE pages
     SET title = ?, slug = ?, icon = ?, position = ?, status = ?, updated_at = ?, updated_by = ?
     WHERE id = ?`,
  )
    .bind(
      nextTitle,
      nextSlug,
      parsed.data.icon !== undefined ? parsed.data.icon : current.icon,
      parsed.data.position ?? current.position,
      nextStatus,
      now,
      user.id,
      id,
    )
    .run();

  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();
  await syncPageFts(
    c.env.DB,
    id,
    current.organization_id,
    nextTitle,
    content?.markdown ?? '',
    nextStatus,
  );

  const updated = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  return c.json({ page: mapPageWithContent(updated!, content) });
});

pagesRoutes.put('/:id/content', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parsed = saveContentSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid content payload.' } }, 400);
  }

  // Optimistic concurrency check
  if (current.revision !== parsed.data.expectedRevision) {
    const serverContent = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
      .bind(id)
      .first<PageContentRow>();
    return c.json(
      {
        error: {
          code: 'REVISION_CONFLICT',
          message: 'Page has been modified in another session.',
          details: {
            currentRevision: current.revision,
            serverUpdatedAt: current.updated_at,
            serverMarkdown: serverContent?.markdown ?? '',
          },
        },
      },
      409,
    );
  }

  const now = new Date().toISOString();
  const nextRevision = current.revision + 1;
  const metrics = extractMarkdownMetrics(parsed.data.markdown);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE pages SET revision = ?, updated_at = ?, updated_by = ? WHERE id = ? AND revision = ?`,
    ).bind(nextRevision, now, user.id, id, current.revision),
    c.env.DB.prepare(
      `INSERT INTO page_contents (page_id, markdown, excerpt, word_count, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET
         markdown = excluded.markdown,
         excerpt = excluded.excerpt,
         word_count = excluded.word_count,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    ).bind(id, parsed.data.markdown, metrics.excerpt, metrics.wordCount, now, user.id),
  ]);

  await syncPageFts(
    c.env.DB,
    id,
    current.organization_id,
    current.title,
    parsed.data.markdown,
    current.status,
  );

  const updated = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();

  return c.json({ page: mapPageWithContent(updated!, content) });
});

pagesRoutes.post('/:id/move', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parsed = movePageSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid move payload.' } }, 400);
  }

  const targetWs = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(parsed.data.targetWorkspaceId)
    .first<WorkspaceRow>();
  if (!targetWs || targetWs.organization_id !== current.organization_id) {
    return c.json(
      { error: { code: 'INVALID_WORKSPACE', message: 'Target workspace must belong to the same organization.' } },
      400,
    );
  }

  const allOrgPages = await c.env.DB.prepare(
    `SELECT id, parent_id, workspace_id FROM pages WHERE organization_id = ?`,
  )
    .bind(current.organization_id)
    .all<{ id: string; parent_id: string | null; workspace_id: string }>();

  const simplified = allOrgPages.results.map((r) => ({ id: r.id, parentId: r.parent_id }));

  if (wouldCreateCycle(simplified, id, parsed.data.targetParentId)) {
    return c.json(
      { error: { code: 'CYCLE_DETECTED', message: 'Cannot move a page into itself or one of its descendants.' } },
      400,
    );
  }

  if (parsed.data.targetParentId) {
    const targetParent = allOrgPages.results.find((p) => p.id === parsed.data.targetParentId);
    if (!targetParent || targetParent.workspace_id !== targetWs.id) {
      return c.json(
        { error: { code: 'INVALID_PARENT', message: 'Target parent must reside in target workspace.' } },
        400,
      );
    }
  }

  const oldPath = await computeRelativePath(c.env.DB, current.workspace_id, id);
  const siblings = await getSiblingSlugs(c.env.DB, targetWs.id, parsed.data.targetParentId, id);
  const nextSlug = ensureUniqueSlug(
    current.slug,
    siblings.map((s) => s.slug),
  );
  const nextPosition =
    parsed.data.position ?? generateNextPosition(siblings.map((s) => s.position));
  const now = new Date().toISOString();
  const descendantIds = collectDescendantIds(simplified, id);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE pages
       SET workspace_id = ?, parent_id = ?, slug = ?, position = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`,
    ).bind(targetWs.id, parsed.data.targetParentId, nextSlug, nextPosition, now, user.id, id),
  ];

  // Record alias for old path if moved
  if (oldPath) {
    statements.push(
      c.env.DB.prepare(
        `INSERT OR REPLACE INTO page_route_aliases (id, page_id, organization_id, workspace_id, old_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, current.organization_id, current.workspace_id, oldPath, now),
    );
  }

  // Keep subtree workspace consistent when moving across workspaces
  if (targetWs.id !== current.workspace_id && descendantIds.length > 0) {
    for (const descId of descendantIds) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE pages SET workspace_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
        ).bind(targetWs.id, now, user.id, descId),
      );
    }
  }

  await c.env.DB.batch(statements);

  const updated = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  return c.json({ page: mapPage(updated!) });
});

pagesRoutes.post('/:id/duplicate', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const source = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!source) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, source.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parsed = duplicatePageSchema.safeParse(await c.req.json().catch(() => ({})));
  const targetParentId =
    parsed.success && parsed.data.targetParentId !== undefined
      ? parsed.data.targetParentId
      : source.parent_id;

  const sourceContent = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();

  const siblings = await getSiblingSlugs(c.env.DB, source.workspace_id, targetParentId);
  const newTitle = `${source.title} (copia)`;
  const newSlug = ensureUniqueSlug(
    slugify(newTitle, `${source.slug}-copy`),
    siblings.map((s) => s.slug),
  );
  const position = generateNextPosition(siblings.map((s) => s.position));
  const newId = crypto.randomUUID();
  const now = new Date().toISOString();
  const markdown = sourceContent?.markdown ?? '';
  const metrics = extractMarkdownMetrics(markdown);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO pages (id, organization_id, workspace_id, parent_id, title, slug, icon, position, revision, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?)`,
    ).bind(
      newId,
      source.organization_id,
      source.workspace_id,
      targetParentId,
      newTitle,
      newSlug,
      source.icon,
      position,
      now,
      now,
      user.id,
      user.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO page_contents (page_id, markdown, excerpt, word_count, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(newId, markdown, metrics.excerpt, metrics.wordCount, now, user.id),
  ]);

  await syncPageFts(c.env.DB, newId, source.organization_id, newTitle, markdown, 'active');

  const created = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(newId)
    .first<PageRow>();
  const createdContent = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(newId)
    .first<PageContentRow>();
  return c.json({ page: mapPageWithContent(created!, createdContent) }, 201);
});

pagesRoutes.post('/reorder', async (c) => {
  const user = c.get('user');
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid reorder payload.' } }, 400);
  }
  const ws = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(parsed.data.workspaceId)
    .first<WorkspaceRow>();
  if (!ws) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, ws.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const now = new Date().toISOString();
  const statements = parsed.data.orderedIds.map((pageId, index) =>
    c.env.DB.prepare(
      `UPDATE pages SET position = ?, updated_at = ?, updated_by = ?
       WHERE id = ? AND workspace_id = ?`,
    ).bind(generatePosition(index), now, user.id, pageId, ws.id),
  );
  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }
  return c.json({ ok: true });
});

pagesRoutes.post('/:id/restore', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  // If parent was deleted, promote restored page to root of workspace to prevent orphans
  let nextParentId = current.parent_id;
  if (nextParentId) {
    const parent = await c.env.DB.prepare(`SELECT status FROM pages WHERE id = ?`)
      .bind(nextParentId)
      .first<{ status: string }>();
    if (!parent || parent.status === 'deleted') {
      nextParentId = null;
    }
  }

  const siblings = await getSiblingSlugs(c.env.DB, current.workspace_id, nextParentId, id);
  const nextSlug = ensureUniqueSlug(
    current.slug,
    siblings.map((s) => s.slug),
  );
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `UPDATE pages SET status = 'active', parent_id = ?, slug = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
  )
    .bind(nextParentId, nextSlug, now, user.id, id)
    .run();

  const content = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
    .bind(id)
    .first<PageContentRow>();
  await syncPageFts(
    c.env.DB,
    id,
    current.organization_id,
    current.title,
    content?.markdown ?? '',
    'active',
  );

  const restored = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  return c.json({ page: mapPage(restored!) });
});

pagesRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
    .bind(id)
    .first<PageRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const allWsPages = await c.env.DB.prepare(
    `SELECT id, parent_id FROM pages WHERE workspace_id = ?`,
  )
    .bind(current.workspace_id)
    .all<{ id: string; parent_id: string | null }>();
  const descendantIds = collectDescendantIds(
    allWsPages.results.map((r) => ({ id: r.id, parentId: r.parent_id })),
    id,
  );
  const allAffected = [id, ...descendantIds];
  const permanent = c.req.query('permanent') === 'true';

  if (permanent) {
    const statements: D1PreparedStatement[] = allAffected.map((pid) =>
      c.env.DB.prepare(`DELETE FROM pages_fts WHERE page_id = ?`).bind(pid),
    );
    statements.push(c.env.DB.prepare(`DELETE FROM pages WHERE id = ?`).bind(id));
    await c.env.DB.batch(statements);
  } else {
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (const pid of allAffected) {
      statements.push(
        c.env.DB.prepare(`DELETE FROM pages_fts WHERE page_id = ?`).bind(pid),
        c.env.DB.prepare(
          `UPDATE pages SET status = 'deleted', updated_at = ?, updated_by = ? WHERE id = ?`,
        ).bind(now, user.id, pid),
      );
    }
    await c.env.DB.batch(statements);
  }

  return c.json({ ok: true, affectedCount: allAffected.length });
});
