import type { AtralumeIconDefinition } from '@osmanjimenez/atralume/icon';

export const TRAZENA_ICONS: readonly AtralumeIconDefinition[] = [
  {
    name: 'plus',
    paths: ['M12 5v14M5 12h14'],
    category: 'actions',
  },
  {
    name: 'search',
    paths: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.35-4.35'],
    category: 'actions',
  },
  {
    name: 'folder',
    paths: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'],
    category: 'navigation',
  },
  {
    name: 'book',
    paths: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
    category: 'navigation',
  },
  {
    name: 'file-text',
    paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6M16 13H8M16 17H8M10 9H8'],
    category: 'navigation',
  },
  {
    name: 'chevron-right',
    paths: ['m9 18 6-6-6-6'],
    category: 'arrows',
  },
  {
    name: 'settings',
    paths: [
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ],
    category: 'actions',
  },
  {
    name: 'database',
    paths: ['M12 2C7.03 2 3 3.79 3 6s4.03 4 9 4 9-1.79 9-4-4.03-4-9-4z', 'M21 12c0 2.21-4.03 4-9 4s-9-1.79-9-4', 'M3 6v12c0 2.21 4.03 4 9 4s9-1.79 9-4V6'],
    category: 'actions',
  },
  {
    name: 'trash',
    paths: ['M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
    category: 'actions',
  },
  {
    name: 'archive',
    paths: ['M21 8v13H3V8M1 3h22v5H1V3zm9 9h4'],
    category: 'actions',
  },
  {
    name: 'copy',
    paths: ['M9 9h13v13H9z', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'],
    category: 'actions',
  },
  {
    name: 'edit',
    paths: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'],
    category: 'actions',
  },
  {
    name: 'sun',
    paths: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42'],
    category: 'actions',
  },
  {
    name: 'moon',
    paths: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
    category: 'actions',
  },
  {
    name: 'logout',
    paths: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'],
    category: 'actions',
  },
  {
    name: 'download',
    paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3'],
    category: 'actions',
  },
  {
    name: 'more-vertical',
    paths: ['M12 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', 'M12 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
    category: 'actions',
  },
  {
    name: 'sidebar',
    paths: ['M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z', 'M9 3v18'],
    category: 'navigation',
  },
  {
    name: 'move',
    paths: ['M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20'],
    category: 'actions',
  },
  {
    name: 'rotate-ccw',
    paths: ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10'],
    category: 'actions',
  },
  {
    name: 'layers',
    paths: ['M12 2 2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5M2 12l10 5 10-5'],
    category: 'navigation',
  },
];
