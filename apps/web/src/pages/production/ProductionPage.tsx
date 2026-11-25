import { addDays, formatDate, PRIORITIES, PRIORITY_LABELS, relativeDay, todayISO, type Priority } from '@nexo/shared';
import { AlertTriangle, Factory, PackageOpen, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock, Tape } from '@/components/ui/Feedback';
import { Field, Input, QtyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, Segmented } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Overlay';
import { SearchInput, VariantPicker } from '@/components/ui/Pickers';
import { PriorityBadge, ProductionStatusBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import type { VariantOption } from '@/lib/types';

export interface PORow {
  id: number;
  number: string;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  stage: string;
  status: string;
  priority: Priority;
  targetDate: string;
  responsible: string | null;
  units: number;
  done: number;
  summary: string;
  progress: number;
  late: boolean;
  missingMaterials: string[];
  incidents: number;
  finishedAt: string | null;
}

export default function ProductionPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'tablero';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const stages = useApi<string[]>('/production/stages');
  const list = useApi<PORow[]>(`/production${qs({ status: tab === 'terminadas' ? 'terminada,cancelada' : 'activas', q: dq })}`);
  const rows = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Producción"
        description="Toca una orden para avanzarla."
        actions={
          can('produccion.gestionar') ? (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              Producir para bodega
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-col gap-2.5 md:flex-row md:items-center">
        <Segmented
          label="Qué órdenes ver"
          value={tab as 'tablero' | 'terminadas'}
          onChange={(v) => setParams(v === 'tablero' ? {} : { tab: v }, { replace: true })}
          options={[
            { value: 'tablero', label: 'En curso', count: tab === 'tablero' ? rows.length : undefined },
            { value: 'terminadas', label: 'Terminadas' },
          ]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Buscar orden, pedido o cliente" className="md:w-80" />
      </div>
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : list.isLoading || stages.isLoading ? (
        <LoadingBlock />
      ) : tab === 'tablero' ? (
        rows.length ? (
          <div className="overflow-x-auto pb-2">
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${stages.data?.length ?? 6}, minmax(230px, 1fr))` }}>
              {(stages.data ?? []).map((st) => {
                const items = rows.filter((r) => r.stage === st);
                return (
                  <section key={st} className="flex flex-col rounded-xl bg-[#eceeea]" aria-label={st}>
                    <header className="flex items-center justify-between px-3 pb-2 pt-3">
                      <h2 className="text-[15px] font-bold">{st}</h2>
                      <span className="num rounded-full bg-surface px-2 text-[13px] font-bold text-muted">{items.length}</span>
                    </header>
                    <div className="flex flex-1 flex-col gap-2 px-2 pb-3">
                      {!items.length ? <p className="stitch-border rounded-lg px-3 py-5 text-center text-[13px] text-muted">Nada en esta etapa</p> : null}
                      {items.map((r) => (
                        <Link key={r.id} to={`/produccion/${r.id}`} className={`block rounded-lg border bg-surface p-3 shadow-[var(--shadow-card)] hover:border-petrol-200 ${r.late ? 'border-risk-500/50' : 'border-line'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-petrol-700">{r.number}</span>
                            <PriorityBadge priority={r.priority} />
                          </div>
                          <p className="mt-1 text-[14px] font-semibold leading-snug">{r.customerName}</p>
                          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{r.summary}</p>
                          <div className="mt-2.5">
                            <Tape value={r.progress} tone={r.late ? 'risk' : 'petrol'} />
                            <div className="mt-1 flex justify-between text-[12.5px] text-muted">
                              <span>
                                {r.done}/{r.units} unid.
                              </span>
                              <span className={r.late ? 'font-semibold text-risk-700' : ''}>{r.late ? `Atrasada (${relativeDay(r.targetDate)})` : `Para ${relativeDay(r.targetDate)}`}</span>
                            </div>
                          </div>
                          {r.missingMaterials.length ? (
                            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-warn-50 px-2 py-1 text-[12.5px] font-semibold text-warn-700">
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> Falta material: {r.missingMaterials.join(', ')}
                            </p>
                          ) : null}
                          {r.incidents ? <p className="mt-1.5 text-[12.5px] font-semibold text-risk-700">{r.incidents} incidencia(s) registrada(s)</p> : null}
                        </Link>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <Card>
            <EmptyState icon={PackageOpen} title="No hay órdenes de producción en curso" text="Las órdenes se crean desde un pedido confirmado (botón “Enviar a producción”) o aquí para reponer bodega." />
          </Card>
        )
      ) : (
        <Card padded={false}>
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={(r) => nav(`/produccion/${r.id}`)}
            empty={<EmptyState title="Todavía no hay órdenes terminadas" />}
            columns={[
              { key: 'n', header: 'Orden', render: (r) => <span className="font-bold text-petrol-700">{r.number}</span>, sortValue: (r) => r.id },
              { key: 'c', header: 'Pedido / cliente', render: (r) => <span>{r.orderNumber ? `${r.orderNumber} · ` : ''}{r.customerName}</span> },
              { key: 's', header: 'Estado', render: (r) => <ProductionStatusBadge status={r.status} /> },
              { key: 'u', header: 'Unidades', align: 'right', render: (r) => <span className="num">{r.units}</span>, sortValue: (r) => r.units },
              { key: 't', header: 'Fecha objetivo', render: (r) => formatDate(r.targetDate), sortValue: (r) => r.targetDate },
              { key: 'f', header: 'Terminada', render: (r) => formatDate(r.finishedAt), sortValue: (r) => r.finishedAt },
            ]}
            initialSort={{ key: 'f', dir: 'desc' }}
          />
        </Card>
      )}
      <NewInternalOrder open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewInternalOrder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [items, setItems] = useState<Array<{ v: VariantOption; quantity: number }>>([]);
  const [targetDate, setTargetDate] = useState(addDays(todayISO(), 7));
  const [priority, setPriority] = useState<Priority>('normal');
  const [responsible, setResponsible] = useState('');
  const [notes, setNotes] = useState('');
  const create = useAction((b: object) => api.post<{ id: number; number: string }>('/production', b), {
    success: (r) => `Orden ${r.number} creada`,
    onSuccess: (r) => {
      onClose();
      setItems([]);
      nav(`/produccion/${r.id}`);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Producir para bodega"
      description="Para reponer existencias de productos terminados que no están ligados a un pedido."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Factory} disabled={!items.length} loading={create.isPending} onClick={() => create.mutate({ targetDate, priority, responsible: responsible || null, notes: notes || null, items: items.map((i) => ({ variantId: i.v.id, quantity: i.quantity })) })}>
            Crear orden de producción
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <VariantPicker types={['terminado']} pickedIds={items.map((i) => i.v.id)} onPick={(v) => setItems((xs) => (xs.some((x) => x.v.id === v.id) ? xs : [...xs, { v, quantity: 10 }]))} />
        {items.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {items.map((i, idx) => (
              <li key={i.v.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex-1 text-[14.5px] font-semibold">{i.v.label}</span>
                <QtyInput value={i.quantity} min={1} onChange={(q) => setItems((xs) => xs.map((x, j) => (j === idx ? { ...x, quantity: q } : x)))} aria-label={`Cantidad de ${i.v.label}`} />
                <button className="rounded p-1.5 text-muted hover:text-risk-700" onClick={() => setItems((xs) => xs.filter((_, j) => j !== idx))} aria-label="Quitar">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Fecha objetivo" required htmlFor="np-date">
            <Input id="np-date" type="date" value={targetDate} min={todayISO()} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <Field label="Prioridad" required htmlFor="np-prio">
            <Select id="np-prio" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsable" htmlFor="np-resp">
            <Input id="np-resp" value={responsible} onChange={(e) => setResponsible(e.target.value)} />
          </Field>
        </div>
        <Field label="Notas" htmlFor="np-notes">
          <Textarea id="np-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
