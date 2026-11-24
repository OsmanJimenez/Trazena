export type EntityStatus = 'active' | 'archived' | 'deleted';

export type OrganizationRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type WorkspaceRole = 'admin' | 'editor' | 'viewer';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface UserProfile {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserPreferences {
  userId: string;
  theme: ThemePreference;
  sidebarWidth: number;
  lastOrganizationId: string | null;
  lastWorkspaceId: string | null;
  lastPageId: string | null;
  editorMode: 'edit' | 'split' | 'preview';
  updatedAt: string;
}

export interface Organization {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  position: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface Page {
  id: string;
  organizationId: string;
  workspaceId: string;
  parentId: string | null;
  title: string;
  slug: string;
  icon: string | null;
  position: string;
  revision: number;
  status: EntityStatus;
  lastReviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string | null;
}

export interface PageContent {
  pageId: string;
  markdown: string;
  excerpt: string | null;
  wordCount: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PageWithContent extends Page {
  content: PageContent;
}

export interface PageTreeItem extends Page {
  children: PageTreeItem[];
}

export interface PageRouteAlias {
  id: string;
  pageId: string;
  organizationId: string;
  workspaceId: string;
  oldPath: string;
  createdAt: string;
}

export interface BreadcrumbSegment {
  type: 'organization' | 'workspace' | 'page';
  id: string;
  label: string;
  slug: string;
  icon: string | null;
  route: string;
}

export interface ResolvedRouteResult {
  organization: Organization;
  workspace: Workspace | null;
  page: PageWithContent | null;
  breadcrumbs: BreadcrumbSegment[];
  canonicalPath: string;
  redirectedFromAlias: boolean;
}

export interface SearchResultItem {
  pageId: string;
  organizationId: string;
  organizationSlug: string;
  workspaceId: string;
  workspaceSlug: string;
  title: string;
  slug: string;
  snippet: string;
  canonicalPath: string;
  updatedAt: string;
}

export interface StorageStats {
  organizationsCount: number;
  workspacesCount: number;
  pagesCount: number;
  archivedPagesCount: number;
  deletedPagesCount: number;
  totalContentBytes: number;
  estimatedDbBytes: number;
  d1FreeTierLimitBytes: number;
}

export interface OrganizationExportPayload {
  version: 1;
  exportedAt: string;
  organization: Organization;
  workspaces: Workspace[];
  pages: PageWithContent[];
}
