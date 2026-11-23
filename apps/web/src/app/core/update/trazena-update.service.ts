import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { compareSemver, type ApiVersionInfo } from '@trazena/shared';
import { environment } from '../../../environments/environment';
import { APP_BUILD_META } from '../diagnostics/app-version';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'preparing'
  | 'ready'
  | 'applying'
  | 'up_to_date'
  | 'incompatible'
  | 'unrecoverable'
  | 'error';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const VISIBILITY_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Trazena Update & Recovery — Dedicated PWA & compatibility update manager.
 * Strictly separated from Trazena Sync: checking or applying app updates NEVER triggers document sync.
 */
@Injectable({ providedIn: 'root' })
export class TrazenaUpdateService {
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private readonly http = inject(HttpClient);
  private readonly diagnostics = inject(DiagnosticsService);

  private readonly _status = signal<UpdateStatus>('idle');
  private readonly _phaseLabel = signal('Aplicación actualizada');
  private readonly _lastCheckedAt = signal<string | null>(null);
  private readonly _availableHash = signal<string | null>(null);
  private readonly _errorMessage = signal<string | null>(null);
  private readonly _backendInfo = signal<ApiVersionInfo | null>(null);
  private readonly _hasUnsavedEditorDraft = signal(false);

  private lastCheckEpoch = 0;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  readonly status = this._status.asReadonly();
  readonly phaseLabel = this._phaseLabel.asReadonly();
  readonly lastCheckedAt = this._lastCheckedAt.asReadonly();
  readonly availableHash = this._availableHash.asReadonly();
  readonly errorMessage = this._errorMessage.asReadonly();
  readonly backendInfo = this._backendInfo.asReadonly();
  readonly hasUnsavedEditorDraft = this._hasUnsavedEditorDraft.asReadonly();
  readonly swEnabled = Boolean(this.swUpdate?.isEnabled);
  readonly currentMeta = APP_BUILD_META;

  setUnsavedEditorDraft(dirty: boolean): void {
    this._hasUnsavedEditorDraft.set(dirty);
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    if (this.swUpdate?.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event: VersionEvent) => {
        if (event.type === 'VERSION_DETECTED') {
          this._status.set('preparing');
          this._phaseLabel.set('Versión detectada · Preparando archivos…');
          void this.diagnostics.log({
            level: 'info',
            category: 'app-update',
            phase: 'version-detected',
            eventCode: 'SW_VERSION_DETECTED',
            details: { hash: event.version.hash },
          });
        } else if (event.type === 'VERSION_READY') {
          this._status.set('ready');
          this._availableHash.set(event.latestVersion.hash);
          this._phaseLabel.set('Nueva versión lista para instalar');
          void this.diagnostics.log({
            level: 'info',
            category: 'app-update',
            phase: 'version-ready',
            eventCode: 'SW_VERSION_READY',
            details: { latestHash: event.latestVersion.hash },
          });
        } else if (event.type === 'VERSION_INSTALLATION_FAILED') {
          this._status.set('error');
          this._errorMessage.set('Error al preparar la actualización de la PWA.');
          this._phaseLabel.set('Error al preparar actualización');
          void this.diagnostics.log({
            level: 'error',
            category: 'service-worker',
            phase: 'install-failed',
            eventCode: 'SW_INSTALL_FAILED',
            error: event.error,
          });
        }
      });

      this.swUpdate.unrecoverable.subscribe((event) => {
        this._status.set('unrecoverable');
        this._errorMessage.set(
          'El estado en caché de la PWA requiere recarga segura. Tus documentos en IndexedDB están protegidos.',
        );
        this._phaseLabel.set('Estado irrecuperable detectado');
        void this.diagnostics.log({
          level: 'error',
          category: 'service-worker',
          phase: 'unrecoverable',
          eventCode: 'SW_UNRECOVERABLE_STATE',
          error: event.reason,
        });
      });

      // Check on startup
      void this.checkForUpdates(true);

      // Check every 6 hours while open and active
      this.periodicTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void this.checkForUpdates(true);
        }
      }, SIX_HOURS_MS);

      // Check when returning to tab after cooldown
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (
            document.visibilityState === 'visible' &&
            Date.now() - this.lastCheckEpoch >= VISIBILITY_COOLDOWN_MS
          ) {
            void this.checkForUpdates(true);
          }
        });
      }
    } else {
      void this.checkBackendCompatibility();
    }
  }

  async checkForUpdates(silent = false): Promise<void> {
    this.lastCheckEpoch = Date.now();
    this._errorMessage.set(null);
    if (!silent) {
      this._status.set('checking');
      this._phaseLabel.set('Buscando actualización…');
    }

    await this.checkBackendCompatibility();

    try {
      if (this.swUpdate?.isEnabled) {
        const found = await this.swUpdate.checkForUpdate();
        this._lastCheckedAt.set(new Date().toISOString());
        if (found) {
          if (this._status() !== 'ready') {
            this._status.set('available');
            this._phaseLabel.set('Nueva versión detectada · Preparando archivos…');
          }
        } else if (this._status() !== 'ready' && this._status() !== 'incompatible') {
          this._status.set('up_to_date');
          this._phaseLabel.set('Trazena está actualizado');
        }
      } else {
        this._lastCheckedAt.set(new Date().toISOString());
        if (this._status() !== 'incompatible') {
          this._status.set('up_to_date');
          this._phaseLabel.set('Service Worker inactivo en modo desarrollo');
        }
      }
    } catch (err) {
      this._status.set('error');
      this._errorMessage.set('No se pudo comprobar si hay actualizaciones.');
      this._phaseLabel.set('Error al buscar actualizaciones');
      await this.diagnostics.log({
        level: 'warn',
        category: 'app-update',
        phase: 'check-failed',
        eventCode: 'UPDATE_CHECK_FAILED',
        error: err,
      });
    }
  }

  async applyUpdateNow(): Promise<void> {
    if (this._hasUnsavedEditorDraft()) {
      this._errorMessage.set(
        'Hay cambios recientes en el editor guardándose en IndexedDB. Espera un segundo antes de recargar.',
      );
      return;
    }

    this._status.set('applying');
    this._phaseLabel.set('Protegiendo cambios locales y aplicando actualización…');

    await this.diagnostics.log({
      level: 'info',
      category: 'app-update',
      phase: 'apply',
      eventCode: 'UPDATE_APPLY_STARTED',
    });

    try {
      if (this.swUpdate?.isEnabled) {
        await this.swUpdate.activateUpdate();
      }
      window.location.reload();
    } catch (err) {
      this._status.set('error');
      this._errorMessage.set('No se pudo activar la nueva versión. Puedes reintentar.');
      await this.diagnostics.log({
        level: 'error',
        category: 'app-update',
        phase: 'apply-failed',
        eventCode: 'UPDATE_APPLY_FAILED',
        error: err,
      });
    }
  }

  async checkBackendCompatibility(): Promise<void> {
    const apiUrl = environment.apiUrl.replace(/\/+$/, '');
    if (!apiUrl) return;
    try {
      const info = await firstValueFrom(
        this.http.get<ApiVersionInfo>(`${apiUrl}/api/version`),
      );
      this._backendInfo.set(info);
      if (
        info.syncProtocolVersion !== APP_BUILD_META.syncProtocolVersion ||
        compareSemver(APP_BUILD_META.appVersion, info.minimumCompatibleAppVersion) < 0
      ) {
        this._status.set('incompatible');
        this._phaseLabel.set(
          `Actualización requerida (mínimo v${info.minimumCompatibleAppVersion})`,
        );
      }
    } catch {
      // Offline or API unreachable: continue working offline safely
    }
  }
}
