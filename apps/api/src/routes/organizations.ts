import { Hono } from 'hono';
import { z } from 'zod';
import {
  ensureUniqueSlug,
  generateNextPosition,
  generatePosition,
  slugify,
  type OrganizationExportPayload,
} from '@trazena/shared';
import type { AppContext } from '../env.js';
import {
  canAdmin,
  getOrganizationRole,
  mapOrg,
  mapPageWithContent,
  mapWorkspace,
  type OrgRow,
  type PageContentRow,
  type PageRow,
  type WorkspaceRow,
} from '../repositories/db.js';

const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
});

const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  position: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
});

const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const organizationsRoutes = new Hono<AppContext>();

organizationsRoutes.get('/', async (c) => {
  const user = c.get('user');
  const includeArchived = c.req.query('includeArchived') === 'true';
  const statusFilter = includeArchived ? `o.status != 'deleted'` : `o.status = 'active'`;

  const result = await c.env.DB.prepare(
    `SELECT o.* FROM organizations o
     INNER JOIN organization_members m ON m.organization_id = o.id
     WHERE m.user_id = ? AND ${statusFilter}
     ORDER BY o.position ASC, o.name ASC`,
  )
    .bind(user.id)
    .all<OrgRow>();

  return c.json({ organizations: result.results.map(mapOrg) });
});

organizationsRoutes.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createOrgSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid organization payload.', details: parsed.error.flatten() } },
      400,
    );
  }

  const existing = await c.env.DB.prepare(
    `SELECT slug, position FROM organizations WHERE owner_id = ? AND status != 'deleted'`,
  )
    .bind(user.id)
    .all<{ slug: string; position: string }>();

  const baseSlug = slugify(parsed.data.slug || parsed.data.name, 'organization');
  const slug = ensureUniqueSlug(
    baseSlug,
    existing.results.map((r) => r.slug),
  );
  const position = generateNextPosition(existing.results.map((r) => r.position));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO organizations (id, owner_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    ).bind(
      id,
      user.id,
      parsed.data.name,
      slug,
      parsed.data.description ?? null,
      parsed.data.icon ?? 'folder',
      position,
      now,
      now,
      user.id,
      user.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO organization_members (organization_id, user_id, role, created_at)
       VALUES (?, ?, 'owner', ?)`,
    ).bind(id, user.id, now),
  ]);

  const created = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`)
    .bind(id)
    .first<OrgRow>();

  return c.json({ organization: mapOrg(created!) }, 201);
});

organizationsRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await getOrganizationRole(c.env.DB, id, user.id);
  if (!canAdmin(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions for this organization.' } }, 403);
  }

  const parsed = updateOrgSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid update payload.', details: parsed.error.flatten() } },
      400,
    );
  }

  const current = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`)
    .bind(id)
    .first<OrgRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Organization not found.' } }, 404);
  }

  let nextSlug = current.slug;
  if (parsed.data.slug !== undefined) {
    const siblings = await c.env.DB.prepare(
      `SELECT slug FROM organizations WHERE owner_id = ? AND id != ? AND status != 'deleted'`,
    )
      .bind(current.owner_id, id)
      .all<{ slug: string }>();
    nextSlug = ensureUniqueSlug(
      slugify(parsed.data.slug, current.slug),
      siblings.results.map((r) => r.slug),
    );
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE organizations
     SET name = ?, slug = ?, description = ?, icon = ?, position = ?, status = ?, updated_at = ?, updated_by = ?
     WHERE id = ?`,
  )
    .bind(
      parsed.data.name ?? current.name,
      nextSlug,
      parsed.data.description !== undefined ? parsed.data.description : current.description,
      parsed.data.icon !== undefined ? parsed.data.icon : current.icon,
      parsed.data.position ?? current.position,
      parsed.data.status ?? current.status,
      now,
      user.id,
      id,
    )
    .run();

  const updated = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`)
    .bind(id)
    .first<OrgRow>();

  return c.json({ organization: mapOrg(updated!) });
});

organizationsRoutes.post('/reorder', async (c) => {
  const user = c.get('user');
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid reorder payload.' } }, 400);
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < parsed.data.orderedIds.length; i++) {
    const orgId = parsed.data.orderedIds[i];
    const role = await getOrganizationRole(c.env.DB, orgId, user.id);
    if (!canAdmin(role)) continue;
    statements.push(
      c.env.DB.prepare(
        `UPDATE organizations SET position = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      ).bind(generatePosition(i), now, user.id, orgId),
    );
  }
  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }
  return c.json({ ok: true });
});

organizationsRoutes.get('/:id/export', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await getOrganizationRole(c.env.DB, id, user.id);
  if (!role) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const org = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`)
    .bind(id)
    .first<OrgRow>();
  if (!org) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Organization not found.' } }, 404);
  }

  const workspaces = await c.env.DB.prepare(
    `SELECT * FROM workspaces WHERE organization_id = ? AND status != 'deleted' ORDER BY position ASC`,
  )
    .bind(id)
    .all<WorkspaceRow>();

  const pages = await c.env.DB.prepare(
    `SELECT * FROM pages WHERE organization_id = ? AND status != 'deleted' ORDER BY position ASC`,
  )
    .bind(id)
    .all<PageRow>();

  const contents = await c.env.DB.prepare(
    `SELECT pc.* FROM page_contents pc
     INNER JOIN pages p ON p.id = pc.page_id
     WHERE p.organization_id = ? AND p.status != 'deleted'`,
  )
    .bind(id)
    .all<PageContentRow>();

  const contentMap = new Map(contents.results.map((row) => [row.page_id, row]));

  const payload: OrganizationExportPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    organization: mapOrg(org),
    workspaces: workspaces.results.map(mapWorkspace),
    pages: pages.results.map((p) => mapPageWithContent(p, contentMap.get(p.id) ?? null)),
  };

  return c.json(payload);
});

organizationsRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const role = await getOrganizationRole(c.env.DB, id, user.id);
  if (role !== 'owner') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Only the owner can delete an organization.' } }, 403);
  }

  const permanent = c.req.query('permanent') === 'true';
  if (permanent) {
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM pages_fts WHERE organization_id = ?`).bind(id),
      c.env.DB.prepare(`DELETE FROM organizations WHERE id = ?`).bind(id),
    ]);
  } else {
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM pages_fts WHERE organization_id = ?`).bind(id),
      c.env.DB.prepare(
        `UPDATE organizations SET status = 'deleted', updated_at = ?, updated_by = ? WHERE id = ?`,
      ).bind(now, user.id, id),
    ]);
  }

  return c.json({ ok: true });
});
