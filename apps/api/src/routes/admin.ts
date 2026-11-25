// Configuración, usuarios, auditoría y restablecimiento de datos demo.
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { ROLE_LABELS, settingsSchema, userSchema, type Role } from '@nexo/shared';
import { db } from '../db/client';
import { auditLogs, settings, users } from '../db/schema';
import { runIntegrity } from '../db/integrity';
import { resetAndSeed } from '../db/seed';
import { audit } from '../lib/audit';
import { assertCan, currentUser, invalidateUserCache, requireModule } from '../lib/auth';
import { badRequest, idParam, notFound, parse } from '../lib/errors';
import { appState } from '../lib/state';
import { dateQuery, demoEnabled } from '../lib/security';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res) => {
  const [s] = await db.select().from(settings).limit(1);
  res.json(s ?? null);
});

settingsRouter.put('/', requireModule('configuracion'), async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'configuracion.editar');
  const input = parse(settingsSchema, req.body);
  await db.transaction(async (tx) => {
    await tx.update(settings).set(input).where(eq(settings.id, 1));
    await audit(tx, user, { action: 'configuracion', entity: 'configuracion', summary: 'Configuración del negocio actualizada', sensitive: true });
  });
  const [s] = await db.select().from(settings).limit(1);
  res.json(s);
});

export const usersRouter = Router();
usersRouter.use(requireModule('configuracion'));

usersRouter.get('/', async (_req, res) => {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, lastLoginAt: users.lastLoginAt })
    .from(users)
    .orderBy(users.id);
  res.json(rows);
});

usersRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'configuracion.editar');
  const input = parse(userSchema, req.body);
  if (!input.password) throw badRequest('Escribe una contraseña de al menos 8 caracteres.', { password: 'Obligatoria para usuarios nuevos.' });
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (exists) throw badRequest('Ya existe un usuario con ese correo.', { email: 'Usa otro correo.' });
  const created = await db.transaction(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ name: input.name, email: input.email, role: input.role, active: input.active, passwordHash: await bcrypt.hash(input.password!, 10) })
      .returning({ id: users.id });
    await audit(tx, user, {
      action: 'usuario_creado',
      entity: 'usuario',
      entityId: u.id,
      summary: `Usuario ${input.name} creado con rol ${ROLE_LABELS[input.role]}`,
      sensitive: true,
    });
    return u;
  });
  res.status(201).json(created);
});

usersRouter.put('/:id', async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'configuracion.editar');
  const id = idParam(req.params.id);
  const input = parse(userSchema, req.body);
  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) throw notFound('El usuario');
  if (id === user.id && (!input.active || input.role !== 'admin')) {
    throw badRequest('No puedes quitarte el rol de administrador ni desactivar tu propio usuario.');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        name: input.name,
        email: input.email,
        role: input.role,
        active: input.active,
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
      })
      .where(eq(users.id, id));
    const changes = [];
    if (existing.role !== input.role) changes.push(`rol ${ROLE_LABELS[existing.role as Role]} → ${ROLE_LABELS[input.role]}`);
    if (existing.active !== input.active) changes.push(input.active ? 'activado' : 'desactivado');
    if (input.password) changes.push('contraseña cambiada');
    invalidateUserCache(id);
    await audit(tx, user, {
      action: 'usuario_editado',
      entity: 'usuario',
      entityId: id,
      summary: `Usuario ${input.name} actualizado${changes.length ? `: ${changes.join(', ')}` : ''}`,
      sensitive: changes.length > 0,
    });
  });
  res.json({ ok: true });
});

export const auditRouter = Router();
auditRouter.use(requireModule('configuracion'));
auditRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const sensitive = req.query.sensitive === 'true';
  const from = req.query.from ? dateQuery(req.query.from, '') || null : null;
  const to = req.query.to ? dateQuery(req.query.to, '') || null : null;
  const rows = await db
    .select({ log: auditLogs, userName: users.name })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(
      and(
        q ? or(ilike(auditLogs.summary, `%${q}%`), ilike(auditLogs.reference, `%${q}%`)) : undefined,
        sensitive ? eq(auditLogs.sensitive, true) : undefined,
        from ? gte(auditLogs.createdAt, `${from}T00:00:00-05:00`) : undefined,
        to ? lte(auditLogs.createdAt, `${to}T23:59:59-05:00`) : undefined,
      ),
    )
    .orderBy(desc(auditLogs.id))
    .limit(300);
  res.json(rows.map((r) => ({ ...r.log, userName: r.userName ?? 'Sistema' })));
});

/** Verificación de integridad de los datos (solo administrador). */
auditRouter.get('/integrity', async (_req, res) => {
  res.json(await runIntegrity(db));
});

export const demoRouter = Router();
demoRouter.post('/reset', requireModule('configuracion'), async (req, res) => {
  const user = currentUser(req);
  assertCan(user, 'configuracion.editar');
  if (!demoEnabled()) throw badRequest('El restablecimiento solo está disponible en modo demo.');
  appState.ready = false;
  appState.message = 'se están restableciendo los datos de demostración (uno o dos minutos).';
  try {
    await resetAndSeed();
    invalidateUserCache();
  } finally {
    appState.ready = true;
  }
  res.json({ ok: true });
});

