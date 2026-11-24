import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { IndexedDbService } from '../storage/indexeddb.service';

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  mode: 'remote' | 'local';
  token?: string;
  expiresAt?: string;
}

const LOCAL_SESSION_KEY = 'trazena_local_session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly idb = inject(IndexedDbService);

  private readonly _user = signal<SessionUser | null>(null);
  private readonly _ready = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isRemoteApiEnabled = Boolean(environment.apiUrl?.trim());
  readonly canSyncRemote = computed(
    () => this.isRemoteApiEnabled && this._user()?.mode === 'remote' && Boolean(this._user()?.token),
  );
  readonly isFirebaseConfigured = false;

  private initPromise: Promise<void> | null = null;

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const stored = await this.idb.getByKey<{ key: string; value: SessionUser }>(
        'meta',
        LOCAL_SESSION_KEY,
      );
      if (stored?.value) {
        const exp = stored.value.expiresAt ? Date.parse(stored.value.expiresAt) : null;
        if (!exp || exp > Date.now()) {
          this._user.set(stored.value);
        } else {
          await this.idb.delete('meta', LOCAL_SESSION_KEY);
        }
      }
      this._ready.set(true);
    })();

    return this.initPromise;
  }

  async login(email: string, password: string): Promise<void> {
    this._error.set(null);
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail || !trimmedEmail.includes('@') || password.length < 4) {
      const msg = 'Ingresa un correo válido y una contraseña de al menos 4 caracteres.';
      this._error.set(msg);
      throw new Error(msg);
    }

    const apiUrl = environment.apiUrl?.trim().replace(/\/+$/, '');
    if (apiUrl && navigator.onLine) {
      try {
        const res = await fetch(`${apiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmedEmail, password }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          mode?: 'remote' | 'local_only';
          token?: string;
          expiresAt?: string;
          user?: { uid: string; email: string; displayName: string };
          error?: { message?: string };
        };

        if (res.status === 401) {
          const msg = data.error?.message || 'Contraseña incorrecta.';
          this._error.set(msg);
          throw new Error(msg);
        }

        if (res.ok && data.mode === 'remote' && data.token && data.user) {
          const session: SessionUser = {
            uid: data.user.uid,
            email: data.user.email,
            displayName: data.user.displayName,
            mode: 'remote',
            token: data.token,
            expiresAt: data.expiresAt,
          };
          await this.idb.put('meta', { key: LOCAL_SESSION_KEY, value: session });
          this._user.set(session);
          return;
        }
        // Any other user (mode: 'local_only') falls through cleanly to Local IndexedDB Vault
      } catch (err) {
        if (err instanceof Error && err.message && !err.message.includes('Failed to fetch')) {
          throw err;
        }
        // Network unreachable: allow offline Local Vault access
      }
    }

    const session: SessionUser = {
      uid: `local:${trimmedEmail}`,
      email: trimmedEmail,
      displayName: trimmedEmail.split('@')[0] || 'Usuario',
      mode: 'local',
    };
    await this.idb.put('meta', { key: LOCAL_SESSION_KEY, value: session });
    this._user.set(session);
  }

  async sendPasswordReset(_email: string): Promise<void> {
    throw new Error(
      'Trazena utiliza acceso privado de propietario único en Cloudflare Workers. Para cambiar la contraseña, actualiza el secreto OWNER_PASSWORD_HASH en Cloudflare.',
    );
  }

  async logout(): Promise<void> {
    await this.idb.delete('meta', LOCAL_SESSION_KEY);
    this._user.set(null);
    await this.router.navigate(['/login']);
  }

  async getIdToken(): Promise<string | null> {
    const u = this._user();
    if (!u || u.mode !== 'remote' || !u.token) return null;
    return u.token;
  }
}
