import { Injectable, computed, inject, signal } from '@angular/core';
import type { DailyNoteEntry, DailyNotesPreferences, PageWithContent } from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { KnowledgeMetaService } from '../knowledge/knowledge-meta.service';
import { KnowledgeStore } from '../state/knowledge.store';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';

const DAILY_PREFS_KEY = 'trazena_daily_notes_prefs_v1';

/**
 * Formats a Date object as a stable local calendar date (YYYY-MM-DD)
 * without UTC timezone shift bugs.
 */
export function toLocalCalendarDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftLocalCalendarDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map((n) => Number.parseInt(n, 10));
  const dt = new Date(y, (m || 1) - 1, (d || 1) + deltaDays);
  return toLocalCalendarDate(dt);
}

/**
 * Daily Notes backed by standard Trazena pages (no separate storage, no quick capture).
 * Never auto-creates a note on app startup unless explicitly requested by the user.
 */
@Injectable({ providedIn: 'root' })
export class DailyNotesService {
  private readonly idb = inject(IndexedDbService);
  private readonly store = inject(KnowledgeStore);
  private readonly meta = inject(KnowledgeMetaService);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(TrazenaSyncService);

  private readonly _entries = signal<DailyNoteEntry[]>([]);
  private readonly _prefs = signal<DailyNotesPreferences>({
    organizationId: null,
    workspaceId: null,
    templateId: null,
  });
  private readonly _initialized = signal(false);

  readonly entries = this._entries.asReadonly();
  readonly preferences = this._prefs.asReadonly();

  readonly datesWithNotes = computed(() =>
    new Set(this._entries().map((e) => e.noteDate)),
  );

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.store.initialize();
    await this.meta.initialize();
    const [entries, savedPrefs] = await Promise.all([
      this.idb.getAll<DailyNoteEntry>('daily_notes'),
      this.idb.getByKey<{ key: string; value: DailyNotesPreferences }>('meta', DAILY_PREFS_KEY),
    ]);
    this._entries.set(entries.sort((a, b) => b.noteDate.localeCompare(a.noteDate)));
    if (savedPrefs?.value) {
      this._prefs.set(savedPrefs.value);
    }
    this._initialized.set(true);
  }

  async savePreferences(prefs: DailyNotesPreferences): Promise<void> {
    this._prefs.set(prefs);
    await this.idb.put('meta', { key: DAILY_PREFS_KEY, value: prefs });
  }

  resolveTargetWorkspace(): { organizationId: string; workspaceId: string } | null {
    const prefs = this._prefs();
    if (prefs.organizationId && prefs.workspaceId) {
      const wsExists = this.store
        .workspaces()
        .some((w) => w.id === prefs.workspaceId && w.status === 'active');
      if (wsExists) {
        return { organizationId: prefs.organizationId, workspaceId: prefs.workspaceId };
      }
    }
    const org = this.store.activeOrganizations()[0];
    if (!org) return null;
    const ws = this.store.getWorkspacesForOrg(org.id)[0];
    if (!ws) return null;
    return { organizationId: org.id, workspaceId: ws.id };
  }

  findEntryForDate(noteDate: string): DailyNoteEntry | null {
    const target = this.resolveTargetWorkspace();
    const byWs = target
      ? this._entries().find((e) => e.noteDate === noteDate && e.workspaceId === target.workspaceId)
      : null;
    return byWs ?? this._entries().find((e) => e.noteDate === noteDate) ?? null;
  }

  async openOrCreateForDate(noteDate = toLocalCalendarDate()): Promise<PageWithContent | null> {
    await this.initialize();
    const existingEntry = this.findEntryForDate(noteDate);
    if (existingEntry) {
      const page = this.store
        .pages()
        .find((p) => p.id === existingEntry.pageId && p.status !== 'deleted');
      if (page) {
        const content = await this.idb.getPageContent(page.id);
        return {
          ...page,
          content: content ?? {
            pageId: page.id,
            markdown: `# ${page.title}\n\n`,
            excerpt: '',
            wordCount: 0,
            updatedAt: page.updatedAt,
            updatedBy: page.updatedBy,
          },
        };
      }
    }

    const target = this.resolveTargetWorkspace();
    if (!target) return null;

    const title = `Nota diaria — ${noteDate}`;
    const tpl = this._prefs().templateId
      ? this.meta.templates().find((t) => t.id === this._prefs().templateId)
      : null;
    const markdown = tpl
      ? this.meta
          .renderTemplateMarkdown(tpl, title)
          .replace(/\{\{\s*date\s*\}\}/g, noteDate)
      : `# ${title}\n\n## Prioridades del día\n\n- [ ] \n\n## Notas y decisiones\n\n\n## Cierre y pendientes\n\n`;

    const created = await this.store.createPage({
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      parentId: null,
      title,
      markdown,
    });

    const uid = this.auth.user()?.uid ?? 'local-owner';
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const entry: DailyNoteEntry = {
      id: `${target.workspaceId}:${noteDate}`,
      organizationId: target.organizationId,
      workspaceId: target.workspaceId,
      pageId: created.id,
      noteDate,
      createdAt: now,
      updatedAt: now,
    };

    await this.idb.commitAtomicWithOutbox('daily_notes', entry, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'daily_note',
      entityId: entry.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...entry },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._entries.update((list) =>
      [...list.filter((e) => e.id !== entry.id), entry].sort((a, b) =>
        b.noteDate.localeCompare(a.noteDate),
      ),
    );
    await this.sync.refreshState();
    return created;
  }
}
