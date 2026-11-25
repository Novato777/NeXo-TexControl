import { CUSTOMER_TYPE_LABELS, CUSTOMER_TYPES, DEFAULT_CUSTOMER_TAGS, type CustomerType } from '@nexo/shared';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Overlay';
import { api, ApiError } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import type { Customer } from '@/lib/types';

const empty = { name: '', type: 'persona' as CustomerType, document: '', phone: '', whatsapp: '', email: '', address: '', city: 'Bogotá', notes: '', tags: [] as string[], marketingConsent: false, creditDays: 0 };

export function CustomerFormModal({ open, onClose, customer, onSaved }: { open: boolean; onClose: () => void; customer?: Customer | null; onSaved?: (c: Customer) => void }) {
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(
      customer
        ? {
            name: customer.name,
            type: customer.type as CustomerType,
            document: customer.document ?? '',
            phone: customer.phone ?? '',
            whatsapp: customer.whatsapp ?? '',
            email: customer.email ?? '',
            address: customer.address ?? '',
            city: customer.city ?? '',
            notes: customer.notes ?? '',
            tags: customer.tags,
            marketingConsent: customer.marketingConsent,
            creditDays: customer.creditDays,
          }
        : empty,
    );
  }, [open, customer]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(() => (customer ? api.put<Customer>(`/customers/${customer.id}`, f) : api.post<Customer>('/customers', f)), {
    success: customer ? 'Cliente actualizado' : 'Cliente creado',
    silentError: true,
    onSuccess: (c) => {
      onSaved?.(c);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={customer ? `Editar ${customer.name}` : 'Agregar cliente'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} loading={save.isPending} onClick={() => save.mutate(undefined, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}>
            {customer ? 'Guardar cambios' : 'Guardar cliente'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {errors._ ? <p className="rounded-lg bg-risk-50 px-3 py-2 font-semibold text-risk-700">{errors._}</p> : null}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-[15px] font-bold">Datos principales</legend>
          <Field label="Nombre o razón social" required error={errors.name} htmlFor="c-name" className="sm:col-span-2">
            <Input id="c-name" value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} autoFocus />
          </Field>
          <Field label="Tipo de cliente" required htmlFor="c-type">
            <Select id="c-type" value={f.type} onChange={(e) => set('type', e.target.value as CustomerType)}>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CUSTOMER_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Documento (cédula o NIT)" error={errors.document} htmlFor="c-doc">
            <Input id="c-doc" value={f.document} onChange={(e) => set('document', e.target.value)} invalid={!!errors.document} />
          </Field>
        </fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-3 text-[15px] font-bold">Contacto</legend>
          <Field label="Teléfono" error={errors.phone} htmlFor="c-phone">
            <Input id="c-phone" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="300 123 4567" invalid={!!errors.phone} />
          </Field>
          <Field label="WhatsApp" hint="Si es el mismo teléfono, déjalo vacío." error={errors.whatsapp} htmlFor="c-wa">
            <Input id="c-wa" inputMode="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} invalid={!!errors.whatsapp} />
          </Field>
          <Field label="Correo" error={errors.email} htmlFor="c-email">
            <Input id="c-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} invalid={!!errors.email} />
          </Field>
          <Field label="Ciudad" htmlFor="c-city">
            <Input id="c-city" value={f.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="Dirección" htmlFor="c-addr" className="sm:col-span-2">
            <Input id="c-addr" value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
        </fieldset>
        <fieldset className="space-y-4">
          <legend className="mb-3 text-[15px] font-bold">Condiciones y etiquetas</legend>
          <Field label="Días de crédito" hint="Cuántos días tiene para pagar el saldo. 0 = paga al recibir." htmlFor="c-credit">
            <Select id="c-credit" value={f.creditDays} onChange={(e) => set('creditDays', Number(e.target.value))} className="max-w-xs">
              {[0, 8, 15, 30, 45, 60].map((d) => (
                <option key={d} value={d}>
                  {d === 0 ? 'Sin crédito (paga al recibir)' : `${d} días`}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <p className="mb-2 text-[14px] font-semibold text-ink-soft">Etiquetas</p>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_CUSTOMER_TAGS.map((t) => {
                const on = f.tags.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => set('tags', on ? f.tags.filter((x) => x !== t) : [...f.tags, t])} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${on ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-line-strong text-ink-soft hover:bg-linen'}`}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <Checkbox checked={f.marketingConsent} onChange={(v) => set('marketingConsent', v)} label="Acepta recibir promociones por WhatsApp o correo" description="Solo los clientes que acepten aparecerán en las campañas de marketing." />
          <Field label="Notas" htmlFor="c-notes">
            <Textarea id="c-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </fieldset>
      </div>
    </Modal>
  );
}
