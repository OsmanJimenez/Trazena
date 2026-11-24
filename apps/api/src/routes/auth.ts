import { Hono } from 'hono';
import { z } from 'zod';
import type { AppContext } from '../env.js';
import {
  resolveOrProvisionUser,
  signSessionJwt,
  verifyPbkdf2Password,
} from '../middleware/auth.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export const authRoutes = new Hono<AppContext>();

authRoutes.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Ingresa un correo y contraseña válidos.' } },
      400,
    );
  }

  const ownerEmail = (c.env.OWNER_EMAIL ?? '').trim().toLowerCase();
  const passwordHash = c.env.OWNER_PASSWORD_HASH ?? '';
  const jwtSecret = c.env.AUTH_JWT_SECRET ?? '';

  if (!ownerEmail || !passwordHash || !jwtSecret) {
    return c.json(
      {
        error: {
          code: 'SERVER_MISCONFIGURED',
          message:
            'Faltan secretos de autenticación en el Worker (OWNER_EMAIL / OWNER_PASSWORD_HASH / AUTH_JWT_SECRET).',
        },
      },
      500,
    );
  }

  const incomingEmail = parsed.data.email.trim().toLowerCase();

  // Any non-owner email is allowed to use Trazena offline in local IndexedDB only (zero D1 access)
  if (incomingEmail !== ownerEmail) {
    return c.json({
      mode: 'local_only' as const,
      message: 'Cuenta local en IndexedDB sin sincronización en la nube.',
    });
  }

  const passOk = await verifyPbkdf2Password(parsed.data.password, passwordHash);
  if (!passOk) {
    return c.json(
      { error: { code: 'INVALID_CREDENTIALS', message: 'Contraseña incorrecta.' } },
      401,
    );
  }

  const displayName = ownerEmail.split('@')[0] || 'Propietario';
  const subjectUid = `owner:${ownerEmail}`;
  const user = await resolveOrProvisionUser(c.env.DB, {
    subjectUid,
    email: ownerEmail,
    displayName,
    avatarUrl: null,
  });

  const { token, expiresAt } = await signSessionJwt(
    { sub: subjectUid, email: ownerEmail, name: user.displayName ?? displayName },
    jwtSecret,
  );

  return c.json({
    mode: 'remote' as const,
    token,
    expiresAt,
    user: {
      id: user.id,
      uid: subjectUid,
      email: user.email,
      displayName: user.displayName ?? displayName,
    },
  });
});

authRoutes.get('/me', (c) => {
  const user = c.get('user');
  return c.json({ user });
});
