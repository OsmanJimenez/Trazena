import { Injectable, inject, signal } from '@angular/core';
import {
  computeContentHash,
  type OrganizationReviewPolicy,
  type Page,
  type Tag,
} from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';

export interface BrokenLinkIssue {
  sourcePageId: string;
  sourceTitle: string;
  sourcePath: string;
  targetPageId: string;
  linkLabel: string;
  reason: 'not_found' | 'deleted';
}

export interface DuplicateGroup {
  reason: 'identical_content' | 'identical_title';
  key: string;
  pages: Array<{ id: string; title: string; path: string }>;
}

export interface ExternalLinkEntry {
  sourcePageId: string;
  sourceTitle: string;
  sourcePath: string;
  url: string;
}

export interface KnowledgeHealthReport {
  generatedAt: string;
  totalActivePages: number;
  unreviewedPages: Array<{ page: Page; path: string; daysSinceReview: number | null; cycleDays: number }>;
  brokenInternalLinks: BrokenLinkIssue[];
  externalLinks: ExternalLinkEntry[];
  potentialDuplicates: DuplicateGroup[];
  orphanPages: Array<{ page: Page; path: string }>;
  unusedTags: Tag[];
}

const DEFAULT_REVIEW_CYCLE_DAYS = 90;

@Injectable({ providedIn: 'root' })
export class KnowledgeHealthService {
  private readonly idb = inject(IndexedDbService);
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(TrazenaSyncService);

  private readonly _policies = signal<OrganizationReviewPolicy[]>([]);
  readonly policies = this._policies.asReadonly();

  async initialize(): Promise<void> {
    await this.idb.ensureOpen();
    const all = await this.idb.getAll<OrganizationReviewPolicy>('review_policies');
    this._policies.set(all);
  }

  getReviewCycleDays(orgId: string): number {
    return (
      this._policies().find((p) => p.organizationId === orgId)?.reviewCycleDays ??
      DEFAULT_REVIEW_CYCLE_DAYS
    );
  }

  async setReviewCycleDays(orgId: string, days: number): Promise<void> {
    const safeDays = Math.min(365, Math.max(7, Math.round(days)));
    const record: OrganizationReviewPolicy = {
      organizationId: orgId,
      reviewCycleDays: safeDays,
      updatedAt: new Date().toISOString(),
    };
    await this.idb.put('review_policies', record);
    this._policies.update((list) => [
      ...list.filter((p) => p.organizationId !== orgId),
      record,
    ]);
  }

