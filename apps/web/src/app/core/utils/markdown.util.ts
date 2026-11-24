import { Marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import katex from 'katex';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CALLOUT_META: Record<string, { tone: string; label: string }> = {
  NOTE: { tone: 'note', label: 'Nota' },
  NOTA: { tone: 'note', label: 'Nota' },
  INFO: { tone: 'info', label: 'Información' },
  TIP: { tone: 'tip', label: 'Consejo' },
  CONSEJO: { tone: 'tip', label: 'Consejo' },
  WARNING: { tone: 'warning', label: 'Advertencia' },
  ADVERTENCIA: { tone: 'warning', label: 'Advertencia' },
  DANGER: { tone: 'danger', label: 'Peligro' },
  CAUTION: { tone: 'danger', label: 'Peligro' },
  PELIGRO: { tone: 'danger', label: 'Peligro' },
};

const renderer = new Renderer();

renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').trim().split(/\s+/)[0] || '';
  if (language.toLowerCase() === 'mermaid') {
    const encoded = encodeURIComponent(text);
    return `<div class="trz-mermaid-block" data-mermaid="${encoded}"><div class="trz-code-header"><span>mermaid</span></div><div class="trz-mermaid-render">Renderizando diagrama Mermaid…</div><pre class="trz-mermaid-fallback"><code>${escapeHtml(text)}</code></pre></div>`;
  }

  let highlighted: string;
  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(text, { language }).value;
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }

  const displayLang = escapeHtml(language || 'text');
  const lineCount = text.split('\n').length;
  const collapsible = lineCount > 14;
  const foldBtn = collapsible
    ? `<button type="button" class="trz-code-fold" data-fold-code="true">Plegar (${lineCount} líneas)</button>`
    : '';

  return `<div class="trz-code-block" data-collapsed="false"><div class="trz-code-header"><span>${displayLang}</span><div class="trz-code-actions">${foldBtn}<button type="button" class="trz-code-copy" data-copy-code="true">Copiar</button></div></div><pre><code class="hljs language-${displayLang}">${highlighted}</code></pre></div>`;
};

renderer.blockquote = function ({ tokens }) {
  const inner = this.parser.parse(tokens);
  const calloutMatch = inner.match(
    /^\s*<p>\s*\[!(NOTE|NOTA|INFO|TIP|CONSEJO|WARNING|ADVERTENCIA|DANGER|CAUTION|PELIGRO)\]\s*(?:<br\s*\/?>|\n)?([\s\S]*?)<\/p>/i,
  );
  if (calloutMatch) {
    const key = calloutMatch[1].toUpperCase();
    const meta = CALLOUT_META[key] ?? { tone: 'note', label: key };
    const restOfFirst = calloutMatch[2]?.trim() ? `<p>${calloutMatch[2]}</p>` : '';
    const remainder = inner.slice(calloutMatch[0].length);
    return `<aside class="trz-callout" data-tone="${meta.tone}"><div class="trz-callout-title">${meta.label}</div><div class="trz-callout-body">${restOfFirst}${remainder}</div></aside>`;
  }
  return `<blockquote>${inner}</blockquote>`;
};

renderer.link = function ({ href, title, tokens }) {
  const safeHref = href ?? '#';
  const isInternal = safeHref.startsWith('trazena://page/');
  const isExternal = /^https?:\/\//i.test(safeHref);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  const internalAttr = isInternal
    ? ` class="trz-internal-link" data-page-id="${escapeHtml(safeHref.slice('trazena://page/'.length))}"`
    : '';
  const body = this.parser.parseInline(tokens);
  return `<a href="${escapeHtml(safeHref)}"${internalAttr}${titleAttr}${targetAttr}>${body}</a>`;
};

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  renderer,
});

/**
 * Renders KaTeX math expressions ($$display$$ and $inline$) outside fenced code blocks.
 */
