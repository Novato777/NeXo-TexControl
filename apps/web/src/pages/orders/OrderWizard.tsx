import {
  addDays,
  DELIVERY_METHOD_LABELS,
  DELIVERY_METHODS,
  formatCOP,
  formatDate,
  PRIORITY_LABELS,
  todayISO,
  type DeliveryMethod,
  type PaymentMethod,
  type Priority,
} from '@nexo/shared';
import { Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, Factory, Flame, Home, Printer, Store, Trash2, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { HelpTip, Notice } from '@/components/ui/Feedback';
import { Checkbox, ChoiceCards, Field, Input, MoneyInput, QtyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, Segmented } from '@/components/ui/Layout';
import { CustomerPicker, VariantPicker } from '@/components/ui/Pickers';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { confirmLeave, useAction, useLeaveGuard } from '@/lib/hooks';
import { useToast } from '@/lib/toast';
import type { Customer, VariantOption } from '@/lib/types';
import { MethodChoice } from './shared';

interface Custom {
  logo: boolean;
  technique: 'ninguna' | 'bordado' | 'estampado' | 'sublimado';
  position: string;
  names: string;
  measures: string;
  notes: string;
}
interface Line {
  variant: VariantOption;
  quantity: number;
  unitPrice: number;
  custom: Custom;
}
const emptyCustom = (): Custom => ({ logo: false, technique: 'ninguna', position: '', names: '', measures: '', notes: '' });

const STEPS = ['Cliente', 'Productos', 'Entrega y pago', 'Confirmar'] as const;
const DELIVERY_SHORT: Record<DeliveryMethod, string> = { recoge: 'Recoge en el local', domicilio: 'A domicilio', institucion: 'En la institución' };
const STATUS_HELP = {
  confirmado: 'El cliente aceptó. Se separa lo que haya en bodega y se puede enviar a producción.',
  pendiente: 'Falta que el cliente apruebe o envíe datos (logo, tallas).',
  borrador: 'Solo se guarda como cotización. No afecta inventario ni producción.',
} as const;

export default function OrderWizard() {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [step, setStep] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [promisedDate, setPromisedDate] = useState(addDays(todayISO(), 15));
  const [priority, setPriority] = useState<Priority>('normal');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('recoge');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState(0);
  const [advance, setAdvance] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState<'confirmado' | 'pendiente' | 'borrador'>('confirmado');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [wantsCustom, setWantsCustom] = useState<'no' | 'si'>('no');
  const [created, setCreated] = useState<{ id: number; number: string; status: string } | null>(null);

  // Llegar con el cliente ya elegido (desde su ficha)
  const presetCustomer = params.get('cliente');
  useEffect(() => {
    if (!presetCustomer) return;
    api
      .get<{ customer: Customer }>(`/customers/${presetCustomer}`)
      .then((d) => {
        setCustomer(d.customer);
        if (d.customer.address) setDeliveryAddress(d.customer.address);
        setStep(1);
      })
      .catch(() => null);
  }, [presetCustomer]);

  // Duplicar un pedido anterior (clientes recurrentes)
  const dupId = params.get('duplicar');
  useEffect(() => {
    if (!dupId) return;
    api
      .get<{ order: { notes: string | null; priority: Priority; deliveryMethod: DeliveryMethod; deliveryAddress: string | null }; customer: Customer; items: Array<{ variantId: number; quantity: number; unitPrice: number; customization: Partial<Custom> | null }> }>(`/orders/${dupId}`)
      .then(async (d) => {
        setCustomer(d.customer);
        setPriority(d.order.priority);
        setDeliveryMethod(d.order.deliveryMethod);
        setDeliveryAddress(d.order.deliveryAddress ?? '');
        const opts = await api.get<VariantOption[]>(`/products/variants/search?types=terminado,servicio`);
        setLines(
          d.items
            .map((it) => {
              const v = opts.find((o) => o.id === it.variantId);
              return v ? { variant: v, quantity: it.quantity, unitPrice: v.price, custom: { ...emptyCustom(), ...(it.customization ?? {}) } as Custom } : null;
            })
            .filter(Boolean) as Line[],
        );
        if (d.items.some((it) => it.customization)) setWantsCustom('si');
        toast.info('Pedido copiado. Revisa cantidades y fecha antes de confirmar.');
        setStep(1);
      })
      .catch(() => toast.error('No se pudo copiar el pedido.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupId]);

  const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);
  const balance = total - advance;
  const anyCustom = lines.some((l) => l.custom.logo || l.custom.technique !== 'ninguna' || l.custom.names);
  const maxDiscountPct = can('pedido.descuento') ? 100 : 10;

  const validate = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    if (s === 0 && !customer) e.customer = 'Selecciona un cliente o crea uno nuevo para continuar.';
    if (s === 1) {
      if (!lines.length) e.lines = 'Agrega al menos un producto al pedido.';
      if (lines.some((l) => l.quantity <= 0)) e.lines = 'Todas las cantidades deben ser mayores que cero.';
    }
    if (s === 2) {
      if (!promisedDate) e.promisedDate = 'Elige la fecha de entrega.';
      else if (promisedDate < todayISO()) e.promisedDate = 'La fecha no puede ser anterior a hoy.';
      if (deliveryMethod === 'domicilio' && !deliveryAddress.trim()) e.deliveryAddress = 'Escribe la dirección de envío.';
      if (discount > subtotal) e.discount = 'El descuento no puede ser mayor que el valor del pedido.';
      else if (subtotal && (discount / subtotal) * 100 > maxDiscountPct) e.discount = `Tu usuario puede dar hasta ${maxDiscountPct}% de descuento (${formatCOP(Math.floor(subtotal * 0.1))}).`;
      if (advance > total) e.advance = `El anticipo no puede superar el total (${formatCOP(total)}).`;
    }
    return e;
  };
  const next = () => {
    const e = validate(step);
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goTo = (i: number) => {
    for (let s = 0; s < i; s++) {
      const e = validate(s);
      if (Object.keys(e).length) {
        setErrors(e);
        setStep(s);
        return;
      }
    }
    setErrors({});
    setStep(i);
  };

  const submit = useAction(
    () =>
      api.post<{ id: number; number: string; status: string }>('/orders', {
        customerId: customer!.id,
        items: lines.map((l) => ({
          variantId: l.variant.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          customization: l.custom.logo || l.custom.technique !== 'ninguna' || l.custom.names || l.custom.measures || l.custom.notes ? l.custom : null,
        })),
        promisedDate,
        priority,
        deliveryMethod,
        deliveryAddress: deliveryAddress || null,
        notes: notes || null,
        discount,
        status,
        advance: advance > 0 ? { amount: advance, method, reference: reference || null } : null,
      }),
    { onSuccess: (r) => setCreated(r), silentError: true },
  );
  const onSubmit = () =>
    submit.mutate(undefined, {
      onError: (e: ApiError) => {
        setErrors({ submit: e.message });
      },
    });

  useLeaveGuard((!!customer || lines.length > 0) && !created, 'El pedido todavía no se ha guardado. ¿Seguro que quieres salir? Se perderá lo que escribiste.');

  if (created) return <Success created={created} hasCustom={anyCustom} />;

  return (
    <div>
      <PageHeader title="Crear pedido" description="4 pasos. Puedes volver atrás sin perder lo escrito." back={{ to: '/pedidos', label: 'Pedidos' }} />
      <Stepper step={step} onGo={goTo} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          {step === 0 ? (
            <StepBox title="¿Para quién es el pedido?" text="Busca el cliente por nombre, documento o teléfono. Si es nuevo, créalo aquí mismo.">
              <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setErrors({}); if (c?.address) setDeliveryAddress(c.address); }} />
              {errors.customer ? <ErrorLine text={errors.customer} /> : null}
            </StepBox>
          ) : null}

          {step === 1 ? (
            <StepBox title="¿Qué productos lleva?" text="Busca el producto y toca la talla. Tocar otra vez la misma talla suma una unidad.">
              <VariantPicker
                types={['terminado', 'servicio']}
                pickedIds={lines.map((l) => l.variant.id)}
                onPick={(v) =>
                  setLines((ls) => {
                    const i = ls.findIndex((l) => l.variant.id === v.id);
                    if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, quantity: l.quantity + 1 } : l));
                    return [...ls, { variant: v, quantity: 1, unitPrice: v.price, custom: emptyCustom() }];
                  })
                }
              />
              <LinesEditor lines={lines} setLines={setLines} />
              {errors.lines ? <ErrorLine text={errors.lines} /> : null}
              {lines.some((l) => l.variant.type !== 'servicio') ? (
                <div className="mt-6 rounded-xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-bold">¿Lleva logo, bordado, estampado o nombres?</p>
                    <Segmented
                      label="¿Lleva personalización?"
                      value={wantsCustom}
                      onChange={(v) => {
                        setWantsCustom(v);
                        if (v === 'no') setLines((ls) => ls.map((l) => ({ ...l, custom: emptyCustom() })));
                      }}
                      options={[
                        { value: 'no', label: 'No' },
                        { value: 'si', label: 'Sí' },
                      ]}
                    />
                  </div>
                  {wantsCustom === 'si' ? (
                    <div className="mt-4">
                      <CustomEditor lines={lines} setLines={setLines} />
                    </div>
                  ) : (
                    <p className="mt-1 text-[13.5px] text-muted">Si no lleva nada especial, se toma de bodega lo que haya disponible.</p>
                  )}
                </div>
              ) : null}
            </StepBox>
          ) : null}

          {step === 2 ? (
            <StepBox title="¿Cuándo se entrega y cuánto paga?">
              <div className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Fecha de entrega" required error={errors.promisedDate} htmlFor="w-date" hint={promisedDate ? `Es ${formatDate(promisedDate)}.` : undefined}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input id="w-date" type="date" value={promisedDate} min={todayISO()} onChange={(e) => setPromisedDate(e.target.value)} className="w-auto" invalid={!!errors.promisedDate} />
                      {[8, 15, 30].map((d) => (
                        <Button key={d} size="sm" variant="soft" onClick={() => setPromisedDate(addDays(todayISO(), d))}>
                          {d} días
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <div>
                    <p className="mb-1.5 text-[14px] font-semibold text-ink-soft">Prioridad</p>
                    <Segmented label="Prioridad" value={priority} onChange={setPriority} options={(['normal', 'alta', 'urgente'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))} />
                  </div>
                  <div className="md:col-span-2">
                    <p className="mb-1.5 text-[14px] font-semibold text-ink-soft">¿Cómo se entrega?</p>
                    <Segmented label="Forma de entrega" value={deliveryMethod} onChange={setDeliveryMethod} options={DELIVERY_METHODS.map((m) => ({ value: m, label: DELIVERY_SHORT[m] }))} />
                  </div>
                  {deliveryMethod !== 'recoge' ? (
                    <Field label="Dirección de entrega" required={deliveryMethod === 'domicilio'} error={errors.deliveryAddress} htmlFor="w-addr" className="md:col-span-2">
                      <Input id="w-addr" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} invalid={!!errors.deliveryAddress} />
                    </Field>
                  ) : null}
                  <Field label="Nota para el taller" htmlFor="w-notes" className="md:col-span-2">
                    <Input id="w-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: empacar por curso" />
                  </Field>
                </div>

                <div className="stitch-x text-line-strong" aria-hidden />

                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Descuento" error={errors.discount} htmlFor="w-disc" hint={can('pedido.descuento') ? undefined : 'Hasta 10% sin autorización.'}>
                    <div className="flex flex-wrap items-center gap-2">
                      <MoneyInput id="w-disc" value={discount} onChange={setDiscount} invalid={!!errors.discount} className="max-w-[170px]" />
                      {[5, 10].map((p) => (
                        <Button key={p} size="sm" variant="soft" onClick={() => setDiscount(Math.round((subtotal * p) / 100 / 100) * 100)}>
                          {p}%
                        </Button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Anticipo que deja hoy" error={errors.advance} htmlFor="w-adv">
                    <div className="flex flex-wrap items-center gap-2">
                      <MoneyInput id="w-adv" value={advance} onChange={setAdvance} invalid={!!errors.advance} className="max-w-[170px]" />
                      <Button size="sm" variant="soft" onClick={() => setAdvance(Math.round((total * 0.5) / 1000) * 1000)}>
                        50%
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => setAdvance(total)}>
                        Todo
                      </Button>
                    </div>
                  </Field>
                </div>
                {advance > 0 ? (
                  <div className="space-y-3">
                    <MethodChoice value={method} onChange={setMethod} />
                    {method !== 'efectivo' ? <Input aria-label="Referencia de la transacción" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referencia de la transacción (opcional)" className="max-w-md" /> : null}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-3 rounded-xl bg-linen p-4 text-center">
                  <div>
                    <p className="text-[13px] font-semibold text-muted">Total del pedido</p>
                    <p className="num text-[20px] font-extrabold">{formatCOP(total)}</p>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-muted">Queda debiendo</p>
                    <p className={`num text-[20px] font-extrabold ${balance > 0 ? 'text-warn-700' : 'text-ok-700'}`}>{formatCOP(Math.max(balance, 0))}</p>
                  </div>
                </div>
              </div>
            </StepBox>
          ) : null}

          {step === 3 ? (
            <StepBox title="Revisa y confirma">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ReviewBlock title="Cliente" onEdit={() => setStep(0)}>
                    {customer?.name}
                  </ReviewBlock>
                  <ReviewBlock title="Entrega y pago" onEdit={() => setStep(2)}>
                    {formatDate(promisedDate)} · {DELIVERY_SHORT[deliveryMethod]} · anticipo {formatCOP(advance)}
                  </ReviewBlock>
                </div>
                <ReviewBlock title={`Productos (${lines.reduce((a, l) => a + l.quantity, 0)} unidades)`} onEdit={() => setStep(1)}>
                  <ul className="mt-1 space-y-1">
                    {lines.map((l) => (
                      <li key={l.variant.id} className="flex justify-between gap-3 text-[14.5px]">
                        <span>
                          {l.quantity} × {l.variant.label}
                          {l.custom.logo || l.custom.technique !== 'ninguna' ? <span className="ml-2 text-[13px] font-semibold text-violet-700">Personalizado</span> : null}
                        </span>
                        <span className="num">{formatCOP(l.quantity * l.unitPrice)}</span>
                      </li>
                    ))}
                  </ul>
                </ReviewBlock>
                <div>
                  <p className="mb-1.5 text-[14px] font-semibold text-ink-soft">¿Cómo queda el pedido?</p>
                  <Segmented
                    label="Estado del pedido"
                    value={status}
                    onChange={setStatus}
                    options={[
                      { value: 'confirmado', label: 'Confirmado' },
                      { value: 'pendiente', label: 'Por confirmar' },
                      { value: 'borrador', label: 'Cotización' },
                    ]}
                  />
                  <p className="mt-1.5 text-[13.5px] text-muted">{STATUS_HELP[status]}</p>
                </div>
                {errors.submit ? (
                  <Notice tone="risk" title="No se pudo guardar el pedido">
                    {errors.submit}
                  </Notice>
                ) : null}
              </div>
            </StepBox>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
            <Button variant="secondary" icon={ChevronLeft} onClick={() => (step ? setStep(step - 1) : confirmLeave() && nav('/pedidos'))}>
              {step ? 'Paso anterior' : 'Cancelar'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={next} size="lg">
                Siguiente: {STEPS[step + 1]}
                <ChevronRight className="h-5 w-5" aria-hidden />
              </Button>
            ) : (
              <Button size="lg" variant="success" icon={Check} loading={submit.isPending} onClick={onSubmit}>
                {status === 'confirmado' ? 'Confirmar pedido' : status === 'pendiente' ? 'Guardar por confirmar' : 'Guardar borrador'}
              </Button>
            )}
          </div>
        </Card>

        {/* Resumen siempre visible */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card title="Resumen">
            <dl className="space-y-2.5 text-[14.5px]">
              <div>
                <dt className="text-[13px] font-semibold text-muted">Cliente</dt>
                <dd className="font-semibold">{customer?.name ?? <span className="font-normal text-muted">Sin seleccionar</span>}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">Productos</dt>
                <dd>{lines.length ? `${lines.length} referencia(s) · ${lines.reduce((a, l) => a + l.quantity, 0)} unidades` : <span className="text-muted">Ninguno</span>}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold text-muted">Entrega</dt>
                <dd>{formatDate(promisedDate)}</dd>
              </div>
              <div className="stitch-x my-2 text-line-strong" aria-hidden />
              <SummaryRow label="Subtotal" value={formatCOP(subtotal)} />
              {discount ? <SummaryRow label="Descuento" value={`− ${formatCOP(discount)}`} /> : null}
              <SummaryRow label="Total" value={formatCOP(total)} big />
              {advance ? <SummaryRow label="Anticipo" value={formatCOP(advance)} /> : null}
              <SummaryRow label="Saldo" value={formatCOP(Math.max(balance, 0))} />
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Stepper({ step, onGo }: { step: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="Pasos del pedido" className="mb-6 overflow-x-auto">
      <ol className="flex min-w-[640px] items-center">
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={s} className="flex flex-1 items-center last:flex-none">
              <button type="button" onClick={() => onGo(i)} className="flex items-center gap-2 rounded-lg py-1 pr-2 text-left" aria-current={active ? 'step' : undefined}>
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${active ? 'bg-petrol-600 text-white ring-4 ring-petrol-100' : done ? 'bg-teal-500 text-white' : 'border-2 border-line-strong bg-surface text-muted'}`}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={`whitespace-nowrap text-[14px] font-semibold ${active ? 'text-petrol-700' : done ? 'text-ink' : 'text-muted'}`}>{s}</span>
              </button>
              {i < STEPS.length - 1 ? <span className={`stitch-x mx-1 flex-1 ${done ? 'text-teal-500' : 'text-line-strong'}`} aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepBox({ title, text, children }: { title: string; text?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[21px] font-extrabold">{title}</h2>
      {text ? <p className="mb-5 mt-1 text-muted">{text}</p> : <div className="mb-5" />}
      {children}
    </div>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg bg-risk-50 px-3 py-2 text-[14px] font-semibold text-risk-700" role="alert">
      {text}
    </p>
  );
}

function SummaryRow({ label, value, big, muted }: { label: React.ReactNode; value: string; big?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={big ? 'font-bold' : 'text-ink-soft'}>{label}</span>
      <span className={`num ${big ? 'text-[20px] font-extrabold' : muted ? 'text-muted' : 'font-semibold'}`}>{value}</span>
    </div>
  );
}

function ReviewBlock({ title, children, onEdit }: { title: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-muted">{title}</p>
        <button className="text-[13.5px] font-semibold text-petrol-700 hover:underline" onClick={onEdit}>
          Cambiar
        </button>
      </div>
      <div className="mt-1 font-medium">{children}</div>
    </div>
  );
}

function LinesEditor({ lines, setLines }: { lines: Line[]; setLines: React.Dispatch<React.SetStateAction<Line[]>> }) {
  if (!lines.length) return <p className="stitch-border mt-4 rounded-xl px-4 py-6 text-center text-muted">Todavía no has agregado productos.</p>;
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="mt-5">
      <h3 className="mb-2 font-bold">Productos agregados</h3>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {lines.map((l, i) => (
          <li key={l.variant.id} className="flex flex-col gap-3 p-3.5 md:flex-row md:items-center">
            <div className="flex-1">
              <p className="font-semibold">{l.variant.label}</p>
              <p className="text-[13px] text-muted">
                {l.variant.type === 'servicio' ? 'Servicio' : `${l.variant.available} disponibles en bodega`}
                {l.unitPrice !== l.variant.price ? <span className="ml-2 font-semibold text-warn-700">Precio cambiado (lista {formatCOP(l.variant.price)})</span> : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <QtyInput value={l.quantity} onChange={(v) => update(i, { quantity: v })} min={1} aria-label={`Cantidad de ${l.variant.label}`} />
              <div className="w-36">
                <MoneyInput value={l.unitPrice} onChange={(v) => update(i, { unitPrice: v })} aria-label={`Precio unitario de ${l.variant.label}`} />
              </div>
              <span className="num w-28 text-right font-bold">{formatCOP(l.quantity * l.unitPrice)}</span>
              <button className="rounded-lg p-2 text-muted hover:bg-risk-50 hover:text-risk-700" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${l.variant.label}`}>
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomEditor({ lines, setLines }: { lines: Line[]; setLines: React.Dispatch<React.SetStateAction<Line[]>> }) {
  const products = lines.filter((l) => l.variant.type !== 'servicio');
  const [same, setSame] = useState(true);
  const first = products[0]?.custom ?? emptyCustom();
  const setCustom = (id: number | 'all', patch: Partial<Custom>) =>
    setLines((ls) => ls.map((l) => (l.variant.type !== 'servicio' && (id === 'all' || l.variant.id === id) ? { ...l, custom: { ...l.custom, ...patch } } : l)));
  if (!products.length) return <Notice tone="petrol">Este pedido solo tiene servicios. Puedes continuar.</Notice>;
  const form = (c: Custom, id: number | 'all') => (
    <div className="space-y-4">
      <Checkbox checked={c.logo} onChange={(v) => setCustom(id, { logo: v, technique: v && c.technique === 'ninguna' ? 'bordado' : c.technique })} label="Lleva logo o escudo" />
      <div>
        <p className="mb-2 text-[14px] font-semibold text-ink-soft">Técnica</p>
        <ChoiceCards
          name={`tech-${id}`}
          columns={4}
          value={c.technique}
          onChange={(t) => setCustom(id, { technique: t })}
          options={[
            { value: 'ninguna', label: 'Ninguna', description: 'Prenda sin marcar' },
            { value: 'bordado', label: 'Bordado' },
            { value: 'estampado', label: 'Estampado' },
            { value: 'sublimado', label: 'Sublimado' },
          ]}
        />
      </div>
      {c.technique !== 'ninguna' || c.logo ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ubicación del logo" htmlFor={`pos-${id}`}>
            <Select id={`pos-${id}`} value={c.position} onChange={(e) => setCustom(id, { position: e.target.value })}>
              <option value="">Elegir…</option>
              {['Pecho izquierdo', 'Pecho derecho', 'Centro del pecho', 'Espalda', 'Manga', 'Pierna izquierda'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Nombres o números" hint="Uno por línea o separados por coma." htmlFor={`names-${id}`}>
            <Input id={`names-${id}`} value={c.names} onChange={(e) => setCustom(id, { names: e.target.value })} />
          </Field>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Medidas especiales" htmlFor={`meas-${id}`}>
          <Input id={`meas-${id}`} value={c.measures} onChange={(e) => setCustom(id, { measures: e.target.value })} placeholder="Ej: largo de manga +2 cm" />
        </Field>
        <Field label="Notas para producción" htmlFor={`cnotes-${id}`}>
          <Input id={`cnotes-${id}`} value={c.notes} onChange={(e) => setCustom(id, { notes: e.target.value })} placeholder="Ej: archivo del logo enviado por WhatsApp" />
        </Field>
      </div>
    </div>
  );
  return (
    <div className="space-y-5">
      {products.length > 1 ? (
        <Checkbox
          checked={same}
          onChange={(v) => {
            setSame(v);
            if (v) setCustom('all', first);
          }}
          label="Aplicar la misma personalización a todos los productos"
          description="Desmárcalo si cada producto lleva algo diferente."
        />
      ) : null}
      {same || products.length === 1 ? (
        form(first, 'all')
      ) : (
        <div className="space-y-4">
          {products.map((l) => (
            <details key={l.variant.id} className="rounded-xl border border-line p-4" open>
              <summary className="cursor-pointer font-bold">{l.variant.label}</summary>
              <div className="mt-4">{form(l.custom, l.variant.id)}</div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Success({ created, hasCustom }: { created: { id: number; number: string; status: string }; hasCustom: boolean }) {
  const toast = useToast();
  const nav = useNavigate();
  const { can, access } = useAuth();
  const [sending, setSending] = useState(false);
  const toProduction = async () => {
    setSending(true);
    try {
      const po = await api.post<{ id: number; number: string }>('/production', { orderId: created.id, targetDate: addDays(todayISO(), 10), priority: 'normal' });
      toast.success(`Orden de producción ${po.number} creada`);
      // Si el rol no ve el módulo de producción, se queda en el pedido (allí ve el avance).
      nav(access('produccion') ? `/produccion/${po.id}` : `/pedidos/${created.id}`);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setSending(false);
    }
  };
  const confirmed = created.status === 'confirmado';
  const label = useMemo(() => (created.status === 'confirmado' ? 'confirmado' : created.status === 'pendiente' ? 'guardado como “por confirmar”' : 'guardado como borrador'), [created.status]);
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card>
        <div className="flex flex-col items-center px-2 py-6 text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-ok-50 text-ok-500">
            <CheckCircle2 className="h-9 w-9" />
          </span>
          <h1 className="text-[26px] font-extrabold">Pedido {created.number} {label}</h1>
          <p className="mt-2 max-w-md text-muted">
            {confirmed ? (hasCustom ? 'Tiene productos personalizados: el siguiente paso es enviarlo a producción.' : 'Lo disponible en bodega quedó separado para este cliente.') : 'Puedes confirmarlo cuando el cliente apruebe.'}
          </p>
          <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {confirmed && can('pedido.editar') ? (
              <Button size="lg" icon={Factory} loading={sending} onClick={toProduction}>
                Enviar a producción
              </Button>
            ) : null}
            <ButtonLink to={`/pedidos/${created.id}`} size="lg" variant={confirmed ? 'secondary' : 'primary'}>
              Ver el pedido
            </ButtonLink>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="ghost" icon={Printer} onClick={() => window.open(`/imprimir/pedido/${created.id}`, '_blank')}>
              Imprimir comprobante
            </Button>
            <ButtonLink to="/pedidos/nuevo" reloadDocument variant="ghost" icon={Zap}>
              Crear otro pedido
            </ButtonLink>
          </div>
        </div>
      </Card>
      <p className="mt-3 text-center text-[13px] text-muted">El comprobante de pedido no es una factura fiscal.</p>
    </div>
  );
}
