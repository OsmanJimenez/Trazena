export type ReminderStatus = 'pending' | 'completed' | 'snoozed' | 'deleted';

export interface PageReminder {
  id: string;
  ownerUid: string;
  organizationId: string;
  workspaceId: string;
  pageId: string;
  title: string;
  dueDate: string; // Local calendar YYYY-MM-DD
  dueTime: string | null; // Optional HH:mm
  status: ReminderStatus;
  snoozedUntil: string | null; // ISO timestamp or YYYY-MM-DD
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyNoteEntry {
  id: string; // `${workspaceId}:${noteDate}`
  organizationId: string;
  workspaceId: string;
  pageId: string;
  noteDate: string; // Local calendar YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
}

export interface DailyNotesPreferences {
  organizationId: string | null;
  workspaceId: string | null;
  templateId: string | null;
}

export interface OrganizationReviewPolicy {
  organizationId: string;
  reviewCycleDays: number; // default 90
  updatedAt: string;
}

export interface LocalDraftRecovery {
  id: string; // `${ownerUid}:${pageId}`
  ownerUid: string;
  pageId: string;
  pageTitle: string;
  markdown: string;
  baseRevision: number;
  savedAt: string;
}

export interface WorkspaceTabItem {
  id: string;
  pageId: string;
  title: string;
  canonicalPath: string;
  icon: string | null;
}

export interface WorkspaceLayoutState {
  leftTabs: WorkspaceTabItem[];
  rightTabs: WorkspaceTabItem[];
  activeLeftTabId: string | null;
  activeRightTabId: string | null;
  splitEnabled: boolean;
  activePane: 'left' | 'right';
  splitRatio: number; // 25..75 percentage for desktop
}

export type ShortcutCommandId =
  | 'open_command_palette'
  | 'open_quick_search'
  | 'toggle_sidebar'
  | 'open_daily_note'
  | 'split_right'
  | 'close_split'
  | 'open_explorer'
  | 'open_health'
  | 'open_import'
  | 'open_settings'
  | 'sync_now'
  | 'new_page';

export interface ShortcutBinding {
  commandId: ShortcutCommandId;
  label: string;
  category: 'Navegación' | 'Espacio de trabajo' | 'Documentos' | 'Sistema';
  defaultCombo: string;
  customCombo: string | null;
  disabled: boolean;
}

export type HomeSectionId =
  | 'daily'
  | 'reminders'
  | 'recent'
  | 'favorites'
  | 'pinned_workspaces'
  | 'organizations'
  | 'saved_views'
  | 'needs_review'
  | 'sync_status';

export interface HomeSectionConfig {
  id: HomeSectionId;
  visible: boolean;
}

export interface HomePreferences {
  sections: HomeSectionConfig[];
  pinnedWorkspaceIds: string[];
  defaultSection: HomeSectionId;
}

export type ImportMode = 'new' | 'restore';
export type ImportSourceFormat =
  | 'markdown-file'
  | 'markdown-folder'
  | 'zip-markdown'
  | 'trazena-json';

export interface ImportPreviewItem {
  tempId: string;
  originalPath: string;
  title: string;
  parentTempId: string | null;
  depth: number;
  markdown: string;
  tags: string[];
  duplicateOfPageId: string | null;
  duplicateReason: 'title' | 'content' | null;
  unresolvedLinks: string[];
  missingAssets: string[];
  preservedId?: string;
}

export interface ImportPreviewSummary {
  sourceFormat: ImportSourceFormat;
  sourceLabel: string;
  items: ImportPreviewItem[];
  folderCount: number;
  duplicateCount: number;
  unresolvedLinksCount: number;
  missingAssetsCount: number;
  warnings: string[];
  isTrazJsonV2: boolean;
  manifestVersion: number | null;
}

export interface ImportExecutionResult {
  createdPages: number;
  updatedPages: number;
  skippedPages: number;
  createdTags: number;
  warnings: string[];
}
