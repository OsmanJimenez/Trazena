import { Injectable, inject, signal } from '@angular/core';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';
import {
  collectDescendantIds,
  slugify,
  type ExportFormat,
  type ExportManifest,
  type ExportProgressState,
  type ExportRequest,
  type FullJsonExportPayload,
  type Organization,
  type PageWithContent,
  type Tag,
  type Workspace,
} from '@trazena/shared';
import { APP_BUILD_META } from '../diagnostics/app-version';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';
import { renderSafeMarkdown } from '../utils/markdown.util';

interface ExportDocNode {
  page: PageWithContent;
  organization: Organization;
  workspace: Workspace;
  depth: number;
  folderSegments: string[];
  fileBaseName: string;
  tags: Tag[];
}

interface ExportSnapshot {
  title: string;
  request: ExportRequest;
  organizations: Organization[];
  workspaces: Workspace[];
  nodes: ExportDocNode[];
  warnings: string[];
}

function sanitizeSegment(raw: string, fallback = 'doc'): string {
  const clean = slugify(raw, fallback).replace(/\.\./g, '').slice(0, 64);
  return clean || fallback;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalizes uncommon Unicode symbols not covered by jsPDF Helvetica WinAnsi encoding
 * while preserving full Spanish characters (áéíóúüñÁÉÍÓÚÜÑ¿¡).
 */
function pdfSafeText(text: string): string {
  return text
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/•/g, '-')
    .replace(/☑/g, '[x]')
    .replace(/☐/g, '[ ]');
}

const PREFS_KEY = 'trazena_export_prefs';

/**
 * Unified Local-First Export Engine for Trazena.
 * Pipeline: ExportRequest -> ScopeResolver -> Consistent Snapshot -> FormatAdapter -> Packaging -> BrowserDownload.
 * Operates 100% offline from IndexedDB including unsynced local edits. Never triggers remote sync.
 */
@Injectable({ providedIn: 'root' })
export class ExportEngineService {
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly idb = inject(IndexedDbService);

  private cancelled = false;

  private readonly _progress = signal<ExportProgressState>({
    phase: 'idle',
    message: '',
    processedPages: 0,
    totalPages: 0,
    warnings: [],
    errorMessage: null,
  });

  readonly progress = this._progress.asReadonly();

  resetProgress(): void {
    this.cancelled = false;
    this._progress.set({
      phase: 'idle',
      message: '',
      processedPages: 0,
      totalPages: 0,
      warnings: [],
      errorMessage: null,
    });
  }

  cancelCurrentExport(): void {
    this.cancelled = true;
    this._progress.update((p) => ({
      ...p,
      phase: 'cancelled',
      message: 'Exportación cancelada.',
    }));
  }

  async getSavedPreferences(): Promise<{
    format: ExportFormat;
    includeArchived: boolean;
    includeMetadata: boolean;
    pdfMode: 'combined' | 'separate';
  }> {
    const saved = await this.idb.getByKey<{
      key: string;
      value: {
        format: ExportFormat;
        includeArchived: boolean;
        includeMetadata: boolean;
        pdfMode: 'combined' | 'separate';
      };
    }>('meta', PREFS_KEY);
    return (
      saved?.value ?? {
        format: 'pdf',
        includeArchived: false,
        includeMetadata: true,
        pdfMode: 'combined',
      }
    );
  }

