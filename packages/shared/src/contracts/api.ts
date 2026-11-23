import type {
  EntityStatus,
  Organization,
  Page,
  PageWithContent,
  ThemePreference,
  Workspace,
} from '../models/domain.js';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface CreateOrganizationDto {
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
}

export interface UpdateOrganizationDto {
  name?: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  position?: string;
  status?: EntityStatus;
}

export interface CreateWorkspaceDto {
  organizationId: string;
  name: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
}

export interface UpdateWorkspaceDto {
  name?: string;
  slug?: string;
  description?: string | null;
  icon?: string | null;
  position?: string;
  status?: EntityStatus;
}

export interface CreatePageDto {
  organizationId: string;
  workspaceId: string;
  parentId?: string | null;
  title: string;
  slug?: string;
  icon?: string | null;
  markdown?: string;
}

export interface UpdatePageDto {
  title?: string;
  slug?: string;
  icon?: string | null;
  position?: string;
  status?: EntityStatus;
}

export interface SavePageContentDto {
  markdown: string;
  expectedRevision: number;
}

export interface SavePageContentResponse {
  page: PageWithContent;
}

export interface PageConflictErrorDetails {
  currentRevision: number;
  serverUpdatedAt: string;
  serverMarkdown: string;
}

export interface MovePageDto {
  targetWorkspaceId: string;
  targetParentId: string | null;
  position?: string;
}

export interface DuplicatePageDto {
  includeChildren?: boolean;
  targetParentId?: string | null;
}

export interface UpdatePreferencesDto {
  theme?: ThemePreference;
  sidebarWidth?: number;
  lastOrganizationId?: string | null;
  lastWorkspaceId?: string | null;
  lastPageId?: string | null;
  editorMode?: 'edit' | 'split' | 'preview';
}

export interface ReorderItemsDto {
  orderedIds: string[];
}

export interface BootstrapPayload {
  organizations: Organization[];
  workspaces: Workspace[];
  pages: Page[];
}
