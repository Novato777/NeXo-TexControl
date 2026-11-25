import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useToast } from './toast';

/** Consulta GET con caché. La clave es la ruta. */
export function useApi<T>(path: string | null, opts: Partial<UseQueryOptions<T, ApiError>> = {}) {
  return useQuery<T, ApiError>({
    queryKey: [path],
    queryFn: () => api.get<T>(path!),
    enabled: !!path,
    ...opts,
  });
}

/**
 * Acción que modifica datos. Al terminar refresca todas las consultas (los datos están conectados:
 * un pago cambia caja, cartera y dashboard a la vez) y muestra un aviso de éxito o error.
 */
export function useAction<TBody = unknown, TRes = unknown>(
  fn: (body: TBody) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string); onSuccess?: (r: TRes) => void; silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<TRes, ApiError, TBody>({
    mutationFn: fn,
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onSuccess?.(r);
    },
    onError: (e) => {
      if (!opts.silentError) toast.error(e.message);
    },
  });
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · TexControl`;
  }, [title]);
}

// ------------------------------------------------------------------ Prevención de pérdida de datos
let leaveMessage: string | null = null;

/** Pregunta antes de salir si hay datos sin guardar (cerrar pestaña o navegar por el menú). */
export function useLeaveGuard(dirty: boolean, message = 'Tienes datos sin guardar. ¿Seguro que quieres salir? Se perderá lo que escribiste.') {
  useEffect(() => {
    leaveMessage = dirty ? message : null;
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => {
      window.removeEventListener('beforeunload', h);
      leaveMessage = null;
    };
  }, [dirty, message]);
}

/** Usado por los enlaces del menú: devuelve false si el usuario decide quedarse. */
export function confirmLeave(): boolean {
  if (!leaveMessage) return true;
  const ok = window.confirm(leaveMessage);
  if (ok) leaveMessage = null;
  return ok;
}
