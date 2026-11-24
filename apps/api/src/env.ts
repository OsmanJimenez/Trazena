import type { UserProfile } from '@trazena/shared';

export interface WorkerEnv {
  DB: D1Database;
  /** Single authorized owner email (configured in wrangler vars). */
  OWNER_EMAIL: string;
  /** PBKDF2-SHA256 hash stored as Cloudflare Worker Secret (`pbkdf2$100000$<saltHex>$<hashHex>`). */
  OWNER_PASSWORD_HASH: string;
  /** 256-bit random HMAC secret stored as Cloudflare Worker Secret for HS256 session JWTs. */
  AUTH_JWT_SECRET: string;
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
