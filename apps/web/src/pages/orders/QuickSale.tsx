import { addDays, formatCOP, PAYMENT_METHOD_LABELS, todayISO, type PaymentMethod } from '@nexo/shared';
import { CheckCircle2, Plus, Printer, ShoppingCart, Trash2, UserRound, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, MoneyInput, QtyInput, Select } from '@/components/ui/Form';
import { Card, PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Overlay';
import { CustomerPicker, VariantPicker } from '@/components/ui/Pickers';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useLeaveGuard } from '@/lib/hooks';
import type { Customer, VariantOption } from '@/lib/types';
import { MethodChoice } from './shared';

interface CartLine {
  v: VariantOption;
  quantity: number;
  unitPrice: number;
}

export default function QuickSale() {
  const { can } = useAuth();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [received, setReceived] = useState(0);
  const [split, setSplit] = useState(false);
  const [method2, setMethod2] = useState<PaymentMethod>('nequi');
  const [amount2, setAmount2] = useState(0);
  const [credit, setCredit] = useState(false);
  const [creditPaid, setCreditPaid] = useState(0);
  const [dueDate, setDueDate] = useState(addDays(todayISO(), 30));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: number; number: string; change: number; paymentId?: number } | null>(null);
  const { data: cash } = useApi<{ open: boolean }>('/cash/current');
  useLeaveGuard(cart.length > 0 && !done, 'Hay productos en la venta sin cobrar. ¿Seguro que quieres salir?');

  const subtotal = cart.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const total = Math.max(0, subtotal - discount);
  const paysCash = method === 'efectivo' || (split && method2 === 'efectivo');

  // Pagos que se envían
  let payments: Array<{ amount: number; method: PaymentMethod }> = [];
  let change = 0;
  if (credit) {
    payments = creditPaid > 0 ? [{ amount: creditPaid, method }] : [];
  } else if (split) {
    const first = Math.max(0, total - amount2);
    payments = [
      { amount: first, method },
      { amount: amount2, method: method2 },
    ].filter((p) => p.amount > 0);
  } else {
    payments = total > 0 ? [{ amount: total, method }] : [];
    if (method === 'efectivo' && received > total) change = received - total;
  }

  const problems: string[] = [];
  if (!cart.length) problems.push('Agrega al menos un producto.');
  if (cart.some((l) => l.quantity > l.v.available)) problems.push('Hay productos con más unidades que las disponibles.');
  if (discount > subtotal) problems.push('El descuento no puede superar el valor de la venta.');
  if (!can('pedido.descuento') && subtotal && discount > subtotal * 0.1) problems.push('Tu usuario puede dar hasta 10% de descuento.');
  if (credit && !customer) problems.push('Para vender a crédito selecciona el cliente.');
  if (credit && creditPaid > total) problems.push('El abono no puede superar el total.');
  if (split && amount2 > total) problems.push('El segundo pago no puede superar el total.');
  if (!credit && !split && method === 'efectivo' && received > 0 && received < total) problems.push(`El efectivo recibido no alcanza: faltan ${formatCOP(total - received)}.`);
  if (paysCash && cash && !cash.open) problems.push('La caja está cerrada: ábrela para recibir efectivo o elige otro método.');

  const sell = useAction(
    () =>
      api.post<{ id: number; number: string }>('/orders/quick-sale', {
        customerId: customer?.id ?? null,
        items: cart.map((l) => ({ variantId: l.v.id, quantity: l.quantity, unitPrice: l.unitPrice })),
        discount,
        payments,
        dueDate: credit ? dueDate : null,
      }),
    {
      silentError: true,
      onSuccess: async (r) => {
        const d = await api.get<{ payments: Array<{ id: number }> }>(`/orders/${r.id}`).catch(() => null);
        setDone({ id: r.id, number: r.number, change, paymentId: d?.payments[0]?.id });
      },
    },
  );

  const reset = () => {
    setCart([]);
    setCustomer(null);
    setDiscount(0);
    setReceived(0);
    setSplit(false);
    setAmount2(0);
    setCredit(false);
    setCreditPaid(0);
    setError(null);
    setDone(null);
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl py-6">
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-ok-50 text-ok-500">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <h1 className="text-[26px] font-extrabold">Venta {done.number} registrada</h1>
            <p className="mt-1 text-muted">El inventario y la caja ya quedaron actualizados.</p>
            {done.change > 0 ? (
              <div className="mt-5 rounded-2xl bg-teal-50 px-8 py-4">
                <p className="text-[14px] font-semibold text-teal-700">Cambio para el cliente</p>
                <p className="num text-[34px] font-extrabold text-teal-700">{formatCOP(done.change)}</p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button size="lg" icon={Plus} onClick={reset}>
                Nueva venta
              </Button>
              <Button size="lg" variant="secondary" icon={Printer} onClick={() => window.open(`/imprimir/pedido/${done.id}`, '_blank')}>
                Imprimir comprobante
              </Button>
            </div>
            <Link to={`/pedidos/${done.id}`} className="mt-4 text-[14px] font-semibold text-petrol-700 hover:underline">
              Ver detalle de la venta
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Vender" icon={Zap} description="Toca el producto, elige la talla y cobra." back={{ to: '/pedidos?tipo=venta', label: 'Ventas' }} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card title="1. Busca y toca los productos">
          <VariantPicker
            types={['terminado']}
            onlyAvailable
            autoFocus
            pickedIds={cart.map((l) => l.v.id)}
            onPick={(v) =>
              setCart((c) => {
                const i = c.findIndex((l) => l.v.id === v.id);
                if (i >= 0) return c.map((l, j) => (j === i ? { ...l, quantity: Math.min(l.quantity + 1, v.available) } : l));
                return [...c, { v, quantity: 1, unitPrice: v.price }];
              })
            }
          />
        </Card>

        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card title="2. Cobrar" subtitle={customer ? customer.name : 'Cliente de mostrador'} actions={<Button size="sm" variant="soft" icon={UserRound} onClick={() => setPickCustomer(true)}>{customer ? 'Cambiar cliente' : 'Agregar cliente'}</Button>}>
            {cart.length ? (
              <ul className="mb-4 divide-y divide-line">
                {cart.map((l, i) => (
                  <li key={l.v.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[14.5px] font-semibold leading-snug">{l.v.label}</p>
                      <button className="rounded p-1 text-muted hover:text-risk-700" onClick={() => setCart((c) => c.filter((_, j) => j !== i))} aria-label={`Quitar ${l.v.label}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <QtyInput value={l.quantity} min={1} max={l.v.available} onChange={(q) => setCart((c) => c.map((x, j) => (j === i ? { ...x, quantity: q } : x)))} aria-label={`Cantidad de ${l.v.label}`} />
                      <span className="text-[12.5px] text-muted">de {l.v.available} disp.</span>
                      <span className="num font-bold">{formatCOP(l.quantity * l.unitPrice)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="stitch-border mb-4 flex flex-col items-center rounded-xl px-4 py-8 text-center text-muted">
                <ShoppingCart className="mb-2 h-7 w-7" aria-hidden />
                Toca un producto de la izquierda para agregarlo.
              </div>
            )}

            <div className="space-y-2 text-[15px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-soft">Subtotal</span>
                <span className="num font-semibold">{formatCOP(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="qs-disc" className="text-ink-soft">
                  Descuento
                </label>
                <MoneyInput id="qs-disc" value={discount} onChange={setDiscount} className="h-9 max-w-[150px]" />
              </div>
              <div className="flex items-center justify-between border-t border-line pt-2">
                <span className="text-[17px] font-bold">Total a cobrar</span>
                <span className="num text-[26px] font-extrabold">{formatCOP(total)}</span>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-[14px] font-semibold text-ink-soft">¿Cómo paga?</p>
              <MethodChoice value={method} onChange={setMethod} />
              {!credit && !split && method === 'efectivo' ? (
                <Field label="Efectivo recibido" hint={received > total ? <span className="font-semibold text-teal-700">Devolver de cambio: {formatCOP(received - total)}</span> : 'Escríbelo para calcular el cambio.'} htmlFor="qs-recv">
                  <div className="flex flex-wrap gap-2">
                    <MoneyInput id="qs-recv" value={received} onChange={setReceived} className="max-w-[170px]" />
                    {[total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000]
                      .filter((v, i, a) => v > 0 && a.indexOf(v) === i)
                      .slice(0, 3)
                      .map((v) => (
                        <Button key={v} size="sm" variant="soft" onClick={() => setReceived(v)}>
                          {formatCOP(v)}
                        </Button>
                      ))}
                  </div>
                </Field>
              ) : null}
              <details className="group rounded-lg border border-line px-3 py-2" open={split || credit}>
                <summary className="cursor-pointer text-[14px] font-semibold text-petrol-700">Otras formas de cobro (dos métodos o a crédito)</summary>
                <div className="mt-2 space-y-2">
              {!credit ? <Checkbox checked={split} onChange={setSplit} label="Paga con dos métodos" /> : null}
              {split && !credit ? (
                <div className="grid grid-cols-2 gap-2">
                  <Select aria-label="Segundo método" value={method2} onChange={(e) => setMethod2(e.target.value as PaymentMethod)}>
                    {(['efectivo', 'transferencia', 'tarjeta', 'nequi', 'otro'] as PaymentMethod[]).map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <MoneyInput value={amount2} onChange={setAmount2} aria-label="Valor del segundo método" />
                  <p className="col-span-2 text-[13px] text-muted">
                    {PAYMENT_METHOD_LABELS[method]}: {formatCOP(Math.max(0, total - amount2))} + {PAYMENT_METHOD_LABELS[method2]}: {formatCOP(amount2)}
                  </p>
                </div>
              ) : null}
              <Checkbox checked={credit} onChange={(v) => { setCredit(v); if (v) setSplit(false); }} label="Dejar saldo pendiente (venta a crédito)" description="Requiere seleccionar el cliente." />
              {credit ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Abono hoy" htmlFor="qs-abono">
                    <MoneyInput id="qs-abono" value={creditPaid} onChange={setCreditPaid} />
                  </Field>
                  <Field label="Paga el resto antes del" required htmlFor="qs-due">
                    <Input id="qs-due" type="date" value={dueDate} min={todayISO()} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                  <p className="col-span-2 text-[14px] font-semibold text-warn-700">Queda debiendo {formatCOP(Math.max(0, total - creditPaid))}</p>
                </div>
              ) : null}
                </div>
              </details>
            </div>

            {problems.length && cart.length ? (
              <div className="mt-4">
                <Notice tone="warn">
                  <ul className="list-inside list-disc">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            ) : null}
            {error ? (
              <div className="mt-4">
                <Notice tone="risk" title="No se pudo registrar la venta">
                  {error}
                </Notice>
              </div>
            ) : null}
            <Button
              size="lg"
              variant="success"
              className="mt-4 w-full"
              icon={CheckCircle2}
              disabled={problems.length > 0}
              loading={sell.isPending}
              onClick={() => {
                setError(null);
                sell.mutate(undefined, { onError: (e: ApiError) => setError(e.message) });
              }}
            >
              Confirmar venta de {formatCOP(total)}
            </Button>
          </Card>
        </div>
      </div>

      <Modal open={pickCustomer} onClose={() => setPickCustomer(false)} title="Cliente de la venta" description="Es opcional. Sirve para el historial del cliente y para vender a crédito." size="lg">
        <CustomerPicker
          value={null}
          allowEmpty
          onChange={(c) => {
            setCustomer(c);
            setPickCustomer(false);
          }}
        />
      </Modal>
    </div>
  );
}
