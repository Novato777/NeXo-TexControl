import { formatCOP, formatDate, formatDateTime, INCOME_CATEGORIES, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@nexo/shared';
import { ArrowDownCircle, ArrowUpCircle, Lock, LockOpen, Plus, Undo2, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorState, HelpTip, LoadingBlock, Notice } from '@/components/ui/Feedback';
import { Field, Input, MoneyInput, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, SummaryStrip, Tabs } from '@/components/ui/Layout';
import { ConfirmDialog, Modal } from '@/components/ui/Overlay';
import { PayableBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi } from '@/lib/hooks';
import type { Settings } from '@/lib/types';
import { MethodChoice } from '../orders/shared';
import { NewPayableModal, PayPayableModal, type PayableRow } from './shared';

export interface CashMovement {
  id: number;
  type: 'ingreso' | 'egreso';
  category: string;
  concept: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  refType: string | null;
  reversalOf: number | null;
  createdAt: string;
  userName: string;
}
export interface Summary {
  income: number;
  expense: number;
  cashIn: number;
  cashOut: number;
  opening: number;
  expectedCash: number;
  byMethod: Record<string, { ingreso: number; egreso: number }>;
}
interface Current {
  open: boolean;
  session?: { id: number; number: string; openedAt: string; openingAmount: number; openedByName: string | null };
  summary?: Summary;
  movements?: CashMovement[];
  lastClosed?: { id: number; number: string; closedAt: string; countedCash: number; difference: number } | null;
}

type Tab = 'hoy' | 'pagar' | 'historial';

/** Pestañas de la sección Dinero: caja, por cobrar (cartera) y por pagar. */
export function MoneySectionTabs({ active, onChange }: { active: string; onChange?: (v: Tab) => void }) {
  const { access } = useAuth();
  return (
    <Tabs
      value={active}
      onChange={(v) => onChange?.(v as Tab)}
      tabs={[
        ...(access('caja') ? [{ value: 'hoy', label: 'Caja de hoy', to: active === 'cobrar' ? '/caja' : undefined }] : []),
        ...(access('cartera') ? [{ value: 'cobrar', label: 'Por cobrar', to: '/cartera' }] : []),
        ...(access('caja')
          ? [
              { value: 'pagar', label: 'Por pagar', to: active === 'cobrar' ? '/caja?tab=pagar' : undefined },
              { value: 'historial', label: 'Cajas anteriores', to: active === 'cobrar' ? '/caja?tab=historial' : undefined },
            ]
          : []),
      ]}
    />
  );
}

export default function CashPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'hoy') as Tab;
  return (
    <div>
      <PageHeader
        title="Dinero"
        description={
          <>
            Caja diaria, lo que te deben y lo que debes. <HelpTip>Caja operativa sencilla. La contabilidad formal y la facturación electrónica quedan para una fase futura.</HelpTip>
          </>
        }
      />
      <MoneySectionTabs active={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} />
      {tab === 'hoy' ? <Today /> : tab === 'pagar' ? <Payables /> : <History />}
    </div>
  );
}

