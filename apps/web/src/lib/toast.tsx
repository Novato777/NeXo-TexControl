import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}
interface Ctx {
  success: (t: string) => void;
  error: (t: string) => void;
  info: (t: string) => void;
}
const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
      setTimeout(() => remove(id), kind === 'error' ? 8000 : 4500);
    },
    [remove],
  );
  const value = useMemo(() => ({ success: (t: string) => push('success', t), error: (t: string) => push('error', t), info: (t: string) => push('info', t) }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" role="region" aria-live="polite" aria-label="Avisos">
        {items.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? CircleAlert : Info;
          const tone =
            t.kind === 'success' ? 'border-ok-500 text-ok-700' : t.kind === 'error' ? 'border-risk-500 text-risk-700' : 'border-petrol-500 text-petrol-700';
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={`flex items-start gap-3 rounded-xl border-l-4 bg-surface px-4 py-3 shadow-[var(--shadow-pop)] ${tone}`}
              style={{ animation: 'toast-in .2s ease-out' }}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p className="flex-1 text-[14.5px] font-medium text-ink">{t.text}</p>
              <button onClick={() => remove(t.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Cerrar aviso">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const c = useContext(ToastCtx);
  if (!c) throw new Error('ToastProvider faltante');
  return c;
}
