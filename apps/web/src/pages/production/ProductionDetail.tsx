import { formatDate, formatDateTime, formatQty, INCIDENT_LABELS, INCIDENT_TYPES, relativeDay, type IncidentType } from '@nexo/shared';
import { AlertTriangle, ArrowRightCircle, CheckCircle2, ClipboardCheck, Flag, PackageCheck, Ruler, Scissors } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, LoadingBlock, Notice, Tape } from '@/components/ui/Feedback';
import { Checkbox, ChoiceCards, Field, QtyInput, Textarea } from '@/components/ui/Form';
import { Card, KeyValues, PageHeader } from '@/components/ui/Layout';
import { ActionMenu } from '@/components/ui/Menu';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { OrderStatusBadge, PriorityBadge, ProductionStatusBadge } from '@/components/ui/Status';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';

interface Material {
  id: number;
  name: string;
  unit: string;
  required: number;
  consumed: number;
  waste: number;
  pending: number;
  available: number;
  enough: boolean;
}
interface PItem {
  id: number;
  description: string;
  quantity: number;
  qtyDone: number;
  specs: string | null;
}
interface Detail {
  order: {
    id: number;
    number: string;
    stage: string;
    status: string;
    priority: 'normal' | 'alta' | 'urgente';
    targetDate: string;
    responsible: string | null;
    notes: string | null;
    qcNotes: string | null;
    late: boolean;
    units: number;
    done: number;
    progress: number;
    createdAt: string;
    finishedAt: string | null;
  };
  stages: string[];
  items: PItem[];
  materials: Material[];
  events: Array<{ id: number; type: string; summary: string; createdAt: string; userName: string }>;
  salesOrder: { id: number; number: string; status: string; promisedDate: string | null; customerName: string | null } | null;
}