  async executeExport(request: ExportRequest): Promise<boolean> {
    this.cancelled = false;
    this._progress.set({
      phase: 'preparing',
      message: 'Preparando snapshot consistente desde IndexedDB…',
      processedPages: 0,
      totalPages: 0,
      warnings: [],
      errorMessage: null,
    });

    try {
      await this.idb.put('meta', {
        key: PREFS_KEY,
        value: {
          format: request.format,
          includeArchived: request.includeArchived,
          includeMetadata: request.includeMetadata,
          pdfMode: request.pdfMode ?? 'combined',
        },
      });

      const snapshot = await this.buildConsistentSnapshot(request);
      if (this.cancelled) return false;
      if (snapshot.nodes.length === 0) {
        throw new Error('No hay páginas válidas dentro del alcance seleccionado para exportar.');
      }

      this._progress.set({
        phase: 'processing',
        message: `Procesando ${snapshot.nodes.length} documento(s)…`,
        processedPages: 0,
        totalPages: snapshot.nodes.length,
        warnings: snapshot.warnings,
        errorMessage: null,
      });

      const fileStem = sanitizeSegment(snapshot.title, 'trazena-export');
      const dateStamp = new Date().toISOString().slice(0, 10);

      if (request.format === 'json') {
        const blob = this.generateJsonBlob(snapshot);
        this.triggerDownload(blob, `${fileStem}-${dateStamp}.json`);
      } else if (request.format === 'markdown') {
        if (snapshot.nodes.length === 1 && request.scope === 'page') {
          const md = this.formatMarkdownDocument(snapshot.nodes[0], snapshot, true);
          this.triggerDownload(
            new Blob([md], { type: 'text/markdown;charset=utf-8' }),
            `${snapshot.nodes[0].fileBaseName}.md`,
          );
        } else {
          const zipBlob = await this.packageMarkdownZip(snapshot);
          if (this.cancelled) return false;
          this.triggerDownload(zipBlob, `${fileStem}-markdown-${dateStamp}.zip`);
        }
      } else if (request.format === 'html') {
        if (snapshot.nodes.length === 1 && request.scope === 'page') {
          const html = this.formatStandaloneHtml(snapshot.nodes[0], snapshot, null);
          this.triggerDownload(
            new Blob([html], { type: 'text/html;charset=utf-8' }),
            `${snapshot.nodes[0].fileBaseName}.html`,
          );
        } else {
          const zipBlob = await this.packageHtmlZip(snapshot);
          if (this.cancelled) return false;
          this.triggerDownload(zipBlob, `${fileStem}-html-${dateStamp}.zip`);
        }
      } else if (request.format === 'pdf') {
        if (request.pdfMode === 'separate' && snapshot.nodes.length > 1) {
          const zipBlob = await this.packageSeparatePdfZip(snapshot);
          if (this.cancelled) return false;
          this.triggerDownload(zipBlob, `${fileStem}-pdfs-${dateStamp}.zip`);
        } else {
          const pdfBlob = await this.generateCombinedPdf(snapshot);
          if (this.cancelled) return false;
          this.triggerDownload(pdfBlob, `${fileStem}-${dateStamp}.pdf`);
        }
      }

      this._progress.update((p) => ({
        ...p,
        phase: 'completed',
        processedPages: snapshot.nodes.length,
        message: `Exportación completada (${snapshot.nodes.length} página(s)).`,
      }));
      return true;
    } catch (err) {
      this._progress.update((p) => ({
        ...p,
        phase: 'error',
        message: 'Error durante la exportación.',
        errorMessage: err instanceof Error ? err.message : 'No se pudo generar el archivo.',
      }));
      return false;
    }
  }

  // --- Scope Resolution & Consistent Snapshot ---

