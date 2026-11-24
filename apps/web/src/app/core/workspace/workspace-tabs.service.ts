import { Injectable, computed, inject, signal } from '@angular/core';
import type { Page, WorkspaceLayoutState, WorkspaceTabItem } from '@trazena/shared';
import { IndexedDbService } from '../storage/indexeddb.service';

const LAYOUT_KEY = 'trazena_workspace_layout_v1';
const DEFAULT_LAYOUT: WorkspaceLayoutState = {
  leftTabs: [],
  rightTabs: [],
  activeLeftTabId: null,
  activeRightTabId: null,
  splitEnabled: false,
  activePane: 'left',
  splitRatio: 50,
};

/**
 * Local-only device preference for document Tabs and 2-pane Split View.
 * Never synced to Cloudflare D1; desktop splitRatio is never applied to mobile viewports.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceTabsService {
  private readonly idb = inject(IndexedDbService);

  private readonly _layout = signal<WorkspaceLayoutState>(DEFAULT_LAYOUT);
  private readonly _initialized = signal(false);

  readonly layout = this._layout.asReadonly();
  readonly leftTabs = computed(() => this._layout().leftTabs);
  readonly rightTabs = computed(() => this._layout().rightTabs);
  readonly splitEnabled = computed(() => this._layout().splitEnabled);
  readonly activePane = computed(() => this._layout().activePane);
  readonly splitRatio = computed(() => this._layout().splitRatio);

  readonly activeLeftTab = computed<WorkspaceTabItem | null>(() => {
    const l = this._layout();
    return l.leftTabs.find((t) => t.id === l.activeLeftTabId) ?? l.leftTabs[0] ?? null;
  });

  readonly activeRightTab = computed<WorkspaceTabItem | null>(() => {
    const l = this._layout();
    return l.rightTabs.find((t) => t.id === l.activeRightTabId) ?? l.rightTabs[0] ?? null;
  });

  readonly allOpenTabs = computed(() => {
    const l = this._layout();
    const seen = new Set<string>();
    const combined: WorkspaceTabItem[] = [];
    for (const t of [...l.leftTabs, ...l.rightTabs]) {
      if (!seen.has(t.pageId)) {
        seen.add(t.pageId);
        combined.push(t);
      }
    }
    return combined;
  });

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.idb.ensureOpen();
    const saved = await this.idb.getByKey<{ key: string; value: WorkspaceLayoutState }>(
      'meta',
      LAYOUT_KEY,
    );
    if (saved?.value) {
      this._layout.set({
        ...DEFAULT_LAYOUT,
        ...saved.value,
        splitRatio: Math.min(75, Math.max(25, saved.value.splitRatio ?? 50)),
      });
    }
    this._initialized.set(true);
  }

  private async persist(): Promise<void> {
    await this.idb.put('meta', { key: LAYOUT_KEY, value: this._layout() });
  }

  openPageInTab(
    page: Pick<Page, 'id' | 'title' | 'icon'>,
    canonicalPath: string,
    options?: { pane?: 'left' | 'right'; activate?: boolean },
  ): WorkspaceTabItem {
    const targetPane = options?.pane ?? 'left';
    const activate = options?.activate ?? true;
    const current = this._layout();
    const list = targetPane === 'left' ? current.leftTabs : current.rightTabs;
    const existing = list.find((t) => t.pageId === page.id);

    if (existing) {
      const updatedTab: WorkspaceTabItem = {
        ...existing,
        title: page.title,
        canonicalPath,
        icon: page.icon ?? existing.icon,
      };
      const nextList = list.map((t) => (t.id === existing.id ? updatedTab : t));
      this._layout.set({
        ...current,
        leftTabs: targetPane === 'left' ? nextList : current.leftTabs,
        rightTabs: targetPane === 'right' ? nextList : current.rightTabs,
        activeLeftTabId: targetPane === 'left' && activate ? updatedTab.id : current.activeLeftTabId,
        activeRightTabId: targetPane === 'right' && activate ? updatedTab.id : current.activeRightTabId,
        activePane: activate ? targetPane : current.activePane,
      });
      void this.persist();
      return updatedTab;
    }

    const tab: WorkspaceTabItem = {
      id: `${targetPane}:${page.id}`,
      pageId: page.id,
      title: page.title,
      canonicalPath,
      icon: page.icon ?? 'file-text',
    };
    const nextList = [...list, tab].slice(-16);
    this._layout.set({
      ...current,
      leftTabs: targetPane === 'left' ? nextList : current.leftTabs,
      rightTabs: targetPane === 'right' ? nextList : current.rightTabs,
      activeLeftTabId: targetPane === 'left' && activate ? tab.id : current.activeLeftTabId,
      activeRightTabId: targetPane === 'right' && activate ? tab.id : current.activeRightTabId,
      activePane: activate ? targetPane : current.activePane,
    });
    void this.persist();
    return tab;
  }

  setActiveTab(pane: 'left' | 'right', tabId: string): WorkspaceTabItem | null {
    const current = this._layout();
    const list = pane === 'left' ? current.leftTabs : current.rightTabs;
    const found = list.find((t) => t.id === tabId) ?? null;
    if (!found) return null;
    this._layout.set({
      ...current,
      activeLeftTabId: pane === 'left' ? tabId : current.activeLeftTabId,
      activeRightTabId: pane === 'right' ? tabId : current.activeRightTabId,
      activePane: pane,
    });
    void this.persist();
    return found;
  }

  closeTab(pane: 'left' | 'right', tabId: string): WorkspaceTabItem | null {
    const current = this._layout();
    const list = pane === 'left' ? current.leftTabs : current.rightTabs;
    const idx = list.findIndex((t) => t.id === tabId);
    if (idx === -1) return null;
    const nextList = list.filter((t) => t.id !== tabId);
    const nextActive = nextList[Math.min(idx, nextList.length - 1)] ?? null;

    if (pane === 'right' && nextList.length === 0) {
      this._layout.set({
        ...current,
        rightTabs: [],
        activeRightTabId: null,
        splitEnabled: false,
        activePane: 'left',
      });
      void this.persist();
      return null;
    }

    this._layout.set({
      ...current,
      leftTabs: pane === 'left' ? nextList : current.leftTabs,
      rightTabs: pane === 'right' ? nextList : current.rightTabs,
      activeLeftTabId:
        pane === 'left'
          ? current.activeLeftTabId === tabId
            ? (nextActive?.id ?? null)
            : current.activeLeftTabId
          : current.activeLeftTabId,
      activeRightTabId:
        pane === 'right'
          ? current.activeRightTabId === tabId
            ? (nextActive?.id ?? null)
            : current.activeRightTabId
          : current.activeRightTabId,
    });
    void this.persist();
    return nextActive;
  }

  closeOtherTabs(pane: 'left' | 'right', keepTabId: string): void {
    const current = this._layout();
    const list = pane === 'left' ? current.leftTabs : current.rightTabs;
    const kept = list.filter((t) => t.id === keepTabId);
    this._layout.set({
      ...current,
      leftTabs: pane === 'left' ? kept : current.leftTabs,
      rightTabs: pane === 'right' ? kept : current.rightTabs,
      activeLeftTabId: pane === 'left' ? (kept[0]?.id ?? null) : current.activeLeftTabId,
      activeRightTabId: pane === 'right' ? (kept[0]?.id ?? null) : current.activeRightTabId,
    });
    void this.persist();
  }

  closeAllTabs(pane: 'left' | 'right'): void {
    const current = this._layout();
    this._layout.set({
      ...current,
      leftTabs: pane === 'left' ? [] : current.leftTabs,
      rightTabs: pane === 'right' ? [] : current.rightTabs,
      activeLeftTabId: pane === 'left' ? null : current.activeLeftTabId,
      activeRightTabId: pane === 'right' ? null : current.activeRightTabId,
      splitEnabled: pane === 'right' ? false : current.splitEnabled,
      activePane: pane === 'right' ? 'left' : current.activePane,
    });
    void this.persist();
  }

  reorderTab(pane: 'left' | 'right', fromIndex: number, toIndex: number): void {
    const current = this._layout();
    const list = [...(pane === 'left' ? current.leftTabs : current.rightTabs)];
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
      return;
    }
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    this._layout.set({
      ...current,
      leftTabs: pane === 'left' ? list : current.leftTabs,
      rightTabs: pane === 'right' ? list : current.rightTabs,
    });
    void this.persist();
  }

  splitRight(page?: Pick<Page, 'id' | 'title' | 'icon'>, canonicalPath?: string): void {
    const current = this._layout();
    if (page && canonicalPath) {
      this._layout.set({ ...current, splitEnabled: true });
      this.openPageInTab(page, canonicalPath, { pane: 'right', activate: true });
      return;
    }
    const fallback = this.activeLeftTab();
    if (fallback) {
      this._layout.set({ ...current, splitEnabled: true });
      this.openPageInTab(
        { id: fallback.pageId, title: fallback.title, icon: fallback.icon },
        fallback.canonicalPath,
        { pane: 'right', activate: true },
      );
      return;
    }
    this._layout.set({ ...current, splitEnabled: true, activePane: 'right' });
    void this.persist();
  }

  closeSplit(): void {
    const current = this._layout();
    this._layout.set({
      ...current,
      splitEnabled: false,
      activePane: 'left',
    });
    void this.persist();
  }

  moveTabToOtherPane(fromPane: 'left' | 'right', tabId: string): void {
    const current = this._layout();
    const list = fromPane === 'left' ? current.leftTabs : current.rightTabs;
    const tab = list.find((t) => t.id === tabId);
    if (!tab) return;
    const targetPane = fromPane === 'left' ? 'right' : 'left';
    this.closeTab(fromPane, tabId);
    if (targetPane === 'right') {
      this._layout.update((l) => ({ ...l, splitEnabled: true }));
    }
    this.openPageInTab(
      { id: tab.pageId, title: tab.title, icon: tab.icon },
      tab.canonicalPath,
      { pane: targetPane, activate: true },
    );
  }

  setSplitRatio(ratio: number): void {
    const clamped = Math.min(75, Math.max(25, Math.round(ratio)));
    this._layout.update((l) => ({ ...l, splitRatio: clamped }));
    void this.persist();
  }

  resetSplitRatio(): void {
    this.setSplitRatio(50);
  }

  syncPageMetadata(pageId: string, title: string, canonicalPath: string): void {
    const current = this._layout();
    const mapList = (list: WorkspaceTabItem[]) =>
      list.map((t) => (t.pageId === pageId ? { ...t, title, canonicalPath } : t));
    this._layout.set({
      ...current,
      leftTabs: mapList(current.leftTabs),
      rightTabs: mapList(current.rightTabs),
    });
    void this.persist();
  }

  pruneDeletedPages(validPageIds: Set<string>): void {
    const current = this._layout();
    const leftTabs = current.leftTabs.filter((t) => validPageIds.has(t.pageId));
    const rightTabs = current.rightTabs.filter((t) => validPageIds.has(t.pageId));
    const activeLeftTabId = leftTabs.some((t) => t.id === current.activeLeftTabId)
      ? current.activeLeftTabId
      : (leftTabs[0]?.id ?? null);
    const activeRightTabId = rightTabs.some((t) => t.id === current.activeRightTabId)
      ? current.activeRightTabId
      : (rightTabs[0]?.id ?? null);
    this._layout.set({
      ...current,
      leftTabs,
      rightTabs,
      activeLeftTabId,
      activeRightTabId,
      splitEnabled: current.splitEnabled && rightTabs.length > 0,
    });
    void this.persist();
  }
}
