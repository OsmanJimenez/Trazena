import { Injectable, inject, signal } from '@angular/core';
import type { ThemePreference } from '@trazena/shared';
import { IndexedDbService } from '../storage/indexeddb.service';

const THEME_KEY = 'trazena_theme_pref';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly idb = inject(IndexedDbService);
  private readonly _theme = signal<ThemePreference>('system');
  readonly theme = this._theme.asReadonly();

  async initialize(): Promise<void> {
    const saved = await this.idb.getByKey<{ key: string; value: ThemePreference }>(
      'meta',
      THEME_KEY,
    );
    this.apply(saved?.value ?? 'system', false);
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    this.apply(theme, true);
  }

  async cycleTheme(): Promise<void> {
    const order: ThemePreference[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this._theme()) + 1) % order.length];
    await this.setTheme(next);
  }

  private apply(theme: ThemePreference, persist: boolean): void {
    this._theme.set(theme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-atr-theme', theme);
    }
    if (persist) {
      void this.idb.put('meta', { key: THEME_KEY, value: theme });
    }
  }
}
