import { Injectable, inject, signal } from '@angular/core';
import type { LocalDraftRecovery } from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { IndexedDbService } from '../storage/indexeddb.service';

const MAX_LOCAL_DRAFTS = 20;

/**
 * Local-only crash/reload draft recovery.
 * Strictly separated from normal IndexedDB saves and from the 3-version official history.
 * Never synced remotely to Cloudflare D1.
 */
@Injectable({ providedIn: 'root' })
export class DraftRecoveryService {
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);

  private readonly _drafts = signal<LocalDraftRecovery[]>([]);
  readonly drafts = this._drafts.asReadonly();

  private get ownerUid(): string {
    return this.auth.user()?.uid ?? 'local-owner';
  }

  async reload(): Promise<void> {
    await this.idb.ensureOpen();
    const uid = this.ownerUid;
    const all = await this.idb.getAll<LocalDraftRecovery>('draft_recovery');
    this._drafts.set(
      all
        .filter((d) => d.ownerUid === uid)
        .sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    );
  }

  async saveDraft(
    pageId: string,
    pageTitle: string,
    markdown: string,
    baseRevision: number,
  ): Promise<void> {
    await this.idb.ensureOpen();
    const uid = this.ownerUid;
    const draft: LocalDraftRecovery = {
      id: `${uid}:${pageId}`,
      ownerUid: uid,
      pageId,
      pageTitle,
      markdown,
      baseRevision,
      savedAt: new Date().toISOString(),
    };
    await this.idb.put('draft_recovery', draft);

    // Enforce bounded local retention (max 20 drafts per user)
    const all = (await this.idb.getAll<LocalDraftRecovery>('draft_recovery'))
      .filter((d) => d.ownerUid === uid)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    if (all.length > MAX_LOCAL_DRAFTS) {
      for (const stale of all.slice(MAX_LOCAL_DRAFTS)) {
        await this.idb.delete('draft_recovery', stale.id);
      }
    }
    this._drafts.set(all.slice(0, MAX_LOCAL_DRAFTS));
  }

  async getRecoverableDraft(
    pageId: string,
    currentMarkdown: string,
    currentRevision: number,
  ): Promise<LocalDraftRecovery | null> {
    await this.idb.ensureOpen();
    const id = `${this.ownerUid}:${pageId}`;
    const draft = await this.idb.getByKey<LocalDraftRecovery>('draft_recovery', id);
    if (!draft) return null;
    // Do not offer outdated draft if content is already identical or superseded by a newer revision
    if (draft.markdown.trim() === currentMarkdown.trim()) {
      await this.clearDraft(pageId);
      return null;
    }
    if (draft.baseRevision < currentRevision) {
      return draft; // Caller warns user before restoring over a newer revision
    }
    return draft;
  }

  async clearDraft(pageId: string): Promise<void> {
    await this.idb.ensureOpen();
    const id = `${this.ownerUid}:${pageId}`;
    await this.idb.delete('draft_recovery', id);
    this._drafts.update((list) => list.filter((d) => d.id !== id));
  }
}
