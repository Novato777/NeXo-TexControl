// Modales reutilizados por pedidos, entregas y cartera.
import { formatCOP, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@nexo/shared';
import { Banknote, Copy, CreditCard, ExternalLink, Landmark, MessageCircle, Printer, Smartphone, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Feedback';
import { Checkbox, ChoiceCards, Field, Input, MoneyInput, QtyInput, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { useToast } from '@/lib/toast';

export const METHOD_ICONS: Record<PaymentMethod, typeof Wallet> = { efectivo: Banknote, transferencia: Landmark, tarjeta: CreditCard, nequi: Smartphone, otro: Wallet };

const SHORT_METHOD: Record<PaymentMethod, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', nequi: 'Nequi', otro: 'Otro' };

/** Forma de pago en una sola fila compacta (ícono + nombre). */
export function MethodChoice({ value, onChange }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void }) {
  return (
    <div role="radiogroup" aria-label="Forma de pago" className="flex flex-wrap gap-1.5">
      {PAYMENT_METHODS.map((m) => {
        const Icon = METHOD_ICONS[m];
        const on = m === value;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            title={PAYMENT_METHOD_LABELS[m]}
            onClick={() => onChange(m)}
            className={`inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-btn)] border-2 px-3 text-[14px] font-semibold transition-colors ${on ? 'border-petrol-600 bg-petrol-600 text-white' : 'border-line bg-surface text-ink-soft hover:border-petrol-200'}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {SHORT_METHOD[m]}
          </button>
        );
      })}
    </div>
  );
}

/** Registrar pago o abono a un pedido. Muestra el saldo y cuánto queda después. */
export function PaymentModal({ open, onClose, order }: { open: boolean; onClose: () => void; order: { id: number; number: string; balance: number; customerName?: string | null } }) {
  const [amount, setAmount] = useState(order.balance);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [reference, setReference] = useState('');
  const [lastPaymentId, setLastPaymentId] = useState<number | null>(null);
  const { data: cash } = useApi<{ open: boolean }>(open ? '/cash/current' : null);
  useEffect(() => {
    if (open) {
      setAmount(order.balance);
      setMethod('efectivo');
      setReference('');
      setLastPaymentId(null);
    }
  }, [open, order.balance]);
  const pay = useAction((b: object) => api.post<{ id: number; number: string }>(`/orders/${order.id}/payments`, b), {
    success: (r) => `Pago registrado. Recibo ${r.number}`,
    onSuccess: (r) => setLastPaymentId(r.id),
  });
  const err = amount <= 0 ? 'Escribe un valor mayor que cero.' : amount > order.balance ? `El máximo es el saldo: ${formatCOP(order.balance)}.` : null;
  const cashClosed = method === 'efectivo' && cash && !cash.open;

  if (lastPaymentId) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Pago registrado"
        size="sm"
        footer={
          <>
            <Button variant="secondary" icon={Printer} onClick={() => window.open(`/imprimir/pago/${lastPaymentId}`, '_blank')}>
              Imprimir recibo
            </Button>
            <Button onClick={onClose}>Listo</Button>
          </>
        }
      >
        <Notice tone="ok" title={`Se registró el pago de ${formatCOP(amount)}`}>
          Saldo pendiente ahora: <strong>{formatCOP(order.balance - amount)}</strong>
        </Notice>
      </Modal>
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Registrar pago · ${order.number}`}
      description={order.customerName ?? undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" icon={Wallet} loading={pay.isPending} disabled={!!err || !!cashClosed} onClick={() => pay.mutate({ amount, method, reference })}>
            Registrar pago de {formatCOP(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-linen p-4 text-center">
          <div>
            <p className="text-[13px] font-semibold text-muted">Saldo pendiente</p>
            <p className="num text-[22px] font-extrabold">{formatCOP(order.balance)}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-muted">Quedará debiendo</p>
            <p className={`num text-[22px] font-extrabold ${order.balance - amount <= 0 ? 'text-ok-700' : 'text-warn-700'}`}>{formatCOP(Math.max(0, order.balance - amount))}</p>
          </div>
        </div>
        <Field label="Valor que paga" required error={err} hint="Puede ser un abono (parte del saldo)." htmlFor="pay-amount">
          <MoneyInput id="pay-amount" value={amount} onChange={setAmount} invalid={!!err} autoFocus />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" onClick={() => setAmount(order.balance)}>
            Todo el saldo
          </Button>
          <Button size="sm" variant="soft" onClick={() => setAmount(Math.round(order.balance / 2 / 1000) * 1000)}>
            La mitad
          </Button>
        </div>
        <div>
          <p className="mb-2 text-[14px] font-semibold text-ink-soft">¿Cómo paga?</p>
          <MethodChoice value={method} onChange={setMethod} />
        </div>
        {cashClosed ? (
          <Notice tone="warn" title="La caja está cerrada">
            Para recibir efectivo primero abre la caja en “Caja y gastos”, o elige otro método.
          </Notice>
        ) : null}
        {method !== 'efectivo' ? (
          <Field label="Referencia o número de la transacción" htmlFor="pay-ref">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej: últimos 4 dígitos o número de aprobación" />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

interface DeliveryItem {
  id: number;
  description: string;
  quantity: number;
  qtyDelivered: number;
  reserved: number;
}

/** Registrar entrega total o parcial. */
export function DeliveryModal({ open, onClose, order, items, customerName }: { open: boolean; onClose: () => void; order: { id: number; number: string; balance: number }; items: DeliveryItem[]; customerName?: string | null }) {
  const { can, money } = useAuth();
  const pending = items.filter((i) => i.quantity - i.qtyDelivered > 0);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [receivedBy, setReceivedBy] = useState('');
  const [notes, setNotes] = useState('');
  const [allowBalance, setAllowBalance] = useState(false);
  const [touched, setTouched] = useState(false);
  const [doneId, setDoneId] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setQty(Object.fromEntries(pending.map((i) => [i.id, i.quantity - i.qtyDelivered])));
      setReceivedBy('');
      setNotes('');
      setAllowBalance(false);
      setTouched(false);
      setDoneId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const total = Object.values(qty).reduce((a, b) => a + b, 0);
  const full = pending.every((i) => qty[i.id] === i.quantity - i.qtyDelivered);
  const hasBalance = order.balance > 0;
  const blocked = hasBalance && !allowBalance;
  const act = useAction((b: object) => api.post<{ id: number; number: string }>(`/orders/${order.id}/deliveries`, b), {
    success: (r) => `Entrega ${r.number} registrada`,
    onSuccess: (r) => setDoneId(r.id),
  });
  if (doneId) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="Entrega registrada"
        size="sm"
        footer={
          <>
            <Button variant="secondary" icon={Printer} onClick={() => window.open(`/imprimir/entrega/${doneId}`, '_blank')}>
              Imprimir comprobante de entrega
            </Button>
            <Button onClick={onClose}>Listo</Button>
          </>
        }
      >
        <Notice tone="ok" title={full ? 'El pedido quedó entregado completo' : 'Se registró una entrega parcial'}>
          {full ? 'El estado del pedido cambió a “Entregado”.' : 'El pedido sigue abierto con las unidades que faltan.'}
        </Notice>
      </Modal>
    );
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Registrar entrega · ${order.number}`}
      description={customerName ?? undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="success"
            loading={act.isPending}
            disabled={total <= 0 || blocked}
            onClick={() => {
              setTouched(true);
              if (!receivedBy.trim()) return;
              act.mutate({ receivedBy, notes, allowBalance, items: Object.entries(qty).map(([k, v]) => ({ orderItemId: Number(k), quantity: v })) });
            }}
          >
            {full ? 'Confirmar entrega completa' : `Confirmar entrega parcial (${total} unid.)`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {money && hasBalance ? (
          <Notice tone="warn" title={`Este pedido tiene saldo pendiente de ${formatCOP(order.balance)}`}>
            Lo ideal es cobrar antes de entregar. Si se acordó entregar con saldo, una persona autorizada debe confirmarlo.
            {can('entrega.con_saldo') ? (
              <div className="mt-2">
                <Checkbox checked={allowBalance} onChange={setAllowBalance} label="Autorizo entregar con saldo pendiente" description="Queda registrado en la auditoría con tu nombre." />
              </div>
            ) : (
              <p className="mt-1 font-semibold">Tu usuario no puede autorizarlo: registra primero el pago o pide autorización a Caja.</p>
            )}
          </Notice>
        ) : null}
        <div className="overflow-hidden rounded-xl border border-line">
          <table className="table-base">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="text-right">Por entregar</th>
                <th className="text-right">Se entregan ahora</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <tr key={i.id}>
                  <td>{i.description}</td>
                  <td className="num text-right">{i.quantity - i.qtyDelivered}</td>
                  <td className="text-right">
                    <QtyInput value={qty[i.id] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [i.id]: v }))} max={i.quantity - i.qtyDelivered} aria-label={`Cantidad a entregar de ${i.description}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="¿Quién recibe?" required error={touched && !receivedBy.trim() ? 'Escribe el nombre de quien recibe.' : null} htmlFor="del-rec">
            <Input id="del-rec" value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Nombre y cargo" />
          </Field>
          <Field label="Observaciones" htmlFor="del-notes">
            <Input id="del-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: entregado en portería" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Mensajes listos para WhatsApp: se copian o se abren en WhatsApp. No se envían solos. */
export function MessageModal({ open, onClose, orderId, template = 'recibido' }: { open: boolean; onClose: () => void; orderId: number; template?: string }) {
  const toast = useToast();
  const [tpl, setTpl] = useState(template);
  const { data } = useApi<{ text: string; phone: string; whatsappUrl: string | null }>(open ? `/orders/${orderId}/message?template=${tpl}` : null);
  const [text, setText] = useState('');
  useEffect(() => setText(data?.text ?? ''), [data]);
  const options = [
    ['recibido', 'Pedido recibido'],
    ['avance', 'Avance'],
    ['listo', 'Pedido listo'],
    ['entregado', 'Entregado'],
    ['cobro', 'Recordar saldo'],
  ] as const;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mensaje para el cliente"
      description="El sistema prepara el texto. Tú lo copias o lo abres en WhatsApp para enviarlo (la demo no envía mensajes sola)."
      footer={
        <>
          <Button
            variant="secondary"
            icon={Copy}
            onClick={async () => {
              await navigator.clipboard.writeText(text).catch(() => null);
              toast.success('Mensaje copiado. Pégalo en WhatsApp.');
            }}
          >
            Copiar mensaje
          </Button>
          {data?.whatsappUrl ? (
            <Button icon={ExternalLink} onClick={() => window.open(`https://wa.me/57${data.phone.slice(-10)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>
              Abrir WhatsApp
            </Button>
          ) : null}
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-2">
        {options.map(([k, l]) => (
          <button key={k} onClick={() => setTpl(k)} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${tpl === k ? 'border-petrol-600 bg-petrol-600 text-white' : 'border-line-strong text-ink-soft hover:bg-petrol-50'}`}>
            {l}
          </button>
        ))}
      </div>
      <Field label="Texto del mensaje (puedes editarlo)" htmlFor="msg-text" hint={data?.phone ? `Se abrirá el chat con ${data.phone}.` : 'El cliente no tiene teléfono registrado: copia el mensaje.'}>
        <Textarea id="msg-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[140px]" />
      </Field>
      <p className="mt-3 flex items-center gap-2 text-[13px] text-muted">
        <MessageCircle className="h-4 w-4" aria-hidden /> Integración oficial con WhatsApp Business: preparada para una fase futura.
      </p>
    </Modal>
  );
}
