import { Injectable, inject } from '@angular/core';
import JSZip from 'jszip';
import {
  computeContentHash,
  type FullJsonExportPayload,
  type ImportExecutionResult,
  type ImportMode,
  type ImportPreviewItem,
  type ImportPreviewSummary,
  type ImportSourceFormat,
} from '@trazena/shared';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { SearchEngineService } from '../search/search-engine.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per input file
const MAX_ZIP_ENTRIES = 400;
const MAX_TOTAL_TEXT_BYTES = 30 * 1024 * 1024; // 30 MB ZIP bomb guard

function isSafeRelativePath(path: string): boolean {
  const norm = path.replace(/\\/g, '/').trim();
  if (!norm || norm.includes('\0')) return false;
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return false;
  const parts = norm.split('/');
  return !parts.some((p) => p === '..' || p === '.');
}

/** Strips Notion's trailing 32-hex ID suffix (e.g. "Roadmap 8f4b2c..."). */
function cleanNotionTitle(raw: string): string {
  return raw
    .replace(/\.(md|markdown)$/i, '')
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function parseFrontmatter(markdown: string): {
  body: string;
  title: string | null;
  tags: string[];
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: markdown, title: null, tags: [] };
  const yaml = match[1];
  const body = markdown.slice(match[0].length);
  let title: string | null = null;
  const tags: string[] = [];

  for (const line of yaml.split(/\r?\n/)) {
    const tMatch = line.match(/^title:\s*(.+)$/i);
    if (tMatch) {
      title = tMatch[1].trim().replace(/^["']|["']$/g, '');
    }
    const inlineTags = line.match(/^tags:\s*\[([^\]]+)\]/i);
    if (inlineTags) {
      for (const t of inlineTags[1].split(',')) {
        const clean = t.trim().replace(/^["'#]|["']$/g, '');
        if (clean) tags.push(clean);
      }
    }
  }
  return { body, title, tags };
}

function sanitizeImportedMarkdown(md: string): string {
  return md
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');
}

@Injectable({ providedIn: 'root' })
export class ImportEngineService {
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly search = inject(SearchEngineService);
  private readonly idb = inject(IndexedDbService);

  async analyzeFiles(
    files: File[],
    targetOrgId: string,
  ): Promise<ImportPreviewSummary> {
    await this.store.initialize();
    await this.meta.initialize();

    if (files.length === 0) {
      throw new Error('Selecciona al menos un archivo o carpeta para analizar.');
    }

    const warnings: string[] = [];
    const existingPages = this.store
      .pages()
      .filter((p) => p.organizationId === targetOrgId && p.status !== 'deleted');
    const existingTitleMap = new Map(
      existingPages.map((p) => [p.title.trim().toLowerCase(), p.id]),
    );
    const existingHashMap = new Map<string, string>();
    for (const p of existingPages) {
      const c = await this.idb.getPageContent(p.id);
      if (c?.markdown?.trim()) {
        existingHashMap.set(await computeContentHash(c.markdown.trim()), p.id);
      }
    }

    // 1. Trazena JSON v2 backup
    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.json')) {
      const file = files[0];
      if (file.size > MAX_FILE_BYTES) {
        throw new Error('El archivo JSON supera el límite de 15 MB.');
      }
      const parsed = JSON.parse(await file.text()) as Partial<FullJsonExportPayload>;
      if (!Array.isArray(parsed.pages)) {
        throw new Error('El archivo JSON no corresponde a una exportación válida de Trazena.');
      }
      const items: ImportPreviewItem[] = [];
      const idToTemp = new Map<string, string>();
      for (const p of parsed.pages) {
        idToTemp.set(p.id, `json:${p.id}`);
      }
      for (const p of parsed.pages) {
        const md = sanitizeImportedMarkdown(p.content?.markdown ?? '');
        const hash = md.trim() ? await computeContentHash(md.trim()) : '';
        const dupByHash = hash ? existingHashMap.get(hash) ?? null : null;
        const dupByTitle = existingTitleMap.get(p.title.trim().toLowerCase()) ?? null;
        const pageTagIds = new Set(
          (parsed.pageTags ?? []).filter((pt) => pt.pageId === p.id).map((pt) => pt.tagId),
        );
        const tags = (parsed.tags ?? [])
          .filter((t) => pageTagIds.has(t.id))
          .map((t) => t.name);

        items.push({
          tempId: `json:${p.id}`,
          originalPath: p.slug || p.title,
          title: p.title,
          parentTempId: p.parentId && idToTemp.has(p.parentId) ? idToTemp.get(p.parentId)! : null,
          depth: p.parentId ? 1 : 0,
          markdown: md,
          tags,
          duplicateOfPageId: dupByHash ?? dupByTitle,
          duplicateReason: dupByHash ? 'content' : dupByTitle ? 'title' : null,
          unresolvedLinks: [],
          missingAssets: [],
          preservedId: p.id,
        });
      }

      return {
        sourceFormat: 'trazena-json',
        sourceLabel: file.name,
        items,
        folderCount: 0,
        duplicateCount: items.filter((i) => i.duplicateOfPageId).length,
        unresolvedLinksCount: 0,
        missingAssetsCount: 0,
        warnings,
        isTrazJsonV2: parsed.manifest?.formatVersion === 2,
        manifestVersion: parsed.manifest?.formatVersion ?? null,
      };
    }

    // 2. ZIP archive (Notion / Obsidian / Trazena Markdown ZIP)
    const rawEntries: Array<{ path: string; text: string }> = [];
    let sourceFormat: ImportSourceFormat = 'markdown-file';
    let sourceLabel = files.length === 1 ? files[0].name : `${files.length} archivos Markdown`;

    if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
      const zipFile = files[0];
      if (zipFile.size > MAX_FILE_BYTES) {
        throw new Error('El archivo ZIP supera el límite seguro de 15 MB.');
      }
      sourceFormat = 'zip-markdown';
      sourceLabel = zipFile.name;
      const zip = await JSZip.loadAsync(zipFile);
      const entryNames = Object.keys(zip.files);
      if (entryNames.length > MAX_ZIP_ENTRIES) {
        warnings.push(
          `El ZIP contiene ${entryNames.length} entradas; se analizarán las primeras ${MAX_ZIP_ENTRIES} por límite de seguridad.`,
        );
      }

      let totalBytes = 0;
      for (const name of entryNames.slice(0, MAX_ZIP_ENTRIES)) {
        const entry = zip.files[name];
        if (entry.dir) continue;
        if (!isSafeRelativePath(name)) {
          warnings.push(`Ruta insegura omitida (protección ZIP Slip): ${name}`);
          continue;
        }
        if (name.startsWith('__MACOSX/') || name.includes('/.')) continue;
        if (!/\.(md|markdown)$/i.test(name)) continue;

        const text = await entry.async('string');
        totalBytes += text.length;
        if (totalBytes > MAX_TOTAL_TEXT_BYTES) {
          warnings.push('Se alcanzó el límite máximo de texto descomprimido (30 MB).');
          break;
        }
        rawEntries.push({ path: name.replace(/^content\//i, ''), text });
      }
    } else {
      // Single/multiple .md files or browser folder selection
      const hasFolder = files.some((f) => Boolean((f as File & { webkitRelativePath?: string }).webkitRelativePath));
      sourceFormat = hasFolder ? 'markdown-folder' : 'markdown-file';
      let totalBytes = 0;
      for (const f of files.slice(0, MAX_ZIP_ENTRIES)) {
        if (!/\.(md|markdown)$/i.test(f.name)) continue;
        if (f.size > MAX_FILE_BYTES) {
          warnings.push(`Archivo omitido por exceder 15 MB: ${f.name}`);
          continue;
        }
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        if (!isSafeRelativePath(rel)) {
          warnings.push(`Ruta insegura omitida: ${rel}`);
          continue;
        }
        const text = await f.text();
        totalBytes += text.length;
        if (totalBytes > MAX_TOTAL_TEXT_BYTES) break;
        rawEntries.push({ path: rel, text });
      }
    }

    if (rawEntries.length === 0) {
      throw new Error('No se encontraron archivos Markdown (.md / .markdown) válidos para importar.');
    }

    // Build hierarchy from folder structure (Obsidian / Notion compatible)
    const folderToTempId = new Map<string, string>();
    const items: ImportPreviewItem[] = [];
    const folderSet = new Set<string>();

    const ensureFolderPage = (folderPath: string): string => {
      const existing = folderToTempId.get(folderPath);
      if (existing) return existing;
      const parts = folderPath.split('/');
      const parentPath = parts.slice(0, -1).join('/');
      const parentTempId = parentPath ? ensureFolderPage(parentPath) : null;
      const tempId = `folder:${folderPath}`;
      folderToTempId.set(folderPath, tempId);
      folderSet.add(folderPath);
      const title = cleanNotionTitle(parts[parts.length - 1] || 'Sección');
      items.push({
        tempId,
        originalPath: folderPath,
        title,
        parentTempId,
        depth: parts.length - 1,
        markdown: `# ${title}\n\n`,
        tags: [],
        duplicateOfPageId: existingTitleMap.get(title.toLowerCase()) ?? null,
        duplicateReason: existingTitleMap.has(title.toLowerCase()) ? 'title' : null,
        unresolvedLinks: [],
        missingAssets: [],
      });
      return tempId;
    };

    const titleToTempId = new Map<string, string>();
    const pathToTempId = new Map<string, string>();

    for (const entry of rawEntries) {
      const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
      const fileName = parts[parts.length - 1] ?? 'Documento.md';
      const dirParts = parts.slice(0, -1);
      const parentTempId = dirParts.length > 0 ? ensureFolderPage(dirParts.join('/')) : null;
      const fm = parseFrontmatter(entry.text);
      const body = sanitizeImportedMarkdown(fm.body);
      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = fm.title || (h1Match ? h1Match[1].trim() : cleanNotionTitle(fileName)) || 'Sin título';
      const tempId = `file:${entry.path}`;

      const hash = body.trim() ? await computeContentHash(body.trim()) : '';
      const dupByHash = hash ? existingHashMap.get(hash) ?? null : null;
      const dupByTitle = existingTitleMap.get(title.toLowerCase()) ?? null;

      // Detect missing local asset references (images/attachments)
      const missingAssets: string[] = [];
      const imgRe = /!\[[^\]]*\]\((?!https?:\/\/)([^)]+)\)/g;
      let im: RegExpExecArray | null;
      while ((im = imgRe.exec(body)) !== null) {
        missingAssets.push(im[1]);
      }

      const item: ImportPreviewItem = {
        tempId,
        originalPath: entry.path,
        title,
        parentTempId,
        depth: dirParts.length,
        markdown: body,
        tags: fm.tags,
        duplicateOfPageId: dupByHash ?? dupByTitle,
        duplicateReason: dupByHash ? 'content' : dupByTitle ? 'title' : null,
        unresolvedLinks: [],
        missingAssets,
      };
      items.push(item);
      titleToTempId.set(title.toLowerCase(), tempId);
      titleToTempId.set(cleanNotionTitle(fileName).toLowerCase(), tempId);
      pathToTempId.set(entry.path.toLowerCase(), tempId);
    }

    // Second pass: check [[wikilinks]] and relative .md links
    let unresolvedLinksCount = 0;
    let missingAssetsCount = 0;
    for (const item of items) {
      missingAssetsCount += item.missingAssets.length;
      const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let wm: RegExpExecArray | null;
      while ((wm = wikiRe.exec(item.markdown)) !== null) {
        const ref = wm[1].trim().toLowerCase();
        if (!titleToTempId.has(ref)) {
          item.unresolvedLinks.push(wm[1].trim());
          unresolvedLinksCount++;
        }
      }
      const relMdRe = /\[[^\]]+\]\(([^)]+\.md)\)/gi;
      let rm: RegExpExecArray | null;
      while ((rm = relMdRe.exec(item.markdown)) !== null) {
        const targetName = decodeURIComponent(rm[1]).split('/').pop()?.toLowerCase() ?? '';
        const cleanTarget = cleanNotionTitle(targetName).toLowerCase();
        if (!titleToTempId.has(cleanTarget) && !pathToTempId.has(rm[1].toLowerCase())) {
          item.unresolvedLinks.push(rm[1]);
          unresolvedLinksCount++;
        }
      }
    }

    return {
      sourceFormat,
      sourceLabel,
      items,
      folderCount: folderSet.size,
      duplicateCount: items.filter((i) => i.duplicateOfPageId).length,
      unresolvedLinksCount,
      missingAssetsCount,
      warnings,
      isTrazJsonV2: false,
      manifestVersion: null,
    };
  }

  async executeImport(
    preview: ImportPreviewSummary,
    targetOrgId: string,
    targetWorkspaceId: string,
    mode: ImportMode,
    skipDuplicates = false,
  ): Promise<ImportExecutionResult> {
    await this.store.initialize();
    await this.meta.initialize();

    const tempToRealId = new Map<string, string>();
    const titleToRealId = new Map<string, string>();
    let createdPages = 0;
    let updatedPages = 0;
    let skippedPages = 0;
    let createdTags = 0;
    const warnings = [...preview.warnings];

    // Sort by depth so parent pages are always created before children
    const ordered = [...preview.items].sort((a, b) => a.depth - b.depth);

    for (const item of ordered) {
      if (skipDuplicates && item.duplicateOfPageId) {
        tempToRealId.set(item.tempId, item.duplicateOfPageId);
        titleToRealId.set(item.title.toLowerCase(), item.duplicateOfPageId);
        skippedPages++;
        continue;
      }

      const parentId = item.parentTempId ? (tempToRealId.get(item.parentTempId) ?? null) : null;

      if (mode === 'restore' && item.preservedId) {
        const existing = this.store.pages().find((p) => p.id === item.preservedId);
        if (existing) {
          await this.store.savePageContent(existing.id, item.markdown, existing.revision);
          tempToRealId.set(item.tempId, existing.id);
          titleToRealId.set(item.title.toLowerCase(), existing.id);
          updatedPages++;
          continue;
        }
      }

      const created = await this.store.createPage({
        organizationId: targetOrgId,
        workspaceId: targetWorkspaceId,
        parentId,
        title: item.title,
        markdown: item.markdown,
      });
      tempToRealId.set(item.tempId, created.id);
      titleToRealId.set(item.title.toLowerCase(), created.id);
      createdPages++;

      for (const tagName of item.tags) {
        const tag = await this.meta.ensureTag(targetOrgId, tagName);
        await this.meta.assignTagToPage(created, tag.id);
        createdTags++;
      }
    }

    // Rewrite [[wikilinks]] and relative .md links to stable trazena://page/<id>
    for (const item of ordered) {
      const realId = tempToRealId.get(item.tempId);
      if (!realId) continue;
      const page = this.store.pages().find((p) => p.id === realId);
      if (!page) continue;

      let rewritten = item.markdown;
      rewritten = rewritten.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (full, target, alias) => {
        const id = titleToRealId.get(String(target).trim().toLowerCase());
        return id ? `[${(alias || target).trim()}](trazena://page/${id})` : full;
      });
      rewritten = rewritten.replace(/\[([^\]]+)\]\(([^)]+\.md)\)/gi, (full, label, href) => {
        const base = cleanNotionTitle(decodeURIComponent(String(href)).split('/').pop() ?? '');
        const id = titleToRealId.get(base.toLowerCase());
        return id ? `[${label}](trazena://page/${id})` : full;
      });

      if (rewritten !== item.markdown) {
        await this.store.savePageContent(page.id, rewritten, page.revision);
      }
      this.search.upsertPage(page, rewritten);
      await this.meta.updateBacklinksForPage(page.id, rewritten);
    }

    return {
      createdPages,
      updatedPages,
      skippedPages,
      createdTags,
      warnings,
    };
  }
}
