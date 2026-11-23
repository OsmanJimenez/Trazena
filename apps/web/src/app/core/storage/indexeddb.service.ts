import { Injectable } from '@angular/core';
import type {
  Organization,
  Page,
  PageContent,
  PageRouteAlias,
  Workspace,
} from '@trazena/shared';

export interface SyncQueueItem {
  id: string;
  entityType: 'organization' | 'workspace' | 'page' | 'page_content';
  entityId: string;
  operation: 'upsert' | 'delete';
  payload: unknown;
  createdAt: string;
  retries: number;
}

const DB_NAME = 'trazena_vault_v1';
const DB_VERSION = 1;

export type StoreName =
  | 'organizations'
  | 'workspaces'
  | 'pages'
  | 'page_contents'
  | 'route_aliases'
  | 'sync_queue'
  | 'meta';

/**
 * Offline-first IndexedDB storage engine for Trazena.
 * All documents and metadata live in IndexedDB (never in localStorage).
 */
@Injectable({ providedIn: 'root' })
export class IndexedDbService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
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
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });

    return this.dbPromise;
  }

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
      for (const value of values) {
        store.put(value);
      }
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

  async clearStore(storeName: StoreName): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async replaceSnapshot(data: {
    organizations: Organization[];
    workspaces: Workspace[];
    pages: Page[];
  }): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['organizations', 'workspaces', 'pages'], 'readwrite');
      const orgStore = tx.objectStore('organizations');
      const wsStore = tx.objectStore('workspaces');
      const pageStore = tx.objectStore('pages');

      orgStore.clear();
      wsStore.clear();
      pageStore.clear();

      for (const org of data.organizations) orgStore.put(org);
      for (const ws of data.workspaces) wsStore.put(ws);
      for (const page of data.pages) pageStore.put(page);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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

  async enqueueSync(item: SyncQueueItem): Promise<void> {
    await this.put('sync_queue', item);
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    return this.getAll<SyncQueueItem>('sync_queue');
  }

  async removeSyncItem(id: string): Promise<void> {
    await this.delete('sync_queue', id);
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
