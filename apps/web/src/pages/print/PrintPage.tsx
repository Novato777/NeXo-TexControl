// Comprobantes imprimibles (se guardan como PDF desde el diálogo de impresión del navegador).
// Ninguno es una factura electrónica.
import { DELIVERY_METHOD_LABELS, formatCOP, formatDate, formatDateTime, PAYMENT_METHOD_LABELS, type DeliveryMethod, type PaymentMethod } from '@nexo/shared';
import { Printer, X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ErrorState, Spinner } from '@/components/ui/Feedback';
import { useApi } from '@/lib/hooks';
import type { Settings } from '@/lib/types';

export default function PrintPage() {
  const { kind, id } = useParams();
  const { data: s } = useApi<Settings>('/settings');
  const path = kind === 'pedido' ? `/orders/${id}` : kind === 'pago' ? `/orders/payments/${id}` : kind === 'entrega' ? `/deliveries/${id}` : kind === 'caja' ? `/cash/sessions/${id}` : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = useApi<any>(path);
  useEffect(() => {
    document.title = 'Comprobante · TexControl';
  }, []);
  if (error) return <ErrorState error={error} />;
  if (!data || !s) return <Spinner label="Preparando comprobante…" />;
  return (
    <div className="min-h-screen bg-linen py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[800px] justify-end gap-2 px-4">
        <Button variant="secondary" icon={X} onClick={() => window.close()}>
          Cerrar
        </Button>
        <Button icon={Printer} onClick={() => window.print()}>
          Imprimir o guardar PDF
        </Button>
      </div>
      <article className="print-sheet mx-auto max-w-[800px] rounded-xl border border-line bg-white px-10 py-9 shadow-[var(--shadow-card)]">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <div>
            <p className="text-[20px] font-extrabold">{s.companyName}</p>
            <p className="text-[13px] text-ink-soft">
              {s.nit ? `NIT ${s.nit}` : ''} {s.address ? `· ${s.address}` : ''} {s.city ? `· ${s.city}` : ''}
            </p>
            <p className="text-[13px] text-ink-soft">
              {s.phone} {s.email ? `· ${s.email}` : ''}
            </p>
          </div>
          <Title kind={kind!} data={data} />
        </header>
        <div className="py-5">
          {kind === 'pedido' ? <OrderDoc d={data} /> : kind === 'pago' ? <PaymentDoc d={data} /> : kind === 'entrega' ? <DeliveryDoc d={data} /> : <CashDoc d={data} />}
        </div>
        <footer className="border-t border-line pt-3 text-center text-[12px] text-muted">
          {s.receiptFooter ? <p>{s.receiptFooter}</p> : null}
          <p className="mt-1 font-semibold">Este documento es un comprobante interno y no es una factura electrónica.</p>
          <p>Generado {formatDateTime(new Date())} con TexControl (versión de demostración).</p>
        </footer>
      </article>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Title({ kind, data }: { kind: string; data: any }) {
  const map: Record<string, [string, string]> = {
    pedido: [data.order?.kind === 'venta' ? 'Comprobante de venta' : 'Comprobante de pedido', data.order?.number],
    pago: [data.amount < 0 ? 'Comprobante de reverso' : 'Recibo de pago', data.number],
    entrega: ['Comprobante de entrega', data.number],
    caja: ['Reporte de caja', data.session?.number],
  };
  const [t, n] = map[kind] ?? ['Comprobante', ''];
  return (
    <div className="text-right">
      <p className="text-[13px] font-semibold text-muted">{t}</p>
      <p className="text-[22px] font-extrabold">{n}</p>
    </div>
  );
}

function Row({ k, v, strong }: { k: ReactNode; v: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-0.5 ${strong ? 'text-[16px] font-extrabold' : ''}`}>
      <span className={strong ? '' : 'text-ink-soft'}>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function OrderDoc({ d }: { d: any }) {
  const o = d.order;
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-6 text-[14px]">
        <div>
          <p className="text-[12px] font-bold text-muted">Cliente</p>
          <p className="font-semibold">{d.customer?.name ?? 'Cliente de mostrador'}</p>
          {d.customer?.document ? <p>Doc. {d.customer.document}</p> : null}
          {d.customer?.phone ? <p>Tel. {d.customer.phone}</p> : null}
        </div>
        <div>
          <Row k="Fecha" v={formatDate(o.orderDate)} />
          {o.kind === 'pedido' ? <Row k="Entrega prometida" v={formatDate(o.promisedDate)} /> : null}
          {o.kind === 'pedido' ? <Row k="Forma de entrega" v={DELIVERY_METHOD_LABELS[o.deliveryMethod as DeliveryMethod]} /> : null}
        </div>
      </div>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-ink text-left">
            <th className="py-1.5">Descripción</th>
            <th className="py-1.5 text-right">Cant.</th>
            <th className="py-1.5 text-right">Precio</th>
            <th className="py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {d.items.map((i: any) => (
            <tr key={i.id} className="border-b border-line align-top">
              <td className="py-1.5">
                {i.description}
                {i.custom && i.customization ? (
                  <span className="block text-[12px] text-muted">
                    Personalizado: {[i.customization.technique !== 'ninguna' ? i.customization.technique : null, i.customization.position, i.customization.names].filter(Boolean).join(' · ')}
                  </span>
                ) : null}
              </td>
              <td className="num py-1.5 text-right">{i.quantity}</td>
              <td className="num py-1.5 text-right">{formatCOP(i.unitPrice)}</td>
              <td className="num py-1.5 text-right">{formatCOP(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-4 w-72 text-[14px]">
        {o.discount ? (
          <>
            <Row k="Subtotal" v={formatCOP(o.subtotal)} />
            <Row k="Descuento" v={`− ${formatCOP(o.discount)}`} />
          </>
        ) : null}
        <Row k="Total" v={formatCOP(o.total)} strong />
        <Row k="Pagado" v={formatCOP(o.paid)} />
        <Row k="Saldo pendiente" v={formatCOP(o.balance)} strong />
        {o.balance > 0 && o.dueDate ? <p className="mt-1 text-right text-[12px] text-muted">Vence {formatDate(o.dueDate)}</p> : null}
      </div>
      {d.payments?.length ? (
        <div className="mt-5 text-[13px]">
          <p className="font-bold">Pagos recibidos</p>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {d.payments.map((p: any) => (
            <p key={p.id} className="text-ink-soft">
              {p.number} · {formatDateTime(p.createdAt)} · {PAYMENT_METHOD_LABELS[p.method as PaymentMethod]} · {formatCOP(p.amount)}
            </p>
          ))}
        </div>
      ) : null}
      {o.notes ? <p className="mt-4 text-[13px]"><strong>Notas:</strong> {o.notes}</p> : null}
      {o.kind === 'pedido' ? (
        <div className="mt-12 grid grid-cols-2 gap-10 text-center text-[13px]">
          <div className="border-t border-ink pt-1">Firma del cliente</div>
          <div className="border-t border-ink pt-1">Recibió por la empresa</div>
        </div>
      ) : null}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PaymentDoc({ d }: { d: any }) {
  return (
    <div className="space-y-4 text-[15px]">
      <p>
        {d.amount < 0 ? 'Se devolvió a' : 'Recibimos de'} <strong>{d.customerName}</strong>
        {d.customerDoc ? ` (doc. ${d.customerDoc})` : ''} la suma de:
      </p>
      <p className="num text-center text-[32px] font-extrabold">{formatCOP(Math.abs(d.amount))}</p>
      <div className="mx-auto w-96 text-[14px]">
        <Row k="Concepto" v={d.notes ?? 'Pago'} />
        {d.orderNumber ? <Row k="Pedido / venta" v={d.orderNumber} /> : null}
        <Row k="Método" v={PAYMENT_METHOD_LABELS[d.method as PaymentMethod]} />
        {d.reference ? <Row k="Referencia" v={d.reference} /> : null}
        <Row k="Fecha" v={formatDateTime(d.createdAt)} />
        <Row k="Recibió" v={d.userName ?? '—'} />
        {d.orderBalance != null ? <Row k="Saldo pendiente del pedido" v={formatCOP(d.orderBalance)} strong /> : null}
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DeliveryDoc({ d }: { d: any }) {
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-6 text-[14px]">
        <div>
          <p className="text-[12px] font-bold text-muted">Cliente</p>
          <p className="font-semibold">{d.customer?.name}</p>
          <p>Pedido {d.order.number}</p>
        </div>
        <div>
          <Row k="Fecha de entrega" v={formatDateTime(d.createdAt)} />
          <Row k="Entregó" v={d.deliveredBy ?? d.userName} />
          <Row k="Recibió" v={d.receivedBy} />
          <Row k="Tipo" v={d.partial ? 'Entrega parcial' : 'Entrega completa'} />
        </div>
      </div>
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-ink text-left">
            <th className="py-1.5">Producto</th>
            <th className="py-1.5 text-right">Cantidad entregada</th>
          </tr>
        </thead>
        <tbody>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {d.items.map((i: any) => (
            <tr key={i.orderItemId} className="border-b border-line">
              <td className="py-1.5">{i.description}</td>
              <td className="num py-1.5 text-right">{i.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.balanceAtDelivery > 0 ? <p className="mt-4 text-[14px] font-semibold">Saldo pendiente al momento de la entrega: {formatCOP(d.balanceAtDelivery)}</p> : null}
      {d.notes ? <p className="mt-2 text-[13px]">Observaciones: {d.notes}</p> : null}
      <div className="mt-14 grid grid-cols-2 gap-10 text-center text-[13px]">
        <div className="border-t border-ink pt-1">Firma de quien recibe</div>
        <div className="border-t border-ink pt-1">Firma de quien entrega</div>
      </div>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CashDoc({ d }: { d: any }) {
  const s = d.session;
  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-6 text-[14px]">
        <div>
          <Row k="Abrió" v={`${s.openedByName} · ${formatDateTime(s.openedAt)}`} />
          {s.closedAt ? <Row k="Cerró" v={`${s.closedByName} · ${formatDateTime(s.closedAt)}`} /> : <Row k="Estado" v="Abierta" />}
        </div>
        <div>
          <Row k="Saldo inicial" v={formatCOP(s.openingAmount)} />
          <Row k="Entradas" v={formatCOP(d.summary.income)} />
          <Row k="Salidas" v={formatCOP(d.summary.expense)} />
          <Row k="Efectivo esperado" v={formatCOP(d.summary.expectedCash)} strong />
          {s.countedCash != null ? <Row k="Efectivo contado" v={formatCOP(s.countedCash)} /> : null}
          {s.difference != null ? <Row k="Diferencia" v={formatCOP(s.difference)} strong /> : null}
        </div>
      </div>
      {s.closeNote ? <p className="mb-4 text-[13px]">Explicación de la diferencia: {s.closeNote}</p> : null}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ink text-left">
            <th className="py-1">Hora</th>
            <th className="py-1">Concepto</th>
            <th className="py-1">Método</th>
            <th className="py-1 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {d.movements.map((m: any) => (
            <tr key={m.id} className="border-b border-line">
              <td className="py-1">{formatDateTime(m.createdAt)}</td>
              <td className="py-1">{m.concept}</td>
              <td className="py-1">{PAYMENT_METHOD_LABELS[m.method as PaymentMethod]}</td>
              <td className="num py-1 text-right">
                {m.type === 'ingreso' ? '+' : '−'} {formatCOP(m.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
