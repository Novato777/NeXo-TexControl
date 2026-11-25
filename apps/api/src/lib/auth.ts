import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { can, canAccess, type Action, type Module, type Role } from '@nexo/shared';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { db } from '../db/client';
import { users } from '../db/schema';
import { AppError, forbidden } from './errors';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const TTL_SECONDS = 60 * 60 * 12; // 12 horas

export function signSession(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: TTL_SECONDS, algorithm: 'HS256' });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: TTL_SECONDS * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.sessionCookie, { path: '/' });
}

/** Usuarios vigentes en caché por pocos segundos (evita consultar la base en cada petición). */
const userCache = new Map<number, { user: AuthUser | null; at: number }>();
const CACHE_MS = 5_000;
export function invalidateUserCache(id?: number) {
  if (id) userCache.delete(id);
  else userCache.clear();
}

async function currentFromDb(id: number): Promise<AuthUser | null> {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).where(eq(users.id, id));
  const user = u && u.active ? { id: u.id, name: u.name, email: u.email, role: u.role as Role } : null;
  userCache.set(id, { user, at: Date.now() });
  return user;
}

/**
 * Verifica la sesión y además consulta el usuario: si fue desactivado o le cambiaron el rol,
 * el cambio aplica de inmediato (no espera a que venza el token).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = req.cookies?.[config.sessionCookie] || (header?.startsWith('Bearer ') ? header.slice(7) : null);
  if (!token || typeof token !== 'string' || token.length > 2048) return next(new AppError(401, 'Tu sesión terminó. Ingresa de nuevo.'));
  let payload: AuthUser;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as AuthUser;
  } catch {
    return next(new AppError(401, 'Tu sesión terminó. Ingresa de nuevo.'));
  }
  try {
    const user = Number.isInteger(payload.id) ? await currentFromDb(payload.id) : null;
    if (!user) return next(new AppError(401, 'Tu usuario fue desactivado o ya no existe. Pide ayuda al administrador.'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const requireModule =
  (...modules: Module[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !modules.some((m) => canAccess(req.user!.role, m))) return next(forbidden());
    next();
  };

export function assertCan(user: AuthUser, action: Action, msg?: string) {
  if (!can(user.role, action)) throw forbidden(msg);
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'Tu sesión terminó. Ingresa de nuevo.');
  return req.user;
}
