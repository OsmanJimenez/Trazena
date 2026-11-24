import { Hono } from 'hono';
import { z } from 'zod';
import {
  computeContentHash,
  extractMarkdownMetrics,
  type PageHistoryVersion,
  type SyncDeviceInfo,
  type SyncPullEvent,
  type SyncPullResponse,
  type SyncPushOperationResult,
  type SyncPushResponse,
} from '@trazena/shared';
import type { AppContext } from '../env.js';
import {
  canAdmin,
  canWrite,
  getOrganizationRole,
  mapOrg,
  mapPageWithContent,
  mapWorkspace,
  syncPageFts,
  type OrgRow,
  type PageContentRow,
  type PageRow,
  type WorkspaceRow,
} from '../repositories/db.js';

const MAX_HISTORY_PER_PAGE = 3;

const pushSchema = z.object({
  deviceId: z.string().min(1).max(120),
  deviceName: z.string().max(80).optional(),
  appVersion: z.string().max(32).optional(),
  operations: z
    .array(
      z.object({
        operationId: z.string().min(1).max(120),
        entityType: z.enum([
          'organization',
          'workspace',
          'page',
          'tag',
          'page_tag',
          'property_definition',
          'property_value',
          'saved_view',
          'template',
          'favorite',
          'reminder',
          'daily_note',
          'page_review',
        ]),
        entityId: z.string().min(1).max(120),
        operation: z.enum(['create', 'update', 'move', 'archive', 'restore', 'delete']),
        baseRevision: z.number().int().nullable(),
        payload: z.record(z.unknown()),
        createdAt: z.string(),
      }),
    )
    .max(200),
});

const bulkDeleteHistorySchema = z.object({
  versionIds: z.array(z.string().min(1)).min(1).max(200),
});

const updateDeviceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

interface HistoryRow {
  id: string;
  page_id: string;
  organization_id: string;
  workspace_id: string;
  revision: number;
  content: string;
  content_hash: string;
  byte_size: number;
  created_at: string;
  created_by: string;
  source_device_id: string | null;
  sync_operation_id: string | null;
}

function mapHistory(row: HistoryRow): PageHistoryVersion {
  return {
    id: row.id,
    pageId: row.page_id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    revision: row.revision,
    content: row.content,
    contentHash: row.content_hash,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    createdBy: row.created_by,
    sourceDeviceId: row.source_device_id,
    syncOperationId: row.sync_operation_id,
  };
}

async function recordSyncEvent(
  db: D1Database,
  ev: {
    organizationId: string;
    entityType: 'organization' | 'workspace' | 'page';
    entityId: string;
    operation: 'create' | 'update' | 'move' | 'archive' | 'restore' | 'delete';
    revision: number | null;
    operationId: string;
    deviceId: string | null;
    actorId: string;
    createdAt: string;
  },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO sync_events (organization_id, entity_type, entity_id, operation, revision, operation_id, device_id, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ev.organizationId,
      ev.entityType,
      ev.entityId,
      ev.operation,
      ev.revision,
      ev.operationId,
      ev.deviceId,
      ev.actorId,
      ev.createdAt,
    )
    .run();
  return Number(res.meta.last_row_id ?? 0);
}

/**
 * Saves a full snapshot of the previous Markdown content if it actually changed,
 * and enforces the max-3 previous snapshots retention policy per page.
 */
