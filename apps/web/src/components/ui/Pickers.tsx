import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES, formatCOP, formatQty, presetRange, todayISO, type CustomerType, type PeriodPreset } from '@nexo/shared';
import { Check, Package, Search, UserPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, qs } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import type { Customer, VariantOption } from '@/lib/types';
import { Button } from './Button';
import { Badge } from './Feedback';
import { Field, Input, Select } from './Form';
import { Modal } from './Overlay';

export function SearchInput({ value, onChange, placeholder, autoFocus, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} className="pl-10 pr-9" type="search" />
      {value ? (
        <button type="button" onClick={() => onChange('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink" aria-label="Limpiar búsqueda">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export interface Period {
  preset: PeriodPreset;
  from: string;
  to: string;
}
export function makePeriod(preset: PeriodPreset): Period {
  return { preset, ...presetRange(preset) };
}

const PRESETS: Array<[PeriodPreset, string]> = [
  ['hoy', 'Hoy'],
  ['7d', '7 días'],
  ['mes', 'Este mes'],
  ['30d', '30 días'],
  ['90d', '3 meses'],
  ['anio', 'Este año'],
  ['custom', 'Otro rango'],
];

export function PeriodPicker({ value, onChange, presets }: { value: Period; onChange: (p: Period) => void; presets?: PeriodPreset[] }) {
  const list = presets ? PRESETS.filter(([k]) => presets.includes(k)) : PRESETS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-[var(--radius-btn)] border border-line-strong bg-surface p-1" role="group" aria-label="Periodo">
        {list.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k === 'custom' ? { preset: 'custom', from: value.from, to: value.to } : makePeriod(k))}
            className={`rounded-lg px-3 py-1.5 text-[14px] font-semibold ${value.preset === k ? 'bg-petrol-600 text-white' : 'text-ink-soft hover:bg-petrol-50'}`}
            aria-pressed={value.preset === k}
          >
            {label}
          </button>
        ))}
      </div>
      {value.preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="Desde" value={value.from} max={value.to} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-auto" />
          <span className="text-muted">a</span>
          <Input type="date" aria-label="Hasta" value={value.to} min={value.from} max={todayISO()} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-auto" />
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Cliente
export function CustomerPicker({ value, onChange, allowEmpty, emptyLabel = 'Sin cliente (mostrador)' }: { value: Customer | null; onChange: (c: Customer | null) => void; allowEmpty?: boolean; emptyLabel?: string }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useApi<Customer[]>(`/customers${qs({ q: dq, limit: 8 })}`);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-petrol-600 bg-petrol-50 p-3.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-petrol-600 text-white">
          <Check className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="font-bold text-ink">{value.name}</p>
          <p className="text-[14px] text-muted">
            {CUSTOMER_TYPE_LABELS[value.type as CustomerType]} {value.phone ? `· ${value.phone}` : ''} {value.document ? `· Doc. ${value.document}` : ''}
          </p>
          {value.balance ? <p className="mt-0.5 text-[13.5px] font-semibold text-warn-700">Tiene saldo pendiente de {formatCOP(value.balance)}</p> : null}
        </div>
        <Button variant="secondary" size="sm" onClick={() => onChange(null)}>
          Cambiar cliente
        </Button>
      </div>
    );
  }
  const list = (data ?? []).slice(0, 8);
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, documento o teléfono" autoFocus className="flex-1" />
        <Button variant="soft" icon={UserPlus} onClick={() => setCreating(true)}>
          Crear cliente nuevo
        </Button>
      </div>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface" role="listbox" aria-label="Clientes">
        {allowEmpty ? (
          <li>
            <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-petrol-50" onClick={() => onChange(null)}>
              <span className="font-semibold text-ink-soft">{emptyLabel}</span>
            </button>
          </li>
        ) : null}
        {isLoading ? <li className="px-4 py-3 text-muted">Buscando…</li> : null}
        {!isLoading && !list.length ? (
          <li className="px-4 py-4 text-muted">
            No encontramos clientes con “{q}”.{' '}
            <button type="button" className="font-semibold text-petrol-700 underline" onClick={() => setCreating(true)}>
              Crear “{q}” como cliente nuevo
            </button>
          </li>
        ) : null}
        {list.map((c) => (
          <li key={c.id}>
            <button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-petrol-50" onClick={() => onChange(c)}>
              <span className="flex-1">
                <span className="block font-semibold text-ink">{c.name}</span>
                <span className="text-[13.5px] text-muted">
                  {CUSTOMER_TYPE_LABELS[c.type as CustomerType]}
                  {c.phone ? ` · ${c.phone}` : ''}
                  {c.document ? ` · ${c.document}` : ''}
                </span>
              </span>
              {c.balance ? <Badge tone="warn">Debe {formatCOP(c.balance)}</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      <QuickCustomerModal
        open={creating}
        initialName={q}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          onChange(c);
        }}
      />
    </div>
  );
}

/** Registro rápido de cliente sin abandonar el flujo. */
export function QuickCustomerModal({ open, onClose, onCreated, initialName = '' }: { open: boolean; onClose: () => void; onCreated: (c: Customer) => void; initialName?: string }) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [type, setType] = useState<CustomerType>('persona');
  const [phone, setPhone] = useState('');
  const [document, setDocument] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setName(initialName);
      setErrors({});
    }
  }, [open, initialName]);
  const save = async () => {
    setSaving(true);
    try {
      const c = await api.post<Customer>('/customers', { name, type, phone, document, tags: ['Nuevo'], marketingConsent: false });
      toast.success(`Cliente ${c.name} creado`);
      onCreated(c);
    } catch (e) {
      const err = e as { message: string; fields?: Record<string, string> };
      setErrors(err.fields ?? {});
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crear cliente nuevo"
      description="Solo los datos básicos. Puedes completar el resto después en Clientes."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={UserPlus} loading={saving} onClick={save}>
            Guardar cliente
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre o razón social" required error={errors.name} htmlFor="qc-name">
          <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus invalid={!!errors.name} />
        </Field>
        <Field label="Tipo de cliente" required htmlFor="qc-type">
          <Select id="qc-type" value={type} onChange={(e) => setType(e.target.value as CustomerType)}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Teléfono / WhatsApp" error={errors.phone} htmlFor="qc-phone">
          <Input id="qc-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ej: 300 123 4567" invalid={!!errors.phone} />
        </Field>
        <Field label="Documento (cédula o NIT)" error={errors.document} htmlFor="qc-doc">
          <Input id="qc-doc" value={document} onChange={(e) => setDocument(e.target.value)} invalid={!!errors.document} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Producto / variante
/**
 * Buscador de productos: muestra producto → tallas/colores como botones grandes,
 * con disponible visible. Evita digitar códigos.
 */
export function VariantPicker({
  types,
  onPick,
  onlyAvailable,
  showStock = true,
  placeholder = 'Buscar producto por nombre o código',
  autoFocus,
  pickedIds = [],
}: {
  types: string[];
  onPick: (v: VariantOption) => void;
  onlyAvailable?: boolean;
  showStock?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  pickedIds?: number[];
}) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const { data, isLoading } = useApi<VariantOption[]>(`/products/variants/search${qs({ q: dq, types: types.join(','), onlyAvailable })}`);
  const [productId, setProductId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const groups = new Map<number, VariantOption[]>();
  for (const v of data ?? []) groups.set(v.productId, [...(groups.get(v.productId) ?? []), v]);
  const products = [...groups.values()];
  const selected = productId ? groups.get(productId) : null;

  return (
    <div>
      <SearchInput
        value={q}
        onChange={(v) => {
          setQ(v);
          setProductId(null);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <div ref={listRef} className="mt-3 max-h-[340px] overflow-y-auto rounded-xl border border-line bg-surface">
        {isLoading ? <p className="px-4 py-3 text-muted">Buscando…</p> : null}
        {!isLoading && !products.length ? <p className="px-4 py-4 text-muted">No hay productos que coincidan con “{q}”.</p> : null}
        {!selected
          ? products.slice(0, 30).map((vs) => {
              const p = vs[0];
              const total = vs.reduce((a, v) => a + v.available, 0);
              return (
                <button
                  key={p.productId}
                  type="button"
                  className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-petrol-50"
                  onClick={() => (vs.length === 1 ? onPick(vs[0]) : setProductId(p.productId))}
                >
                  <Package className="h-5 w-5 shrink-0 text-petrol-500" aria-hidden />
                  <span className="flex-1">
                    <span className="block font-semibold text-ink">{p.productName}</span>
                    <span className="text-[13.5px] text-muted">
                      {p.category} · {vs.length > 1 ? `${vs.length} tallas/colores` : p.sku}
                    </span>
                  </span>
                  <span className="text-right">
                    {p.price ? <span className="num block font-semibold">{formatCOP(p.price)}</span> : null}
                    {showStock && p.type !== 'servicio' ? <span className={`text-[13px] ${total > 0 ? 'text-muted' : 'text-risk-700 font-semibold'}`}>{total > 0 ? `${formatQty(total)} disponibles` : 'Sin existencias'}</span> : null}
                  </span>
                </button>
              );
            })
          : null}
        {selected ? (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-bold">{selected[0].productName}: elige talla y color</p>
              <button type="button" className="text-[14px] font-semibold text-petrol-700 hover:underline" onClick={() => setProductId(null)}>
                Ver otros productos
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {selected.map((v) => {
                const already = pickedIds.includes(v.id);
                const out = showStock && v.type !== 'servicio' && v.available <= 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => onPick(v)}
                    className={`rounded-xl border-2 px-3 py-2.5 text-left transition-colors ${already ? 'border-ok-500 bg-ok-50' : out ? 'border-line bg-linen' : 'border-line hover:border-petrol-500 hover:bg-petrol-50'}`}
                  >
                    <span className="block font-bold text-ink">
                      {v.size ? `Talla ${v.size}` : 'Única'}
                      {already ? <Check className="ml-1 inline h-4 w-4 text-ok-500" aria-label="ya agregado" /> : null}
                    </span>
                    {v.color ? <span className="block text-[13.5px] text-ink-soft">{v.color}</span> : null}
                    {showStock ? <span className={`block text-[13px] ${out ? 'font-semibold text-risk-700' : 'text-muted'}`}>{out ? 'Sin existencias' : `${formatQty(v.available)} disp.`}</span> : null}
                    {v.price && v.price !== selected[0].price ? <span className="num block text-[13px] font-semibold text-petrol-700">{formatCOP(v.price)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
