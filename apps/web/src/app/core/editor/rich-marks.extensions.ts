import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
    highlight: {
      toggleHighlight: (color?: string) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

/**
 * Underline mark (`<u>`) with `Ctrl+U` shortcut and Markdown HTML round-trip serialization.
 */
export const TrazenaUnderline = Mark.create({
  name: 'underline',

  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        getAttrs: (value) => (typeof value === 'string' && value.includes('underline') ? {} : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setUnderline:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleUnderline:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetUnderline:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor.commands.toggleUnderline(),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '<u>',
          close: '</u>',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

/**
 * Text foreground color mark (`<span style="color: ...">`) preserving Notion / rich-text colors.
 */
export const TrazenaTextColor = Mark.create({
  name: 'textColor',

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style?.color || null,
        renderHTML: (attrs) => {
          if (!attrs['color']) return {};
          return { style: `color: ${attrs['color']}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[style]',
        getAttrs: (el) => {
          const color = (el as HTMLElement).style?.color?.trim();
          return color ? { color } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: unknown, mark: { attrs: Record<string, unknown> }) {
            const c = String(mark.attrs['color'] ?? '').trim();
            return c ? `<span style="color: ${c}">` : '';
          },
          close(_state: unknown, mark: { attrs: Record<string, unknown> }) {
            return mark.attrs['color'] ? '</span>' : '';
          },
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});

const DEFAULT_HIGHLIGHT = 'rgba(234, 179, 8, 0.26)';

/**
 * Background highlight mark (`<mark style="background-color: ...">`) preserving Notion highlights.
 */
export const TrazenaHighlight = Mark.create({
  name: 'highlight',

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute('data-color') ||
          (el as HTMLElement).style?.backgroundColor ||
          DEFAULT_HIGHLIGHT,
        renderHTML: (attrs) => {
          const color = String(attrs['color'] || DEFAULT_HIGHLIGHT);
          return {
            'data-color': color,
            style: `background-color: ${color}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'mark' },
      {
        tag: 'span[style]',
        getAttrs: (el) => {
          const bg = (el as HTMLElement).style?.backgroundColor?.trim();
          return bg ? { color: bg } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleHighlight:
        (color?: string) =>
        ({ commands }) =>
          commands.toggleMark(this.name, { color: color ?? DEFAULT_HIGHLIGHT }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open(_state: unknown, mark: { attrs: Record<string, unknown> }) {
            const c = String(mark.attrs['color'] ?? DEFAULT_HIGHLIGHT).trim();
            return `<mark style="background-color: ${c}">`;
          },
          close: '</mark>',
          mixable: true,
          expelEnclosingWhitespace: true,
        },
        parse: {},
      },
    };
  },
});
