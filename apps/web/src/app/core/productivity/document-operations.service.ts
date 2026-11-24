import { Injectable, inject } from '@angular/core';
import type { PageWithContent } from '@trazena/shared';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { SearchEngineService } from '../search/search-engine.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';

export interface MergeResult {
  targetPageId: string;
  updatedReferencesCount: number;
  copiedTagsCount: number;
}

/**
 * Structural document transformations (Extract selection to subpage, Merge pages).
 * Preserves Markdown integrity, recalculates internal links, and keeps source recoverable.
 */
@Injectable({ providedIn: 'root' })
export class DocumentOperationsService {
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly search = inject(SearchEngineService);
  private readonly idb = inject(IndexedDbService);

  async extractSelectionToSubpage(
    sourcePage: PageWithContent,
    selectedText: string,
    newTitle: string,
  ): Promise<{ childPage: PageWithContent; updatedSourceMarkdown: string }> {
    const trimmedSelection = selectedText.trim();
    if (!trimmedSelection) {
      throw new Error('Selecciona el contenido que deseas extraer.');
    }

    const childMarkdown = trimmedSelection.startsWith('#')
      ? trimmedSelection
      : `# ${newTitle.trim()}\n\n${trimmedSelection}\n`;

    const childPage = await this.store.createPage({
      organizationId: sourcePage.organizationId,
      workspaceId: sourcePage.workspaceId,
      parentId: sourcePage.id,
      title: newTitle.trim(),
      markdown: childMarkdown,
    });

    const linkMd = `[${childPage.title}](trazena://page/${childPage.id})`;
    const currentMd = sourcePage.content.markdown;
    const idx = currentMd.indexOf(trimmedSelection);
    const updatedSourceMarkdown =
      idx >= 0
        ? currentMd.slice(0, idx) + linkMd + currentMd.slice(idx + trimmedSelection.length)
        : `${currentMd}\n\n${linkMd}\n`;

    const saved = await this.store.savePageContent(
      sourcePage.id,
      updatedSourceMarkdown,
      sourcePage.revision,
    );
    if (saved) {
      this.search.upsertPage(saved, updatedSourceMarkdown);
      await this.meta.updateBacklinksForPage(saved.id, updatedSourceMarkdown);
    }
    this.search.upsertPage(childPage, childMarkdown);
    await this.meta.updateBacklinksForPage(childPage.id, childMarkdown);

    return { childPage, updatedSourceMarkdown };
  }

  async mergePages(sourcePageId: string, targetPageId: string): Promise<MergeResult> {
    if (sourcePageId === targetPageId) {
      throw new Error('Selecciona una página destino diferente a la página origen.');
    }

    const sourcePage = this.store.pages().find((p) => p.id === sourcePageId);
    const targetPage = this.store.pages().find((p) => p.id === targetPageId);
    if (!sourcePage || !targetPage) {
      throw new Error('No se encontraron ambas páginas para fusionar.');
    }

    const [sourceContent, targetContent] = await Promise.all([
      this.idb.getPageContent(sourcePage.id),
      this.idb.getPageContent(targetPage.id),
    ]);

    const sourceMd = sourceContent?.markdown?.trim() ?? '';
    const targetMd = targetContent?.markdown?.trim() ?? '';
    const mergedMd = `${targetMd}\n\n---\n\n## ${sourcePage.title}\n\n${sourceMd}\n`;

    const savedTarget = await this.store.savePageContent(
      targetPage.id,
      mergedMd,
      targetPage.revision,
    );

    // Copy tags from source to target without duplicates
    const sourceTags = this.meta.getTagsForPage(sourcePage.id);
    let copiedTagsCount = 0;
    for (const tag of sourceTags) {
      await this.meta.assignTagToPage(targetPage, tag.id);
      copiedTagsCount++;
    }

    // Rewrite incoming trazena://page/<sourcePageId> references across other active pages
    let updatedReferencesCount = 0;
    const refRe = new RegExp(`trazena://page/${sourcePage.id}`, 'g');
    for (const other of this.store.pages()) {
      if (other.id === sourcePage.id || other.status === 'deleted') continue;
      const otherContent = await this.idb.getPageContent(other.id);
      if (!otherContent?.markdown || !refRe.test(otherContent.markdown)) continue;
      const nextMd = otherContent.markdown.replace(refRe, `trazena://page/${targetPage.id}`);
      await this.store.savePageContent(other.id, nextMd, other.revision);
      this.search.upsertPage(other, nextMd);
      await this.meta.updateBacklinksForPage(other.id, nextMd);
      updatedReferencesCount++;
    }

    // Archive source page safely instead of destructive deletion (recoverable)
    await this.store.updatePageMeta(sourcePage.id, { status: 'archived' });

    if (savedTarget) {
      this.search.upsertPage(savedTarget, mergedMd);
      await this.meta.updateBacklinksForPage(savedTarget.id, mergedMd);
    }

    return {
      targetPageId: targetPage.id,
      updatedReferencesCount,
      copiedTagsCount,
    };
  }
}