  private async buildConsistentSnapshot(request: ExportRequest): Promise<ExportSnapshot> {
    await this.store.initialize();
    await this.meta.initialize();

    const allOrgs = this.store.organizations().filter((o) => o.status !== 'deleted');
    const allWs = this.store.workspaces().filter((w) => w.status !== 'deleted');
    const allPages = this.store.pages().filter((p) => {
      if (p.status === 'deleted') return false;
      if (!request.includeArchived && p.status === 'archived') return false;
      return true;
    });

    const orgMap = new Map(allOrgs.map((o) => [o.id, o]));
    const wsMap = new Map(allWs.map((w) => [w.id, w]));

    const selectedPageIds = new Set<string>();
    let title = request.title ?? 'trazena-export';

    if (request.scope === 'page') {
      for (const id of request.targetIds) selectedPageIds.add(id);
      const first = allPages.find((p) => p.id === request.targetIds[0]);
      if (first) title = first.title;
    } else if (request.scope === 'page-tree') {
      for (const id of request.targetIds) {
        selectedPageIds.add(id);
        for (const descId of collectDescendantIds(allPages, id)) {
          selectedPageIds.add(descId);
        }
      }
      const first = allPages.find((p) => p.id === request.targetIds[0]);
      if (first) title = `${first.title}-arbol`;
    } else if (request.scope === 'workspace') {
      const wsSet = new Set(request.targetIds);
      for (const p of allPages) {
        if (wsSet.has(p.workspaceId)) selectedPageIds.add(p.id);
      }
      const ws = wsMap.get(request.targetIds[0]);
      if (ws) title = ws.name;
    } else if (request.scope === 'organization') {
      const orgSet = new Set(request.targetIds);
      for (const p of allPages) {
        if (orgSet.has(p.organizationId)) selectedPageIds.add(p.id);
      }
      const org = orgMap.get(request.targetIds[0]);
      if (org) title = org.name;
    } else {
      for (const id of request.targetIds) selectedPageIds.add(id);
      title = request.title ?? 'seleccion-trazena';
    }

    // Order pages hierarchically (depth-first) and load immutable content snapshot from IndexedDB
    const eligiblePages = allPages.filter((p) => selectedPageIds.has(p.id));
    const eligibleMap = new Map(eligiblePages.map((p) => [p.id, p]));
    const childrenMap = new Map<string | null, typeof eligiblePages>();
    for (const p of eligiblePages) {
      const key = p.parentId && eligibleMap.has(p.parentId) ? p.parentId : null;
      const list = childrenMap.get(key) ?? [];
      list.push(p);
      childrenMap.set(key, list);
    }
    for (const list of childrenMap.values()) {
      list.sort((a, b) => a.position.localeCompare(b.position) || a.title.localeCompare(b.title));
    }

    const ordered: Array<{ page: (typeof eligiblePages)[number]; depth: number; chain: string[] }> = [];
    const visited = new Set<string>();
    const walk = (parentId: string | null, depth: number, chain: string[]) => {
      const list = childrenMap.get(parentId) ?? [];
      for (const p of list) {
        if (visited.has(p.id)) continue;
        visited.add(p.id);
        const seg = sanitizeSegment(p.slug || p.title, 'page');
        ordered.push({ page: p, depth, chain: [...chain, seg] });
        walk(p.id, depth + 1, [...chain, seg]);
      }
    };
    walk(null, 0, []);

    const nodes: ExportDocNode[] = [];
    const usedPaths = new Set<string>();
    const warnings: string[] = [];
    const usedOrgs = new Map<string, Organization>();
    const usedWs = new Map<string, Workspace>();

    for (const item of ordered) {
      const org = orgMap.get(item.page.organizationId);
      const ws = wsMap.get(item.page.workspaceId);
      if (!org || !ws) continue;
      usedOrgs.set(org.id, org);
      usedWs.set(ws.id, ws);

      const content = (await this.idb.getPageContent(item.page.id)) ?? {
        pageId: item.page.id,
        markdown: `# ${item.page.title}\n\n`,
        excerpt: '',
        wordCount: 0,
        updatedAt: item.page.updatedAt,
        updatedBy: item.page.updatedBy,
      };

      if (/!\[[^\]]*\]\(https?:\/\//i.test(content.markdown)) {
        warnings.push(
          `"${item.page.title}" referencia imágenes remotas; se exporta el texto completo sin incrustar binarios remotos.`,
        );
      }

      const folderSegments = [
        sanitizeSegment(org.slug || org.name, 'org'),
        sanitizeSegment(ws.slug || ws.name, 'space'),
        ...item.chain.slice(0, -1),
      ];
      let fileBase = item.chain[item.chain.length - 1] || 'page';
      let fullKey = [...folderSegments, fileBase].join('/');
      let suffix = 2;
      while (usedPaths.has(fullKey)) {
        fileBase = `${item.chain[item.chain.length - 1]}-${suffix}`;
        fullKey = [...folderSegments, fileBase].join('/');
        suffix += 1;
      }
      usedPaths.add(fullKey);

      nodes.push({
        page: { ...item.page, content },
        organization: org,
        workspace: ws,
        depth: item.depth,
        folderSegments,
        fileBaseName: fileBase,
        tags: this.meta.getTagsForPage(item.page.id),
      });
    }

    return {
      title,
      request,
      organizations: [...usedOrgs.values()],
      workspaces: [...usedWs.values()],
      nodes,
      warnings,
    };
  }

