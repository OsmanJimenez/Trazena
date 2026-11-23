import { Injectable, signal } from '@angular/core';
import type { LocalDiagnosticEvent } from '@trazena/shared';
import { APP_BUILD_META } from './app-version';

const DIAG_DB_NAME = 'trazena-diagnostics';
const DIAG_DB_VERSION = 1;
const STORE_EVENTS = 'events';
const MAX_RETENTION_DAYS = 30;
const MAX_BUDGET_BYTES = 2 * 1024 * 1024; // 2 MB per device

function sanitizeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(password|token|secret|cookie|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(0, 400);
}

/**
 * Independent diagnostic log store (`trazena-diagnostics`).
 * Stays operational even when the primary document database fails to open or migrate.
 * Logs remain strictly local on the device — never transmitted to Cloudflare D1.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  private dbPromise: Promise<IDBDatabase> | null = null;
  readonly runId = crypto.randomUUID();
  private readonly _recentEvents = signal<LocalDiagnosticEvent[]>([]);
  private readonly _fatalError = signal<{
    code: string;
    message: string;
    migrationId?: string;
    timestamp: string;
  } | null>(null);

  readonly recentEvents = this._recentEvents.asReadonly();
  readonly fatalError = this._fatalError.asReadonly();

  private getDeviceIdFallback(): string {
    try {
      const existing = globalThis.sessionStorage?.getItem('trz_diag_device_id');
      if (existing) return existing;
      const created = crypto.randomUUID();
      globalThis.sessionStorage?.setItem('trz_diag_device_id', created);
      return created;
    } catch {
      return 'unknown-device';
    }
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DIAG_DB_NAME, DIAG_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'id' });
          store.createIndex('by_timestamp', 'timestamp', { unique: false });
          store.createIndex('by_level', 'level', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Cannot open trazena-diagnostics'));
    });
    return this.dbPromise;
  }

  async log(input: {
    level: LocalDiagnosticEvent['level'];
    category: LocalDiagnosticEvent['category'];
    phase: string;
    eventCode: string;
    deviceId?: string;
    schemaFrom?: number;
    schemaTo?: number;
    migrationId?: string;
    durationMs?: number;
    error?: unknown;
    details?: Record<string, unknown>;
  }): Promise<void> {
    const errObj = input.error instanceof Error ? input.error : null;
    const event: LocalDiagnosticEvent = {
      id: crypto.randomUUID(),
      runId: this.runId,
      deviceId: input.deviceId ?? this.getDeviceIdFallback(),
      timestamp: new Date().toISOString(),
      level: input.level,
      category: input.category,
      phase: input.phase,
      eventCode: input.eventCode,
      appVersion: APP_BUILD_META.appVersion,
      buildId: APP_BUILD_META.buildId,
      schemaFrom: input.schemaFrom,
      schemaTo: input.schemaTo,
      migrationId: input.migrationId,
      durationMs: input.durationMs,
      errorName: errObj?.name,
      sanitizedMessage: sanitizeText(
        errObj?.message ?? (typeof input.error === 'string' ? input.error : undefined),
      ),
      details: input.details,
    };

    if (input.level === 'error' && (input.category === 'database-migration' || input.category === 'recovery')) {
      this._fatalError.set({
        code: event.eventCode,
        message: event.sanitizedMessage ?? 'Error crítico en migración o almacenamiento local.',
        migrationId: event.migrationId,
        timestamp: event.timestamp,
      });
    }

    this._recentEvents.update((list) => [event, ...list].slice(0, 150));

    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readwrite');
        tx.objectStore(STORE_EVENTS).put(event);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await this.enforceRetention();
    } catch {
      // Never throw from diagnostics logging
    }
  }

  async loadEvents(limit = 200): Promise<LocalDiagnosticEvent[]> {
    try {
      const db = await this.open();
      const all = await new Promise<LocalDiagnosticEvent[]>((resolve, reject) => {
        const tx = db.transaction(STORE_EVENTS, 'readonly');
        const req = tx.objectStore(STORE_EVENTS).getAll();
        req.onsuccess = () => resolve((req.result as LocalDiagnosticEvent[]) ?? []);
        req.onerror = () => reject(req.error);
      });
      all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const slice = all.slice(0, limit);
      this._recentEvents.set(slice);
      return slice;
    } catch {
      return this._recentEvents();
    }
  }

  async clearOrdinaryLogs(): Promise<void> {
    try {
      const db = await this.open();
      const all = await this.loadEvents(2000);
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      for (const ev of all) {
        if (ev.level === 'info' || ev.level === 'debug') {
          store.delete(ev.id);
        }
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
      });
      await this.loadEvents();
    } catch {
      // ignore
    }
  }

  async exportDiagnosticsReport(extraState?: Record<string, unknown>): Promise<void> {
    const events = await this.loadEvents(500);
    const report = {
      exportedAt: new Date().toISOString(),
      runId: this.runId,
      versions: APP_BUILD_META,
      fatalError: this._fatalError(),
      state: extraState ?? {},
      events,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trazena-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async enforceRetention(): Promise<void> {
    const db = await this.open();
    const all = await new Promise<LocalDiagnosticEvent[]>((resolve, reject) => {
      const tx = db.transaction(STORE_EVENTS, 'readonly');
      const req = tx.objectStore(STORE_EVENTS).getAll();
      req.onsuccess = () => resolve((req.result as LocalDiagnosticEvent[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    const cutoff = Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const toDelete = new Set<string>();
    let totalBytes = 0;
    const encoder = new TextEncoder();

    // Sort oldest first; prioritize deleting info/debug before warn/error
    const sorted = [...all].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (const ev of sorted) {
      const ts = Date.parse(ev.timestamp);
      if (Number.isFinite(ts) && ts < cutoff && ev.level !== 'error') {
        toDelete.add(ev.id);
      } else {
        totalBytes += encoder.encode(JSON.stringify(ev)).byteLength;
      }
    }

    if (totalBytes > MAX_BUDGET_BYTES) {
      const priorityOrder: LocalDiagnosticEvent['level'][] = ['debug', 'info', 'warn', 'error'];
      for (const lvl of priorityOrder) {
        if (totalBytes <= MAX_BUDGET_BYTES) break;
        for (const ev of sorted) {
          if (totalBytes <= MAX_BUDGET_BYTES) break;
          if (toDelete.has(ev.id) || ev.level !== lvl) continue;
          toDelete.add(ev.id);
          totalBytes -= encoder.encode(JSON.stringify(ev)).byteLength;
        }
      }
    }

    if (toDelete.size > 0) {
      const tx = db.transaction(STORE_EVENTS, 'readwrite');
      const store = tx.objectStore(STORE_EVENTS);
      for (const id of toDelete) store.delete(id);
    }
  }
}
