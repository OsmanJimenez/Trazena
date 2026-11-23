import type {
  Organization,
  OrganizationRole,
  Page,
  PageContent,
  PageWithContent,
  UserPreferences,
  Workspace,
} from '@trazena/shared';

export interface OrgRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: string;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

export interface WorkspaceRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: string;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

export interface PageRow {
  id: string;
  organization_id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  slug: string;
  icon: string | null;
  position: string;
  revision: number;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string | null;
}

export interface PageContentRow {
  page_id: string;
  markdown: string;
  excerpt: string | null;
  word_count: number;
  updated_at: string;
  updated_by: string | null;
}

export interface PreferencesRow {
  user_id: string;
  theme: 'light' | 'dark' | 'system';
  sidebar_width: number;
  last_organization_id: string | null;
  last_workspace_id: string | null;
  last_page_id: string | null;
  editor_mode: 'edit' | 'split' | 'preview';
  updated_at: string;
}

export function mapOrg(row: OrgRow): Organization {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    position: row.position,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function mapWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    icon: row.icon,
    position: row.position,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function mapPage(row: PageRow): Page {
  return {
    id: row.id,
    organizationId: row.organization_id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    title: row.title,
    slug: row.slug,
    icon: row.icon,
    position: row.position,
    revision: row.revision,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

export function mapPageContent(row: PageContentRow): PageContent {
  return {
    pageId: row.page_id,
    markdown: row.markdown,
    excerpt: row.excerpt,
    wordCount: row.word_count,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function mapPageWithContent(
  pageRow: PageRow,
  contentRow: PageContentRow | null,
): PageWithContent {
  const page = mapPage(pageRow);
  return {
    ...page,
    content: contentRow
      ? mapPageContent(contentRow)
      : {
          pageId: page.id,
          markdown: '',
          excerpt: '',
          wordCount: 0,
          updatedAt: page.updatedAt,
          updatedBy: page.updatedBy,
        },
  };
}

export function mapPreferences(row: PreferencesRow): UserPreferences {
  return {
    userId: row.user_id,
    theme: row.theme,
    sidebarWidth: row.sidebar_width,
    lastOrganizationId: row.last_organization_id,
    lastWorkspaceId: row.last_workspace_id,
    lastPageId: row.last_page_id,
    editorMode: row.editor_mode,
    updatedAt: row.updated_at,
  };
}

/**
 * Verifies that `userId` belongs to `organizationId` and returns their role.
 */
export async function getOrganizationRole(
  db: D1Database,
  organizationId: string,
  userId: string,
): Promise<OrganizationRole | null> {
  const row = await db
    .prepare(
      `SELECT role FROM organization_members
       WHERE organization_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(organizationId, userId)
    .first<{ role: OrganizationRole }>();
  return row?.role ?? null;
}

export function canWrite(role: OrganizationRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function canAdmin(role: OrganizationRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export async function syncPageFts(
  db: D1Database,
  pageId: string,
  organizationId: string,
  title: string,
  markdown: string,
  status: 'active' | 'archived' | 'deleted',
): Promise<void> {
  await db.prepare(`DELETE FROM pages_fts WHERE page_id = ?`).bind(pageId).run();
  if (status === 'active') {
    await db
      .prepare(
        `INSERT INTO pages_fts (page_id, organization_id, title, markdown)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(pageId, organizationId, title, markdown)
      .run();
  }
}
