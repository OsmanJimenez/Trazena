import { Injectable, inject, signal } from '@angular/core';
import {
  computeContentHash,
  type LocalMutation,
  type Organization,
  type Page,
  type PageContent,
  type PageHistoryVersion,
  type PageRouteAlias,
  type SyncCheckpoint,
  type SyncConflictRecord,
  type SyncDeviceInfo,
  type SyncSessionSummary,
  type Workspace,
} from '@trazena/shared';
import { APP_BUILD_META } from '../diagnostics/app-version';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';

const DB_NAME = 'trazena_vault_v1';
const DB_VERSION = 4;
const MAX_LOCAL_HISTORY_PER_PAGE = 3;

export type StoreName =
  | 'organizations'
  | 'workspaces'
  | 'pages'
  | 'page_contents'
  | 'page_history'
  | 'route_aliases'
  | 'sync_queue'
  | 'sync_outbox'
  | 'sync_checkpoints'
  | 'sync_sessions'
  | 'sync_conflicts'
  | 'sync_device'
  | 'tags'
  | 'page_tags'
  | 'property_definitions'
  | 'property_values'
  | 'saved_views'
  | 'templates'
  | 'favorites'
  | 'recent_visits'
  | 'reminders'
  | 'daily_notes'
  | 'draft_recovery'
  | 'review_policies'
  | 'meta';

export interface MigrationProgressState {
  status: 'idle' | 'running' | 'blocked' | 'completed' | 'failed';
  fromVersion: number;
  toVersion: number;
  message: string;
}

