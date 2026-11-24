import { Injectable, inject, signal } from '@angular/core';
import type { HomePreferences, HomeSectionId } from '@trazena/shared';
import { IndexedDbService } from '../storage/indexeddb.service';

const HOME_PREFS_KEY = 'trazena_home_prefs_v1';

const DEFAULT_HOME_PREFS: HomePreferences = {
  sections: [
    { id: 'daily', visible: true },
    { id: 'reminders', visible: true },
    { id: 'recent', visible: true },
    { id: 'favorites', visible: true },
    { id: 'pinned_workspaces', visible: true },
    { id: 'organizations', visible: true },
    { id: 'saved_views', visible: true },
    { id: 'needs_review', visible: true },
    { id: 'sync_status', visible: true },
  ],
  pinnedWorkspaceIds: [],
  defaultSection: 'recent',
};

@Injectable({ providedIn: 'root' })
export class HomePreferencesService {
  private readonly idb = inject(IndexedDbService);

  private readonly _prefs = signal<HomePreferences>(DEFAULT_HOME_PREFS);
  private readonly _initialized = signal(false);

  readonly prefs = this._prefs.asReadonly();

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.idb.ensureOpen();
    const saved = await this.idb.getByKey<{ key: string; value: HomePreferences }>(
      'meta',
      HOME_PREFS_KEY,
    );
    if (saved?.value) {
      this._prefs.set({
        ...DEFAULT_HOME_PREFS,
        ...saved.value,
      });
    }
    this._initialized.set(true);
  }

  async toggleSection(id: HomeSectionId): Promise<void> {
    this._prefs.update((p) => ({
      ...p,
      sections: p.sections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    }));
    await this.persist();
  }

  async moveSection(id: HomeSectionId, direction: -1 | 1): Promise<void> {
    const list = [...this._prefs().sections];
    const idx = list.findIndex((s) => s.id === id);
    const nextIdx = idx + direction;
    if (idx === -1 || nextIdx < 0 || nextIdx >= list.length) return;
    const [item] = list.splice(idx, 1);
    list.splice(nextIdx, 0, item);
    this._prefs.update((p) => ({ ...p, sections: list }));
    await this.persist();
  }

  async togglePinnedWorkspace(workspaceId: string): Promise<void> {
    this._prefs.update((p) => {
      const exists = p.pinnedWorkspaceIds.includes(workspaceId);
      return {
        ...p,
        pinnedWorkspaceIds: exists
          ? p.pinnedWorkspaceIds.filter((id) => id !== workspaceId)
          : [...p.pinnedWorkspaceIds, workspaceId],
      };
    });
    await this.persist();
  }

  async resetDefaults(): Promise<void> {
    this._prefs.set(DEFAULT_HOME_PREFS);
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.idb.put('meta', { key: HOME_PREFS_KEY, value: this._prefs() });
  }
}
