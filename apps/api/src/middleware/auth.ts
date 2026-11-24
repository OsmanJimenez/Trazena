import type { Context, Next } from 'hono';
import type { UserProfile } from '@trazena/shared';
import type { AppContext } from '../env.js';

interface SessionJwtPayload {
  iss: string;
  sub: string;
  email: string;
  name: string;
  iat: number;
  exp: number;
}

const JWT_ISSUER = 'trazena-api';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Verifies a plaintext password against a stored `pbkdf2$<iterations>$<saltHex>$<hashHex>` secret
 * using Web Crypto PBKDF2-SHA256 in constant time.
 */
export async function verifyPbkdf2Password(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.trim().split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10_000) return false;

  const salt = hexToBytes(parts[2]);
  const expected = hexToBytes(parts[3]);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    expected.length * 8,
  );
  return constantTimeEqual(new Uint8Array(derivedBits), expected);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSessionJwt(
  identity: { sub: string; email: string; name: string },
  secret: string,
): Promise<{ token: string; expiresAt: string }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const header = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
  );
  const payload = bytesToBase64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: JWT_ISSUER,
        sub: identity.sub,
        email: identity.email,
        name: identity.name,
        iat: now,
        exp,
      } satisfies SessionJwtPayload),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );
  const token = `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifySessionJwt(
  token: string,
  secret: string,
): Promise<SessionJwtPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
  const [headerPart, payloadPart, sigPart] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerPart))) as {
    alg?: string;
  };
  if (header.alg !== 'HS256') throw new Error('Unsupported JWT algorithm');

  const key = await importHmacKey(secret);
  const sigBytes = base64UrlToBytes(sigPart);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('Invalid JWT signature');

  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToBytes(payloadPart)),
  ) as SessionJwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== JWT_ISSUER) throw new Error('Invalid token issuer');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Token expired');
  return payload;
}

export async function resolveOrProvisionUser(
  db: D1Database,
  identity: {
    subjectUid: string;
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  },
): Promise<UserProfile> {
  const existing = await db
    .prepare(
      `SELECT id, firebase_uid, email, display_name, avatar_url, created_at, updated_at
       FROM users WHERE firebase_uid = ? OR email = ? LIMIT 1`,
    )
    .bind(identity.subjectUid, identity.email)
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
      identity.subjectUid,
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
    firebaseUid: identity.subjectUid,
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
    if (c.env.DEV_AUTH_EMAIL && token === 'dev-local-token') {
      const user = await resolveOrProvisionUser(c.env.DB, {
        subjectUid: `dev:${c.env.DEV_AUTH_EMAIL}`,
        email: c.env.DEV_AUTH_EMAIL,
        displayName: 'Local Developer',
        avatarUrl: null,
      });
      c.set('user', user);
      await next();
      return;
    }

    const secret = c.env.AUTH_JWT_SECRET;
    const ownerEmail = (c.env.OWNER_EMAIL ?? '').trim().toLowerCase();
    if (!secret || !ownerEmail) {
      return c.json(
        {
          error: {
            code: 'SERVER_MISCONFIGURED',
            message: 'Worker auth secrets (AUTH_JWT_SECRET / OWNER_EMAIL) are not configured.',
          },
        },
        500,
      );
    }

    const payload = await verifySessionJwt(token, secret);
    if (payload.email.trim().toLowerCase() !== ownerEmail) {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Unauthorized account.' } }, 403);
    }

    const user = await resolveOrProvisionUser(c.env.DB, {
      subjectUid: payload.sub,
      email: ownerEmail,
      displayName: payload.name || ownerEmail.split('@')[0],
      avatarUrl: null,
    });

    c.set('user', user);
    await next();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid authentication token.';
    return c.json({ error: { code: 'UNAUTHORIZED', message } }, 401);
  }
}
