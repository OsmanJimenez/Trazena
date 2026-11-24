import DOMPurify from 'dompurify';

const SAFE_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)|hsla?\([^)]+\)|[a-z]{3,20})$/i;

/**
 * Default Notion / browser canvas foreground & background colors that should NOT
 * be preserved as explicit inline styles (so pasted text adapts cleanly to light/dark themes).
 */
const DEFAULT_TEXT_COLORS = new Set([
  'rgb(55, 53, 47)',
  'rgba(55, 53, 47, 1)',
  'rgb(0, 0, 0)',
  'rgba(0, 0, 0, 1)',
  '#000',
  '#000000',
  '#37352f',
  'rgb(255, 255, 255)',
  'rgba(255, 255, 255, 0.81)',
  'rgba(255, 255, 255, 0.9)',
  'rgba(255, 255, 255, 1)',
  '#fff',
  '#ffffff',
  'rgb(236, 236, 236)',
  'rgb(25, 25, 25)',
  'inherit',
  'initial',
  'currentcolor',
]);

const DEFAULT_BG_COLORS = new Set([
  'transparent',
  'rgba(0, 0, 0, 0)',
  'rgb(255, 255, 255)',
  'rgba(255, 255, 255, 1)',
  '#fff',
  '#ffffff',
  'rgb(25, 25, 25)',
  'rgb(32, 32, 32)',
  'rgb(47, 52, 55)',
  '#191919',
  '#202020',
  '#2f3437',
  'inherit',
  'initial',
  'none',
]);

/**
 * Translates Notion's opaque light-mode highlight fills into translucent equivalents
 * so highlights stay legible in both Light and Dark themes in Trazena.
 */
const NOTION_BG_TRANSLUCENT_MAP: Record<string, string> = {
  'rgb(251, 243, 219)': 'rgba(234, 179, 8, 0.24)',   // yellow
  'rgb(253, 235, 236)': 'rgba(239, 68, 68, 0.22)',   // red
  'rgb(250, 235, 221)': 'rgba(249, 115, 22, 0.22)',  // orange
  'rgb(237, 243, 236)': 'rgba(34, 197, 94, 0.22)',   // green
  'rgb(231, 243, 248)': 'rgba(59, 130, 246, 0.22)',  // blue
  'rgb(246, 243, 249)': 'rgba(168, 85, 247, 0.22)',  // purple
  'rgb(250, 241, 245)': 'rgba(236, 72, 153, 0.22)',  // pink
  'rgb(244, 238, 238)': 'rgba(161, 98, 7, 0.22)',    // brown
  'rgb(241, 241, 239)': 'rgba(148, 163, 184, 0.24)', // gray
};

function normalizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/!important$/i, '').trim();
  if (!cleaned || !SAFE_COLOR_RE.test(cleaned)) return null;
  return cleaned;
}

function isMeaningfulTextColor(color: string | null): color is string {
  if (!color) return false;
  return !DEFAULT_TEXT_COLORS.has(color.toLowerCase());
}

function normalizeHighlightColor(raw: string | null): string | null {
  const color = normalizeColor(raw);
  if (!color) return null;
  const lower = color.toLowerCase();
  if (DEFAULT_BG_COLORS.has(lower)) return null;
  return NOTION_BG_TRANSLUCENT_MAP[lower] ?? color;
}

export function isNotionHtml(html: string): boolean {
  if (!html) return false;
  return (
    /notion-/i.test(html) ||
    /class="[^"]*\b(to-do-list|checkbox-on|checkbox-off|simple-table|callout|toggle)\b/i.test(html) ||
    /data-block-id=/i.test(html)
  );
}

/**
 * Normalizes HTML copied from Notion (or other rich editors like Google Docs / web pages)
 * into clean, Tiptap-compatible HTML while preserving headings, checklists, callouts,
 * toggles, code blocks, tables, links, underline, text colors, and background highlights.
 */
