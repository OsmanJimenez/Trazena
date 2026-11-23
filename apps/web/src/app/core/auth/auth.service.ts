import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { environment } from '../../../environments/environment';
import { IndexedDbService } from '../storage/indexeddb.service';

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  mode: 'firebase' | 'local';
}

const LOCAL_SESSION_KEY = 'trazena_local_session';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly idb = inject(IndexedDbService);

  private firebaseApp: FirebaseApp | null = null;
  private firebaseAuth: Auth | null = null;
  private currentFirebaseUser: User | null = null;

  private readonly _user = signal<SessionUser | null>(null);
  private readonly _ready = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly user = this._user.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly error = this._error.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isFirebaseConfigured = Boolean(
    environment.firebase.apiKey && environment.firebase.projectId,
  );
  readonly isRemoteApiEnabled = Boolean(environment.apiUrl);

  private initPromise: Promise<void> | null = null;

  initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.isFirebaseConfigured) {
        this.firebaseApp = initializeApp(environment.firebase);
        this.firebaseAuth = getAuth(this.firebaseApp);
        await setPersistence(this.firebaseAuth, browserLocalPersistence);

        await new Promise<void>((resolve) => {
          onAuthStateChanged(this.firebaseAuth!, (fbUser) => {
            this.currentFirebaseUser = fbUser;
            if (fbUser) {
              this._user.set({
                uid: fbUser.uid,
                email: fbUser.email ?? '',
                displayName: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'Usuario',
                mode: 'firebase',
              });
            } else {
              this._user.set(null);
            }
            this._ready.set(true);
            resolve();
          });
        });
      } else {
        // Offline-first Local Vault session stored in IndexedDB meta store
        const stored = await this.idb.getByKey<{ key: string; value: SessionUser }>(
          'meta',
          LOCAL_SESSION_KEY,
        );
        if (stored?.value) {
          this._user.set(stored.value);
        }
        this._ready.set(true);
      }
    })();

    return this.initPromise;
  }

  async login(email: string, password: string): Promise<void> {
    this._error.set(null);
    const trimmedEmail = email.trim().toLowerCase();

    if (this.isFirebaseConfigured && this.firebaseAuth) {
      try {
        await signInWithEmailAndPassword(this.firebaseAuth, trimmedEmail, password);
      } catch (err) {
        const message = this.mapFirebaseError(err);
        this._error.set(message);
        throw new Error(message);
      }
      return;
    }

    // Local Vault mode when Firebase credentials are not configured yet
    if (!trimmedEmail || !trimmedEmail.includes('@') || password.length < 4) {
      const msg = 'Ingresa un correo válido y una contraseña de al menos 4 caracteres.';
      this._error.set(msg);
      throw new Error(msg);
    }

    const session: SessionUser = {
      uid: `local-${trimmedEmail}`,
      email: trimmedEmail,
      displayName: trimmedEmail.split('@')[0] || 'Propietario',
      mode: 'local',
    };
    await this.idb.put('meta', { key: LOCAL_SESSION_KEY, value: session });
    this._user.set(session);
  }

  async sendPasswordReset(email: string): Promise<void> {
    this._error.set(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      throw new Error('Ingresa un correo electrónico válido.');
    }

    if (this.isFirebaseConfigured && this.firebaseAuth) {
      try {
        await sendPasswordResetEmail(this.firebaseAuth, trimmedEmail);
      } catch (err) {
        const message = this.mapFirebaseError(err);
        this._error.set(message);
        throw new Error(message);
      }
      return;
    }

    // In Local Vault mode, inform user cleanly without faking an email dispatch
    throw new Error(
      'Firebase Authentication no está configurado todavía en environment.ts. Configura tu proyecto Firebase para enviar correos de recuperación.',
    );
  }

  async logout(): Promise<void> {
    if (this.isFirebaseConfigured && this.firebaseAuth) {
      await signOut(this.firebaseAuth);
    } else {
      await this.idb.delete('meta', LOCAL_SESSION_KEY);
    }
    this._user.set(null);
    await this.router.navigate(['/login']);
  }

  async getIdToken(): Promise<string | null> {
    if (this.currentFirebaseUser) {
      return this.currentFirebaseUser.getIdToken();
    }
    if (this._user()?.mode === 'local') {
      return 'dev-local-token';
    }
    return null;
  }

  private mapFirebaseError(err: unknown): string {
    const code = (err as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Credenciales incorrectas. Verifica tu correo y contraseña.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos.';
      case 'auth/network-request-failed':
        return 'No se pudo conectar con Firebase. Revisa tu conexión.';
      default:
        return 'No fue posible iniciar sesión. Verifica la configuración de Firebase.';
    }
  }
}
