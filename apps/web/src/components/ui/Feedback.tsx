import { CircleAlert, HelpCircle, Inbox, Loader2, RefreshCw, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './Button';

export type Tone = 'neutral' | 'petrol' | 'teal' | 'ok' | 'warn' | 'risk' | 'violet';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-linen text-ink-soft border-line-strong',
  petrol: 'bg-petrol-50 text-petrol-700 border-petrol-200',
  teal: 'bg-teal-50 text-teal-700 border-teal-500/30',
  ok: 'bg-ok-50 text-ok-700 border-ok-500/30',
  warn: 'bg-warn-50 text-warn-700 border-warn-500/35',
  risk: 'bg-risk-50 text-risk-700 border-risk-500/35',
  violet: 'bg-violet-50 text-violet-700 border-violet-500/30',
};
const dotCls: Record<Tone, string> = {
  neutral: 'bg-muted',
  petrol: 'bg-petrol-500',
  teal: 'bg-teal-500',
  ok: 'bg-ok-500',
  warn: 'bg-warn-500',
  risk: 'bg-risk-500',
  violet: 'bg-violet-500',
};

/** Estado siempre con texto + color (nunca solo color). */
export function Badge({ tone = 'neutral', children, icon: Icon, className = '' }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${toneCls[tone]} ${className}`}>
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : <span className={`h-1.5 w-1.5 rounded-full ${dotCls[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Loader2 className="h-6 w-6 animate-spin text-petrol-500" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-line/70 ${className}`} aria-hidden />;
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Cargando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }: { icon?: LucideIcon; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 rounded-2xl border-2 border-dashed border-line-strong p-4 text-petrol-500">
        <Icon className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="text-[17px] font-bold">{title}</h3>
      {text ? <p className="mt-1 max-w-md text-muted">{text}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <CircleAlert className="mb-3 h-9 w-9 text-risk-500" aria-hidden />
      <h3 className="text-[17px] font-bold">No pudimos cargar esta información</h3>
      <p className="mt-1 max-w-md text-muted">{error?.message}</p>
      {onRetry ? (
        <Button variant="secondary" icon={RefreshCw} className="mt-4" onClick={onRetry}>
          Intentar de nuevo
        </Button>
      ) : null}
    </div>
  );
}

/** Aviso dentro de la página (explicación, advertencia o confirmación). */
export function Notice({ tone = 'petrol', icon: Icon, title, children, action }: { tone?: Tone; icon?: LucideIcon; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center ${toneCls[tone]}`}>
      <div className="flex flex-1 items-start gap-3">
        {Icon ? <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : null}
        <div className="text-[14.5px] text-ink">
          {title ? <p className="font-bold">{title}</p> : null}
          {children ? <div className="text-ink-soft">{children}</div> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Ayuda contextual breve para términos poco comunes. */
export function HelpTip({ children, label = '¿Qué es esto?' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle">
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-petrol-50 hover:text-petrol-700"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open ? (
        <span role="tooltip" className="absolute left-1/2 top-7 z-30 w-64 -translate-x-1/2 rounded-xl bg-ink px-3.5 py-2.5 text-left text-[13.5px] font-normal leading-snug text-white shadow-[var(--shadow-pop)]">
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** Barra de avance tipo cinta métrica. */
export function Tape({ value, tone = 'petrol', label }: { value: number; tone?: 'petrol' | 'ok' | 'warn' | 'risk' | 'teal'; label?: string }) {
  const color = { petrol: 'bg-petrol-500', ok: 'bg-ok-500', warn: 'bg-warn-500', risk: 'bg-risk-500', teal: 'bg-teal-500' }[tone];
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="tape" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? `Avance ${v}%`}>
      <span className={color} style={{ width: `${v}%` }} />
    </div>
  );
}
