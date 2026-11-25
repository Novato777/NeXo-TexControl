import { ChevronDown, ChevronLeft, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { confirmLeave, useDocumentTitle } from '@/lib/hooks';

/**
 * Encabezado compacto: título, una línea corta de ayuda y la acción principal.
 * (`icon` se acepta por compatibilidad pero ya no se dibuja: menos ruido visual.)
 */
export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; icon?: LucideIcon }) {
  useDocumentTitle(title);
  return (
    <header className="mb-5">
      {back ? (
        <Link to={back.to} onClick={(e) => !confirmLeave() && e.preventDefault()} className="mb-1.5 inline-flex items-center gap-1 text-[14px] font-semibold text-petrol-600 hover:text-petrol-800">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-[24px] font-extrabold leading-tight">{title}</h1>
          {description ? <div className="mt-0.5 text-[14.5px] text-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Card({ children, className = '', title, subtitle, actions, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-[16px] font-bold">{title}</h2>
            {subtitle ? <p className="text-[13.5px] text-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export interface TabItem<T extends string> {
  value: T;
  label: string;
  count?: number | null;
  icon?: LucideIcon;
  /** Si se indica, la pestaña navega a otra pantalla del mismo módulo. */
  to?: string;
}

/** Una sola fila de pestañas por pantalla. Las pestañas con `to` llevan a pantallas hermanas del módulo. */
export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange?: (v: T) => void; tabs: Array<TabItem<T>> }) {
  const nav = useNavigate();
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            role="tab"
            aria-selected={active}
            onClick={() => (t.to && !active ? nav(t.to) : onChange?.(t.value))}
            className={`relative inline-flex shrink-0 items-center gap-2 px-3.5 pb-2.5 pt-1.5 text-[15px] font-semibold transition-colors ${active ? 'text-petrol-700' : 'text-muted hover:text-ink'}`}
          >
            {t.label}
            {t.count != null ? <span className={`rounded-full px-2 text-[12.5px] ${active ? 'bg-petrol-600 text-white' : 'bg-linen text-muted'}`}>{t.count}</span> : null}
            {active ? <span className="stitch-x absolute inset-x-2 -bottom-px text-petrol-600" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor de 2–4 opciones (reemplaza pestañas secundarias y selects cortos). */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; count?: number }>; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-[var(--radius-btn)] border border-line-strong bg-surface p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-[14px] font-semibold transition-colors ${value === o.value ? 'bg-petrol-600 text-white' : 'text-ink-soft hover:bg-petrol-50'}`}
        >
          {o.label}
          {o.count != null ? <span className={`ml-1.5 ${value === o.value ? 'text-petrol-100' : 'text-muted'}`}>{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Franja única de cifras clave (máximo 4). Reemplaza varias tarjetas sueltas. */
export function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode; hint?: ReactNode; tone?: 'ink' | 'ok' | 'warn' | 'risk' | 'petrol'; to?: string; onClick?: () => void; active?: boolean } | null | false> }) {
  const list = items.filter(Boolean) as Array<Exclude<(typeof items)[number], null | false>>;
  const cols = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[Math.min(list.length, 4) as 1 | 2 | 3 | 4];
  return (
    <section className={`mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] ${cols}`}>
      {list.map((it) => {
        const color = { ink: 'text-ink', ok: 'text-ok-700', warn: 'text-warn-700', risk: 'text-risk-700', petrol: 'text-petrol-700' }[it.tone ?? 'ink'];
        const inner = (
          <>
            <p className="text-[13px] font-semibold text-muted">{it.label}</p>
            <p className={`num mt-0.5 text-[20px] font-extrabold leading-tight ${color}`}>{it.value}</p>
            {it.hint ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{it.hint}</p> : null}
          </>
        );
        const cls = `block px-4 py-3 text-left transition-colors ${it.active ? 'bg-petrol-50 ring-2 ring-inset ring-petrol-600' : 'bg-surface'} ${it.to || it.onClick ? 'hover:bg-petrol-50' : ''}`;
        return it.to ? (
          <Link key={it.label} to={it.to} className={cls}>
            {inner}
          </Link>
        ) : it.onClick ? (
          <button key={it.label} type="button" onClick={it.onClick} aria-pressed={it.active} className={cls}>
            {inner}
          </button>
        ) : (
          <div key={it.label} className={cls}>
            {inner}
          </div>
        );
      })}
    </section>
  );
}

/** Barra de búsqueda con filtros avanzados ocultos hasta que se necesiten. */
export function FilterBar({ search, quick, children, activeCount = 0 }: { search: ReactNode; quick?: ReactNode; children?: ReactNode; activeCount?: number }) {
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <div className="border-b border-line p-3.5">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
        <div className="flex-1">{search}</div>
        {quick}
        {children ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-[var(--radius-btn)] border px-3.5 text-[14.5px] font-semibold ${open || activeCount ? 'border-petrol-600 bg-petrol-50 text-petrol-700' : 'border-line-strong text-ink-soft hover:bg-linen'}`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
            Filtros{activeCount ? ` (${activeCount})` : ''}
          </button>
        ) : null}
      </div>
      {open && children ? <div className="mt-2.5 flex flex-wrap items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

/** Bloque plegable para información secundaria (historial, explicaciones, detalles). */
export function Collapsible({ title, children, defaultOpen = false, hint }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; hint?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left">
        <span>
          <span className="block text-[16px] font-bold">{title}</span>
          {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
        </span>
        <ChevronDown className={`h-5 w-5 text-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? <div className="border-t border-line">{children}</div> : null}
    </section>
  );
}

/** Lista clave–valor para fichas de detalle. */
export function KeyValues({ items, columns = 2 }: { items: Array<[ReactNode, ReactNode] | null | false>; columns?: 1 | 2 | 3 }) {
  const cols = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' }[columns];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2.5 ${cols}`}>
      {items.filter(Boolean).map((it, i) => {
        const [k, v] = it as [ReactNode, ReactNode];
        return (
          <div key={i}>
            <dt className="text-[13px] font-semibold text-muted">{k}</dt>
            <dd className="mt-0.5 text-[15px] text-ink">{v ?? '—'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Indicador clave. */
export function Stat({ label, value, hint, tone = 'ink', icon: Icon, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ink' | 'ok' | 'warn' | 'risk' | 'petrol'; icon?: LucideIcon; to?: string }) {
  const color = { ink: 'text-ink', ok: 'text-ok-700', warn: 'text-warn-700', risk: 'text-risk-700', petrol: 'text-petrol-700' }[tone];
  const inner = (
    <>
      <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-muted">
        {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        {label}
      </p>
      <p className={`num mt-1 text-[22px] font-extrabold leading-tight ${color}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-[13px] text-muted">{hint}</p> : null}
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-xl p-4 transition-colors hover:bg-petrol-50/60">
      {inner}
    </Link>
  ) : (
    <div className="p-4">{inner}</div>
  );
}