  private buildManifest(snapshot: ExportSnapshot): ExportManifest {
    return {
      formatVersion: 2,
      exportedAt: new Date().toISOString(),
      appVersion: APP_BUILD_META.appVersion,
      scope: snapshot.request.scope,
      format: snapshot.request.format,
      organizationsCount: snapshot.organizations.length,
      workspacesCount: snapshot.workspaces.length,
      pagesCount: snapshot.nodes.length,
      warnings: snapshot.warnings,
    };
  }

  // --- JSON Adapter (zero secrets, zero diagnostics) ---

  private generateJsonBlob(snapshot: ExportSnapshot): Blob {
    const orgIds = new Set(snapshot.organizations.map((o) => o.id));
    const pageIds = new Set(snapshot.nodes.map((n) => n.page.id));

    const payload: FullJsonExportPayload = {
      manifest: this.buildManifest(snapshot),
      organizations: snapshot.organizations,
      workspaces: snapshot.workspaces,
      pages: snapshot.nodes.map((n) => n.page),
      tags: this.meta.tags().filter((t) => orgIds.has(t.organizationId)),
      pageTags: this.meta.pageTags().filter((pt) => pageIds.has(pt.pageId)),
      propertyDefinitions: this.meta
        .propertyDefinitions()
        .filter((d) => orgIds.has(d.organizationId)),
      propertyValues: this.meta
        .propertyValues()
        .filter((v) => pageIds.has(v.pageId)),
      templates: this.meta.templates(),
    };

    return new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
  }

  // --- Markdown Adapter + ZIP ---

