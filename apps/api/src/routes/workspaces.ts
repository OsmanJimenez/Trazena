import { Hono } from 'hono';
import { z } from 'zod';
import {
  ensureUniqueSlug,
  generateNextPosition,
  generatePosition,
  slugify,
} from '@trazena/shared';
import type { AppContext } from '../env.js';
import {
  canAdmin,
  canWrite,
  getOrganizationRole,
  mapWorkspace,
  type WorkspaceRow,
} from '../repositories/db.js';

const createWorkspaceSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  slug: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(64).nullable().optional(),
  position: z.string().min(1).max(64).optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
});

const reorderSchema = z.object({
  organizationId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export const workspacesRoutes = new Hono<AppContext>();

workspacesRoutes.get('/', async (c) => {
  const user = c.get('user');
  const organizationId = c.req.query('organizationId');
  if (!organizationId) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'organizationId is required.' } }, 400);
  }
  const role = await getOrganizationRole(c.env.DB, organizationId, user.id);
  if (!role) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const includeArchived = c.req.query('includeArchived') === 'true';
  const statusFilter = includeArchived ? `status != 'deleted'` : `status = 'active'`;

  const result = await c.env.DB.prepare(
    `SELECT * FROM workspaces WHERE organization_id = ? AND ${statusFilter} ORDER BY position ASC, name ASC`,
  )
    .bind(organizationId)
    .all<WorkspaceRow>();

  return c.json({ workspaces: result.results.map(mapWorkspace) });
});

workspacesRoutes.post('/', async (c) => {
  const user = c.get('user');
  const parsed = createWorkspaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid workspace payload.', details: parsed.error.flatten() } },
      400,
    );
  }

  const role = await getOrganizationRole(c.env.DB, parsed.data.organizationId, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const existing = await c.env.DB.prepare(
    `SELECT slug, position FROM workspaces WHERE organization_id = ? AND status != 'deleted'`,
  )
    .bind(parsed.data.organizationId)
    .all<{ slug: string; position: string }>();

  const baseSlug = slugify(parsed.data.slug || parsed.data.name, 'space');
  const slug = ensureUniqueSlug(
    baseSlug,
    existing.results.map((r) => r.slug),
  );
  const position = generateNextPosition(existing.results.map((r) => r.position));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO workspaces (id, organization_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      parsed.data.organizationId,
      parsed.data.name,
      slug,
      parsed.data.description ?? null,
      parsed.data.icon ?? 'book',
      position,
      now,
      now,
      user.id,
      user.id,
    )
    .run();

  const created = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(id)
    .first<WorkspaceRow>();

  return c.json({ workspace: mapWorkspace(created!) }, 201);
});

workspacesRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(id)
    .first<WorkspaceRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const parsed = updateWorkspaceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid update payload.' } }, 400);
  }

  let nextSlug = current.slug;
  if (parsed.data.slug !== undefined) {
    const siblings = await c.env.DB.prepare(
      `SELECT slug FROM workspaces WHERE organization_id = ? AND id != ? AND status != 'deleted'`,
    )
      .bind(current.organization_id, id)
      .all<{ slug: string }>();
    nextSlug = ensureUniqueSlug(
      slugify(parsed.data.slug, current.slug),
      siblings.results.map((r) => r.slug),
    );
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE workspaces
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

  const updated = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(id)
    .first<WorkspaceRow>();
  return c.json({ workspace: mapWorkspace(updated!) });
});

workspacesRoutes.post('/reorder', async (c) => {
  const user = c.get('user');
  const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid reorder payload.' } }, 400);
  }
  const role = await getOrganizationRole(c.env.DB, parsed.data.organizationId, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }

  const now = new Date().toISOString();
  const statements = parsed.data.orderedIds.map((wsId, idx) =>
    c.env.DB.prepare(
      `UPDATE workspaces SET position = ?, updated_at = ?, updated_by = ?
       WHERE id = ? AND organization_id = ?`,
    ).bind(generatePosition(idx), now, user.id, wsId, parsed.data.organizationId),
  );
  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }
  return c.json({ ok: true });
});

workspacesRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const current = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
    .bind(id)
    .first<WorkspaceRow>();
  if (!current) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Workspace not found.' } }, 404);
  }

  const role = await getOrganizationRole(c.env.DB, current.organization_id, user.id);
  if (!canAdmin(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Admin permission required.' } }, 403);
  }

  const permanent = c.req.query('permanent') === 'true';
  if (permanent) {
    await c.env.DB.prepare(`DELETE FROM workspaces WHERE id = ?`).bind(id).run();
  } else {
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      `UPDATE workspaces SET status = 'deleted', updated_at = ?, updated_by = ? WHERE id = ?`,
    )
      .bind(now, user.id, id)
      .run();
  }
  return c.json({ ok: true });
});