function Today() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useApi<Current>('/cash/current');
  const [modal, setModal] = useState<null | 'open' | 'ingreso' | 'egreso' | 'close'>(null);
  const [reverse, setReverse] = useState<CashMovement | null>(null);
  useEffect(() => {
    if (params.get('accion') === 'gasto' && data?.open) {
      setModal('egreso');
      params.delete('accion');
      setParams(params, { replace: true });
    }
  }, [params, data, setParams]);
  const rev = useAction((b: { reason: string }) => api.post(`/cash/movements/${reverse!.id}/reverse`, b), { success: 'Movimiento reversado', onSuccess: () => setReverse(null) });
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;

  if (!data.open) {
    return (
      <>
        <Card>
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-warn-50 text-warn-500">
              <Lock className="h-8 w-8" />
            </span>
            <h2 className="text-[22px] font-extrabold">La caja está cerrada</h2>
            <p className="mt-1 max-w-md text-muted">Ábrela al empezar el día con el dinero en efectivo que hay en el cajón. Sin caja abierta no se puede recibir efectivo.</p>
            {data.lastClosed ? (
              <p className="mt-3 text-[14px] text-muted">
                Último cierre: {data.lastClosed.number} · {formatDateTime(data.lastClosed.closedAt)} · contado {formatCOP(data.lastClosed.countedCash)}
              </p>
            ) : null}
            {can('caja.operar') ? (
              <Button size="lg" icon={LockOpen} className="mt-6" onClick={() => setModal('open')}>
                Abrir caja
              </Button>
            ) : null}
            {params.get('accion') === 'gasto' ? <p className="mt-3 font-semibold text-warn-700">Abre la caja primero para registrar el gasto.</p> : null}
          </div>
        </Card>
        <OpenModal open={modal === 'open'} onClose={() => setModal(null)} suggested={data.lastClosed?.countedCash ?? 200000} />
      </>
    );
  }

  const s = data.summary!;
  const methods = Object.entries(s.byMethod);
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="flex items-center gap-2 text-[15px]">
          <Badge tone="ok" icon={LockOpen}>
            Abierta
          </Badge>
          <span className="text-muted">
            {data.session!.number} · abrió {data.session!.openedByName} {formatDateTime(data.session!.openedAt)}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {can('caja.operar') ? (
            <Button variant="secondary" icon={ArrowUpCircle} onClick={() => setModal('ingreso')}>
              Registrar ingreso
            </Button>
          ) : null}
          {can('gasto.registrar') ? (
            <Button variant="secondary" icon={ArrowDownCircle} onClick={() => setModal('egreso')}>
              Registrar gasto
            </Button>
          ) : null}
          {can('caja.cerrar') ? (
            <Button icon={Lock} onClick={() => setModal('close')}>
              Cerrar caja
            </Button>
          ) : null}
        </div>
      </div>

      <SummaryStrip
        items={[
          { label: 'Entró hoy', value: formatCOP(s.income), tone: 'ok', hint: `Efectivo ${formatCOP(s.cashIn)}` },
          { label: 'Salió hoy', value: formatCOP(s.expense), tone: 'risk', hint: `Efectivo ${formatCOP(s.cashOut)}` },
          {
            label: 'Efectivo que debe haber',
            value: formatCOP(s.expectedCash),
            tone: 'petrol',
            hint: (
              <>
                Abrió con {formatCOP(s.opening)} <HelpTip>Solo cuenta el efectivo. Transferencias, tarjetas y Nequi no entran al cajón.</HelpTip>
              </>
            ),
          },
        ]}
      />

      <Card
        title="Movimientos de hoy"
        subtitle={methods.length ? methods.map(([m, v]) => `${PAYMENT_METHOD_LABELS[m as PaymentMethod] ?? m}: ${formatCOP(v.ingreso - v.egreso)}`).join(' · ') : undefined}
        padded={false}
      >
        <MovementsTable rows={data.movements!} onReverse={can('pago.reversar') ? setReverse : undefined} />
      </Card>

      <MovementModal type="ingreso" open={modal === 'ingreso'} onClose={() => setModal(null)} />
      <MovementModal type="egreso" open={modal === 'egreso'} onClose={() => setModal(null)} />
      <CloseModal open={modal === 'close'} onClose={() => setModal(null)} summary={s} />
      <ConfirmDialog
        open={!!reverse}
        onClose={() => setReverse(null)}
        title="Reversar movimiento"
        confirmLabel="Reversar"
        tone="danger"
        requireReason
        loading={rev.isPending}
        onConfirm={(reason) => rev.mutate({ reason })}
        consequence={`Se registrará un movimiento contrario por ${formatCOP(reverse?.amount)}. El original no se borra.`}
      />
    </div>
  );
}

