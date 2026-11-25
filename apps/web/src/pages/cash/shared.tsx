import { formatCOP, formatDate, todayISO, type PaymentMethod } from '@nexo/shared';
import { Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Overlay';
import { api, ApiError } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import type { Settings, Supplier } from '@/lib/types';
import { MethodChoice } from '../orders/shared';

export interface PayableRow {
  id: number;
  number: string;
  supplierId: number | null;
  supplierName: string | null;
  purchaseId: number | null;
  category: string;
  concept: string;
  amount: number;
  paid: number;
  balance: number;
  dueDate: string;
  status: string;
  daysToDue: number;
}

export function PayPayableModal({ open, onClose, payable }: { open: boolean; onClose: () => void; payable: Pick<PayableRow, 'id' | 'number' | 'concept' | 'balance' | 'supplierName'> }) {
  const [amount, setAmount] = useState(payable.balance);
  const [method, setMethod] = useState<PaymentMethod>('transferencia');
  const [reference, setReference] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setAmount(payable.balance);
      setErr(null);
    }
  }, [open, payable.balance]);
  const pay = useAction((b: object) => api.post(`/payables/${payable.id}/pay`, b), { success: 'Pago registrado. Se anotó la salida de dinero en caja.', silentError: true, onSuccess: onClose });
  const invalid = amount <= 0 || amount > payable.balance;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Pagar · ${payable.concept}`}
      description={payable.supplierName ?? undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Wallet} disabled={invalid} loading={pay.isPending} onClick={() => pay.mutate({ amount, method, reference }, { onError: (e: ApiError) => setErr(e.message) })}>
            Pagar {formatCOP(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-linen p-3 text-[15px]">
          Saldo por pagar: <strong className="num">{formatCOP(payable.balance)}</strong>
        </p>
        <Field label="Valor que pagas" required error={amount > payable.balance ? `El máximo es ${formatCOP(payable.balance)}.` : null} htmlFor="pp-amount">
          <MoneyInput id="pp-amount" value={amount} onChange={setAmount} autoFocus invalid={amount > payable.balance} />
        </Field>
        <div>
          <p className="mb-2 text-[14px] font-semibold text-ink-soft">¿Cómo pagas?</p>
          <MethodChoice value={method} onChange={setMethod} />
        </div>
        {method !== 'efectivo' ? (
          <Field label="Referencia" htmlFor="pp-ref">
            <Input id="pp-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        ) : null}
        {err ? <Notice tone="risk">{err}</Notice> : null}
      </div>
    </Modal>
  );
}

/** Registrar una obligación (gasto por pagar más adelante). */
export function NewPayableModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: settings } = useApi<Settings>('/settings');
  const { data: suppliers } = useApi<Supplier[]>(open ? '/suppliers' : null);
  const [supplierId, setSupplierId] = useState('');
  const [category, setCategory] = useState('');
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState(0);
  const [dueDate, setDueDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open && settings && !category) setCategory(settings.expenseCategories[0]);
  }, [open, settings, category]);
  const save = useAction((b: object) => api.post('/payables', b), {
    success: 'Cuenta por pagar registrada',
    silentError: true,
    onSuccess: () => {
      setConcept('');
      setAmount(0);
      setNotes('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Registrar cuenta por pagar"
      description={`Un gasto que se pagará después. Vencerá el ${formatDate(dueDate)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate({ supplierId: supplierId ? Number(supplierId) : null, category, concept, amount, dueDate, notes }, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}>
            Guardar cuenta por pagar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {errors._ ? <p className="rounded-lg bg-risk-50 px-3 py-2 font-semibold text-risk-700 sm:col-span-2">{errors._}</p> : null}
        <Field label="Concepto" required error={errors.concept} htmlFor="np-c" className="sm:col-span-2">
          <Input id="np-c" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej: Servicio de vigilancia noviembre" invalid={!!errors.concept} />
        </Field>
        <Field label="Categoría" required htmlFor="np-cat">
          <Select id="np-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {settings?.expenseCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Proveedor" htmlFor="np-sup">
          <Select id="np-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Sin proveedor</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Valor" required error={errors.amount} htmlFor="np-a">
          <MoneyInput id="np-a" value={amount} onChange={setAmount} invalid={!!errors.amount} />
        </Field>
        <Field label="Fecha de vencimiento" required htmlFor="np-d">
          <Input id="np-d" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Notas" htmlFor="np-n" className="sm:col-span-2">
          <Textarea id="np-n" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
