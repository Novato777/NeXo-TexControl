import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

/** Error con mensaje pensado para el usuario final. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new AppError(400, msg, fields);
export const notFound = (what = 'El registro') => new AppError(404, `${what} no existe o fue eliminado.`);
export const forbidden = (msg = 'Tu usuario no tiene permiso para hacer esto. Pide ayuda al administrador.') =>
  new AppError(403, msg);
export const conflict = (msg: string) => new AppError(409, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw zodToAppError(result.error);
  return result.data;
}

function zodToAppError(err: ZodError): AppError {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = err.issues[0]?.message ?? 'Revisa los datos ingresados.';
  return new AppError(400, first, fields);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields });
  }
  if (err instanceof ZodError) {
    const e = zodToAppError(err);
    return res.status(400).json({ error: e.message, fields: e.fields });
  }
  // Errores del lector de JSON (cuerpo mal formado o demasiado grande): culpa del cliente, no del servidor.
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') return res.status(400).json({ error: 'Los datos enviados no tienen un formato válido.' });
  if (type === 'entity.too.large') return res.status(413).json({ error: 'La información enviada es demasiado grande.' });
  // Valor fuera de rango para la base de datos (protección extra además de las validaciones).
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code === '22003' || code === '22P02' || code === '22007' || code === '22008') {
    return res.status(400).json({ error: 'Alguno de los valores está fuera del rango permitido. Revisa cantidades, precios y fechas.' });
  }
  if (code === '23505') {
    return res.status(409).json({ error: 'Esta operación ya se había registrado (por ejemplo, ya hay una caja abierta). Actualiza la pantalla y revisa.' });
  }
  console.error('[api] error no controlado:', err);
  return res
    .status(500)
    .json({ error: 'Ocurrió un problema inesperado. Intenta de nuevo; si continúa, avisa al administrador.' });
}

/** Convierte el id de la URL a número o responde 404. */
export function idParam(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2_147_483_647) throw notFound();
  return n;
}