export default function ProductionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useApi<Detail>(`/production/${id}`);
  const [modal, setModal] = useState<null | 'consume' | 'progress' | 'incident' | 'finish'>(null);
  const [stageTarget, setStageTarget] = useState<string | null>(null);
  const move = useAction((b: { stage: string; note?: string }) => api.post(`/production/${id}/stage`, b), {
    success: (r) => 'Orden movida de etapa',
    onSuccess: () => setStageTarget(null),
  });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock rows={8} />;
  const { order: po, stages, items, materials } = data;
  const open = po.status === 'pendiente' || po.status === 'en_proceso';
  const editable = open && can('produccion.gestionar');
  const idx = stages.indexOf(po.stage);
  const nextStage = idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  const allDone = items.every((i) => i.qtyDone >= i.quantity);
  const missing = materials.filter((m) => !m.enough);

  let primary: React.ReactNode = null;
  if (editable) {
    if (allDone)
      primary = (
        <Button variant="success" icon={ClipboardCheck} onClick={() => setModal('finish')}>
          Terminar y aprobar calidad
        </Button>
      );
    else if (nextStage)
      primary = (
        <Button icon={ArrowRightCircle} onClick={() => setStageTarget(nextStage)}>
          Pasar a {nextStage}
        </Button>
      );
    else
      primary = (
        <Button icon={Ruler} onClick={() => setModal('progress')}>
          Registrar unidades terminadas
        </Button>
      );
  }

  return (
    <div>
      <PageHeader
        title={`Orden de producción ${po.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProductionStatusBadge status={po.status} />
            <PriorityBadge priority={po.priority} />
            {po.late ? <Badge tone="risk">Atrasada</Badge> : null}
            {data.salesOrder ? (
              <span>
                Pedido{' '}
                <Link to={`/pedidos/${data.salesOrder.id}`} className="font-semibold text-petrol-700 hover:underline">
                  {data.salesOrder.number}
                </Link>{' '}
                · {data.salesOrder.customerName}
              </span>
            ) : (
              <span>Producción para bodega</span>
            )}
          </span>
        }
        back={{ to: '/produccion', label: 'Producción' }}
        actions={
          editable ? (
            <>
              <ActionMenu
                items={[
                  { label: 'Registrar consumo de material', icon: Scissors, onClick: () => setModal('consume') },
                  { label: 'Reportar un problema', icon: Flag, onClick: () => setModal('incident') },
                ]}
              />
              {!allDone && nextStage ? (
                <Button variant="secondary" icon={Ruler} onClick={() => setModal('progress')}>
                  Registrar avance
                </Button>
              ) : null}
              {primary}
            </>
          ) : null
        }
      />

      {/* Etapas: cinta con puntadas */}
      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">
            {po.status === 'terminada' ? 'Terminada' : `Etapa actual: ${po.stage}`} <span className="ml-2 font-normal text-muted">{po.progress}% de avance</span>
          </p>
          <p className={`text-[14px] ${po.late ? 'font-semibold text-risk-700' : 'text-muted'}`}>
            Fecha objetivo: {formatDate(po.targetDate)} ({relativeDay(po.targetDate)})
          </p>
        </div>
        <Tape value={po.progress} tone={po.status === 'terminada' ? 'ok' : po.late ? 'risk' : 'petrol'} />
        <ol className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0,1fr))` }}>
          {stages.map((s, i) => {
            const done = po.status === 'terminada' || i < idx;
            const cur = i === idx && po.status !== 'terminada';
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!editable || cur}
                  onClick={() => setStageTarget(s)}
                  className={`w-full rounded-lg border px-2 py-2 text-center text-[13px] font-semibold transition-colors ${cur ? 'border-petrol-600 bg-petrol-600 text-white' : done ? 'border-teal-500/40 bg-teal-50 text-teal-700' : 'border-line bg-surface text-muted'} ${editable && !cur ? 'hover:border-petrol-500' : ''}`}
                  title={editable && !cur ? `Mover a ${s}` : s}
                >
                  {done ? <CheckCircle2 className="mx-auto mb-0.5 h-4 w-4" aria-hidden /> : null}
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      {missing.length && open ? (
        <div className="mb-6">
          <Notice tone="warn" icon={AlertTriangle} title="No alcanza el material para terminar esta orden" action={<Link to="/inventario?tab=reposicion" className="font-semibold text-petrol-700 hover:underline">Ver reposición</Link>}>
            {missing.map((m) => `${m.name}: se necesitan ${formatQty(m.pending)} ${m.unit} y hay ${formatQty(Math.max(m.available, 0))}`).join(' · ')}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Qué se fabrica" subtitle={`${po.done} de ${po.units} unidades terminadas`} padded={false}>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Producto y especificaciones</th>
                  <th className="text-right">Terminadas</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <p className="font-semibold">{i.description}</p>
                      {i.specs ? <p className="text-[13px] text-violet-700">{i.specs}</p> : null}
                      <div className="mt-2 max-w-sm">
                        <Tape value={(i.qtyDone / i.quantity) * 100} tone={i.qtyDone >= i.quantity ? 'ok' : 'teal'} label={`${i.qtyDone} de ${i.quantity}`} />
                      </div>
                    </td>
                    <td className="num text-right text-[16px] font-bold">
                      {i.qtyDone}/{i.quantity}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="Materiales" subtitle="Estimado según la receta de cada producto. El inventario solo se descuenta al registrar el consumo." padded={false}>
            {materials.length ? (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="text-right">Necesario</th>
                      <th className="text-right">Ya usado</th>
                      <th className="text-right">Falta usar</th>
                      <th className="text-right">En bodega</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((m) => (
                      <tr key={m.id}>
                        <td className="font-medium">{m.name}</td>
                        <td className="num whitespace-nowrap text-right">
                          {formatQty(m.required)} {m.unit}
                        </td>
                        <td className="num text-right">
                          {formatQty(m.consumed)}
                          {m.waste ? <span className="block text-[12px] text-warn-700">+{formatQty(m.waste)} merma</span> : null}
                        </td>
                        <td className="num text-right">{formatQty(m.pending)}</td>
                        <td className="num text-right">{formatQty(m.available)}</td>
                        <td>{m.pending === 0 ? <Badge tone="ok">Completo</Badge> : m.enough ? <Badge tone="teal">Alcanza</Badge> : <Badge tone="risk">No alcanza</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-5 py-4 text-muted">Este producto no tiene receta de materiales registrada.</p>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Datos de la orden">
            <KeyValues
              columns={1}
              items={[
                ['Responsable', po.responsible ?? 'Sin asignar'],
                ['Creada', formatDateTime(po.createdAt)],
                data.salesOrder ? ['Estado del pedido', <OrderStatusBadge key="s" status={data.salesOrder.status} />] : null,
                data.salesOrder?.promisedDate ? ['Entrega al cliente', formatDate(data.salesOrder.promisedDate)] : null,
                po.finishedAt ? ['Terminada', formatDateTime(po.finishedAt)] : null,
                po.qcNotes ? ['Control de calidad', po.qcNotes] : null,
                po.notes ? ['Notas', po.notes] : null,
              ]}
            />
          </Card>
          <Card title="Historial" padded={false}>
            <ol className="px-5 py-4">
              {data.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < data.events.length - 1 ? <span className="stitch-y absolute bottom-0 left-[7px] top-5 text-line-strong" aria-hidden /> : null}
                  <span className={`mt-1.5 h-4 w-4 shrink-0 rounded-full border-[3px] bg-surface ${e.type === 'incidencia' ? 'border-risk-500' : e.type === 'calidad' ? 'border-ok-500' : e.type === 'consumo' ? 'border-warn-500' : 'border-petrol-500'}`} aria-hidden />
                  <div>
                    <p className={`text-[14.5px] leading-snug ${e.type === 'incidencia' ? 'font-semibold text-risk-700' : ''}`}>{e.summary}</p>
                    <p className="text-[13px] text-muted">
                      {e.userName} · {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!stageTarget}
        onClose={() => setStageTarget(null)}
        title={`Mover a “${stageTarget}”`}
        confirmLabel={`Mover a ${stageTarget}`}
        loading={move.isPending}
        onConfirm={(note) => move.mutate({ stage: stageTarget!, note: note || undefined })}
        consequence={`La orden pasará de “${po.stage}” a “${stageTarget}”. Quedará anotado en el historial${data.salesOrder ? ' y en el pedido del cliente' : ''}.`}
      />
      <ConsumeModal open={modal === 'consume'} onClose={() => setModal(null)} poId={po.id} materials={materials} />
      <ProgressModal open={modal === 'progress'} onClose={() => setModal(null)} poId={po.id} items={items} />
      <IncidentModal open={modal === 'incident'} onClose={() => setModal(null)} poId={po.id} />
      <FinishModal open={modal === 'finish'} onClose={() => setModal(null)} poId={po.id} materials={materials} units={po.units} hasOrder={!!data.salesOrder} />
    </div>
  );
}

function ConsumeModal({ open, onClose, poId, materials }: { open: boolean; onClose: () => void; poId: number; materials: Material[] }) {
  const [vals, setVals] = useState<Record<number, { quantity: number; waste: number }>>({});
  useEffect(() => {
    if (open) setVals(Object.fromEntries(materials.map((m) => [m.id, { quantity: m.pending, waste: 0 }])));
  }, [open, materials]);
  const save = useAction((b: object) => api.post(`/production/${poId}/consume`, b), { success: 'Consumo registrado. El inventario de materiales se actualizó.', onSuccess: onClose });
  const lines = Object.entries(vals).map(([k, v]) => ({ materialId: Number(k), ...v }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Registrar consumo de materiales"
      description="Escribe cuánto se usó realmente. Lo que se dañó o desperdició va en “Merma”."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Scissors} loading={save.isPending} disabled={!lines.some((l) => l.quantity > 0 || l.waste > 0)} onClick={() => save.mutate({ lines })}>
            Descontar del inventario
          </Button>
        </>
      }
    >
      <table className="table-base">
        <thead>
          <tr>
            <th>Material</th>
            <th className="text-right">Falta usar</th>
            <th className="text-center">Se usó</th>
            <th className="text-center">Merma</th>
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => (
            <tr key={m.id}>
              <td>
                <p className="font-medium">{m.name}</p>
                <p className="text-[12.5px] text-muted">En bodega: {formatQty(m.available)} {m.unit}</p>
              </td>
              <td className="num text-right">
                {formatQty(m.pending)} {m.unit}
              </td>
              <td className="text-center">
                <QtyInput decimals step={m.unit === 'unidad' ? 1 : 0.5} value={vals[m.id]?.quantity ?? 0} onChange={(q) => setVals((v) => ({ ...v, [m.id]: { ...v[m.id], quantity: q } }))} aria-label={`Cantidad usada de ${m.name}`} />
              </td>
              <td className="text-center">
                <QtyInput decimals step={m.unit === 'unidad' ? 1 : 0.5} value={vals[m.id]?.waste ?? 0} onChange={(q) => setVals((v) => ({ ...v, [m.id]: { ...v[m.id], waste: q } }))} aria-label={`Merma de ${m.name}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function ProgressModal({ open, onClose, poId, items }: { open: boolean; onClose: () => void; poId: number; items: PItem[] }) {
  const [vals, setVals] = useState<Record<number, number>>({});
  useEffect(() => {
    if (open) setVals(Object.fromEntries(items.map((i) => [i.id, i.qtyDone])));
  }, [open, items]);
  const save = useAction((b: object) => api.post(`/production/${poId}/progress`, b), { success: 'Avance guardado', onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="¿Cuántas unidades están terminadas?"
      description="Escribe el total terminado de cada talla (no solo lo de hoy)."
      footer={
        <>
          <Button variant="ghost" onClick={() => setVals(Object.fromEntries(items.map((i) => [i.id, i.quantity])))}>
            Marcar todo terminado
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Ruler} loading={save.isPending} onClick={() => save.mutate({ lines: Object.entries(vals).map(([k, v]) => ({ itemId: Number(k), done: v })) })}>
            Guardar avance
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-line">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="font-semibold">{i.description}</span>
            <span className="flex items-center gap-2">
              <QtyInput value={vals[i.id] ?? 0} max={i.quantity} onChange={(q) => setVals((v) => ({ ...v, [i.id]: q }))} aria-label={`Terminadas de ${i.description}`} />
              <span className="num text-muted">de {i.quantity}</span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function IncidentModal({ open, onClose, poId }: { open: boolean; onClose: () => void; poId: number }) {
  const [type, setType] = useState<IncidentType>('retraso');
  const [detail, setDetail] = useState('');
  const save = useAction((b: object) => api.post(`/production/${poId}/incident`, b), {
    success: 'Problema registrado. Se anotó también en el pedido.',
    onSuccess: () => {
      setDetail('');
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reportar un problema"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Flag} loading={save.isPending} disabled={!detail.trim()} onClick={() => save.mutate({ type, detail })}>
            Registrar problema
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ChoiceCards name="inc" columns={2} value={type} onChange={setType} options={INCIDENT_TYPES.map((t) => ({ value: t, label: INCIDENT_LABELS[t] }))} />
        <Field label="¿Qué pasó?" required htmlFor="inc-d">
          <Textarea id="inc-d" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Ej: 3 camisas con costura torcida, se deben repetir" />
        </Field>
      </div>
    </Modal>
  );
}

function FinishModal({ open, onClose, poId, materials, units, hasOrder }: { open: boolean; onClose: () => void; poId: number; materials: Material[]; units: number; hasOrder: boolean }) {
  const [qc, setQc] = useState(false);
  const [consume, setConsume] = useState(true);
  const [notes, setNotes] = useState('');
  const pending = materials.filter((m) => m.pending > 0);
  const save = useAction((b: object) => api.post<{ orderReady: boolean }>(`/production/${poId}/finish`, b), {
    success: (r) => (r.orderReady ? 'Orden terminada. El pedido quedó listo para entregar.' : 'Orden terminada. Los productos ingresaron a bodega.'),
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Terminar orden y aprobar calidad"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="success" icon={PackageCheck} disabled={!qc} loading={save.isPending} onClick={() => save.mutate({ qcApproved: true, qcNotes: notes || null, consumeRemaining: consume })}>
            Terminar orden
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Notice tone="petrol">
          Se sumarán <strong>{units} unidades</strong> al inventario de producto terminado{hasOrder ? ' y quedarán separadas para el pedido del cliente' : ''}.
        </Notice>
        <Checkbox checked={qc} onChange={setQc} label="Revisé la calidad: costuras, tallas, bordados y empaque están bien" description="Obligatorio para terminar." />
        {pending.length ? (
          <Checkbox
            checked={consume}
            onChange={setConsume}
            label="Descontar el material que falta registrar"
            description={`Según la receta: ${pending.map((m) => `${formatQty(m.pending)} ${m.unit} de ${m.name}`).join(', ')}.`}
          />
        ) : null}
        <Field label="Notas de calidad" htmlFor="qc-n">
          <Textarea id="qc-n" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej: se repitieron 2 bordados" />
        </Field>
      </div>
    </Modal>
  );
}
