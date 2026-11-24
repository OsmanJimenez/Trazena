export const APP_PROTOCOL_VERSIONS = {
  appVersion: '0.4.0',
  apiVersion: 1,
  syncProtocolVersion: 1,
  localSchemaVersion: 4,
  remoteSchemaVersion: 4,
  minimumCompatibleAppVersion: '0.3.0',
} as const;

export type SyncEntityType =
  | 'organization'
  | 'workspace'
  | 'page'
  | 'tag'
  | 'page_tag'
  | 'property_definition'
  | 'property_value'
  | 'saved_view'
  | 'template'
  | 'favorite'
  | 'reminder'
  | 'daily_note'
  | 'page_review';

export type SyncOperationKind =
  | 'create'
  | 'update'
  | 'move'
  | 'archive'
  | 'restore'
  | 'delete';

export type LocalMutationStatus = 'pending' | 'conflict' | 'confirmed';

export interface LocalMutation {
  operationId: string;
  deviceId: string;
  ownerUid: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperationKind;
  baseRevision: number | null;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  status: LocalMutationStatus;
}

export interface SyncCheckpoint {
  id: string; // `${ownerUid}:${deviceId}:${organizationId}`
  ownerUid: string;
  deviceId: string;
  organizationId: string;
  lastAppliedSequence: number;
  lastSyncedAt: string | null;
}

export interface SyncDeviceInfo {
  deviceId: string;
  ownerUid: string;
  name: string;
  lastSyncedAt: string | null;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageHistoryVersion {
  id: string;
  pageId: string;
  organizationId: string;
  workspaceId: string;
  revision: number;
  content: string;
  contentHash: string;
  byteSize: number;
  createdAt: string;
  createdBy: string;
  sourceDeviceId?: string | null;
  syncOperationId?: string | null;
}

export interface SyncConflictRecord {
  id: string;
  ownerUid: string;
  pageId: string;
  pageTitle: string;
  organizationId: string;
  workspaceId: string;
  operationId: string;
  baseRevision: number | null;
  serverRevision: number;
  localMarkdown: string;
  serverMarkdown: string;
  localUpdatedAt: string;
  serverUpdatedAt: string;
  detectedAt: string;
  resolved: boolean;
}

export interface SyncSessionEntry {
  entityType: SyncEntityType;
  entityId: string;
  label: string;
  action: string;
}

export interface SyncSessionSummary {
  id: string;
  ownerUid: string;
  deviceId: string;
  startedAt: string;
  finishedAt: string;
  status: 'completed' | 'partial_conflict' | 'failed';
  uploaded: SyncSessionEntry[];
  downloaded: SyncSessionEntry[];
  conflictsCount: number;
  errorMessage: string | null;
}

export interface ApiVersionInfo {
  appName: string;
  apiVersion: number;
  syncProtocolVersion: number;
  remoteSchemaVersion: number;
  minimumCompatibleAppVersion: string;
  serverTime: string;
}

export interface SyncPushRequest {
  deviceId: string;
  deviceName?: string;
  appVersion?: string;
  operations: Array<{
    operationId: string;
    entityType: SyncEntityType;
    entityId: string;
    operation: SyncOperationKind;
    baseRevision: number | null;
    payload: Record<string, unknown>;
    createdAt: string;
  }>;
}

export interface SyncPushOperationResult {
  operationId: string;
  entityType: SyncEntityType;
  entityId: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  revision?: number;
  sequence?: number;
  conflict?: {
    serverRevision: number;
    serverMarkdown: string;
    serverUpdatedAt: string;
  };
  error?: string;
}

export interface SyncPushResponse {
  results: SyncPushOperationResult[];
  latestSequence: number;
}

export interface SyncPullEvent {
  sequence: number;
  organizationId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperationKind;
  revision: number | null;
  operationId: string;
  deviceId: string | null;
  actorId: string;
  createdAt: string;
}

export interface SyncPullResponse {
  since: number;
  latestSequence: number;
  hasMore: boolean;
  requiresFullResync: boolean;
  events: SyncPullEvent[];
  organizations: import('./domain.js').Organization[];
  workspaces: import('./domain.js').Workspace[];
  pages: import('./domain.js').PageWithContent[];
}

export interface LocalDiagnosticEvent {
  id: string;
  runId: string;
  deviceId: string;
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  category:
    | 'app-update'
    | 'database-migration'
    | 'service-worker'
    | 'sync'
    | 'recovery';
  phase: string;
  eventCode: string;
  appVersion: string;
  buildId: string;
  schemaFrom?: number;
  schemaTo?: number;
  migrationId?: string;
  durationMs?: number;
  errorName?: string;
  sanitizedMessage?: string;
  details?: Record<string, unknown>;
}
