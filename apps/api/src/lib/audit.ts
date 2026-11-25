import type { Executor } from '../db/client';
import { auditLogs } from '../db/schema';
import type { AuthUser } from './auth';

export async function audit(
  tx: Executor,
  user: AuthUser | null,
  entry: {
    action: string;
    entity: string;
    entityId?: number | null;
    reference?: string | null;
    summary: string;
    sensitive?: boolean;
    detail?: unknown;
    /** Fecha histórica (solo para datos importados / demo). */
    at?: string;
  },
) {
  await tx.insert(auditLogs).values({
    userId: user?.id ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    reference: entry.reference ?? null,
    summary: entry.summary,
    sensitive: entry.sensitive ?? false,
    detail: entry.detail ?? null,
    ...(entry.at ? { createdAt: entry.at } : {}),
  });
}
