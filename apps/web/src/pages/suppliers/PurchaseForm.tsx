import { addDays, formatCOP, formatDate, formatQty, todayISO, type PaymentMethod } from '@nexo/shared';
import { PackagePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader } from '@/components/ui/Layout';
import { VariantPicker } from '@/components/ui/Pickers';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Supplier, VariantOption } from '@/lib/types';
import { MethodChoice } from '../orders/shared';

interface Line {
  v: VariantOption;
  quantity: string;
  unitCost: number;
}

export default function PurchaseForm() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { data: suppliers } = useApi<Supplier[]>('/suppliers');
  const [supplierId, setSupplierId] = useState(params.get('proveedor') ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [payNow, setPayNow] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [error, setError] = useState<string | null>(null);
  const supplier = suppliers?.find((s) => String(s.id) === supplierId);

  useEffect(() => {
    if (supplier) setDueDate(addDays(date, supplier.paymentTermDays));
  }, [supplier, date]);

  // Precargar desde "Reposición"
  const preMaterial = params.get('material');
  useEffect(() => {
    if (!preMaterial) return;
    api.get<VariantOption[]>(`/products/variants/search?types=materia_prima,insumo,terminado`).then((vs) => {
      const v = vs.find((x) => String(x.id) === preMaterial);
      if (v) setLines([{ v, quantity: params.get('cantidad') ?? '1', unitCost: v.cost }]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preMaterial]);

  const subtotal = Math.round(lines.reduce((a, l) => a + (Number(l.quantity.replace(',', '.')) || 0) * l.unitCost, 0));
  const total = Math.max(0, subtotal - discount);
  useEffect(() => {
    if (payNow) setPayAmount(total);
  }, [payNow, total]);

  const save = useAction(
    () =>
      api.post<{ id: number; number: string }>('/purchases', {
        supplierId: Number(supplierId),
        items: lines.map((l) => ({ variantId: l.v.id, quantity: Number(l.quantity.replace(',', '.')), unitCost: l.unitCost })),
        discount,
        date,
        dueDate: dueDate || null,
        notes: notes || null,
        payNow: payNow && payAmount > 0 ? { amount: payAmount, method } : null,
      }),
    { success: (r) => `Compra ${r.number} registrada. Cuando llegue la mercancía, confirma la recepción.`, silentError: true, onSuccess: (r) => nav(`/compras/${r.id}`) },
  );
  const problems = [!supplierId && 'Selecciona el proveedor.', !lines.length && 'Agrega al menos un material.', lines.some((l) => !(Number(l.quantity.replace(',', '.')) > 0)) && 'Revisa las cantidades.', lines.some((l) => l.unitCost <= 0) && 'Escribe el costo de cada material.'].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Nueva compra" description="Registra lo que le pides al proveedor. El inventario solo sube cuando confirmes que llegó." back={{ to: '/proveedores?tab=compras', label: 'Compras' }} />
      <div className="space-y-6">
        <Card title="1. Proveedor">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Proveedor" required htmlFor="pf-sup" className="sm:col-span-3">
              <Select id="pf-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Selecciona…</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.supplies}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha de la compra" required htmlFor="pf-date">
              <Input id="pf-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Fecha para pagar" htmlFor="pf-due" hint={supplier ? (supplier.paymentTermDays ? `Plazo del proveedor: ${supplier.paymentTermDays} días` : 'Proveedor de contado') : undefined}>
              <Input id="pf-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card title="2. Materiales que pides">
          <VariantPicker
            types={['materia_prima', 'insumo', 'terminado']}
            showStock
            placeholder="Buscar tela, hilo, botones, medias…"
            pickedIds={lines.map((l) => l.v.id)}
            onPick={(v) => setLines((ls) => (ls.some((l) => l.v.id === v.id) ? ls : [...ls, { v, quantity: '1', unitCost: v.cost }]))}
          />
          {lines.length ? (
            <div className="mt-5 overflow-x-auto rounded-xl border border-line">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Material</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Costo por unidad</th>
                    <th className="text-right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.v.id}>
                      <td>
                        <p className="font-semibold">{l.v.label}</p>
                        <p className="text-[12.5px] text-muted">
                          Hay {formatQty(l.v.stock)} {l.v.unit} · último costo {formatCOP(l.v.cost)}
                        </p>
                      </td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <Input inputMode="decimal" className="num h-10 w-24 text-right" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label={`Cantidad de ${l.v.label}`} />
                          <span className="text-[13px] text-muted">{l.v.unit}</span>
                        </span>
                      </td>
                      <td className="text-right">
                        <MoneyInput value={l.unitCost} onChange={(n) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: n } : x)))} className="ml-auto h-10 max-w-[140px]" aria-label={`Costo de ${l.v.label}`} />
                      </td>
                      <td className="num text-right font-bold">{formatCOP((Number(l.quantity.replace(',', '.')) || 0) * l.unitCost)}</td>
                      <td>
                        <button className="rounded p-1.5 text-muted hover:text-risk-700" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Quitar ${l.v.label}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card title="3. Valor y pago">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-ink-soft">Subtotal</span>
                <span className="num font-semibold">{formatCOP(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="pf-disc" className="text-ink-soft">
                  Descuento del proveedor
                </label>
                <MoneyInput id="pf-disc" value={discount} onChange={setDiscount} className="h-10 max-w-[160px]" />
              </div>
              <div className="flex justify-between border-t border-line pt-2">
                <span className="font-bold">Total de la compra</span>
                <span className="num text-[22px] font-extrabold">{formatCOP(total)}</span>
              </div>
              <Field label="Notas" htmlFor="pf-notes">
                <Textarea id="pf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <div className="space-y-3">
              <Checkbox checked={payNow} onChange={setPayNow} label="Pago ahora (todo o una parte)" description={payNow ? undefined : `Si no, queda como cuenta por pagar${dueDate ? ` con vencimiento ${formatDate(dueDate)}` : ''}.`} />
              {payNow ? (
                <>
                  <Field label="Valor que pagas hoy" htmlFor="pf-pay">
                    <MoneyInput id="pf-pay" value={payAmount} onChange={setPayAmount} />
                  </Field>
                  <MethodChoice value={method} onChange={setMethod} />
                </>
              ) : null}
            </div>
          </div>
        </Card>
        {error ? (
          <Notice tone="risk" title="No se pudo guardar la compra">
            {error}
          </Notice>
        ) : null}
        {problems.length && lines.length ? <Notice tone="warn">{problems.join(' ')}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => nav(-1)}>
            Cancelar
          </Button>
          <Button size="lg" icon={PackagePlus} disabled={problems.length > 0} loading={save.isPending} onClick={() => save.mutate(undefined, { onError: (e: ApiError) => setError(e.message) })}>
            Registrar compra de {formatCOP(total)}
          </Button>
        </div>
      </div>
    </div>
  );
}
