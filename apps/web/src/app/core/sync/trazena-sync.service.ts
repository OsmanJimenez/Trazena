import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  compareSemver,
  extractMarkdownMetrics,
  type ApiVersionInfo,
  type LocalMutation,
  type PageContent,
  type SyncCheckpoint,
  type SyncConflictRecord,
  type SyncDeviceInfo,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncSessionEntry,
  type SyncSessionSummary,
} from '@trazena/shared';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { APP_BUILD_META } from '../diagnostics/app-version';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';
import { IndexedDbService } from '../storage/indexeddb.service';

export type SyncRunState =
  | 'idle'
  | 'syncing'
  | 'completed'
  | 'partial_conflict'
  | 'error'
  | 'offline'
  | 'unconfigured';

const ENTITY_ORDER: Record<LocalMutation['entityType'], number> = {
  organization: 0,
  workspace: 1,
  page: 2,
  tag: 3,
  page_tag: 4,
  property_definition: 5,
  property_value: 6,
  saved_view: 7,
  template: 8,
  favorite: 9,
  reminder: 10,
  daily_note: 11,
  page_review: 12,
};

/**
 * Trazena Sync — Dedicated manual bidirectional incremental sync engine.
 * Completely independent from editor autosave and PWA app updates.
 */
@Injectable({ providedIn: 'root' })
export class TrazenaSyncService {
  private readonly http = inject(HttpClient);
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);
  private readonly diagnostics = inject(DiagnosticsService);

  private readonly _isOnline = signal(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  private readonly _device = signal<SyncDeviceInfo | null>(null);
  private readonly _outbox = signal<LocalMutation[]>([]);
  private readonly _conflicts = signal<SyncConflictRecord[]>([]);
  private readonly _sessions = signal<SyncSessionSummary[]>([]);
  private readonly _checkpoint = signal<SyncCheckpoint | null>(null);
  private readonly _state = signal<SyncRunState>('idle');
  private readonly _phaseLabel = signal<string>('');
  private readonly _lastError = signal<string | null>(null);
  private readonly _lastSummary = signal<SyncSessionSummary | null>(null);

  private reloadCallback: (() => Promise<void>) | null = null;
  private duplicateLocalPageCallback:
    | ((pageId: string, localMarkdown: string) => Promise<void>)
    | null = null;

  readonly isOnline = this._isOnline.asReadonly();
  readonly device = this._device.asReadonly();
  readonly outbox = this._outbox.asReadonly();
  readonly conflicts = this._conflicts.asReadonly();
  readonly sessions = this._sessions.asReadonly();
  readonly checkpoint = this._checkpoint.asReadonly();
  readonly state = this._state.asReadonly();
  readonly phaseLabel = this._phaseLabel.asReadonly();
  readonly lastError = this._lastError.asReadonly();
  readonly lastSummary = this._lastSummary.asReadonly();

  readonly pendingCount = computed(
    () => this._outbox().filter((m) => m.status === 'pending').length,
  );
  readonly conflictsCount = computed(() => this._conflicts().length);
  readonly lastSyncedAt = computed(
    () => this._checkpoint()?.lastSyncedAt ?? this._device()?.lastSyncedAt ?? null,
  );
  readonly isRemoteConfigured = computed(() => environment.apiUrl.trim().length > 0);

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this._isOnline.set(true));
      window.addEventListener('offline', () => this._isOnline.set(false));
    }
  }

  registerStoreHooks(hooks: {
    reloadFromLocal: () => Promise<void>;
    duplicateConflictCopy: (pageId: string, localMarkdown: string) => Promise<void>;
  }): void {
    this.reloadCallback = hooks.reloadFromLocal;
    this.duplicateLocalPageCallback = hooks.duplicateConflictCopy;
  }

  private get apiUrl(): string {
    return environment.apiUrl.replace(/\/+$/, '');
  }

  private get ownerUid(): string {
    return this.auth.user()?.uid ?? 'local-owner';
  }

  async refreshState(): Promise<void> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const [outbox, conflicts, sessions, checkpoint] = await Promise.all([
      this.idb.getOutbox(uid),
      this.idb.getConflicts(uid),
      this.idb.getSyncSessions(uid),
      this.idb.getCheckpoint(uid, device.deviceId),
    ]);
    this._device.set(device);
    this._outbox.set(outbox);
    this._conflicts.set(conflicts);
    this._sessions.set(sessions);
    this._checkpoint.set(checkpoint);
    if (sessions.length > 0 && !this._lastSummary()) {
      this._lastSummary.set(sessions[0]);
    }
  }

  async renameCurrentDevice(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = this._device() ?? (await this.idb.getOrCreateDevice(this.ownerUid));
    const updated: SyncDeviceInfo = {
      ...current,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };
    await this.idb.saveDevice(updated);
    this._device.set(updated);

    if (this.isRemoteConfigured() && this._isOnline()) {
      try {
        await firstValueFrom(
          this.http.patch(`${this.apiUrl}/api/devices/${updated.deviceId}`, {
            name: trimmed,
          }),
        );
      } catch {
        // Non-blocking: local name is already persisted
      }
    }
  }

  /**
   * One-click manual bidirectional incremental sync.
   */
  async syncNow(): Promise<SyncSessionSummary | null> {
    if (this._state() === 'syncing') return null;
    await this.refreshState();

    const startedAt = new Date().toISOString();
    const uid = this.ownerUid;
    const device = this._device() ?? (await this.idb.getOrCreateDevice(uid));

    if (!this.isRemoteConfigured()) {
      this._state.set('unconfigured');
      this._lastError.set(
        'Modo local-first activo: configura environment.apiUrl y Firebase para sincronizar con Cloudflare D1.',
      );
      return null;
    }

    if (!this._isOnline()) {
      this._state.set('offline');
      this._lastError.set(
        'Sin conexión a Internet. Tus cambios siguen seguros en IndexedDB y se enviarán cuando sincronices con conexión.',
      );
      return null;
    }

    this._state.set('syncing');
    this._lastError.set(null);
    this._phaseLabel.set('Comprobando compatibilidad…');

    const uploaded: SyncSessionEntry[] = [];
    const downloaded: SyncSessionEntry[] = [];
    let conflictsDetected = 0;

    try {
      // 1. Lightweight compatibility check
      const versionInfo = await firstValueFrom(
        this.http.get<ApiVersionInfo>(`${this.apiUrl}/api/version`),
      );
      if (
        versionInfo.syncProtocolVersion !== APP_BUILD_META.syncProtocolVersion ||
        compareSemver(APP_BUILD_META.appVersion, versionInfo.minimumCompatibleAppVersion) < 0
      ) {
        throw new Error(
          `Esta versión de Trazena (${APP_BUILD_META.appVersion}) requiere actualizarse (mínimo ${versionInfo.minimumCompatibleAppVersion}) antes de sincronizar.`,
        );
      }

      // 2. Push pending consolidated local mutations
      const pending = this._outbox()
        .filter((m) => m.status === 'pending')
        .sort(
          (a, b) =>
            ENTITY_ORDER[a.entityType] - ENTITY_ORDER[b.entityType] ||
            a.createdAt.localeCompare(b.createdAt),
        );

      if (pending.length > 0) {
        this._phaseLabel.set(`Enviando ${pending.length} cambio(s) locales…`);
        const pushRes = await firstValueFrom(
          this.http.post<SyncPushResponse>(`${this.apiUrl}/api/sync/push`, {
            deviceId: device.deviceId,
            deviceName: device.name,
            appVersion: APP_BUILD_META.appVersion,
            operations: pending.map((m) => ({
              operationId: m.operationId,
              entityType: m.entityType,
              entityId: m.entityId,
              operation: m.operation,
              baseRevision: m.baseRevision,
              payload: m.payload,
              createdAt: m.createdAt,
            })),
          }),
        );

        const confirmedIds: string[] = [];
        const byOpId = new Map(pending.map((m) => [m.operationId, m]));

        for (const r of pushRes.results) {
          const orig = byOpId.get(r.operationId);
          if (!orig) continue;

          if (r.status === 'applied' || r.status === 'duplicate') {
            confirmedIds.push(r.operationId);
            if (orig.entityType === 'page' && r.revision) {
              const localPage = await this.idb.getByKey<import('@trazena/shared').Page>(
                'pages',
                orig.entityId,
              );
              if (localPage) {
                await this.idb.put('pages', { ...localPage, revision: r.revision });
              }
            }
            uploaded.push({
              entityType: orig.entityType,
              entityId: orig.entityId,
              label: String(orig.payload['title'] ?? orig.payload['name'] ?? orig.entityId.slice(0, 8)),
              action: this.operationLabel(orig.operation),
            });
          } else if (r.status === 'conflict' && r.conflict) {
            conflictsDetected += 1;
            await this.idb.markOutboxStatus(r.operationId, 'conflict');
            const localContent = await this.idb.getPageContent(orig.entityId);
            const conflictRecord: SyncConflictRecord = {
              id: `conflict:${orig.entityId}`,
              ownerUid: uid,
              pageId: orig.entityId,
              pageTitle: String(orig.payload['title'] ?? 'Página'),
              organizationId: String(orig.payload['organizationId'] ?? ''),
              workspaceId: String(orig.payload['workspaceId'] ?? ''),
              operationId: orig.operationId,
              baseRevision: orig.baseRevision,
              serverRevision: r.conflict.serverRevision,
              localMarkdown: String(orig.payload['markdown'] ?? localContent?.markdown ?? ''),
              serverMarkdown: r.conflict.serverMarkdown,
              localUpdatedAt: orig.updatedAt,
              serverUpdatedAt: r.conflict.serverUpdatedAt,
              detectedAt: new Date().toISOString(),
              resolved: false,
            };
            await this.idb.saveConflict(conflictRecord);
          }
        }

        await this.idb.removeOutboxOperations(confirmedIds);
      }

      // 3. Incremental pull from checkpoint cursor
      this._phaseLabel.set('Descargando novedades incrementales…');
      let cp = await this.idb.getCheckpoint(uid, device.deviceId);
      let cursor = cp.lastAppliedSequence;
      let hasMore = true;
      let safetyLoops = 0;

      const remainingOutbox = await this.idb.getOutbox(uid);
      const dirtyPageIds = new Set(
        remainingOutbox.filter((m) => m.entityType === 'page').map((m) => m.entityId),
      );

      while (hasMore && safetyLoops < 20) {
        safetyLoops += 1;
        const pullRes = await firstValueFrom(
          this.http.get<SyncPullResponse>(`${this.apiUrl}/api/sync/pull`, {
            params: { since: String(cursor), limit: '100' },
          }),
        );

        for (const org of pullRes.organizations) {
          await this.idb.put('organizations', org);
          downloaded.push({
            entityType: 'organization',
            entityId: org.id,
            label: org.name,
            action: 'Actualizada',
          });
        }

        for (const ws of pullRes.workspaces) {
          await this.idb.put('workspaces', ws);
          downloaded.push({
            entityType: 'workspace',
            entityId: ws.id,
            label: ws.name,
            action: 'Actualizado',
          });
        }

        for (const remotePage of pullRes.pages) {
          if (dirtyPageIds.has(remotePage.id)) {
            // Never silently overwrite a page with pending local edits
            continue;
          }
          const { content, ...meta } = remotePage;
          await this.idb.put('pages', meta);
          await this.idb.savePageContent(content);
          downloaded.push({
            entityType: 'page',
            entityId: meta.id,
            label: meta.title,
            action: meta.status === 'deleted' ? 'Eliminada' : 'Actualizada',
          });
        }

        // Advance cursor strictly AFTER IndexedDB writes succeeded
        cursor = pullRes.latestSequence;
        hasMore = pullRes.hasMore;
        cp = {
          ...cp,
          lastAppliedSequence: cursor,
          lastSyncedAt: new Date().toISOString(),
        };
        await this.idb.saveCheckpoint(cp);
      }

      const finishedAt = new Date().toISOString();
      const updatedDevice: SyncDeviceInfo = {
        ...device,
        lastSyncedAt: finishedAt,
        updatedAt: finishedAt,
      };
      await this.idb.saveDevice(updatedDevice);

      const summary: SyncSessionSummary = {
        id: crypto.randomUUID(),
        ownerUid: uid,
        deviceId: device.deviceId,
        startedAt,
        finishedAt,
        status: conflictsDetected > 0 ? 'partial_conflict' : 'completed',
        uploaded,
        downloaded,
        conflictsCount: conflictsDetected,
        errorMessage: null,
      };
      await this.idb.saveSyncSession(summary);
      this._lastSummary.set(summary);
      this._state.set(conflictsDetected > 0 ? 'partial_conflict' : 'completed');
      this._phaseLabel.set('');

      await this.diagnostics.log({
        level: conflictsDetected > 0 ? 'warn' : 'info',
        category: 'sync',
        phase: 'complete',
        eventCode: conflictsDetected > 0 ? 'SYNC_COMPLETED_WITH_CONFLICTS' : 'SYNC_COMPLETED',
        deviceId: device.deviceId,
        details: {
          uploadedCount: uploaded.length,
          downloadedCount: downloaded.length,
          conflictsCount: conflictsDetected,
          sequence: cursor,
        },
      });

      await this.refreshState();
      if (this.reloadCallback) await this.reloadCallback();
      return summary;
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const message =
        err instanceof Error ? err.message : 'Error de red durante la sincronización.';
      const summary: SyncSessionSummary = {
        id: crypto.randomUUID(),
        ownerUid: uid,
        deviceId: device.deviceId,
        startedAt,
        finishedAt,
        status: 'failed',
        uploaded,
        downloaded,
        conflictsCount: conflictsDetected,
        errorMessage: message,
      };
      await this.idb.saveSyncSession(summary);
      this._lastSummary.set(summary);
      this._lastError.set(message);
      this._state.set('error');
      this._phaseLabel.set('');

      await this.diagnostics.log({
        level: 'error',
        category: 'sync',
        phase: 'failed',
        eventCode: 'SYNC_FAILED',
        deviceId: device.deviceId,
        error: err,
      });

      await this.refreshState();
      return summary;
    }
  }

  // --- Conflict Resolution ---

  async resolveConflictKeepLocal(conflict: SyncConflictRecord): Promise<void> {
    const outboxItem = await this.idb.getByKey<LocalMutation>(
      'sync_outbox',
      conflict.operationId,
    );
    const now = new Date().toISOString();
    if (outboxItem) {
      await this.idb.put('sync_outbox', {
        ...outboxItem,
        operationId: crypto.randomUUID(),
        baseRevision: conflict.serverRevision,
        status: 'pending' as const,
        updatedAt: now,
      });
      await this.idb.delete('sync_outbox', conflict.operationId);
    }
    await this.idb.deleteConflict(conflict.id);
    await this.refreshState();
  }

  async resolveConflictKeepServer(conflict: SyncConflictRecord): Promise<void> {
    const localPage = await this.idb.getByKey<import('@trazena/shared').Page>(
      'pages',
      conflict.pageId,
    );
    const metrics = extractMarkdownMetrics(conflict.serverMarkdown);
    const content: PageContent = {
      pageId: conflict.pageId,
      markdown: conflict.serverMarkdown,
      excerpt: metrics.excerpt,
      wordCount: metrics.wordCount,
      updatedAt: conflict.serverUpdatedAt,
      updatedBy: localPage?.updatedBy ?? this.ownerUid,
    };
    if (localPage) {
      await this.idb.put('pages', {
        ...localPage,
        revision: conflict.serverRevision,
        updatedAt: conflict.serverUpdatedAt,
      });
    }
    await this.idb.savePageContent(content);
    await this.idb.delete('sync_outbox', conflict.operationId);
    await this.idb.deleteConflict(conflict.id);
    await this.refreshState();
    if (this.reloadCallback) await this.reloadCallback();
  }

  async resolveConflictManualMerge(
    conflict: SyncConflictRecord,
    mergedMarkdown: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const metrics = extractMarkdownMetrics(mergedMarkdown);
    await this.idb.savePageContent({
      pageId: conflict.pageId,
      markdown: mergedMarkdown,
      excerpt: metrics.excerpt,
      wordCount: metrics.wordCount,
      updatedAt: now,
      updatedBy: this.ownerUid,
    });
    const outboxItem = await this.idb.getByKey<LocalMutation>(
      'sync_outbox',
      conflict.operationId,
    );
    if (outboxItem) {
      await this.idb.delete('sync_outbox', conflict.operationId);
      await this.idb.put('sync_outbox', {
        ...outboxItem,
        operationId: crypto.randomUUID(),
        baseRevision: conflict.serverRevision,
        payload: { ...outboxItem.payload, markdown: mergedMarkdown },
        status: 'pending' as const,
        updatedAt: now,
      });
    }
    await this.idb.deleteConflict(conflict.id);
    await this.refreshState();
    if (this.reloadCallback) await this.reloadCallback();
  }

  async resolveConflictKeepBoth(conflict: SyncConflictRecord): Promise<void> {
    if (this.duplicateLocalPageCallback) {
      await this.duplicateLocalPageCallback(conflict.pageId, conflict.localMarkdown);
    }
    await this.resolveConflictKeepServer(conflict);
  }

  private operationLabel(op: LocalMutation['operation']): string {
    const map: Record<LocalMutation['operation'], string> = {
      create: 'Creado',
      update: 'Modificado',
      move: 'Movido',
      archive: 'Archivado',
      restore: 'Restaurado',
      delete: 'Eliminado',
    };
    return map[op];
  }
}
