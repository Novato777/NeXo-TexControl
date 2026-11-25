import { formatCOP, formatDate, formatDateTime, formatQty } from '@nexo/shared';
import { Ban, PackageCheck, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/Form';
import { Card, KeyValues, PageHeader } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { PayableBadge, PurchaseBadge } from '@/components/ui/Status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import { PayPayableModal } from '../cash/shared';

interface Item {
  id: number;
  label: string;
  unit: string;
  quantity: number;
  qtyReceived: number;
  pending: number;
  unitCost: number;
}
interface Detail {
  purchase: { id: number; number: string; status: string; date: string; dueDate: string | null; subtotal: number; discount: number; total: number; notes: string | null; receivedAt: string | null; createdByName: string | null };
  supplier: { id: number; name: string; phone: string | null };
  items: Item[];
  payable: { id: number; number: string; concept: string; amount: number; paid: number; balance: number; dueDate: string } | null;
}

export default function PurchaseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/purchases/${id}`);
  const [receive, setReceive] = useState(false);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const canc = useAction((b: { reason: string }) => api.post(`/purchases/${id}/cancel`, b), { success: 'Compra cancelada', onSuccess: () => setCancel(false) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={6} />;
  const p = data.purchase;
  const openRecv = p.status === 'pedida' || p.status === 'recibida_parcial';
  const payStatus = data.payable ? (data.payable.balance <= 0 ? 'pagado' : data.payable.dueDate < new Date().toISOString().slice(0, 10) ? 'vencido' : data.payable.paid > 0 ? 'parcial' : 'pendiente') : null;
  return (
    <div>
      <PageHeader
        title={`Compra ${p.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PurchaseBadge status={p.status} />
            <Link to={`/proveedores/${data.supplier.id}`} className="font-semibold text-petrol-700 hover:underline">
              {data.supplier.name}
            </Link>
          </span>
        }
        back={{ to: '/proveedores?tab=compras', label: 'Compras' }}
        actions={
          <>
            {p.status === 'pedida' && can('compra.gestionar') ? (
              <Button variant="secondary" icon={Ban} onClick={() => setCancel(true)}>
                Cancelar compra
              </Button>
            ) : null}
            {data.payable && data.payable.balance > 0 && can('gasto.registrar') ? (
              <Button variant={openRecv ? 'secondary' : 'primary'} icon={Wallet} onClick={() => setPay(true)}>
                Pagar al proveedor
              </Button>
            ) : null}
            {openRecv && can('compra.gestionar') ? (
              <Button icon={PackageCheck} onClick={() => setReceive(true)}>
                Confirmar lo que llegó
              </Button>
            ) : null}
          </>
        }
      />
      {openRecv ? (
        <div className="mb-5">
          <Notice tone="petrol" icon={PackageCheck} title={p.status === 'pedida' ? 'Esta compra todavía no ha llegado' : 'Llegó una parte de esta compra'}>
            Cuando recibas la mercancía, confirma las cantidades: así sube el inventario. Si llega incompleta, registra lo que llegó y el resto queda pendiente.
          </Notice>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Materiales" padded={false}>
          <table className="table-base">
            <thead>
              <tr>
                <th>Material</th>
                <th className="text-right">Pedido</th>
                <th className="text-right">Recibido</th>
                <th className="text-right">Costo</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="font-medium">{i.label}</td>
                  <td className="num text-right">
                    {formatQty(i.quantity)} {i.unit}
                  </td>
                  <td className="num text-right">
                    {i.pending <= 0 ? <Badge tone="ok">Completo</Badge> : i.qtyReceived ? <span className="font-semibold text-warn-700">{formatQty(i.qtyReceived)} (faltan {formatQty(i.pending)})</span> : <span className="text-muted">Pendiente</span>}
                  </td>
                  <td className="num text-right">{formatCOP(i.unitCost)}</td>
                  <td className="num text-right font-semibold">{formatCOP(i.quantity * i.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-6">
          <Card title="Valor">
            <dl className="space-y-1.5 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-ink-soft">Subtotal</dt>
                <dd className="num">{formatCOP(p.subtotal)}</dd>
              </div>
              {p.discount ? (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Descuento</dt>
                  <dd className="num">− {formatCOP(p.discount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t border-line pt-1.5">
                <dt className="font-bold">Total</dt>
                <dd className="num text-[18px] font-extrabold">{formatCOP(p.total)}</dd>
              </div>
            </dl>
            {data.payable && payStatus ? (
              <div className="mt-4 rounded-xl bg-linen p-3 text-[14.5px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Cuenta por pagar</span>
                  <PayableBadge status={payStatus} />
                </div>
                <p className="mt-1">
                  Pagado {formatCOP(data.payable.paid)} · Saldo <strong>{formatCOP(data.payable.balance)}</strong>
                </p>
                <p className="text-muted">Vence {formatDate(data.payable.dueDate)}</p>
              </div>
            ) : null}
          </Card>
          <Card title="Datos">
            <KeyValues
              columns={1}
              items={[
                ['Fecha de compra', formatDate(p.date)],
                ['Registró', p.createdByName ?? '—'],
                p.receivedAt ? ['Última recepción', formatDateTime(p.receivedAt)] : null,
                p.notes ? ['Notas', p.notes] : null,
              ]}
            />
          </Card>
        </div>
      </div>
      <ReceiveModal open={receive} onClose={() => setReceive(false)} purchaseId={p.id} items={data.items} />
      {data.payable ? <PayPayableModal open={pay} onClose={() => setPay(false)} payable={{ ...data.payable, supplierName: data.supplier.name }} /> : null}
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title={`Cancelar compra ${p.number}`}
        confirmLabel="Cancelar compra"
        tone="danger"
        requireReason
        loading={canc.isPending}
        onConfirm={(reason) => canc.mutate({ reason })}
        consequence="La compra quedará anulada y también su cuenta por pagar. No afecta el inventario porque no se ha recibido nada."
      />
    </div>
  );
}

function ReceiveModal({ open, onClose, purchaseId, items }: { open: boolean; onClose: () => void; purchaseId: number; items: Item[] }) {
  const pending = items.filter((i) => i.pending > 0);
  const [vals, setVals] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [closeShort, setCloseShort] = useState(false);
  useEffect(() => {
    if (open) {
      setVals(Object.fromEntries(pending.map((i) => [i.id, String(i.pending).replace('.', ',')])));
      setCloseShort(false);
      setNote('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const parsed = pending.map((i) => ({ item: i, q: Number((vals[i.id] ?? '0').replace(',', '.')) || 0 }));
  const partial = parsed.some((p) => p.q < p.item.pending);
  const over = parsed.some((p) => p.q > p.item.pending + 0.0001);
  const save = useAction((b: object) => api.post<{ status: string }>(`/purchases/${purchaseId}/receive`, b), {
    success: (r) => (r.status === 'recibida' ? 'Recepción completa. El inventario ya se actualizó.' : 'Recepción parcial registrada. El inventario ya se actualizó.'),
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Confirmar lo que llegó"
      description="Cuenta lo que trajo el proveedor y escribe la cantidad recibida de cada material."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={PackageCheck} variant="success" disabled={over || !parsed.some((p) => p.q > 0)} loading={save.isPending} onClick={() => save.mutate({ lines: parsed.map((p) => ({ itemId: p.item.id, quantity: p.q })), note: note || null, closeShort })}>
            Sumar al inventario
          </Button>
        </>
      }
    >
      <table className="table-base">
        <thead>
          <tr>
            <th>Material</th>
            <th className="text-right">Falta por llegar</th>
            <th className="text-right">Llegó</th>
          </tr>
        </thead>
        <tbody>
          {parsed.map(({ item, q }) => (
            <tr key={item.id}>
              <td className="font-medium">{item.label}</td>
              <td className="num text-right">
                {formatQty(item.pending)} {item.unit}
              </td>
              <td className="text-right">
                <Input inputMode="decimal" className={`num ml-auto h-10 w-28 text-right ${q > item.pending + 0.0001 ? 'border-risk-500' : ''}`} value={vals[item.id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [item.id]: e.target.value }))} aria-label={`Recibido de ${item.label}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {over ? <p className="mt-3 font-semibold text-risk-700">No puedes recibir más de lo que falta por llegar.</p> : null}
      {partial && !over ? (
        <div className="mt-4 space-y-3">
          <Checkbox checked={closeShort} onChange={setCloseShort} label="No llegará el resto: cerrar la compra con faltantes" description="Si no lo marcas, la compra queda abierta esperando lo que falta." />
          <Field label="¿Qué pasó con lo que falta?" htmlFor="rc-note">
            <Textarea id="rc-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: el proveedor envía el resto la próxima semana" />
          </Field>
        </div>
      ) : null}
    </Modal>
  );
}