async function saveSnapshotAndRotate(
  db: D1Database,
  params: {
    pageId: string;
    organizationId: string;
    workspaceId: string;
    previousRevision: number;
    previousMarkdown: string;
    nextMarkdown: string;
    actorId: string;
    deviceId: string | null;
    operationId: string | null;
  },
): Promise<void> {
  const [prevHash, nextHash] = await Promise.all([
    computeContentHash(params.previousMarkdown),
    computeContentHash(params.nextMarkdown),
  ]);
  if (prevHash === nextHash) return;

  const now = new Date().toISOString();
  const byteSize = new TextEncoder().encode(params.previousMarkdown).byteLength;

  await db
    .prepare(
      `INSERT INTO page_history_versions
        (id, page_id, organization_id, workspace_id, revision, content, content_hash, byte_size, created_at, created_by, source_device_id, sync_operation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      params.pageId,
      params.organizationId,
      params.workspaceId,
      params.previousRevision,
      params.previousMarkdown,
      prevHash,
      byteSize,
      now,
      params.actorId,
      params.deviceId,
      params.operationId,
    )
    .run();

  // Rotate: keep only the newest MAX_HISTORY_PER_PAGE (3) previous versions
  const existing = await db
    .prepare(
      `SELECT id FROM page_history_versions WHERE page_id = ? ORDER BY created_at DESC, revision DESC`,
    )
    .bind(params.pageId)
    .all<{ id: string }>();

  if (existing.results.length > MAX_HISTORY_PER_PAGE) {
    const toDelete = existing.results.slice(MAX_HISTORY_PER_PAGE);
    await db.batch(
      toDelete.map((row) =>
        db.prepare(`DELETE FROM page_history_versions WHERE id = ?`).bind(row.id),
      ),
    );
  }
}

const SEEDED_ORGS: Record<string, { name: string; slug: string; description: string; icon: string }> = {
  'org-trazena': {
    name: 'Trazena',
    slug: 'trazena',
    description: 'Guía oficial, características y arquitectura Local-First de Trazena.',
    icon: 'layers',
  },
  'org-personal': {
    name: 'Personal',
    slug: 'personal',
    description: 'Espacio personal para notas rápidas, aprendizaje e ideas.',
    icon: 'folder',
  },
};

const SEEDED_WORKSPACES: Record<string, { name: string; slug: string; description: string; icon: string }> = {
  'ws-guia': {
    name: 'Guía de uso',
    slug: 'guia-de-uso',
    description: 'Cómo organizar tu conocimiento, usar el editor Markdown y sincronizar.',
    icon: 'book',
  },
  'ws-notas': {
    name: 'Notas',
    slug: 'notas',
    description: 'Apuntes personales, listas de tareas e ideas diarias.',
    icon: 'book',
  },
};

/**
 * Verifies the authenticated user can write to `orgId`.
 * If `orgId` does not exist yet in D1 (e.g. a locally seeded default org or offline-created org),
 * provisions it under the authenticated owner so child workspace/page syncs succeed seamlessly.
 */
async function ensureOrgWriteAccess(
  db: D1Database,
  orgId: string,
  userId: string,
  now: string,
): Promise<boolean> {
  if (!orgId) return false;
  const role = await getOrganizationRole(db, orgId, userId);
  if (canWrite(role)) return true;

  const existing = await db
    .prepare(`SELECT id FROM organizations WHERE id = ?`)
    .bind(orgId)
    .first<{ id: string }>();
  if (existing) return false;

  const seed = SEEDED_ORGS[orgId] ?? {
    name: orgId === 'org-trazena' ? 'Trazena' : 'Organización',
    slug: orgId.slice(0, 32),
    description: '',
    icon: 'folder',
  };

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO organizations
          (id, owner_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, '0000001000', 'active', ?, ?, ?, ?)`,
      )
      .bind(orgId, userId, seed.name, seed.slug, seed.description || null, seed.icon, now, now, userId, userId),
    db
      .prepare(
        `INSERT OR IGNORE INTO organization_members (organization_id, user_id, role, created_at)
         VALUES (?, ?, 'owner', ?)`,
      )
      .bind(orgId, userId, now),
  ]);
  return true;
}

async function ensureWorkspaceExists(
  db: D1Database,
  wsId: string,
  orgId: string,
  userId: string,
  now: string,
): Promise<void> {
  if (!wsId || !orgId) return;
  const existing = await db
    .prepare(`SELECT id FROM workspaces WHERE id = ?`)
    .bind(wsId)
    .first<{ id: string }>();
  if (existing) return;

  const seed = SEEDED_WORKSPACES[wsId] ?? {
    name: 'General',
    slug: wsId.slice(0, 32),
    description: '',
    icon: 'book',
  };

  await db
    .prepare(
      `INSERT OR IGNORE INTO workspaces
        (id, organization_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, '0000001000', 'active', ?, ?, ?, ?)`,
    )
    .bind(wsId, orgId, seed.name, seed.slug, seed.description || null, seed.icon, now, now, userId, userId)
    .run();
}

export const syncRoutes = new Hono<AppContext>();

