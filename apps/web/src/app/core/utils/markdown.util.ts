import { Marked, Renderer } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const renderer = new Renderer();

renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').trim().split(/\s+/)[0] || '';
  let highlighted: string;
  if (language && hljs.getLanguage(language)) {
    highlighted = hljs.highlight(text, { language }).value;
  } else {
    highlighted = hljs.highlightAuto(text).value;
  }

  const displayLang = escapeHtml(language || 'text');
  return `<div class="trz-code-block"><div class="trz-code-header"><span>${displayLang}</span><button type="button" class="trz-code-copy" data-copy-code="true">Copiar</button></div><pre><code class="hljs language-${displayLang}">${highlighted}</code></pre></div>`;
};

renderer.link = function ({ href, title, tokens }) {
  const safeHref = href ?? '#';
  const isExternal = /^https?:\/\//i.test(safeHref);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  const body = this.parser.parseInline(tokens);
  return `<a href="${escapeHtml(safeHref)}"${titleAttr}${targetAttr}>${body}</a>`;
};

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  renderer,
});

/**
 * Renders Markdown into sanitized HTML safe against XSS and script injection.
 */
export function renderSafeMarkdown(markdown: string): string {
  const rawHtml = markedInstance.parse(markdown || '') as string;
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel', 'data-copy-code', 'type', 'checked', 'disabled'],
  });
}