function renderMathTokens(markdown: string): { text: string; blocks: Map<string, string> } {
  const blocks = new Map<string, string>();
  let idx = 0;

  // Protect fenced code blocks first so $ inside code is never interpreted as math
  const codePlaceholders = new Map<string, string>();
  let protectedMd = markdown.replace(/(^|\n)(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, (m) => {
    const token = `@@TRZ_CODE_${idx++}@@`;
    codePlaceholders.set(token, m);
    return token;
  });

  // Display math $$...$$
  protectedMd = protectedMd.replace(/\$\$([\s\S]+?)\$\$/g, (_full, expr: string) => {
    const token = `@@TRZ_MATH_${idx++}@@`;
    try {
      const html = katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
      blocks.set(token, `<div class="trz-math-block">${html}</div>`);
    } catch {
      blocks.set(token, `<pre class="trz-math-error">${escapeHtml(expr)}</pre>`);
    }
    return token;
  });

  // Inline math $...$ (avoid matching currency like "$100 y $200")
  protectedMd = protectedMd.replace(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_full, expr: string) => {
    if (/^\d+(?:[.,]\d+)?$/.test(expr.trim())) return _full;
    const token = `@@TRZ_MATH_${idx++}@@`;
    try {
      const html = katex.renderToString(expr.trim(), {
        displayMode: false,
        throwOnError: false,
        strict: false,
      });
      blocks.set(token, `<span class="trz-math-inline">${html}</span>`);
    } catch {
      blocks.set(token, `<code>${escapeHtml(expr)}</code>`);
    }
    return token;
  });

  // Restore protected code blocks
  for (const [token, original] of codePlaceholders.entries()) {
    protectedMd = protectedMd.replace(token, () => original);
  }

  return { text: protectedMd, blocks };
}

/**
 * Renders Markdown (GFM + Callouts + KaTeX + Mermaid placeholders + Highlighted Code)
 * into sanitized HTML safe against XSS and script injection.
 */
export function renderSafeMarkdown(markdown: string): string {
  const { text, blocks } = renderMathTokens(markdown || '');
  let rawHtml = markedInstance.parse(text) as string;
  for (const [token, mathHtml] of blocks.entries()) {
    rawHtml = rawHtml.replace(token, () => mathHtml);
  }
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: [
      'target',
      'rel',
      'data-copy-code',
      'data-fold-code',
      'data-collapsed',
      'data-mermaid',
      'data-tone',
      'data-page-id',
      'data-color',
      'style',
      'type',
      'checked',
      'disabled',
      'aria-hidden',
    ],
  });
}

let mermaidInitialized = false;

/**
 * Hydrates `.trz-mermaid-block` placeholders inside a rendered preview container
 * using Mermaid in `securityLevel: 'strict'` mode (100% offline, XSS-safe).
 */
export async function hydrateMermaidDiagrams(
  container: HTMLElement,
  darkTheme: boolean,
): Promise<void> {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>('.trz-mermaid-block'));
  if (nodes.length === 0) return;

  const { default: mermaid } = await import('mermaid');
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: darkTheme ? 'dark' : 'default',
    });
    mermaidInitialized = true;
  } else {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: darkTheme ? 'dark' : 'default',
    });
  }

  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const encoded = el.getAttribute('data-mermaid') ?? '';
    const code = decodeURIComponent(encoded);
    const renderHost = el.querySelector<HTMLElement>('.trz-mermaid-render');
    const fallback = el.querySelector<HTMLElement>('.trz-mermaid-fallback');
    if (!renderHost) continue;
    try {
      const id = `trz-mmd-${Date.now()}-${i}`;
      const { svg } = await mermaid.render(id, code);
      renderHost.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true } });
      if (fallback) fallback.style.display = 'none';
    } catch {
      renderHost.textContent = 'Sintaxis Mermaid no válida (mostrando código fuente):';
      if (fallback) fallback.style.display = 'block';
    }
  }
}