syncRoutes.post('/sync/push', async (c) => {
  const user = c.get('user');
  const parsed = pushSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid sync push payload.', details: parsed.error.flatten() } },
      400,
    );
  }

  const now = new Date().toISOString();
  const { deviceId, deviceName, appVersion, operations } = parsed.data;

  // Register / touch device
  await c.env.DB.prepare(
    `INSERT INTO sync_devices (device_id, user_id, name, last_synced_at, app_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(device_id, user_id) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       app_version = excluded.app_version,
       updated_at = excluded.updated_at`,
  )
    .bind(deviceId, user.id, deviceName || 'Dispositivo Trazena', now, appVersion || '0.2.0', now, now)
    .run();

  const results: SyncPushOperationResult[] = [];

  for (const op of operations) {
    // 1. Idempotency check by operation_id
    const existingEvent = await c.env.DB.prepare(
      `SELECT sequence, revision FROM sync_events WHERE operation_id = ? LIMIT 1`,
    )
      .bind(op.operationId)
      .first<{ sequence: number; revision: number | null }>();

    if (existingEvent) {
      results.push({
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        status: 'duplicate',
        sequence: existingEvent.sequence,
        revision: existingEvent.revision ?? undefined,
      });
      continue;
    }

    try {
      if (op.entityType === 'organization') {
        const p = op.payload as Record<string, string | null | undefined>;
        const existingOrg = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`)
          .bind(op.entityId)
          .first<OrgRow>();

        if (!existingOrg) {
          await c.env.DB.batch([
            c.env.DB.prepare(
              `INSERT INTO organizations (id, owner_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              op.entityId,
              user.id,
              String(p['name'] ?? 'Organización'),
              String(p['slug'] ?? op.entityId.slice(0, 12)),
              p['description'] ?? null,
              p['icon'] ?? 'folder',
              String(p['position'] ?? '0000001000'),
              (p['status'] as 'active' | 'archived' | 'deleted') ?? 'active',
              op.createdAt,
              now,
              user.id,
              user.id,
            ),
            c.env.DB.prepare(
              `INSERT OR IGNORE INTO organization_members (organization_id, user_id, role, created_at)
               VALUES (?, ?, 'owner', ?)`,
            ).bind(op.entityId, user.id, now),
          ]);
        } else {
          const role = await getOrganizationRole(c.env.DB, existingOrg.id, user.id);
          if (!canAdmin(role)) {
            results.push({
              operationId: op.operationId,
              entityType: op.entityType,
              entityId: op.entityId,
              status: 'rejected',
              error: 'FORBIDDEN',
            });
            continue;
          }
          await c.env.DB.prepare(
            `UPDATE organizations SET name = ?, slug = ?, description = ?, icon = ?, position = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
          )
            .bind(
              String(p['name'] ?? existingOrg.name),
              String(p['slug'] ?? existingOrg.slug),
              p['description'] !== undefined ? p['description'] : existingOrg.description,
              p['icon'] !== undefined ? p['icon'] : existingOrg.icon,
              String(p['position'] ?? existingOrg.position),
              (p['status'] as 'active' | 'archived' | 'deleted') ?? existingOrg.status,
              now,
              user.id,
              op.entityId,
            )
            .run();
        }

        const seq = await recordSyncEvent(c.env.DB, {
          organizationId: op.entityId,
          entityType: 'organization',
          entityId: op.entityId,
          operation: op.operation,
          revision: null,
          operationId: op.operationId,
          deviceId,
          actorId: user.id,
          createdAt: now,
        });
        results.push({
          operationId: op.operationId,
          entityType: op.entityType,
          entityId: op.entityId,
          status: 'applied',
          sequence: seq,
        });
      } else if (op.entityType === 'workspace') {
        const p = op.payload as Record<string, string | null | undefined>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({
            operationId: op.operationId,
            entityType: op.entityType,
            entityId: op.entityId,
            status: 'rejected',
            error: 'FORBIDDEN',
          });
          continue;
        }

        const existingWs = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`)
          .bind(op.entityId)
          .first<WorkspaceRow>();

        if (!existingWs) {
          await c.env.DB.prepare(
            `INSERT INTO workspaces (id, organization_id, name, slug, description, icon, position, status, created_at, updated_at, created_by, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
            .bind(
              op.entityId,
              orgId,
              String(p['name'] ?? 'Espacio'),
              String(p['slug'] ?? op.entityId.slice(0, 12)),
              p['description'] ?? null,
              p['icon'] ?? 'book',
              String(p['position'] ?? '0000001000'),
              (p['status'] as 'active' | 'archived' | 'deleted') ?? 'active',
              op.createdAt,
              now,
              user.id,
              user.id,
            )
            .run();
        } else {
          await c.env.DB.prepare(
            `UPDATE workspaces SET name = ?, slug = ?, description = ?, icon = ?, position = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
          )
            .bind(
              String(p['name'] ?? existingWs.name),
              String(p['slug'] ?? existingWs.slug),
              p['description'] !== undefined ? p['description'] : existingWs.description,
              p['icon'] !== undefined ? p['icon'] : existingWs.icon,
              String(p['position'] ?? existingWs.position),
              (p['status'] as 'active' | 'archived' | 'deleted') ?? existingWs.status,
              now,
              user.id,
              op.entityId,
            )
            .run();
        }

        const seq = await recordSyncEvent(c.env.DB, {
          organizationId: orgId,
          entityType: 'workspace',
          entityId: op.entityId,
          operation: op.operation,
          revision: null,
          operationId: op.operationId,
          deviceId,
          actorId: user.id,
          createdAt: now,
        });
        results.push({
          operationId: op.operationId,
          entityType: op.entityType,
          entityId: op.entityId,
          status: 'applied',
          sequence: seq,
        });
      } else if (op.entityType === 'page') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        const wsId = String(p['workspaceId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({
            operationId: op.operationId,
            entityType: op.entityType,
            entityId: op.entityId,
            status: 'rejected',
            error: 'FORBIDDEN',
          });
          continue;
        }
        await ensureWorkspaceExists(c.env.DB, wsId, orgId, user.id, now);

        const existingPage = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`)
          .bind(op.entityId)
          .first<PageRow>();
        const existingContent = existingPage
          ? await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`)
            .bind(op.entityId)
            .first<PageContentRow>()
          : null;

        const hasMarkdown = typeof p['markdown'] === 'string';
        const nextMarkdown = hasMarkdown
          ? String(p['markdown'])
          : (existingContent?.markdown ?? '');

        if (!existingPage) {
          const metrics = extractMarkdownMetrics(nextMarkdown);
          const nextTitle = String(p['title'] ?? 'Sin título');
          const nextStatus = (p['status'] as 'active' | 'archived' | 'deleted') ?? 'active';
          await c.env.DB.batch([
            c.env.DB.prepare(
              `INSERT INTO pages (id, organization_id, workspace_id, parent_id, title, slug, icon, position, revision, status, created_at, updated_at, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
            ).bind(
              op.entityId,
              orgId,
              wsId,
              (p['parentId'] as string | null) ?? null,
              nextTitle,
              String(p['slug'] ?? op.entityId.slice(0, 12)),
              (p['icon'] as string | null) ?? 'file-text',
              String(p['position'] ?? '0000001000'),
              nextStatus,
              op.createdAt,
              now,
              user.id,
              user.id,
            ),
            c.env.DB.prepare(
              `INSERT INTO page_contents (page_id, markdown, excerpt, word_count, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(op.entityId, nextMarkdown, metrics.excerpt, metrics.wordCount, now, user.id),
          ]);
          await syncPageFts(c.env.DB, op.entityId, orgId, nextTitle, nextMarkdown, nextStatus);
          const seq = await recordSyncEvent(c.env.DB, {
            organizationId: orgId,
            entityType: 'page',
            entityId: op.entityId,
            operation: op.operation,
            revision: 1,
            operationId: op.operationId,
            deviceId,
            actorId: user.id,
            createdAt: now,
          });
          results.push({
            operationId: op.operationId,
            entityType: op.entityType,
            entityId: op.entityId,
            status: 'applied',
            revision: 1,
            sequence: seq,
          });
        } else {
          // Conflict detection: never last-write-wins for concurrent Markdown edits
          if (
            hasMarkdown &&
            op.baseRevision !== null &&
            existingPage.revision !== op.baseRevision
          ) {
            results.push({
              operationId: op.operationId,
              entityType: op.entityType,
              entityId: op.entityId,
              status: 'conflict',
              conflict: {
                serverRevision: existingPage.revision,
                serverMarkdown: existingContent?.markdown ?? '',
                serverUpdatedAt: existingPage.updated_at,
              },
            });
            continue;
          }

          const nextTitle = String(p['title'] ?? existingPage.title);
          const nextSlug = String(p['slug'] ?? existingPage.slug);
          const nextStatus =
            (p['status'] as 'active' | 'archived' | 'deleted') ?? existingPage.status;
          const nextParentId =
            p['parentId'] !== undefined ? (p['parentId'] as string | null) : existingPage.parent_id;
          const nextWsId = wsId || existingPage.workspace_id;
          const nextPosition = String(p['position'] ?? existingPage.position);
          const nextIcon =
            p['icon'] !== undefined ? (p['icon'] as string | null) : existingPage.icon;

          let nextRevision = existingPage.revision;
          if (hasMarkdown) {
            await saveSnapshotAndRotate(c.env.DB, {
              pageId: existingPage.id,
              organizationId: existingPage.organization_id,
              workspaceId: nextWsId,
              previousRevision: existingPage.revision,
              previousMarkdown: existingContent?.markdown ?? '',
              nextMarkdown,
              actorId: user.id,
              deviceId,
              operationId: op.operationId,
            });
            nextRevision = existingPage.revision + 1;
            const metrics = extractMarkdownMetrics(nextMarkdown);
            await c.env.DB.prepare(
              `INSERT INTO page_contents (page_id, markdown, excerpt, word_count, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(page_id) DO UPDATE SET
                 markdown = excluded.markdown,
                 excerpt = excluded.excerpt,
                 word_count = excluded.word_count,
                 updated_at = excluded.updated_at,
                 updated_by = excluded.updated_by`,
            )
              .bind(existingPage.id, nextMarkdown, metrics.excerpt, metrics.wordCount, now, user.id)
              .run();
          }

          await c.env.DB.prepare(
            `UPDATE pages
             SET workspace_id = ?, parent_id = ?, title = ?, slug = ?, icon = ?, position = ?, revision = ?, status = ?, updated_at = ?, updated_by = ?
             WHERE id = ?`,
          )
            .bind(
              nextWsId,
              nextParentId,
              nextTitle,
              nextSlug,
              nextIcon,
              nextPosition,
              nextRevision,
              nextStatus,
              now,
              user.id,
              existingPage.id,
            )
            .run();

          await syncPageFts(
            c.env.DB,
            existingPage.id,
            existingPage.organization_id,
            nextTitle,
            nextMarkdown,
            nextStatus,
          );

          const seq = await recordSyncEvent(c.env.DB, {
            organizationId: existingPage.organization_id,
            entityType: 'page',
            entityId: existingPage.id,
            operation: op.operation,
            revision: nextRevision,
            operationId: op.operationId,
            deviceId,
            actorId: user.id,
            createdAt: now,
          });
          results.push({
            operationId: op.operationId,
            entityType: op.entityType,
            entityId: op.entityId,
            status: 'applied',
            revision: nextRevision,
            sequence: seq,
          });
        }
      } else if (op.entityType === 'tag') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        await c.env.DB.prepare(
          `INSERT INTO tags (id, organization_id, name, normalized_name, color, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, normalized_name = excluded.normalized_name, color = excluded.color, status = excluded.status, updated_at = excluded.updated_at`,
        )
          .bind(op.entityId, orgId, String(p['name'] ?? ''), String(p['normalizedName'] ?? ''), String(p['color'] ?? '#0f766e'), String(p['status'] ?? 'active'), op.createdAt, now)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'page_tag') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        if (op.operation === 'delete') {
          await c.env.DB.prepare(`DELETE FROM page_tags WHERE id = ?`).bind(op.entityId).run();
        } else {
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO page_tags (id, page_id, tag_id, organization_id, created_at) VALUES (?, ?, ?, ?, ?)`,
          )
            .bind(op.entityId, String(p['pageId'] ?? ''), String(p['tagId'] ?? ''), orgId, op.createdAt)
            .run();
        }
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'property_definition') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        await c.env.DB.prepare(
          `INSERT INTO property_definitions (id, organization_id, name, type, options_json, position, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, options_json = excluded.options_json, position = excluded.position, status = excluded.status, updated_at = excluded.updated_at`,
        )
          .bind(op.entityId, orgId, String(p['name'] ?? ''), String(p['type'] ?? 'text'), JSON.stringify(p['options'] ?? []), String(p['position'] ?? '0000001000'), String(p['status'] ?? 'active'), op.createdAt, now)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'property_value') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        if (op.operation === 'delete') {
          await c.env.DB.prepare(`DELETE FROM property_values WHERE id = ?`).bind(op.entityId).run();
        } else {
          await c.env.DB.prepare(
            `INSERT INTO property_values (id, page_id, property_id, organization_id, value_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          )
            .bind(op.entityId, String(p['pageId'] ?? ''), String(p['propertyId'] ?? ''), orgId, JSON.stringify(p['value'] ?? null), now)
            .run();
        }
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'saved_view') {
        const p = op.payload as Record<string, unknown>;
        await c.env.DB.prepare(
          `INSERT INTO saved_views (id, user_id, organization_id, name, config_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, status = excluded.status, updated_at = excluded.updated_at`,
        )
          .bind(op.entityId, user.id, (p['organizationId'] as string | null) ?? null, String(p['name'] ?? ''), JSON.stringify(p), String(p['status'] ?? 'active'), op.createdAt, now)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'template') {
        const p = op.payload as Record<string, unknown>;
        await c.env.DB.prepare(
          `INSERT INTO templates (id, user_id, organization_id, name, category, description, markdown, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, description = excluded.description, markdown = excluded.markdown, status = excluded.status, updated_at = excluded.updated_at`,
        )
          .bind(op.entityId, user.id, (p['organizationId'] as string | null) ?? null, String(p['name'] ?? ''), String(p['category'] ?? 'General'), String(p['description'] ?? ''), String(p['markdown'] ?? ''), String(p['status'] ?? 'active'), op.createdAt, now)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'favorite') {
        const p = op.payload as Record<string, unknown>;
        if (op.operation === 'delete') {
          await c.env.DB.prepare(`DELETE FROM user_favorites WHERE id = ? AND user_id = ?`).bind(op.entityId, user.id).run();
        } else {
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO user_favorites (id, user_id, page_id, created_at) VALUES (?, ?, ?, ?)`,
          )
            .bind(op.entityId, user.id, String(p['pageId'] ?? ''), op.createdAt)
            .run();
        }
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'reminder') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        if (op.operation === 'delete') {
          await c.env.DB.prepare(`DELETE FROM page_reminders WHERE id = ? AND user_id = ?`).bind(op.entityId, user.id).run();
        } else {
          await c.env.DB.prepare(
            `INSERT INTO page_reminders (id, user_id, organization_id, workspace_id, page_id, title, due_date, due_time, status, snoozed_until, completed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, due_date = excluded.due_date, due_time = excluded.due_time, status = excluded.status, snoozed_until = excluded.snoozed_until, completed_at = excluded.completed_at, updated_at = excluded.updated_at`,
          )
            .bind(
              op.entityId,
              user.id,
              orgId,
              String(p['workspaceId'] ?? ''),
              String(p['pageId'] ?? ''),
              String(p['title'] ?? ''),
              String(p['dueDate'] ?? ''),
              (p['dueTime'] as string | null) ?? null,
              String(p['status'] ?? 'pending'),
              (p['snoozedUntil'] as string | null) ?? null,
              (p['completedAt'] as string | null) ?? null,
              op.createdAt,
              now,
            )
            .run();
        }
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'daily_note') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        await c.env.DB.prepare(
          `INSERT INTO daily_notes (id, organization_id, workspace_id, page_id, note_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET page_id = excluded.page_id, updated_at = excluded.updated_at`,
        )
          .bind(op.entityId, orgId, String(p['workspaceId'] ?? ''), String(p['pageId'] ?? ''), String(p['noteDate'] ?? ''), op.createdAt, now)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      } else if (op.entityType === 'page_review') {
        const p = op.payload as Record<string, unknown>;
        const orgId = String(p['organizationId'] ?? '');
        if (!(await ensureOrgWriteAccess(c.env.DB, orgId, user.id, now))) {
          results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'rejected', error: 'FORBIDDEN' });
          continue;
        }
        // Update review date metadata ONLY — never creates a Markdown history snapshot
        await c.env.DB.prepare(`UPDATE pages SET last_reviewed_at = ? WHERE id = ?`)
          .bind(String(p['lastReviewedAt'] ?? now), op.entityId)
          .run();
        results.push({ operationId: op.operationId, entityType: op.entityType, entityId: op.entityId, status: 'applied' });
      }
    } catch (err) {
      results.push({
        operationId: op.operationId,
        entityType: op.entityType,
        entityId: op.entityId,
        status: 'rejected',
        error: err instanceof Error ? err.message : 'SYNC_OP_FAILED',
      });
    }
  }

  const maxSeqRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sequence), 0) AS latest FROM sync_events`,
  ).first<{ latest: number }>();

  const response: SyncPushResponse = {
    results,
    latestSequence: maxSeqRow?.latest ?? 0,
  };
  return c.json(response);
});

syncRoutes.get('/sync/pull', async (c) => {
  const user = c.get('user');
  const since = Math.max(0, Number.parseInt(c.req.query('since') ?? '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') ?? '100', 10) || 100));

  const maxSeqRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sequence), 0) AS latest, COALESCE(MIN(sequence), 0) AS earliest FROM sync_events`,
  ).first<{ latest: number; earliest: number }>();

  const latestSequence = maxSeqRow?.latest ?? 0;
  const earliestSequence = maxSeqRow?.earliest ?? 0;

  // Full bootstrap pull when since === 0 or cursor predates retained events
  const requiresFullResync = since === 0 || (earliestSequence > 1 && since < earliestSequence - 1);

  if (requiresFullResync) {
    const orgs = await c.env.DB.prepare(
      `SELECT o.* FROM organizations o
       INNER JOIN organization_members m ON m.organization_id = o.id
       WHERE m.user_id = ?`,
    )
      .bind(user.id)
      .all<OrgRow>();

    const workspaces = await c.env.DB.prepare(
      `SELECT w.* FROM workspaces w
       INNER JOIN organization_members m ON m.organization_id = w.organization_id
       WHERE m.user_id = ?`,
    )
      .bind(user.id)
      .all<WorkspaceRow>();

    const pages = await c.env.DB.prepare(
      `SELECT p.* FROM pages p
       INNER JOIN organization_members m ON m.organization_id = p.organization_id
       WHERE m.user_id = ?`,
    )
      .bind(user.id)
      .all<PageRow>();

    const contents = await c.env.DB.prepare(
      `SELECT pc.* FROM page_contents pc
       INNER JOIN pages p ON p.id = pc.page_id
       INNER JOIN organization_members m ON m.organization_id = p.organization_id
       WHERE m.user_id = ?`,
    )
      .bind(user.id)
      .all<PageContentRow>();

    const contentMap = new Map(contents.results.map((r) => [r.page_id, r]));

    const payload: SyncPullResponse = {
      since,
      latestSequence,
      hasMore: false,
      requiresFullResync: true,
      events: [],
      organizations: orgs.results.map(mapOrg),
      workspaces: workspaces.results.map(mapWorkspace),
      pages: pages.results.map((p) => mapPageWithContent(p, contentMap.get(p.id) ?? null)),
    };
    return c.json(payload);
  }

  const eventRows = await c.env.DB.prepare(
    `SELECT e.* FROM sync_events e
     INNER JOIN organization_members m ON m.organization_id = e.organization_id
     WHERE m.user_id = ? AND e.sequence > ?
     ORDER BY e.sequence ASC
     LIMIT ?`,
  )
    .bind(user.id, since, limit + 1)
    .all<{
      sequence: number;
      organization_id: string;
      entity_type: 'organization' | 'workspace' | 'page';
      entity_id: string;
      operation: 'create' | 'update' | 'move' | 'archive' | 'restore' | 'delete';
      revision: number | null;
      operation_id: string;
      device_id: string | null;
      actor_id: string;
      created_at: string;
    }>();

  const hasMore = eventRows.results.length > limit;
  const pageEvents = hasMore ? eventRows.results.slice(0, limit) : eventRows.results;
  const events: SyncPullEvent[] = pageEvents.map((r) => ({
    sequence: r.sequence,
    organizationId: r.organization_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    operation: r.operation,
    revision: r.revision,
    operationId: r.operation_id,
    deviceId: r.device_id,
    actorId: r.actor_id,
    createdAt: r.created_at,
  }));

  const orgIds = [...new Set(events.filter((e) => e.entityType === 'organization').map((e) => e.entityId))];
  const wsIds = [...new Set(events.filter((e) => e.entityType === 'workspace').map((e) => e.entityId))];
  const pageIds = [...new Set(events.filter((e) => e.entityType === 'page').map((e) => e.entityId))];

  const organizations: OrgRow[] = [];
  for (const id of orgIds) {
    const row = await c.env.DB.prepare(`SELECT * FROM organizations WHERE id = ?`).bind(id).first<OrgRow>();
    if (row) organizations.push(row);
  }
  const workspaces: WorkspaceRow[] = [];
  for (const id of wsIds) {
    const row = await c.env.DB.prepare(`SELECT * FROM workspaces WHERE id = ?`).bind(id).first<WorkspaceRow>();
    if (row) workspaces.push(row);
  }
  const pagesWithContent = [];
  for (const id of pageIds) {
    const pRow = await c.env.DB.prepare(`SELECT * FROM pages WHERE id = ?`).bind(id).first<PageRow>();
    if (pRow) {
      const cRow = await c.env.DB.prepare(`SELECT * FROM page_contents WHERE page_id = ?`).bind(id).first<PageContentRow>();
      pagesWithContent.push(mapPageWithContent(pRow, cRow));
    }
  }

  const batchMaxSeq = events.length > 0 ? events[events.length - 1].sequence : latestSequence;

  const response: SyncPullResponse = {
    since,
    latestSequence: batchMaxSeq,
    hasMore,
    requiresFullResync: false,
    events,
    organizations: organizations.map(mapOrg),
    workspaces: workspaces.map(mapWorkspace),
    pages: pagesWithContent,
  };
  return c.json(response);
});

// --- Page History Endpoints ---

syncRoutes.get('/pages/:id/history', async (c) => {
  const user = c.get('user');
  const pageId = c.req.param('id');
  const page = await c.env.DB.prepare(`SELECT organization_id FROM pages WHERE id = ?`)
    .bind(pageId)
    .first<{ organization_id: string }>();
  if (!page) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Page not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, page.organization_id, user.id);
  if (!role) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } }, 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM page_history_versions WHERE page_id = ? ORDER BY created_at DESC LIMIT 3`,
  )
    .bind(pageId)
    .all<HistoryRow>();

  return c.json({ versions: rows.results.map(mapHistory) });
});

