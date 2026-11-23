import type { UserProfile } from '@trazena/shared';

export interface WorkerEnv {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS?: string;
  /**
   * Optional local-only dev bypass (must never be set in production).
   * When set in `.dev.vars`, allows `Authorization: Bearer dev-local-token`.
   */
  DEV_AUTH_EMAIL?: string;
}

export interface AppVariables {
  user: UserProfile;
}

export interface AppContext {
  Bindings: WorkerEnv;
  Variables: AppVariables;
}