export function normalizePastedHtml(html: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return html;

  // 1. Remove non-content noise
  body
    .querySelectorAll('script, style, meta, link, noscript, button, .notion-copy-button')
    .forEach((el) => el.remove());

  // 2. Convert Notion To-Do lists into Tiptap TaskList / TaskItem
  body.querySelectorAll('ul.to-do-list').forEach((ul) => {
    ul.setAttribute('data-type', 'taskList');
    ul.removeAttribute('class');
    ul.querySelectorAll(':scope > li').forEach((li) => {
      const checkedBox = li.querySelector('.checkbox-on, input[type="checkbox"]:checked');
      const anyBox = li.querySelector('.checkbox, .checkbox-on, .checkbox-off, input[type="checkbox"]');
      const isChecked = Boolean(checkedBox);
      anyBox?.remove();

      li.setAttribute('data-type', 'taskItem');
      li.setAttribute('data-checked', isChecked ? 'true' : 'false');
      // Wrap loose text in <p> as Tiptap TaskItem expects block children
      if (!li.querySelector(':scope > p')) {
        const p = doc.createElement('p');
        while (li.firstChild) {
          p.appendChild(li.firstChild);
        }
        li.appendChild(p);
      }
    });
  });

  // Also handle generic checkbox list items (e.g. Notion desktop / GitHub / other editors)
  body.querySelectorAll('li').forEach((li) => {
    if (li.getAttribute('data-type') === 'taskItem') return;
    const checkbox = li.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
    if (!checkbox) return;
    const isChecked = (checkbox as HTMLInputElement).checked || checkbox.hasAttribute('checked');
    checkbox.remove();
    const parentUl = li.closest('ul');
    if (parentUl) parentUl.setAttribute('data-type', 'taskList');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', isChecked ? 'true' : 'false');
  });

  // 3. Convert Notion Callouts into Trazena [!NOTE] blockquotes
  body.querySelectorAll('figure.callout, div.callout, .notion-callout-block').forEach((callout) => {
    const bq = doc.createElement('blockquote');
    const iconEl = callout.querySelector('.icon, .notion-record-icon');
    const iconText = iconEl?.textContent?.trim() ?? '';
    iconEl?.remove();

    const p = doc.createElement('p');
    const prefix = iconText ? `[!NOTE] ${iconText} ` : '[!NOTE] ';
    p.appendChild(doc.createTextNode(prefix));
    while (callout.firstChild) {
      const child = callout.firstChild;
      if (child.nodeType === Node.ELEMENT_NODE && /^(P|DIV)$/i.test((child as HTMLElement).tagName)) {
        const el = child as HTMLElement;
        while (el.firstChild) p.appendChild(el.firstChild);
        el.remove();
      } else {
        p.appendChild(child);
      }
    }
    bq.appendChild(p);
    callout.replaceWith(bq);
  });

  // 4. Convert Notion Toggles (<details><summary>) so content is preserved instead of dropped
  body.querySelectorAll('details').forEach((details) => {
    const frag = doc.createDocumentFragment();
    const summary = details.querySelector(':scope > summary');
    if (summary) {
      const p = doc.createElement('p');
      const strong = doc.createElement('strong');
      strong.textContent = `▸ ${summary.textContent?.trim() ?? ''}`;
      p.appendChild(strong);
      frag.appendChild(p);
      summary.remove();
    }
    while (details.firstChild) {
      frag.appendChild(details.firstChild);
    }
    details.replaceWith(frag);
  });

  // 5. Normalize Notion Code Blocks (<pre class="code"><code>)
  body.querySelectorAll('pre').forEach((pre) => {
    let code = pre.querySelector('code');
    if (!code) {
      code = doc.createElement('code');
      code.textContent = pre.textContent ?? '';
      pre.textContent = '';
      pre.appendChild(code);
    }
    const langAttr =
      code.getAttribute('data-lang') ||
      pre.getAttribute('data-lang') ||
      code.className.match(/language-([a-z0-9_+-]+)/i)?.[1] ||
      pre.className.match(/language-([a-z0-9_+-]+)/i)?.[1];
    if (langAttr) {
      code.className = `language-${langAttr.toLowerCase()}`;
    }
  });

  // 6. Normalize Notion Tables (unwrap wrapper <div>s inside cells)
  body.querySelectorAll('td, th').forEach((cell) => {
    cell.querySelectorAll(':scope > div').forEach((div) => {
      const p = doc.createElement('p');
      while (div.firstChild) p.appendChild(div.firstChild);
      div.replaceWith(p);
    });
  });

  // 7. Normalize inline styles (bold, italic, strike, underline, text color, highlight background)
  const styledEls = Array.from(body.querySelectorAll<HTMLElement>('span, mark, font, b, i, u, s, del, em, strong'));
  for (const el of styledEls) {
    const tag = el.tagName.toLowerCase();
    const style = el.style;

    // Extract semantic style flags before cleaning attributes
    const fontWeight = style.fontWeight?.trim().toLowerCase() ?? '';
    const isBold = fontWeight === 'bold' || Number(fontWeight) >= 600;
    const isItalic = style.fontStyle?.trim().toLowerCase() === 'italic';
    const textDec = (style.textDecoration || style.textDecorationLine || '').toLowerCase();
    const isUnderline = textDec.includes('underline') || tag === 'u';
    const isStrike = textDec.includes('line-through') || tag === 's' || tag === 'del';

    const rawColor = normalizeColor(style.color || el.getAttribute('color'));
    const textColor = isMeaningfulTextColor(rawColor) ? rawColor : null;
    const bgColor = normalizeHighlightColor(style.backgroundColor || style.background);

    // Strip Notion's noisy inline styles and rebuild clean semantic wrappers
    if (tag === 'span' || tag === 'font' || tag === 'mark') {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('color');

      let current: HTMLElement = el;

      if (tag === 'mark' || bgColor) {
        const mark = doc.createElement('mark');
        const resolvedBg = bgColor ?? 'rgba(234, 179, 8, 0.24)';
        mark.setAttribute('data-color', resolvedBg);
        mark.setAttribute('style', `background-color: ${resolvedBg}`);
        while (current.firstChild) mark.appendChild(current.firstChild);
        current.replaceWith(mark);
        current = mark;
      }

      if (textColor) {
        const span = doc.createElement('span');
        span.setAttribute('style', `color: ${textColor}`);
        current.parentNode?.insertBefore(span, current);
        span.appendChild(current);
        current = span;
      }

      const wrapWith = (wrapperTag: string) => {
        const wrapper = doc.createElement(wrapperTag);
        current.parentNode?.insertBefore(wrapper, current);
        wrapper.appendChild(current);
        current = wrapper;
      };

      if (isUnderline) wrapWith('u');
      if (isStrike) wrapWith('s');
      if (isItalic) wrapWith('em');
      if (isBold) wrapWith('strong');

      // Unwrap plain empty-attribute <span> wrappers to keep DOM clean
      if (
        el.isConnected &&
        (tag === 'span' || tag === 'font') &&
        !el.attributes.length
      ) {
        const frag = doc.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.replaceWith(frag);
      }
    }
  }

  return DOMPurify.sanitize(body.innerHTML, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['data-type', 'data-checked', 'data-color', 'style', 'class', 'target', 'rel'],
  });
}
