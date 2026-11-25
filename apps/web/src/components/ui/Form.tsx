import { formatQty, parseCOP } from '@nexo/shared';
import { CircleAlert } from 'lucide-react';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

const fieldBase =
  'rounded-[var(--radius-field)] border bg-surface px-3.5 text-[15px] text-ink placeholder:text-muted/70 transition-colors focus:outline-none focus:ring-3 focus:ring-teal-500/25 focus:border-teal-500 disabled:bg-linen disabled:text-muted';
const fieldOk = 'border-line-strong hover:border-petrol-200';
const fieldErr = 'border-risk-500 bg-risk-50/40';
/** Ancho completo salvo que el llamador indique un ancho propio (w-auto, w-40, etc.). */
const widthOf = (cls = '') => (/(^|\s)([a-z]+:)?w-/.test(cls) ? '' : 'w-full');

/** Campo con etiqueta visible, ayuda y mensaje de error que explica cómo corregir. */
export function Field({
  label,
  required,
  hint,
  error,
  children,
  className = '',
  htmlFor,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-[14px] font-semibold text-ink-soft">
        {label}
        {required ? (
          <span className="ml-1 text-risk-500" aria-label="obligatorio">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-[12.5px] font-normal text-muted">(opcional)</span>
        )}
      </label>
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13.5px] font-medium text-risk-700" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className = '', ...rest }, ref) {
  return <input ref={ref} className={`${fieldBase} ${widthOf(className)} h-11 ${invalid ? fieldErr : fieldOk} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
});

export function Textarea({ invalid, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={`${fieldBase} w-full min-h-[88px] py-2.5 ${invalid ? fieldErr : fieldOk} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ invalid, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={`${fieldBase} ${widthOf(className)} h-11 cursor-pointer pr-9 ${invalid ? fieldErr : fieldOk} ${className}`} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

/** Dinero en pesos: muestra "$ 120.000" mientras se escribe, guarda un entero. */
export function MoneyInput({
  value,
  onChange,
  invalid,
  id,
  placeholder = '$ 0',
  autoFocus,
  disabled,
  className = '',
  ...aria
}: {
  value: number | null | undefined;
  onChange: (v: number) => void;
  invalid?: boolean;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const shown = value ? `$ ${new Intl.NumberFormat('es-CO').format(value)}` : '';
  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      disabled={disabled}
      className={`${fieldBase} ${widthOf(className)} num h-11 text-right font-semibold ${invalid ? fieldErr : fieldOk} ${className}`}
      placeholder={placeholder}
      value={shown}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(parseCOP(e.target.value))}
      onFocus={(e) => e.target.select()}
      {...aria}
    />
  );
}

/** Cantidad con botones grandes − / + (fácil en tablet). */
export function QtyInput({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  decimals = false,
  id,
  invalid,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  decimals?: boolean;
  id?: string;
  invalid?: boolean;
  'aria-label'?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(min, max != null ? Math.min(max, n) : n);
  return (
    <div className={`inline-flex h-11 items-stretch overflow-hidden rounded-[var(--radius-field)] border bg-surface ${invalid ? 'border-risk-500' : 'border-line-strong'}`}>
      <button type="button" className="w-10 text-xl font-semibold text-petrol-700 hover:bg-petrol-50 disabled:opacity-40" onClick={() => onChange(clamp(round(value - step)))} disabled={value <= min} aria-label="Restar">
        −
      </button>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode={decimals ? 'decimal' : 'numeric'}
        className="num w-16 border-x border-line text-center text-[15px] font-semibold focus:outline-none focus:bg-teal-50"
        value={text ?? (decimals ? formatQty(value) : String(value))}
        onFocus={(e) => {
          setText(String(value).replace('.', ','));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'));
          if (Number.isFinite(n)) onChange(clamp(decimals ? n : Math.round(n)));
        }}
        onBlur={() => setText(null)}
      />
      <button type="button" className="w-10 text-xl font-semibold text-petrol-700 hover:bg-petrol-50 disabled:opacity-40" onClick={() => onChange(clamp(round(value + step)))} disabled={max != null && value >= max} aria-label="Sumar">
        +
      </button>
    </div>
  );
}
const round = (n: number) => Math.round(n * 1000) / 1000;

export function Checkbox({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-lg py-1">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-petrol-600)]" />
      <span>
        <span className="block font-medium text-ink">{label}</span>
        {description ? <span className="block text-[13.5px] text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** Opciones grandes tipo tarjeta (mejor que un select cuando hay 2–5 opciones). */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  columns = 3,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string; description?: string; icon?: React.ComponentType<{ className?: string }> }>;
  columns?: 2 | 3 | 4 | 5;
  name: string;
}) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-3 lg:grid-cols-5' }[columns];
  return (
    <div role="radiogroup" className={`grid grid-cols-1 gap-2.5 ${cols}`}>
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <label
            key={o.value}
            className={`relative flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3.5 transition-colors ${active ? 'border-petrol-600 bg-petrol-50' : 'border-line bg-surface hover:border-petrol-200'}`}
          >
            <input type="radio" name={name} className="sr-only" checked={active} onChange={() => onChange(o.value)} />
            {Icon ? <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${active ? 'text-petrol-600' : 'text-muted'}`} /> : null}
            <span>
              <span className={`block font-semibold ${active ? 'text-petrol-700' : 'text-ink'}`}>{o.label}</span>
              {o.description ? <span className="mt-0.5 block text-[13px] leading-snug text-muted">{o.description}</span> : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** Lista editable de textos (catálogos de configuración). */
export function TagEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setText('');
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-petrol-50 py-1 pl-3 pr-1 text-[14px] font-medium text-petrol-700">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full px-1.5 text-petrol-500 hover:bg-petrol-100 hover:text-risk-500" aria-label={`Quitar ${v}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button type="button" onClick={add} className="h-11 shrink-0 rounded-[var(--radius-btn)] border border-line-strong px-4 font-semibold text-petrol-700 hover:bg-petrol-50">
          Agregar
        </button>
      </div>
    </div>
  );
}