syncRoutes.get('/history', async (c) => {
  const user = c.get('user');
  const orgId = c.req.query('organizationId');
  const rows = await c.env.DB.prepare(
    `SELECT h.* FROM page_history_versions h
     INNER JOIN organization_members m ON m.organization_id = h.organization_id
     WHERE m.user_id = ? AND (? IS NULL OR h.organization_id = ?)
     ORDER BY h.created_at DESC
     LIMIT 300`,
  )
    .bind(user.id, orgId ?? null, orgId ?? null)
    .all<HistoryRow>();

  return c.json({ versions: rows.results.map(mapHistory) });
});

syncRoutes.delete('/pages/:id/history/:versionId', async (c) => {
  const user = c.get('user');
  const versionId = c.req.param('versionId');
  const row = await c.env.DB.prepare(`SELECT organization_id FROM page_history_versions WHERE id = ?`)
    .bind(versionId)
    .first<{ organization_id: string }>();
  if (!row) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'History version not found.' } }, 404);
  }
  const role = await getOrganizationRole(c.env.DB, row.organization_id, user.id);
  if (!canWrite(role)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }, 403);
  }
  await c.env.DB.prepare(`DELETE FROM page_history_versions WHERE id = ?`).bind(versionId).run();
  return c.json({ ok: true });
});

