// Endurecimiento de la API: cabeceras, CSRF, limpieza de entradas, límite de intentos y lectura segura de filtros.
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { AppError } from './errors';

/** Cabeceras de seguridad (equivalente mínimo a helmet, sin dependencias). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Protección CSRF: toda acción que modifica datos debe llegar como JSON.
 * Un formulario de otro sitio no puede enviar application/json sin permiso (CORS), así que se bloquea.
 */
export function requireJson(req: Request, _res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > 0 && !req.is('application/json')) {
      return next(new AppError(415, 'El formato de los datos no es válido.'));
    }
  }
  next();
}

/** Quita caracteres nulos y de control que PostgreSQL rechaza, y recorta textos de búsqueda gigantes. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
function clean(v: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (typeof v === 'string') return v.replace(CONTROL, '');
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = clean(val, depth + 1);
    }
    return out;
  }
  return v;
}
export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  // En Express 5 req.query se recalcula en cada lectura: se reemplaza por una copia limpia y fija.
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') q[k] = v.replace(CONTROL, '').slice(0, 200); // arrays u objetos en la URL no se aceptan
  }
  Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
  next();
}

/** Límite de intentos fallidos de ingreso por IP (anti fuerza bruta). */
const attempts = new Map<string, { count: number; until: number }>();
const WINDOW = 10 * 60_000;
const MAX_FAILS = 10;
/** Clave del límite: IP + correo. Así, detrás de un proxy compartido, un atacante no bloquea a los demás usuarios. */
function attemptKey(req: Request) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 120) : '';
  return `${req.ip ?? 'desconocida'}|${email}`;
}
export function loginGuard(req: Request, _res: Response, next: NextFunction) {
  const key = attemptKey(req);
  const a = attempts.get(key);
  if (a && a.count >= MAX_FAILS && a.until > Date.now()) {
    const min = Math.ceil((a.until - Date.now()) / 60_000);
    return next(new AppError(429, `Demasiados intentos fallidos. Por seguridad, espera ${min} minuto(s) e intenta de nuevo.`));
  }
  next();
}
export function registerLoginFailure(req: Request) {
  const key = attemptKey(req);
  const a = attempts.get(key);
  const fresh = !a || a.until < Date.now();
  attempts.set(key, { count: fresh ? 1 : a!.count + 1, until: Date.now() + WINDOW });
  if (attempts.size > 10_000) attempts.clear();
}
export function clearLoginFailures(req: Request) {
  attempts.delete(attemptKey(req));
}

/** El acceso rápido por rol solo existe en modo demo. En producción hay que activarlo explícitamente. */
export function demoEnabled() {
  const v = process.env.DEMO_MODE;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return !config.isProd;
}

// ------------------------------------------------------------------ lectura segura de filtros (?limit=, ?from=…)
export function intQuery(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
export function idQuery(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}
export function dateQuery(v: unknown, def: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return def;
  const d = new Date(v + 'T12:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return def;
  const y = Number(v.slice(0, 4));
  return y < 2000 || y > 2100 ? def : v;
}

/** Evita que un texto se ejecute como fórmula al abrir el CSV en Excel. */
export function csvSafe(x: unknown): string {
  const s = String(x ?? '');
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}
