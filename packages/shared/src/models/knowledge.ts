import type { EntityStatus, Organization, PageWithContent, Workspace } from './domain.js';

export type PropertyType =
  | 'text'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'multi-select';

export interface Tag {
  id: string;
  organizationId: string;
  name: string;
  normalizedName: string;
  color: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PageTag {
  id: string; // `${pageId}:${tagId}`
  pageId: string;
  tagId: string;
  organizationId: string;
  createdAt: string;
}

export interface PropertyDefinition {
  id: string;
  organizationId: string;
  name: string;
  type: PropertyType;
  options: string[];
  position: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export type PropertyScalarValue = string | number | boolean | string[] | null;

export interface PropertyValue {
  id: string; // `${pageId}:${propertyId}`
  pageId: string;
  propertyId: string;
  organizationId: string;
  value: PropertyScalarValue;
  updatedAt: string;
}

export interface UserFavorite {
  id: string; // `${ownerUid}:${pageId}`
  ownerUid: string;
  pageId: string;
  createdAt: string;
}

export interface RecentVisit {
  id: string; // `${ownerUid}:${pageId}`
  ownerUid: string;
  pageId: string;
  visitedAt: string;
}

export interface DocumentTemplate {
  id: string;
  organizationId: string | null; // null = global personal template
  name: string;
  category: string;
  description: string;
  markdown: string;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export type FilterField =
  | 'organizationId'
  | 'workspaceId'
  | 'parentId'
  | 'title'
  | 'content'
  | 'tags'
  | 'status'
  | 'favorite'
  | 'pendingSync'
  | 'createdAt'
  | 'updatedAt'
  | `prop:${string}`;

export type FilterOperator =
  | 'contains'
  | 'not_contains'
  | 'equals'
  | 'not_equals'
  | 'includes'
  | 'before'
  | 'after'
  | 'between'
  | 'is_true'
  | 'is_false';

export interface FilterCondition {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  value: string;
  valueTo?: string; // for 'between' dates
}

export interface FilterGroup {
  combinator: 'AND' | 'OR';
  conditions: FilterCondition[];
}

export type ExplorerSortBy =
  | 'relevance'
  | 'title_asc'
  | 'title_desc'
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'created_asc';

export type ExplorerGroupBy =
  | 'none'
  | 'organization'
  | 'workspace'
  | 'status'
  | 'tag';

export interface SavedView {
  id: string;
  organizationId: string | null;
  name: string;
  query: string;
  viewMode: 'list' | 'table';
  filterGroup: FilterGroup;
  sortBy: ExplorerSortBy;
  groupBy: ExplorerGroupBy;
  columns: string[];
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TocHeading {
  id: string;
  level: number;
  text: string;
}

export interface InternalLinkRef {
  sourcePageId: string;
  targetPageId: string;
  label: string;
}

export type ExportScope =
  | 'page'
  | 'page-tree'
  | 'workspace'
  | 'organization'
  | 'selection'
  | 'filtered-results';

export type ExportFormat = 'pdf' | 'markdown' | 'html' | 'json';

export interface ExportRequest {
  scope: ExportScope;
  targetIds: string[];
  format: ExportFormat;
  includeArchived: boolean;
  includeMetadata: boolean;
  includeCoverPage?: boolean;
  includeToc?: boolean;
  pdfMode?: 'combined' | 'separate';
  title?: string;
}

export interface ExportProgressState {
  phase:
    | 'idle'
    | 'preparing'
    | 'processing'
    | 'generating'
    | 'packaging'
    | 'downloading'
    | 'completed'
    | 'cancelled'
    | 'error';
  message: string;
  processedPages: number;
  totalPages: number;
  warnings: string[];
  errorMessage: string | null;
}

export interface ExportManifest {
  formatVersion: 2;
  exportedAt: string;
  appVersion: string;
  scope: ExportScope;
  format: ExportFormat;
  organizationsCount: number;
  workspacesCount: number;
  pagesCount: number;
  warnings: string[];
}

export interface FullJsonExportPayload {
  manifest: ExportManifest;
  organizations: Organization[];
  workspaces: Workspace[];
  pages: PageWithContent[];
  tags: Tag[];
  pageTags: PageTag[];
  propertyDefinitions: PropertyDefinition[];
  propertyValues: PropertyValue[];
  templates: DocumentTemplate[];
}
