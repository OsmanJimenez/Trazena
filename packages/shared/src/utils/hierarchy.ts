import type { Page, PageTreeItem } from '../models/domain.js';

/**
 * Converts any human-readable name into a URL-safe lowercase slug.
 * Strips diacritics and collapses non-alphanumeric runs to single hyphens.
 */
export function slugify(input: string, fallback = 'untitled'): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized.length > 0 ? normalized : fallback;
}

/**
 * Ensures a slug is unique among siblings by appending `-2`, `-3`, etc.
 */
export function ensureUniqueSlug(
  baseSlug: string,
  existingSlugs: Iterable<string>,
): string {
  const taken = new Set(existingSlugs);
  if (!taken.has(baseSlug)) return baseSlug;
  let suffix = 2;
  while (taken.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseSlug}-${suffix}`;
}

/**
 * Simple deterministic lexicographic position generator.
 * Produces zero-padded numeric positions separated by step 1000 for clean ordering.
 */
export function generatePosition(index: number): string {
  return String((index + 1) * 1000).padStart(10, '0');
}

export function generateNextPosition(existingPositions: readonly string[]): string {
  if (existingPositions.length === 0) return generatePosition(0);
  const sorted = [...existingPositions].sort();
  const last = sorted[sorted.length - 1];
  const parsed = Number.parseInt(last, 10);
  if (Number.isFinite(parsed)) {
    return String(parsed + 1000).padStart(10, '0');
  }
  return `${last}m`;
}

/**
 * Checks whether moving `pageId` under `targetParentId` would introduce a cycle.
 */
export function wouldCreateCycle(
  pages: readonly Pick<Page, 'id' | 'parentId'>[],
  pageId: string,
  targetParentId: string | null,
): boolean {
  if (targetParentId === null) return false;
  if (targetParentId === pageId) return true;

  const byId = new Map<string, string | null>();
  for (const p of pages) {
    byId.set(p.id, p.parentId);
  }

  let cursor: string | null = targetParentId;
  const visited = new Set<string>([pageId]);
  while (cursor !== null) {
    if (visited.has(cursor)) return true;
    visited.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
  return false;
}

/**
 * Collects all descendant IDs of a given page (excluding the page itself).
 */
export function collectDescendantIds(
  pages: readonly Pick<Page, 'id' | 'parentId'>[],
  rootPageId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.parentId) continue;
    const list = childrenByParent.get(p.parentId) ?? [];
    list.push(p.id);
    childrenByParent.set(p.parentId, list);
  }

  const result: string[] = [];
  const queue = [...(childrenByParent.get(rootPageId) ?? [])];
  const visited = new Set<string>([rootPageId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const next = childrenByParent.get(current);
    if (next) queue.push(...next);
  }

  return result;
}

/**
 * Builds a sorted recursive page tree from a flat list of pages.
 */
export function buildPageTree(pages: readonly Page[]): PageTreeItem[] {
  const map = new Map<string, PageTreeItem>();
  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  const roots: PageTreeItem[] = [];
  for (const item of map.values()) {
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(item);
    } else {
      roots.push(item);
    }
  }

  const sortNodes = (nodes: PageTreeItem[]): void => {
    nodes.sort((a, b) =>
      a.position === b.position
        ? a.title.localeCompare(b.title)
        : a.position.localeCompare(b.position),
    );
    for (const node of nodes) {
      if (node.children.length > 0) sortNodes(node.children);
    }
  };

  sortNodes(roots);
  return roots;
}

/**
 * Builds the canonical hierarchical URL path for a page.
 */
export function buildCanonicalPagePath(
  orgSlug: string,
  workspaceSlug: string,
  pages: readonly Pick<Page, 'id' | 'parentId' | 'slug'>[],
  pageId: string,
): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chain: string[] = [];
  const visited = new Set<string>();
  let cursor = byId.get(pageId);

  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    chain.unshift(cursor.slug);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  return `/o/${orgSlug}/${workspaceSlug}/${chain.join('/')}`;
}

/**
 * Computes plain-text excerpt and word count from Markdown content.
 */
export function extractMarkdownMetrics(markdown: string): {
  excerpt: string;
  wordCount: number;
} {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = plain.length > 0 ? plain.split(/\s+/).length : 0;
  const excerpt = plain.slice(0, 220);
  return { excerpt, wordCount: words };
}