  /**
   * Explicitly marks a page as reviewed today.
   * Updates `lastReviewedAt` metadata ONLY — never generates a Markdown history snapshot.
   */
  async markPageReviewed(page: Page): Promise<Page> {
    const uid = this.auth.user()?.uid ?? 'local-owner';
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const updated: Page = { ...page, lastReviewedAt: now };

    await this.idb.commitAtomicWithOutbox('pages', updated, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'page_review',
      entityId: page.id,
      operation: 'update',
      baseRevision: page.revision,
      payload: {
        organizationId: page.organizationId,
        lastReviewedAt: now,
      },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    await this.store.reloadFromLocal();
    await this.sync.refreshState();
    return updated;
  }

  async analyzeHealth(includeArchived = false): Promise<KnowledgeHealthReport> {
    await this.initialize();
    await this.store.initialize();
    await this.meta.initialize();

    const allPages = this.store.pages();
    const pageById = new Map(allPages.map((p) => [p.id, p]));
    const eligible = allPages.filter((p) =>
      includeArchived ? p.status !== 'deleted' : p.status === 'active',
    );

    const nowMs = Date.now();
    const unreviewedPages: KnowledgeHealthReport['unreviewedPages'] = [];
    const brokenInternalLinks: BrokenLinkIssue[] = [];
    const externalLinks: ExternalLinkEntry[] = [];
    const byContentHash = new Map<string, Array<{ id: string; title: string; path: string }>>();
    const byTitle = new Map<string, Array<{ id: string; title: string; path: string }>>();
    const inboundCounts = new Map<string, number>();

    for (const page of eligible) {
      const path = this.store.getCanonicalPath(page.id);
      const cycleDays = this.getReviewCycleDays(page.organizationId);
      const refIso = page.lastReviewedAt ?? null;
      const daysSinceReview = refIso
        ? Math.floor((nowMs - new Date(refIso).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      if (daysSinceReview === null || daysSinceReview >= cycleDays) {
        unreviewedPages.push({ page, path, daysSinceReview, cycleDays });
      }

      const normTitle = page.title.trim().toLowerCase();
      if (normTitle) {
        const list = byTitle.get(normTitle) ?? [];
        list.push({ id: page.id, title: page.title, path });
        byTitle.set(normTitle, list);
      }

      const content = await this.idb.getPageContent(page.id);
      const md = content?.markdown ?? '';
      if (md.trim().length > 25) {
        const hash = await computeContentHash(md.trim());
        const list = byContentHash.get(hash) ?? [];
        list.push({ id: page.id, title: page.title, path });
        byContentHash.set(hash, list);
      }

      // Check internal links trazena://page/<id>
      const linkRe = /\[([^\]]+)\]\(trazena:\/\/page\/([a-zA-Z0-9-]+)\)/g;
      let match: RegExpExecArray | null;
      while ((match = linkRe.exec(md)) !== null) {
        const label = match[1];
        const targetId = match[2];
        const target = pageById.get(targetId);
        if (!target) {
          brokenInternalLinks.push({
            sourcePageId: page.id,
            sourceTitle: page.title,
            sourcePath: path,
            targetPageId: targetId,
            linkLabel: label,
            reason: 'not_found',
          });
        } else if (target.status === 'deleted') {
          brokenInternalLinks.push({
            sourcePageId: page.id,
            sourceTitle: page.title,
            sourcePath: path,
            targetPageId: targetId,
            linkLabel: label,
            reason: 'deleted',
          });
        } else {
          inboundCounts.set(targetId, (inboundCounts.get(targetId) ?? 0) + 1);
        }
      }

      // Extract external URLs for optional manual review (never auto-pinged)
      const extRe = /https?:\/\/[^\s)>"']+/gi;
      const seenExt = new Set<string>();
      let extMatch: RegExpExecArray | null;
      while ((extMatch = extRe.exec(md)) !== null) {
        const url = extMatch[0].replace(/[.,;]+$/, '');
        if (!seenExt.has(url)) {
          seenExt.add(url);
          externalLinks.push({
            sourcePageId: page.id,
            sourceTitle: page.title,
            sourcePath: path,
            url,
          });
        }
      }
    }

    const potentialDuplicates: DuplicateGroup[] = [];
    for (const [hash, group] of byContentHash.entries()) {
      if (group.length > 1) {
        potentialDuplicates.push({ reason: 'identical_content', key: hash.slice(0, 12), pages: group });
      }
    }
    for (const [titleKey, group] of byTitle.entries()) {
      if (group.length > 1) {
        potentialDuplicates.push({ reason: 'identical_title', key: titleKey, pages: group });
      }
    }

    const orphanPages = eligible
      .filter((p) => (inboundCounts.get(p.id) ?? 0) === 0)
      .map((page) => ({ page, path: this.store.getCanonicalPath(page.id) }));

    const activePageIds = new Set(eligible.map((p) => p.id));
    const usedTagIds = new Set(
      this.meta
        .pageTags()
        .filter((pt) => activePageIds.has(pt.pageId))
        .map((pt) => pt.tagId),
    );
    const unusedTags = this.meta.tags().filter((t) => !usedTagIds.has(t.id));

    return {
      generatedAt: new Date().toISOString(),
      totalActivePages: eligible.length,
      unreviewedPages,
      brokenInternalLinks,
      externalLinks,
      potentialDuplicates,
      orphanPages,
      unusedTags,
    };
  }
}
