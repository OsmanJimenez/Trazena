import { Injectable, inject, signal } from '@angular/core';
import type { ShortcutBinding, ShortcutCommandId } from '@trazena/shared';
import { IndexedDbService } from '../storage/indexeddb.service';

const SHORTCUTS_KEY = 'trazena_shortcuts_v1';

const RESERVED_COMBOS = new Set([
  'ctrl+t',
  'ctrl+w',
  'ctrl+n',
  'ctrl+r',
  'ctrl+l',
  'ctrl+tab',
  'ctrl+shift+t',
  'alt+f4',
]);

export const DEFAULT_SHORTCUTS: readonly ShortcutBinding[] = [
  { commandId: 'open_command_palette', label: 'Abrir paleta de comandos', category: 'Navegación', defaultCombo: 'Ctrl+Shift+P', customCombo: null, disabled: false },
  { commandId: 'open_quick_search', label: 'Búsqueda rápida global', category: 'Navegación', defaultCombo: 'Ctrl+K', customCombo: null, disabled: false },
  { commandId: 'open_daily_note', label: 'Abrir nota diaria de hoy', category: 'Documentos', defaultCombo: 'Alt+D', customCombo: null, disabled: false },
  { commandId: 'new_page', label: 'Crear nueva página', category: 'Documentos', defaultCombo: 'Alt+N', customCombo: null, disabled: false },
  { commandId: 'toggle_sidebar', label: 'Alternar barra lateral', category: 'Espacio de trabajo', defaultCombo: 'Ctrl+\\', customCombo: null, disabled: false },
  { commandId: 'split_right', label: 'Dividir vista a la derecha', category: 'Espacio de trabajo', defaultCombo: 'Alt+\\', customCombo: null, disabled: false },
  { commandId: 'close_split', label: 'Cerrar vista dividida', category: 'Espacio de trabajo', defaultCombo: 'Alt+Shift+\\', customCombo: null, disabled: false },
  { commandId: 'open_explorer', label: 'Abrir Explorador de conocimiento', category: 'Navegación', defaultCombo: 'Alt+E', customCombo: null, disabled: false },
  { commandId: 'open_health', label: 'Abrir Salud del conocimiento', category: 'Sistema', defaultCombo: 'Alt+H', customCombo: null, disabled: false },
  { commandId: 'open_import', label: 'Importar documentos', category: 'Documentos', defaultCombo: 'Alt+I', customCombo: null, disabled: false },
  { commandId: 'open_settings', label: 'Abrir Configuración', category: 'Sistema', defaultCombo: 'Alt+,', customCombo: null, disabled: false },
  { commandId: 'sync_now', label: 'Sincronizar ahora (manual)', category: 'Sistema', defaultCombo: 'Alt+S', customCombo: null, disabled: false },
];

export function normalizeCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .join('+');
}

export function formatEventToCombo(ev: KeyboardEvent): string | null {
  const key = ev.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null;
  const parts: string[] = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('Ctrl');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  if (parts.length === 0) return null;
  const displayKey = key.length === 1 ? key.toUpperCase() : key;
  parts.push(displayKey);
  return parts.join('+');
}

@Injectable({ providedIn: 'root' })
export class ShortcutsService {
  private readonly idb = inject(IndexedDbService);

  private readonly _bindings = signal<ShortcutBinding[]>(DEFAULT_SHORTCUTS.map((s) => ({ ...s })));
  private readonly _initialized = signal(false);

  readonly bindings = this._bindings.asReadonly();

  async initialize(): Promise<void> {
    if (this._initialized()) return;
    await this.idb.ensureOpen();
    const saved = await this.idb.getByKey<{ key: string; value: ShortcutBinding[] }>(
      'meta',
      SHORTCUTS_KEY,
    );
    if (saved?.value?.length) {
      const savedMap = new Map(saved.value.map((s) => [s.commandId, s]));
      this._bindings.set(
        DEFAULT_SHORTCUTS.map((def) => {
          const prev = savedMap.get(def.commandId);
          return prev
            ? { ...def, customCombo: prev.customCombo, disabled: prev.disabled }
            : { ...def };
        }),
      );
    }
    this._initialized.set(true);
  }

  getActiveCombo(commandId: ShortcutCommandId): string | null {
    const found = this._bindings().find((b) => b.commandId === commandId);
    if (!found || found.disabled) return null;
    return found.customCombo ?? found.defaultCombo;
  }

  matchCommand(ev: KeyboardEvent): ShortcutCommandId | null {
    const combo = formatEventToCombo(ev);
    if (!combo) return null;
    const norm = normalizeCombo(combo);
    for (const b of this._bindings()) {
      if (b.disabled) continue;
      const active = b.customCombo ?? b.defaultCombo;
      if (normalizeCombo(active) === norm) {
        return b.commandId;
      }
    }
    return null;
  }

  validateCombo(
    commandId: ShortcutCommandId,
    combo: string,
  ): { ok: boolean; error?: string } {
    const norm = normalizeCombo(combo);
    if (RESERVED_COMBOS.has(norm)) {
      return {
        ok: false,
        error: `La combinación "${combo}" está reservada por el navegador.`,
      };
    }
    const conflict = this._bindings().find(
      (b) =>
        b.commandId !== commandId &&
        !b.disabled &&
        normalizeCombo(b.customCombo ?? b.defaultCombo) === norm,
    );
    if (conflict) {
      return {
        ok: false,
        error: `Conflicto con "${conflict.label}". Deshabilita o cambia el otro atajo primero.`,
      };
    }
    return { ok: true };
  }

  async setCustomCombo(
    commandId: ShortcutCommandId,
    combo: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const check = this.validateCombo(commandId, combo);
    if (!check.ok) return check;
    this._bindings.update((list) =>
      list.map((b) => (b.commandId === commandId ? { ...b, customCombo: combo, disabled: false } : b)),
    );
    await this.persist();
    return { ok: true };
  }

  async toggleDisabled(commandId: ShortcutCommandId): Promise<void> {
    this._bindings.update((list) =>
      list.map((b) => (b.commandId === commandId ? { ...b, disabled: !b.disabled } : b)),
    );
    await this.persist();
  }

  async resetAll(): Promise<void> {
    this._bindings.set(DEFAULT_SHORTCUTS.map((s) => ({ ...s })));
    await this.persist();
  }

  private async persist(): Promise<void> {
    await this.idb.put('meta', { key: SHORTCUTS_KEY, value: this._bindings() });
  }
}
