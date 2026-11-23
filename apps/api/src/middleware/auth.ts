import type { Context, Next } from 'hono';
import type { AppContext } from '../env.js';
import type { UserProfile } from '@trazena/shared';

interface FirebaseJwk extends JsonWebKey {
  kid: string;
  alg?: string;
  use?: string;
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface FirebaseJwtPayload {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time?: number;
  email?: string;
  name?: string;
  picture?: string;
}

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedKeys: Map<string, CryptoKey> = new Map();
let cacheExpiresAt = 0;

function base64UrlToUint8Array(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeJwtPart<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function getFirebasePublicKey(kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  if (now < cacheExpiresAt && cachedKeys.has(kid)) {
    return cachedKeys.get(kid) ?? null;
  }

  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch Firebase JWKS: ${response.status}`);
  }

  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAgeSeconds = maxAgeMatch ? Number.parseInt(maxAgeMatch[1], 10) : 3600;

  const data = (await response.json()) as { keys: FirebaseJwk[] };
  const nextKeys = new Map<string, CryptoKey>();

  for (const jwk of data.keys) {
    if (!jwk.kid) continue;
    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    nextKeys.set(jwk.kid, cryptoKey);
  }

  cachedKeys = nextKeys;
  cacheExpiresAt = now + maxAgeSeconds * 1000;
  return cachedKeys.get(kid) ?? null;
}

async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<FirebaseJwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJwtPart<JwtHeader>(headerPart);
  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported JWT algorithm or missing kid');
  }

  const publicKey = await getFirebasePublicKey(header.kid);
  if (!publicKey) {
    throw new Error('Unknown Firebase signing key');
  }

  const signingInput = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const signature = base64UrlToUint8Array(signaturePart);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signature,
    signingInput,
  );
  if (!valid) {
    throw new Error('Invalid JWT signature');
  }

  const payload = decodeJwtPart<FirebaseJwtPayload>(payloadPart);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.iss !== expectedIssuer) {
    throw new Error('Invalid token issuer');
  }
  if (payload.aud !== projectId) {
    throw new Error('Invalid token audience');
  }
  if (!payload.sub || payload.sub.length > 128) {
    throw new Error('Invalid token subject');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) {
    throw new Error('Token expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSeconds + 300) {
    throw new Error('Token issued in the future');
  }

  return payload;
}

async function resolveOrProvisionUser(
  db: D1Database,
  identity: {
    firebaseUid: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  },
): Promise<UserProfile> {
  const existing = await db
    .prepare(
      `SELECT id, firebase_uid, email, display_name, avatar_url, created_at, updated_at
       FROM users WHERE firebase_uid = ? LIMIT 1`,
    )
    .bind(identity.firebaseUid)
    .first<{
      id: string;
      firebase_uid: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (existing) {
    return {
      id: existing.id,
      firebaseUid: existing.firebase_uid,
      email: existing.email,
      displayName: existing.display_name,
      avatarUrl: existing.avatar_url,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO users (id, firebase_uid, email, display_name, avatar_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      identity.firebaseUid,
      identity.email,
      identity.displayName,
      identity.avatarUrl,
      now,
      now,
    )
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO user_preferences (user_id, theme, sidebar_width, editor_mode, updated_at)
       VALUES (?, 'system', 280, 'split', ?)`,
    )
    .bind(id, now)
    .run();

  return {
    id,
    firebaseUid: identity.firebaseUid,
    email: identity.email,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    createdAt: now,
    updatedAt: now,
  };
}

export async function authMiddleware(
  c: Context<AppContext>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token.' } },
      401,
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Empty Bearer token.' } },
      401,
    );
  }

  try {
    // Explicit local development bypass only when DEV_AUTH_EMAIL is configured in .dev.vars
    if (c.env.DEV_AUTH_EMAIL && token === 'dev-local-token') {
      const user = await resolveOrProvisionUser(c.env.DB, {
        firebaseUid: `dev:${c.env.DEV_AUTH_EMAIL}`,
        email: c.env.DEV_AUTH_EMAIL,
        displayName: 'Local Developer',
        avatarUrl: null,
      });
      c.set('user', user);
      await next();
      return;
    }

    const projectId = c.env.FIREBASE_PROJECT_ID;
    if (!projectId || projectId.startsWith('REPLACE_')) {
      return c.json(
        {
          error: {
            code: 'SERVER_MISCONFIGURED',
            message: 'FIREBASE_PROJECT_ID is not configured on the Worker.',
          },
        },
        500,
      );
    }

    const payload = await verifyFirebaseIdToken(token, projectId);
    const email = payload.email ?? `${payload.sub}@firebase.local`;
    const user = await resolveOrProvisionUser(c.env.DB, {
      firebaseUid: payload.sub,
      email,
      displayName: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    });

    c.set('user', user);
    await next();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid authentication token.';
    return c.json(
      { error: { code: 'UNAUTHORIZED', message } },
      401,
    );
  }
}