  private resolveInternalLinksForExport(
    markdown: string,
    snapshot: ExportSnapshot,
    ext: 'md' | 'html',
  ): string {
    const nodeById = new Map(snapshot.nodes.map((n) => [n.page.id, n]));
    const replacer = (_full: string, label: string, targetId: string) => {
      const target = nodeById.get(targetId);
      if (!target) return label;
      const targetPath = [...target.folderSegments, `${target.fileBaseName}.${ext}`].join('/');
      return `[${label}](${targetPath})`;
    };
    return markdown
      .replace(/\[([^\]]+)\]\(trazena:\/\/page\/([a-zA-Z0-9-]+)\)/g, replacer)
      .replace(/\[\[([^|\]]+)\|page:([a-zA-Z0-9-]+)\]\]/g, replacer);
  }

  private formatMarkdownDocument(
    node: ExportDocNode,
    snapshot: ExportSnapshot,
    singleFile: boolean,
  ): string {
    const body = singleFile
      ? node.page.content.markdown
      : this.resolveInternalLinksForExport(node.page.content.markdown, snapshot, 'md');
    if (!snapshot.request.includeMetadata) return body;

    const tagNames = node.tags.map((t) => t.name);
    const props = this.meta.getPropertyValuesForPage(node.page.id);
    const propLines = props.map((pv) => {
      const def = this.meta.propertyDefinitions().find((d) => d.id === pv.propertyId);
      return def ? `  ${sanitizeSegment(def.name, 'prop')}: ${JSON.stringify(pv.value)}` : '';
    }).filter(Boolean);

    const fm = [
      '---',
      `id: "${node.page.id}"`,
      `title: ${JSON.stringify(node.page.title)}`,
      `organization: ${JSON.stringify(node.organization.name)}`,
      `workspace: ${JSON.stringify(node.workspace.name)}`,
      `revision: ${node.page.revision}`,
      `updatedAt: "${node.page.updatedAt}"`,
      ...(tagNames.length > 0 ? [`tags: [${tagNames.map((t) => JSON.stringify(t)).join(', ')}]`] : []),
      ...(propLines.length > 0 ? ['properties:', ...propLines] : []),
      '---',
      '',
    ].join('\n');

    return `${fm}${body}`;
  }

  private async packageMarkdownZip(snapshot: ExportSnapshot): Promise<Blob> {
    const zip = new JSZip();
    const manifest = this.buildManifest(snapshot);
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('metadata/entities.json', await this.generateJsonBlob(snapshot).text());

    const readmeLines = [
      `# ${snapshot.title}`,
      '',
      `Exportado desde Trazena v${APP_BUILD_META.appVersion} el ${manifest.exportedAt}.`,
      '',
      '## Contenido',
      '',
    ];

    for (let i = 0; i < snapshot.nodes.length; i++) {
      if (this.cancelled) throw new Error('Cancelado');
      const node = snapshot.nodes[i];
      const relPath = ['content', ...node.folderSegments, `${node.fileBaseName}.md`].join('/');
      zip.file(relPath, this.formatMarkdownDocument(node, snapshot, false));
      readmeLines.push(`${'  '.repeat(node.depth)}- [${node.page.title}](${relPath})`);
      this._progress.update((p) => ({ ...p, processedPages: i + 1 }));
    }

    zip.file('README.md', readmeLines.join('\n'));
    this._progress.update((p) => ({ ...p, phase: 'packaging', message: 'Empaquetando archivo ZIP…' }));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // --- HTML Portable Adapter + ZIP ---

  private formatStandaloneHtml(
    node: ExportDocNode,
    snapshot: ExportSnapshot,
    navLinksHtml: string | null,
  ): string {
    const resolvedMd = this.resolveInternalLinksForExport(
      node.page.content.markdown,
      snapshot,
      'html',
    );
    const bodyHtml = renderSafeMarkdown(resolvedMd);
    const tagsHtml =
      node.tags.length > 0
        ? `<div class="tags">${node.tags.map((t) => `<span class="tag">#${escapeHtml(t.name)}</span>`).join('')}</div>`
        : '';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(node.page.title)} — Trazena</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #191919; background: #fff; margin: 0; line-height: 1.65; }
  .layout { display: grid; grid-template-columns: ${navLinksHtml ? '260px 1fr' : '1fr'}; min-height: 100vh; }
  nav { background: #f7f7f5; border-right: 1px solid #e6e6e2; padding: 1.25rem; font-size: 0.88rem; }
  nav a { display: block; padding: 0.3rem 0.45rem; color: #333; text-decoration: none; border-radius: 5px; }
  nav a:hover { background: #eaeae6; }
  main { max-width: 820px; margin: 0 auto; padding: 2.25rem 2rem; width: 100%; box-sizing: border-box; }
  .meta { font-size: 0.8rem; color: #6b6b68; margin-bottom: 1.25rem; }
  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.5rem 0 1.25rem; }
  .tag { font-size: 0.75rem; background: #f0fdfa; color: #0f766e; padding: 0.15rem 0.5rem; border-radius: 999px; }
  pre { background: #1c2128; color: #e5e7eb; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d4d4ce; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f3f3f0; }
  blockquote { border-left: 3px solid #191919; margin: 1rem 0; padding: 0.4rem 1rem; background: #f7f7f5; }
  @media (max-width: 820px) { .layout { grid-template-columns: 1fr; } nav { border-right: 0; border-bottom: 1px solid #e6e6e2; } }
</style>
</head>
<body>
<div class="layout">
  ${navLinksHtml ? `<nav><strong>${escapeHtml(snapshot.title)}</strong>${navLinksHtml}</nav>` : ''}
  <main>
    <div class="meta">${escapeHtml(node.organization.name)} / ${escapeHtml(node.workspace.name)} · Rev. v${node.page.revision}</div>
    <h1>${escapeHtml(node.page.title)}</h1>
    ${tagsHtml}
    <article>${bodyHtml}</article>
  </main>
</div>
</body>
</html>`;
  }

  private async packageHtmlZip(snapshot: ExportSnapshot): Promise<Blob> {
    const zip = new JSZip();
    const manifest = this.buildManifest(snapshot);
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const indexLinks = snapshot.nodes
      .map((n) => {
        const rel = ['content', ...n.folderSegments, `${n.fileBaseName}.html`].join('/');
        return `<a style="padding-left:${n.depth * 14 + 6}px" href="${rel}">${escapeHtml(n.page.title)}</a>`;
      })
      .join('');

    zip.file(
      'index.html',
      `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>body{font-family:system-ui,sans-serif;max-width:780px;margin:2rem auto;padding:0 1rem}a{display:block;padding:0.35rem;color:#0f766e;text-decoration:none}</style></head><body><h1>${escapeHtml(snapshot.title)}</h1><p>${snapshot.nodes.length} páginas exportadas el ${manifest.exportedAt}</p>${indexLinks}</body></html>`,
    );

    for (let i = 0; i < snapshot.nodes.length; i++) {
      if (this.cancelled) throw new Error('Cancelado');
      const node = snapshot.nodes[i];
      const depthBack = '../'.repeat(node.folderSegments.length + 1);
      const navHtml = snapshot.nodes
        .map((other) => {
          const href = `${depthBack}content/${[...other.folderSegments, `${other.fileBaseName}.html`].join('/')}`;
          return `<a style="padding-left:${other.depth * 12 + 6}px" href="${href}">${escapeHtml(other.page.title)}</a>`;
        })
        .join('');
      const relPath = ['content', ...node.folderSegments, `${node.fileBaseName}.html`].join('/');
      zip.file(relPath, this.formatStandaloneHtml(node, snapshot, navHtml));
      this._progress.update((p) => ({ ...p, processedPages: i + 1 }));
    }

    this._progress.update((p) => ({ ...p, phase: 'packaging', message: 'Empaquetando HTML portable…' }));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  // --- PDF Adapter (Real Selectable-Text A4 PDF via jsPDF + autoTable) ---

  private renderMarkdownToPdf(doc: jsPDF, node: ExportDocNode, startY: number): number {
    const marginX = 18;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth - marginX * 2;
    let y = startY;

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
    };

    // Document title header
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(25, 25, 25);
    const titleLines = doc.splitTextToSize(pdfSafeText(node.page.title), maxWidth) as string[];
    doc.text(titleLines, marginX, y);
    y += titleLines.length * 7.5 + 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 105);
    const metaLine = pdfSafeText(
      `${node.organization.name} / ${node.workspace.name} · Rev. v${node.page.revision}` +
        (node.tags.length > 0 ? ` · ${node.tags.map((t) => `#${t.name}`).join(' ')}` : ''),
    );
    doc.text(metaLine, marginX, y);
    y += 5;
    doc.setDrawColor(220, 220, 215);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 7;

    const lines = node.page.content.markdown.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code block
      if (trimmed.startsWith('```')) {
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        i++;
        doc.setFont('courier', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(35, 40, 48);
        const wrapped: string[] = [];
        for (const cl of codeLines) {
          const split = doc.splitTextToSize(pdfSafeText(cl || ' '), maxWidth - 8) as string[];
          wrapped.push(...split);
        }
        const blockHeight = wrapped.length * 4.3 + 6;
        ensureSpace(Math.min(blockHeight, 45));
        doc.setFillColor(244, 244, 242);
        doc.setDrawColor(220, 220, 215);
        for (const wl of wrapped) {
          ensureSpace(6);
          doc.rect(marginX, y - 3.5, maxWidth, 4.6, 'F');
          doc.text(wl, marginX + 3, y);
          y += 4.3;
        }
        y += 4;
        continue;
      }

      // Markdown table
      if (
        trimmed.startsWith('|') &&
        i + 1 < lines.length &&
        /^\|?\s*[-:]+/.test(lines[i + 1].trim())
      ) {
        const parseRow = (r: string) =>
          r
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => pdfSafeText(cell.replace(/[*_`]/g, '').trim()));
        const head = [parseRow(trimmed)];
        i += 2;
        const body: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          body.push(parseRow(lines[i].trim()));
          i++;
        }
        ensureSpace(22);
        autoTable(doc, {
          startY: y,
          head,
          body,
          margin: { left: marginX, right: marginX },
          styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: [25, 25, 25] },
          headStyles: { fillColor: [243, 243, 240], textColor: [25, 25, 25], fontStyle: 'bold' },
          theme: 'grid',
        });
        const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
        y = (finalY ?? y + 20) + 6;
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        ensureSpace(8);
        doc.setDrawColor(210, 210, 205);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 6;
        i++;
        continue;
      }

      // Headings H1-H6
      const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const text = pdfSafeText(hMatch[2].replace(/[*_`]/g, ''));
        const sizes = [15, 13, 11.5, 10.5, 10, 9.5];
        ensureSpace(12);
        y += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(sizes[level - 1] ?? 10);
        doc.setTextColor(25, 25, 25);
        const hLines = doc.splitTextToSize(text, maxWidth) as string[];
        doc.text(hLines, marginX, y);
        y += hLines.length * 5.6 + 2.5;
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('>')) {
        const qText = pdfSafeText(trimmed.replace(/^>\s?/, '').replace(/[*_`]/g, ''));
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(10);
        doc.setTextColor(85, 85, 80);
        const qLines = doc.splitTextToSize(qText, maxWidth - 8) as string[];
        ensureSpace(qLines.length * 5 + 4);
        doc.setDrawColor(15, 118, 110);
        doc.setLineWidth(0.8);
        doc.line(marginX + 1, y - 3, marginX + 1, y + qLines.length * 4.8 - 2);
        doc.setLineWidth(0.2);
        doc.text(qLines, marginX + 6, y);
        y += qLines.length * 5 + 3;
        i++;
        continue;
      }

      // Blank line
      if (!trimmed) {
        y += 3;
        i++;
        continue;
      }

      // Lists, checklists, or normal paragraph
      const cleaned = pdfSafeText(
        trimmed
          .replace(/^-\s+\[x\]\s+/i, '[x] ')
          .replace(/^-\s+\[\s\]\s+/, '[ ] ')
          .replace(/^[-*]\s+/, '- ')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
          .replace(/[*_`~]/g, ''),
      );
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(35, 35, 35);
      const pLines = doc.splitTextToSize(cleaned, maxWidth) as string[];
      for (const pl of pLines) {
        ensureSpace(6);
        doc.text(pl, marginX, y);
        y += 5;
      }
      y += 1.5;
      i++;
    }

    return y;
  }

  private addPdfPageNumbers(doc: jsPDF): void {
    const total = doc.getNumberOfPages();
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    for (let p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(130, 130, 125);
      doc.text(`Trazena · Página ${p} de ${total}`, width - 18, height - 10, { align: 'right' });
    }
  }

  private async generateCombinedPdf(snapshot: ExportSnapshot): Promise<Blob> {
    this._progress.update((p) => ({ ...p, phase: 'generating', message: 'Generando documento PDF…' }));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const multi = snapshot.nodes.length > 1;
    if (multi && snapshot.request.includeCoverPage !== false) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(24);
      doc.setTextColor(25, 25, 25);
      doc.text(pdfSafeText(snapshot.title), 18, 65);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(100, 100, 95);
      doc.text(
        pdfSafeText(
          `Exportado desde Trazena · ${snapshot.nodes.length} páginas · ${new Date().toLocaleDateString()}`,
        ),
        18,
        76,
      );

      if (snapshot.request.includeToc !== false) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(25, 25, 25);
        doc.text('Índice', 18, 98);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        let tocY = 107;
        for (const n of snapshot.nodes.slice(0, 35)) {
          if (tocY > 270) break;
          doc.text(pdfSafeText(`${'  '.repeat(n.depth)}- ${n.page.title}`), 20, tocY);
          tocY += 5.5;
        }
      }
      doc.addPage();
    }

    for (let i = 0; i < snapshot.nodes.length; i++) {
      if (this.cancelled) throw new Error('Cancelado');
      if (i > 0) doc.addPage();
      this.renderMarkdownToPdf(doc, snapshot.nodes[i], 20);
      this._progress.update((p) => ({ ...p, processedPages: i + 1 }));
    }

    this.addPdfPageNumbers(doc);
    return doc.output('blob');
  }

  private async packageSeparatePdfZip(snapshot: ExportSnapshot): Promise<Blob> {
    const zip = new JSZip();
    const manifest = this.buildManifest(snapshot);
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    for (let i = 0; i < snapshot.nodes.length; i++) {
      if (this.cancelled) throw new Error('Cancelado');
      const node = snapshot.nodes[i];
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      this.renderMarkdownToPdf(doc, node, 20);
      this.addPdfPageNumbers(doc);
      const relPath = ['content', ...node.folderSegments, `${node.fileBaseName}.pdf`].join('/');
      zip.file(relPath, doc.output('arraybuffer'));
      this._progress.update((p) => ({ ...p, processedPages: i + 1 }));
    }

    this._progress.update((p) => ({ ...p, phase: 'packaging', message: 'Empaquetando PDFs en ZIP…' }));
    return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  }

  private triggerDownload(blob: Blob, filename: string): void {
    this._progress.update((p) => ({ ...p, phase: 'downloading', message: `Descargando ${filename}…` }));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