/**
 * Local-First IndexedDB persistence engine (`trazena_vault_v1`, schema v2).
 * - Explicit non-destructive versioned migrations (v1 -> v2).
 * - Atomic entity + consolidated Outbox writes inside a single IDB transaction.
 * - Multi-tab `blocked` & `versionchange` coordination.
 * - Never stores Markdown in localStorage and never wipes data on error.
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private readonly diagnostics = inject(DiagnosticsService);
  private dbPromise: Promise<IDBDatabase> | null = null;
  private activeDb: IDBDatabase | null = null;

  private readonly _migrationState = signal<MigrationProgressState>({
    status: 'idle',
    fromVersion: 0,
    toVersion: DB_VERSION,
    message: '',
  });
  private readonly _schemaBlocked = signal(false);
  private readonly _persistentStorageGranted = signal<boolean | null>(null);

  readonly migrationState = this._migrationState.asReadonly();
  readonly schemaBlocked = this._schemaBlocked.asReadonly();
  readonly persistentStorageGranted = this._persistentStorageGranted.asReadonly();
  readonly schemaVersion = DB_VERSION;

  async ensureOpen(): Promise<IDBDatabase> {
    return this.open();
  }

  async requestPersistentStorage(): Promise<boolean> {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        const persisted = await navigator.storage.persisted();
        if (persisted) {
          this._persistentStorageGranted.set(true);
          return true;
        }
        const granted = await navigator.storage.persist();
        this._persistentStorageGranted.set(granted);
        return granted;
      }
    } catch {
      // Browser may decline silently
    }
    this._persistentStorageGranted.set(false);
    return false;
  }

  retryOpen(): Promise<IDBDatabase> {
    this.dbPromise = null;
    this._schemaBlocked.set(false);
    return this.open();
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const started = performance.now();
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        this._schemaBlocked.set(true);
        this._migrationState.set({
          status: 'blocked',
          fromVersion: 1,
          toVersion: DB_VERSION,
          message: 'Actualización bloqueada por otra pestaña abierta de Trazena. Cierra las demás pestañas para continuar.',
        });
        void this.diagnostics.log({
          level: 'warn',
          category: 'database-migration',
          phase: 'open-blocked',
          eventCode: 'IDB_UPGRADE_BLOCKED',
          schemaTo: DB_VERSION,
        });
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;
        const oldVersion = event.oldVersion;
        this._migrationState.set({
          status: 'running',
          fromVersion: oldVersion,
          toVersion: DB_VERSION,
          message: `Actualizando almacenamiento local (v${oldVersion} → v${DB_VERSION})…`,
        });

        void this.diagnostics.log({
          level: 'info',
          category: 'database-migration',
          phase: 'upgrade-start',
          eventCode: 'IDB_MIGRATION_STARTED',
          schemaFrom: oldVersion,
          schemaTo: DB_VERSION,
          migrationId: `v${oldVersion}_to_v${DB_VERSION}`,
        });

        try {
          // v1 base stores
          if (oldVersion < 1) {
            if (!db.objectStoreNames.contains('organizations')) {
              db.createObjectStore('organizations', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('workspaces')) {
              const store = db.createObjectStore('workspaces', { keyPath: 'id' });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('pages')) {
              const store = db.createObjectStore('pages', { keyPath: 'id' });
              store.createIndex('by_workspace', 'workspaceId', { unique: false });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('page_contents')) {
              db.createObjectStore('page_contents', { keyPath: 'pageId' });
            }
            if (!db.objectStoreNames.contains('route_aliases')) {
              const store = db.createObjectStore('route_aliases', { keyPath: 'id' });
              store.createIndex('by_workspace', 'workspaceId', { unique: false });
            }
            if (!db.objectStoreNames.contains('sync_queue')) {
              db.createObjectStore('sync_queue', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('meta')) {
              db.createObjectStore('meta', { keyPath: 'key' });
            }
          }

          // v2 Local-First Sync, Outbox, History & Checkpoints (non-destructive expand)
          if (oldVersion < 2) {
            if (!db.objectStoreNames.contains('page_history')) {
              const store = db.createObjectStore('page_history', { keyPath: 'id' });
              store.createIndex('by_page', 'pageId', { unique: false });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('sync_outbox')) {
              const store = db.createObjectStore('sync_outbox', { keyPath: 'operationId' });
              store.createIndex('by_entity', 'entityId', { unique: false });
              store.createIndex('by_owner', 'ownerUid', { unique: false });
            }
            if (!db.objectStoreNames.contains('sync_checkpoints')) {
              db.createObjectStore('sync_checkpoints', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sync_sessions')) {
              db.createObjectStore('sync_sessions', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('sync_conflicts')) {
              const store = db.createObjectStore('sync_conflicts', { keyPath: 'id' });
              store.createIndex('by_page', 'pageId', { unique: false });
            }
            if (!db.objectStoreNames.contains('sync_device')) {
              db.createObjectStore('sync_device', { keyPath: 'deviceId' });
            }
          }

          // v3 Knowledge & Publishing stores (non-destructive expand)
          if (oldVersion < 3) {
            if (!db.objectStoreNames.contains('tags')) {
              const store = db.createObjectStore('tags', { keyPath: 'id' });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('page_tags')) {
              const store = db.createObjectStore('page_tags', { keyPath: 'id' });
              store.createIndex('by_page', 'pageId', { unique: false });
              store.createIndex('by_tag', 'tagId', { unique: false });
            }
            if (!db.objectStoreNames.contains('property_definitions')) {
              const store = db.createObjectStore('property_definitions', { keyPath: 'id' });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('property_values')) {
              const store = db.createObjectStore('property_values', { keyPath: 'id' });
              store.createIndex('by_page', 'pageId', { unique: false });
              store.createIndex('by_prop', 'propertyId', { unique: false });
            }
            if (!db.objectStoreNames.contains('saved_views')) {
              db.createObjectStore('saved_views', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('templates')) {
              db.createObjectStore('templates', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('favorites')) {
              const store = db.createObjectStore('favorites', { keyPath: 'id' });
              store.createIndex('by_owner', 'ownerUid', { unique: false });
            }
            if (!db.objectStoreNames.contains('recent_visits')) {
              const store = db.createObjectStore('recent_visits', { keyPath: 'id' });
              store.createIndex('by_owner', 'ownerUid', { unique: false });
            }
          }

          // v4 Experience & Productivity stores (non-destructive expand)
          if (oldVersion < 4) {
            if (!db.objectStoreNames.contains('reminders')) {
              const store = db.createObjectStore('reminders', { keyPath: 'id' });
              store.createIndex('by_owner', 'ownerUid', { unique: false });
              store.createIndex('by_page', 'pageId', { unique: false });
            }
            if (!db.objectStoreNames.contains('daily_notes')) {
              const store = db.createObjectStore('daily_notes', { keyPath: 'id' });
              store.createIndex('by_org', 'organizationId', { unique: false });
            }
            if (!db.objectStoreNames.contains('draft_recovery')) {
              const store = db.createObjectStore('draft_recovery', { keyPath: 'id' });
              store.createIndex('by_owner', 'ownerUid', { unique: false });
            }
            if (!db.objectStoreNames.contains('review_policies')) {
              db.createObjectStore('review_policies', { keyPath: 'organizationId' });
            }
          }
        } catch (err) {
          this._migrationState.set({
            status: 'failed',
            fromVersion: oldVersion,
            toVersion: DB_VERSION,
            message: 'Error durante la migración del esquema local. Tus datos originales fueron conservados.',
          });
          void this.diagnostics.log({
            level: 'error',
            category: 'database-migration',
            phase: 'upgrade-error',
            eventCode: 'IDB_MIGRATION_FAILED',
            schemaFrom: oldVersion,
            schemaTo: DB_VERSION,
            migrationId: `v${oldVersion}_to_v${DB_VERSION}`,
            error: err,
          });
          throw err;
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        this.activeDb = db;
        this._schemaBlocked.set(false);

        if (this._migrationState().status === 'running') {
          const durationMs = Math.round(performance.now() - started);
          this._migrationState.set({
            status: 'completed',
            fromVersion: this._migrationState().fromVersion,
            toVersion: DB_VERSION,
            message: `Almacenamiento local actualizado a esquema v${DB_VERSION}.`,
          });
          void this.diagnostics.log({
            level: 'info',
            category: 'database-migration',
            phase: 'upgrade-complete',
            eventCode: 'IDB_MIGRATION_COMPLETED',
            schemaFrom: this._migrationState().fromVersion,
            schemaTo: DB_VERSION,
            durationMs,
          });
        }

        // Coordinate with newer tabs attempting a schema upgrade
        db.onversionchange = () => {
          db.close();
          this.activeDb = null;
          this.dbPromise = null;
          this._schemaBlocked.set(true);
          void this.diagnostics.log({
            level: 'warn',
            category: 'database-migration',
            phase: 'versionchange',
            eventCode: 'IDB_VERSIONCHANGE_RECEIVED',
          });
        };

        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        const err = request.error ?? new Error('Failed to open IndexedDB');
        this._migrationState.set({
          status: 'failed',
          fromVersion: 0,
          toVersion: DB_VERSION,
          message: 'No se pudo abrir la base de datos local.',
        });
        void this.diagnostics.log({
          level: 'error',
          category: 'database-migration',
          phase: 'open-error',
          eventCode: 'IDB_OPEN_FAILED',
          schemaTo: DB_VERSION,
          error: err,
        });
        reject(err);
      };
    });

    return this.dbPromise;
  }

  // --- Generic CRUD ---

  async getAll<T>(storeName: StoreName): Promise<T[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve((request.result as T[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  }

  async getByKey<T>(storeName: StoreName, key: string): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async put<T>(storeName: StoreName, value: T): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putMany<T>(storeName: StoreName, values: readonly T[]): Promise<void> {
    if (values.length === 0) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const value of values) store.put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(storeName: StoreName, key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Atomic Local-First writes (Entity + Consolidated Outbox in 1 IDB transaction) ---

  async commitAtomicWithOutbox<T>(
    storeName: StoreName,
    entity: T,
    mutation: LocalMutation,
    extraContent?: PageContent,
  ): Promise<LocalMutation> {
    const db = await this.open();
    const stores: StoreName[] = extraContent
      ? [storeName, 'page_contents', 'sync_outbox']
      : [storeName, 'sync_outbox'];

    return new Promise<LocalMutation>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.objectStore(storeName).put(entity);
      if (extraContent) {
        tx.objectStore('page_contents').put(extraContent);
      }

      const outboxStore = tx.objectStore('sync_outbox');
      const index = outboxStore.index('by_entity');
      const existingReq = index.getAll(mutation.entityId);

      existingReq.onsuccess = () => {
        const existing = ((existingReq.result as LocalMutation[]) ?? []).filter(
          (m) => m.ownerUid === mutation.ownerUid && m.status === 'pending',
        );

        let finalMutation = mutation;
        if (existing.length > 0) {
          // Consolidate repeated edits to the same entity while preserving original baseRevision
          const first = existing.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          for (const old of existing) {
            outboxStore.delete(old.operationId);
          }
          const preservedOperation =
            first.operation === 'create' && mutation.operation === 'update'
              ? 'create'
              : mutation.operation;

          finalMutation = {
            ...mutation,
            operation: preservedOperation,
            baseRevision: first.baseRevision,
            createdAt: first.createdAt,
            payload: { ...first.payload, ...mutation.payload },
          };
        }

        outboxStore.put(finalMutation);
        tx.oncomplete = () => resolve(finalMutation);
      };

      existingReq.onerror = () => reject(existingReq.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Local Page History (max 3 previous full snapshots per page) ---

  async saveLocalHistorySnapshot(params: {
    pageId: string;
    organizationId: string;
    workspaceId: string;
    previousRevision: number;
    previousMarkdown: string;
    nextMarkdown: string;
    actorUid: string;
    deviceId: string;
  }): Promise<PageHistoryVersion | null> {
    const [prevHash, nextHash] = await Promise.all([
      computeContentHash(params.previousMarkdown),
      computeContentHash(params.nextMarkdown),
    ]);
    if (prevHash === nextHash) return null;

    const existing = await this.getPageHistory(params.pageId);
    // Avoid duplicating identical consecutive snapshots
    if (existing[0]?.contentHash === prevHash) return null;

    const version: PageHistoryVersion = {
      id: crypto.randomUUID(),
      pageId: params.pageId,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      revision: params.previousRevision,
      content: params.previousMarkdown,
      contentHash: prevHash,
      byteSize: new TextEncoder().encode(params.previousMarkdown).byteLength,
      createdAt: new Date().toISOString(),
      createdBy: params.actorUid,
      sourceDeviceId: params.deviceId,
    };

    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('page_history', 'readwrite');
      const store = tx.objectStore('page_history');
      store.put(version);

      // Enforce max 3 previous snapshots per page
      const sorted = [version, ...existing].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      if (sorted.length > MAX_LOCAL_HISTORY_PER_PAGE) {
        for (const excess of sorted.slice(MAX_LOCAL_HISTORY_PER_PAGE)) {
          store.delete(excess.id);
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return version;
  }

  async getPageHistory(pageId: string): Promise<PageHistoryVersion[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('page_history', 'readonly');
      const req = tx.objectStore('page_history').index('by_page').getAll(pageId);
      req.onsuccess = () => {
        const list = (req.result as PageHistoryVersion[]) ?? [];
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getAllHistory(): Promise<PageHistoryVersion[]> {
    const list = await this.getAll<PageHistoryVersion>('page_history');
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteHistoryVersion(versionId: string): Promise<void> {
    await this.delete('page_history', versionId);
  }

  async deleteHistoryVersionsBulk(versionIds: readonly string[]): Promise<void> {
    if (versionIds.length === 0) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('page_history', 'readwrite');
      const store = tx.objectStore('page_history');
      for (const id of versionIds) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Sync stores helpers ---

  async getOutbox(ownerUid: string): Promise<LocalMutation[]> {
    const all = await this.getAll<LocalMutation>('sync_outbox');
    return all
      .filter((m) => m.ownerUid === ownerUid && m.status !== 'confirmed')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async removeOutboxOperations(operationIds: readonly string[]): Promise<void> {
    if (operationIds.length === 0) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sync_outbox', 'readwrite');
      const store = tx.objectStore('sync_outbox');
      for (const id of operationIds) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async markOutboxStatus(
    operationId: string,
    status: LocalMutation['status'],
  ): Promise<void> {
    const current = await this.getByKey<LocalMutation>('sync_outbox', operationId);
    if (!current) return;
    await this.put('sync_outbox', {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    });
  }

  async getOrCreateDevice(ownerUid: string): Promise<SyncDeviceInfo> {
    const devices = await this.getAll<SyncDeviceInfo>('sync_device');
    const existing = devices.find((d) => d.ownerUid === ownerUid);
    if (existing) return existing;

    const now = new Date().toISOString();
    const isMobile =
      typeof navigator !== 'undefined' && /Mobile|Android|iPhone/i.test(navigator.userAgent);
    const device: SyncDeviceInfo = {
      deviceId: crypto.randomUUID(),
      ownerUid,
      name: isMobile ? 'Móvil' : 'PC principal',
      lastSyncedAt: null,
      appVersion: APP_BUILD_META.appVersion,
      createdAt: now,
      updatedAt: now,
    };
    await this.put('sync_device', device);
    return device;
  }

  async saveDevice(device: SyncDeviceInfo): Promise<void> {
    await this.put('sync_device', device);
  }

  async getCheckpoint(ownerUid: string, deviceId: string): Promise<SyncCheckpoint> {
    const id = `${ownerUid}:${deviceId}:global`;
    const existing = await this.getByKey<SyncCheckpoint>('sync_checkpoints', id);
    if (existing) return existing;
    return {
      id,
      ownerUid,
      deviceId,
      organizationId: 'global',
      lastAppliedSequence: 0,
      lastSyncedAt: null,
    };
  }

  async saveCheckpoint(cp: SyncCheckpoint): Promise<void> {
    await this.put('sync_checkpoints', cp);
  }

  async saveSyncSession(session: SyncSessionSummary): Promise<void> {
    await this.put('sync_sessions', session);
  }

  async getSyncSessions(ownerUid: string): Promise<SyncSessionSummary[]> {
    const all = await this.getAll<SyncSessionSummary>('sync_sessions');
    return all
      .filter((s) => s.ownerUid === ownerUid)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 30);
  }

  async saveConflict(conflict: SyncConflictRecord): Promise<void> {
    await this.put('sync_conflicts', conflict);
  }

  async getConflicts(ownerUid: string): Promise<SyncConflictRecord[]> {
    const all = await this.getAll<SyncConflictRecord>('sync_conflicts');
    return all
      .filter((c) => c.ownerUid === ownerUid && !c.resolved)
      .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  async deleteConflict(conflictId: string): Promise<void> {
    await this.delete('sync_conflicts', conflictId);
  }

  async savePageContent(content: PageContent): Promise<void> {
    await this.put('page_contents', content);
  }

  async getPageContent(pageId: string): Promise<PageContent | undefined> {
    return this.getByKey<PageContent>('page_contents', pageId);
  }

  async saveRouteAlias(alias: PageRouteAlias): Promise<void> {
    await this.put('route_aliases', alias);
  }

  async getAllRouteAliases(): Promise<PageRouteAlias[]> {
    return this.getAll<PageRouteAlias>('route_aliases');
  }

  async estimateBrowserQuota(): Promise<{ usageBytes: number; quotaBytes: number }> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return {
        usageBytes: est.usage ?? 0,
        quotaBytes: est.quota ?? 0,
      };
    }
    return { usageBytes: 0, quotaBytes: 0 };
  }
}