function Stat({ label, value, hint, tone = 'ink' }: { label: string; value: string; hint?: React.ReactNode; tone?: 'ink' | 'ok' | 'risk' | 'petrol' }) {
  const c = { ink: 'text-ink', ok: 'text-ok-700', risk: 'text-risk-700', petrol: 'text-petrol-700' }[tone];
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-[13.5px] font-semibold text-muted">{label}</p>
      <p className={`num mt-1 text-[22px] font-extrabold ${c}`}>{value}</p>
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function MovementsTable({ rows, onReverse }: { rows: CashMovement[]; onReverse?: (m: CashMovement) => void }) {
  const reversed = new Set(rows.map((r) => r.reversalOf).filter(Boolean));
  return (
    <DataTable
      rows={rows}
      rowKey={(m) => m.id}
      pageSize={20}
      empty={<EmptyState title="Todavía no hay movimientos" text="Las ventas, abonos y gastos aparecerán aquí." />}
      columns={[
        { key: 'h', header: 'Hora', render: (m) => <span className="whitespace-nowrap text-[14px]">{formatDateTime(m.createdAt)}</span> },
        {
          key: 'c',
          header: 'Concepto',
          render: (m) => (
            <div>
              <p className="font-medium">{m.concept}</p>
              <p className="text-[12.5px] text-muted">
                {m.category} · {m.userName}
                {m.reference ? ` · ${m.reference}` : ''}
              </p>
            </div>
          ),
        },
        { key: 'm', header: 'Método', render: (m) => PAYMENT_METHOD_LABELS[m.method] ?? m.method, hideOnMobile: true },
        {
          key: 'v',
          header: 'Valor',
          align: 'right',
          render: (m) => (
            <span className={`num font-bold ${m.type === 'ingreso' ? 'text-ok-700' : 'text-risk-700'}`}>
              {m.type === 'ingreso' ? '+' : '−'} {formatCOP(m.amount)}
            </span>
          ),
        },
        ...(onReverse
          ? [
              {
                key: 'r',
                header: '',
                render: (m: CashMovement) =>
                  m.refType === 'manual' && !reversed.has(m.id) ? (
                    <Button size="sm" variant="ghost" icon={Undo2} onClick={() => onReverse(m)}>
                      Reversar
                    </Button>
                  ) : reversed.has(m.id) ? (
                    <Badge tone="neutral">Reversado</Badge>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}

function OpenModal({ open, onClose, suggested }: { open: boolean; onClose: () => void; suggested: number }) {
  const [amount, setAmount] = useState(suggested);
  const [note, setNote] = useState('');
  useEffect(() => setAmount(suggested), [suggested, open]);
  const act = useAction((b: object) => api.post('/cash/open', b), { success: 'Caja abierta. Ya puedes recibir pagos en efectivo.', onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Abrir caja"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={LockOpen} loading={act.isPending} onClick={() => act.mutate({ openingAmount: amount, note })}>
            Abrir caja con {formatCOP(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="¿Cuánto efectivo hay en el cajón?" required hint="Cuenta los billetes y monedas antes de empezar." htmlFor="op-amount">
          <MoneyInput id="op-amount" value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Nota" htmlFor="op-note">
          <Input id="op-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function MovementModal({ type, open, onClose }: { type: 'ingreso' | 'egreso'; open: boolean; onClose: () => void }) {
  const { data: settings } = useApi<Settings>('/settings');
  const cats = type === 'ingreso' ? ['Otro ingreso', ...INCOME_CATEGORIES.filter((c) => c !== 'Otro ingreso')] : (settings?.expenseCategories ?? []);
  const [category, setCategory] = useState('');
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('efectivo');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setCategory(cats[0] ?? '');
      setConcept('');
      setAmount(0);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);
  const act = useAction((b: object) => api.post('/cash/movements', b), { success: type === 'ingreso' ? 'Ingreso registrado' : 'Gasto registrado', silentError: true, onSuccess: onClose });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={type === 'ingreso' ? 'Registrar ingreso' : 'Registrar gasto'}
      description={type === 'ingreso' ? 'Para dinero que entra y no es pago de un pedido (los pagos de pedidos se registran en el pedido).' : 'Para gastos que se pagan ya. Si se paga después, usa “Cuentas por pagar”.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={type === 'ingreso' ? 'success' : 'primary'}
            loading={act.isPending}
            onClick={() => act.mutate({ type, category, concept, amount, method, reference }, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}
          >
            {type === 'ingreso' ? 'Registrar ingreso' : 'Registrar gasto'} de {formatCOP(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors._ ? <Notice tone="risk">{errors._}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría" required htmlFor="mv-cat">
            <Select id="mv-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Valor" required error={errors.amount} htmlFor="mv-amount">
            <MoneyInput id="mv-amount" value={amount} onChange={setAmount} invalid={!!errors.amount} autoFocus />
          </Field>
          <Field label="Concepto" required error={errors.concept} htmlFor="mv-concept" className="sm:col-span-2">
            <Input id="mv-concept" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={type === 'egreso' ? 'Ej: Domicilio pedido PED-0043' : 'Ej: Venta de retazos'} invalid={!!errors.concept} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-[14px] font-semibold text-ink-soft">Método</p>
          <MethodChoice value={method} onChange={setMethod} />
        </div>
        {method !== 'efectivo' ? (
          <Field label="Referencia" htmlFor="mv-ref">
            <Input id="mv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function CloseModal({ open, onClose, summary }: { open: boolean; onClose: () => void; summary: Summary }) {
  const nav = useNavigate();
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setCounted(0);
      setNote('');
      setTouched(false);
    }
  }, [open]);
  const diff = counted - summary.expectedCash;
  const act = useAction((b: object) => api.post<{ id: number; difference: number }>('/cash/close', b), {
    success: (r) => (r.difference === 0 ? 'Caja cerrada. Todo cuadró.' : `Caja cerrada con diferencia de ${formatCOP(r.difference)}.`),
    onSuccess: (r) => {
      onClose();
      nav(`/caja/${r.id}`);
    },
  });
  const needNote = touched && diff !== 0 && !note.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cerrar caja"
      description="Cuenta el efectivo del cajón y escríbelo. El sistema compara con lo que debería haber."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={Lock}
            loading={act.isPending}
            onClick={() => {
              setTouched(true);
              if (diff !== 0 && !note.trim()) return;
              act.mutate({ countedCash: counted, note: note || null });
            }}
          >
            Cerrar caja
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Efectivo contado en el cajón" required htmlFor="cl-counted">
          <MoneyInput id="cl-counted" value={counted} onChange={(v) => { setCounted(v); setTouched(true); }} autoFocus />
        </Field>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-linen p-4 text-center">
          <div>
            <p className="text-[12.5px] font-semibold text-muted">Debe haber</p>
            <p className="num text-[18px] font-extrabold">{formatCOP(summary.expectedCash)}</p>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-muted">Contaste</p>
            <p className="num text-[18px] font-extrabold">{formatCOP(counted)}</p>
          </div>
          <div>
            <p className="text-[12.5px] font-semibold text-muted">Diferencia</p>
            <p className={`num text-[18px] font-extrabold ${diff === 0 ? 'text-ok-700' : 'text-risk-700'}`}>{touched ? (diff === 0 ? 'Cuadra' : `${diff > 0 ? '+' : ''}${formatCOP(diff)}`) : '—'}</p>
          </div>
        </div>
        {touched && diff !== 0 ? (
          <Field label={diff < 0 ? 'Explica por qué falta dinero' : 'Explica por qué sobra dinero'} required error={needNote ? 'Escribe una explicación para poder cerrar.' : null} htmlFor="cl-note">
            <Textarea id="cl-note" value={note} onChange={(e) => setNote(e.target.value)} invalid={needNote} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function Payables() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState('abiertas');
  const [creating, setCreating] = useState(false);
  const [pay, setPay] = useState<PayableRow | null>(null);
  const { data, isLoading, error, refetch } = useApi<{ summary: { pending: number; overdue: number; dueSoon: number; count: number }; rows: PayableRow[] }>(`/payables?status=${status}`);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <div className="space-y-5">
      <SummaryStrip
        items={[
          { label: 'Total por pagar', value: formatCOP(data.summary.pending) },
          { label: 'Vencido', value: formatCOP(data.summary.overdue), tone: data.summary.overdue ? 'risk' : 'ok' },
          { label: 'Vence en 7 días', value: formatCOP(data.summary.dueSoon), tone: 'warn' },
        ]}
      />
      <Card
        padded={false}
        title="Cuentas por pagar"
        subtitle="Compras a crédito y gastos que se pagan después."
        actions={can('gasto.registrar') ? <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>Registrar cuenta por pagar</Button> : null}
      >
        <div className="flex flex-wrap gap-2 border-b border-line p-4">
          {[
            ['abiertas', 'Pendientes'],
            ['vencido', 'Vencidas'],
            ['pagado', 'Pagadas'],
            ['', 'Todas'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${status === k ? 'border-petrol-600 bg-petrol-600 text-white' : 'border-line-strong text-ink-soft hover:bg-petrol-50'}`}>
              {l}
            </button>
          ))}
        </div>
        <DataTable
          rows={data.rows}
          rowKey={(p) => p.id}
          initialSort={{ key: 'd', dir: 'asc' }}
          empty={<EmptyState title="No hay cuentas en este grupo" />}
          columns={[
            {
              key: 'c',
              header: 'Concepto',
              render: (p) => (
                <div>
                  <p className="font-semibold">{p.concept}</p>
                  <p className="text-[12.5px] text-muted">
                    {p.supplierName ?? p.category} · {p.number}
                  </p>
                </div>
              ),
            },
            { key: 's', header: 'Estado', render: (p) => <PayableBadge status={p.status} /> },
            { key: 'd', header: 'Vence', render: (p) => <span className={p.status === 'vencido' ? 'font-semibold text-risk-700' : ''}>{formatDate(p.dueDate)}</span>, sortValue: (p) => p.dueDate },
            { key: 'a', header: 'Valor', align: 'right', render: (p) => <span className="num">{formatCOP(p.amount)}</span>, hideOnMobile: true },
            { key: 'b', header: 'Saldo', align: 'right', render: (p) => <span className="num font-bold">{formatCOP(p.balance)}</span>, sortValue: (p) => p.balance },
            {
              key: 'x',
              header: '',
              render: (p) => (
                <div className="flex justify-end gap-1">
                  {p.purchaseId ? (
                    <Button size="sm" variant="ghost" onClick={() => nav(`/compras/${p.purchaseId}`)}>
                      Ver compra
                    </Button>
                  ) : null}
                  {p.balance > 0 && can('gasto.registrar') ? (
                    <Button size="sm" variant="soft" icon={Wallet} onClick={() => setPay(p)}>
                      Pagar
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Card>
      <NewPayableModal open={creating} onClose={() => setCreating(false)} />
      {pay ? <PayPayableModal open onClose={() => setPay(null)} payable={pay} /> : null}
    </div>
  );
}

function History() {
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useApi<Array<{ id: number; number: string; status: string; openedAt: string; closedAt: string | null; openedByName: string | null; openingAmount: number; countedCash: number | null; difference: number | null; summary: Summary }>>('/cash/sessions');
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingBlock />;
  return (
    <Card padded={false}>
      <DataTable
        rows={data}
        rowKey={(s) => s.id}
        onRowClick={(s) => nav(`/caja/${s.id}`)}
        empty={<EmptyState title="Todavía no hay cajas registradas" />}
        columns={[
          { key: 'n', header: 'Caja', render: (s) => <span className="font-bold text-petrol-700">{s.number}</span> },
          { key: 'd', header: 'Abierta', render: (s) => formatDateTime(s.openedAt) },
          { key: 'st', header: 'Estado', render: (s) => (s.status === 'abierta' ? <Badge tone="ok">Abierta</Badge> : <Badge tone="neutral">Cerrada</Badge>) },
          { key: 'i', header: 'Entradas', align: 'right', render: (s) => <span className="num text-ok-700">{formatCOP(s.summary.income)}</span> },
          { key: 'e', header: 'Salidas', align: 'right', render: (s) => <span className="num text-risk-700">{formatCOP(s.summary.expense)}</span> },
          { key: 'c', header: 'Contado', align: 'right', render: (s) => <span className="num">{s.countedCash != null ? formatCOP(s.countedCash) : '—'}</span> },
          { key: 'f', header: 'Diferencia', align: 'right', render: (s) => (s.difference == null ? '—' : s.difference === 0 ? <Badge tone="ok">Cuadró</Badge> : <Badge tone="risk">{formatCOP(s.difference)}</Badge>) },
        ]}
      />
    </Card>
  );
}