syncRoutes.post('/history/bulk-delete', async (c) => {
  const user = c.get('user');
  const parsed = bulkDeleteHistorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid versionIds.' } }, 400);
  }

  let deletedCount = 0;
  for (const versionId of parsed.data.versionIds) {
    const row = await c.env.DB.prepare(`SELECT organization_id FROM page_history_versions WHERE id = ?`)
      .bind(versionId)
      .first<{ organization_id: string }>();
    if (!row) continue;
    const role = await getOrganizationRole(c.env.DB, row.organization_id, user.id);
    if (!canWrite(role)) continue;
    await c.env.DB.prepare(`DELETE FROM page_history_versions WHERE id = ?`).bind(versionId).run();
    deletedCount++;
  }
  return c.json({ ok: true, deletedCount });
});

// --- Devices Endpoints ---

syncRoutes.get('/devices', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT * FROM sync_devices WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(user.id)
    .all<{
      device_id: string;
      user_id: string;
      name: string;
      last_synced_at: string | null;
      app_version: string;
      created_at: string;
      updated_at: string;
    }>();

  const devices: SyncDeviceInfo[] = rows.results.map((r) => ({
    deviceId: r.device_id,
    ownerUid: r.user_id,
    name: r.name,
    lastSyncedAt: r.last_synced_at,
    appVersion: r.app_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return c.json({ devices });
});

syncRoutes.patch('/devices/:deviceId', async (c) => {
  const user = c.get('user');
  const deviceId = c.req.param('deviceId');
  const parsed = updateDeviceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid device name.' } }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE sync_devices SET name = ?, updated_at = ? WHERE device_id = ? AND user_id = ?`,
  )
    .bind(parsed.data.name, now, deviceId, user.id)
    .run();
  return c.json({ ok: true });
});
