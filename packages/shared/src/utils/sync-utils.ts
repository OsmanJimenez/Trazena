/**
 * Computes a fast deterministic SHA-256 hex digest using Web Crypto (works in Workers & Browser).
 */
export async function computeContentHash(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Returns true if an ISO timestamp is older than the given number of days (default 30).
 */
export function isOlderThanDays(isoDate: string, days = 30): boolean {
  const ts = Date.parse(isoDate);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > days * 24 * 60 * 60 * 1000;
}

/**
 * Simple semver comparison: returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Computes a clean line-by-line diff on demand for history preview and conflict comparison.
 * Snapshots are always stored full; diffs are computed purely in memory on demand.
 */
export function computeLineDiff(beforeText: string, afterText: string): DiffLine[] {
  const a = beforeText.split('\n');
  const b = afterText.split('\n');
  const m = a.length;
  const n = b.length;

  // Guard for very large docs to keep UI snappy
  if (m * n > 250_000) {
    return [
      ...a.map((text): DiffLine => ({ type: 'removed', text })),
      ...b.map((text): DiffLine => ({ type: 'added', text })),
    ];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      result.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < m) result.push({ type: 'removed', text: a[i++] });
  while (j < n) result.push({ type: 'added', text: b[j++] });
  return result;
}
