import { Injectable, computed, inject, signal } from '@angular/core';
import type { Page, PageReminder } from '@trazena/shared';
import { AuthService } from '../auth/auth.service';
import { IndexedDbService } from '../storage/indexeddb.service';
import { TrazenaSyncService } from '../sync/trazena-sync.service';
import { shiftLocalCalendarDate, toLocalCalendarDate } from './daily-notes.service';

/**
 * Local-First Reminders tied to Trazena pages.
 * Detects due/overdue reminders on open and tab focus without any external push server
 * and without triggering automatic remote sync.
 */
@Injectable({ providedIn: 'root' })
export class RemindersService {
  private readonly idb = inject(IndexedDbService);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(TrazenaSyncService);

  private readonly _reminders = signal<PageReminder[]>([]);
  private readonly _clockTick = signal(Date.now());
  private readonly _initialized = signal(false);

  readonly reminders = computed(() =>
    this._reminders().filter((r) => r.status !== 'deleted'),
  );

  readonly overdueReminders = computed(() => {
    this._clockTick();
    const today = toLocalCalendarDate();
    const nowTime = new Date().toTimeString().slice(0, 5);
    return this.reminders()
      .filter((r) => {
        if (r.status === 'completed') return false;
        const effectiveDate = r.status === 'snoozed' && r.snoozedUntil ? r.snoozedUntil : r.dueDate;
        if (effectiveDate < today) return true;
        if (effectiveDate === today && r.dueTime && r.dueTime <= nowTime) return true;
        return false;
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  });

  readonly upcomingReminders = computed(() => {
    const overdueIds = new Set(this.overdueReminders().map((r) => r.id));
    return this.reminders()
      .filter((r) => r.status !== 'completed' && !overdueIds.has(r.id))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  });

  readonly completedReminders = computed(() =>
    this.reminders()
      .filter((r) => r.status === 'completed')
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt)),
  );

  private get ownerUid(): string {
    return this.auth.user()?.uid ?? 'local-owner';
  }

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.idb.ensureOpen();
    await this.reload();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.recheckDueStatus();
        }
      });
    }
    this._initialized.set(true);
  }

  recheckDueStatus(): void {
    this._clockTick.set(Date.now());
  }

  async reload(): Promise<void> {
    const uid = this.ownerUid;
    const all = await this.idb.getAll<PageReminder>('reminders');
    this._reminders.set(all.filter((r) => r.ownerUid === uid));
  }

  getForPage(pageId: string): PageReminder[] {
    return this.reminders()
      .filter((r) => r.pageId === pageId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  async createReminder(
    page: Pick<Page, 'id' | 'organizationId' | 'workspaceId'>,
    input: { title: string; dueDate: string; dueTime?: string | null },
  ): Promise<PageReminder> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    const now = new Date().toISOString();
    const record: PageReminder = {
      id: crypto.randomUUID(),
      ownerUid: uid,
      organizationId: page.organizationId,
      workspaceId: page.workspaceId,
      pageId: page.id,
      title: input.title.trim(),
      dueDate: input.dueDate,
      dueTime: input.dueTime?.trim() || null,
      status: 'pending',
      snoozedUntil: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.idb.commitAtomicWithOutbox('reminders', record, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'reminder',
      entityId: record.id,
      operation: 'create',
      baseRevision: null,
      payload: { ...record },
      createdAt: now,
      updatedAt: now,
      status: 'pending',
    });

    this._reminders.update((list) => [...list, record]);
    await this.sync.refreshState();
    return record;
  }

  async completeReminder(id: string): Promise<void> {
    const current = this._reminders().find((r) => r.id === id);
    if (!current) return;
    const now = new Date().toISOString();
    await this.saveMutation(
      { ...current, status: 'completed', completedAt: now, updatedAt: now },
      'update',
    );
  }

  async reopenReminder(id: string): Promise<void> {
    const current = this._reminders().find((r) => r.id === id);
    if (!current) return;
    const now = new Date().toISOString();
    await this.saveMutation(
      { ...current, status: 'pending', completedAt: null, snoozedUntil: null, updatedAt: now },
      'update',
    );
  }

  async snoozeReminder(id: string, days = 1): Promise<void> {
    const current = this._reminders().find((r) => r.id === id);
    if (!current) return;
    const nextDate = shiftLocalCalendarDate(toLocalCalendarDate(), days);
    const now = new Date().toISOString();
    await this.saveMutation(
      { ...current, status: 'snoozed', snoozedUntil: nextDate, dueDate: nextDate, updatedAt: now },
      'update',
    );
  }

  async deleteReminder(id: string): Promise<void> {
    const current = this._reminders().find((r) => r.id === id);
    if (!current) return;
    const now = new Date().toISOString();
    await this.saveMutation({ ...current, status: 'deleted', updatedAt: now }, 'delete');
  }

  private async saveMutation(
    record: PageReminder,
    operation: 'update' | 'delete',
  ): Promise<void> {
    const uid = this.ownerUid;
    const device = await this.idb.getOrCreateDevice(uid);
    await this.idb.commitAtomicWithOutbox('reminders', record, {
      operationId: crypto.randomUUID(),
      deviceId: device.deviceId,
      ownerUid: uid,
      entityType: 'reminder',
      entityId: record.id,
      operation,
      baseRevision: null,
      payload: { ...record },
      createdAt: record.updatedAt,
      updatedAt: record.updatedAt,
      status: 'pending',
    });
    this._reminders.update((list) => list.map((r) => (r.id === record.id ? record : r)));
    await this.sync.refreshState();
  }
}
