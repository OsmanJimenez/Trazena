import { Injectable, computed, inject, signal } from '@angular/core';
import type { ThemePreference } from '@trazena/shared';
import { IndexedDbService } from '../storage/indexeddb.service';

const THEME_KEY = 'trazena_theme_pref';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly idb = inject(IndexedDbService);
  private readonly _theme = signal<ThemePreference>('system');
  private readonly _systemPrefersDark = signal(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  readonly theme = this._theme.asReadonly();
  readonly effectiveTheme = computed<'light' | 'dark'>(() => {
    const pref = this._theme();
    if (pref === 'system') {
      return this._systemPrefersDark() ? 'dark' : 'light';
    }
    return pref;
  });

  constructor() {
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', (e) => {
        this._systemPrefersDark.set(e.matches);
      });
    }
  }

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

  /**
   * 1-click toggle: immediately switches between light and dark based on the
   * currently visible effective theme (never requires 2 clicks when coming from 'system').
   */
  async toggleTheme(): Promise<void> {
    const next: ThemePreference = this.effectiveTheme() === 'dark' ? 'light' : 'dark';
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
