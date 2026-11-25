import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { loginSchema, ROLES, type Role } from '@nexo/shared';
import { config } from '../config';
import { db } from '../db/client';
import { users } from '../db/schema';
import { clearSessionCookie, currentUser, requireAuth, setSessionCookie, signSession } from '../lib/auth';
import { AppError, badRequest, parse } from '../lib/errors';
import { clearLoginFailures, demoEnabled, loginGuard, registerLoginFailure } from '../lib/security';

/** Hash de una contraseña aleatoria: se usa cuando el correo no existe (tiempo de respuesta constante). */
const DUMMY_HASH = bcrypt.hashSync('usuario-inexistente-' + Math.random(), 10);

export const authRouter = Router();

async function startSession(res: import('express').Response, u: typeof users.$inferSelect) {
  const user = { id: u.id, name: u.name, email: u.email, role: u.role as Role };
  const token = signSession(user);
  setSessionCookie(res, token);
  await db.update(users).set({ lastLoginAt: new Date().toISOString() }).where(eq(users.id, u.id));
  return { user, token };
}

authRouter.post('/login', loginGuard, async (req, res) => {
  const input = parse(loginSchema, req.body);
  const [u] = await db.select().from(users).where(eq(users.email, input.email));
  // Se compara siempre contra un hash (aunque el correo no exista) para no revelar qué correos son válidos por el tiempo de respuesta.
  const okPass = await bcrypt.compare(input.password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !okPass) {
    registerLoginFailure(req);
    throw new AppError(401, 'El correo o la contraseña no coinciden. Revísalos e intenta de nuevo.');
  }
  clearLoginFailures(req);
  if (!u.active) throw new AppError(403, 'Este usuario está desactivado. Pide ayuda al administrador.');
  res.json(await startSession(res, u));
});

/** Acceso rápido por rol, solo disponible en modo demo. */
authRouter.post('/demo-login', loginGuard, async (req, res) => {
  if (!demoEnabled()) throw new AppError(404, 'No disponible.');
  const role = String(req.body?.role ?? '');
  if (!ROLES.includes(role as Role)) throw badRequest('Rol no válido.');
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, role), eq(users.active, true)))
    .orderBy(asc(users.id))
    .limit(1);
  if (!u) throw badRequest('No hay usuario demo para ese rol.');
  res.json(await startSession(res, u));
});

authRouter.get('/demo-accounts', async (_req, res) => {
  if (!demoEnabled()) return res.json({ enabled: false, accounts: [] });
  const rows = await db.select({ name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.active, true)).orderBy(asc(users.id));
  const seen = new Set<string>();
  const accounts = rows.filter((r) => (seen.has(r.role) ? false : (seen.add(r.role), true)));
  res.json({ enabled: true, password: config.demoPassword, accounts });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});
