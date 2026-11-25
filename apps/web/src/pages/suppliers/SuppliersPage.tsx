import { formatCOP, formatDate } from '@nexo/shared';
import { Building2, PackagePlus, Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/ui/Feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/Form';
import { Card, PageHeader, Tabs } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Overlay';
import { SearchInput } from '@/components/ui/Pickers';
import { PurchaseBadge } from '@/components/ui/Status';
import { DataTable } from '@/components/ui/Table';
import { api, ApiError, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useApi, useDebounced } from '@/lib/hooks';
import type { Supplier } from '@/lib/types';

interface PurchaseRow {
  id: number;
  number: string;
  supplierName: string;
  status: string;
  date: string;
  dueDate: string | null;
  total: number;
  paid: number;
  balance: number;
}

export default function SuppliersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'compras';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [pStatus, setPStatus] = useState('abiertas');
  const [form, setForm] = useState(false);
  const sup = useApi<Supplier[]>(tab === 'proveedores' ? `/suppliers${qs({ q: dq })}` : null);
  const pur = useApi<PurchaseRow[]>(tab === 'compras' ? `/purchases${qs({ status: pStatus })}` : null);
  return (
    <div>
      <PageHeader
        title="Compras"
        actions={
          <>
            {can('proveedor.editar') ? (
              <Button variant="secondary" icon={Plus} onClick={() => setForm(true)}>
                Agregar proveedor
              </Button>
            ) : null}
            {can('compra.gestionar') ? (
              <ButtonLink to="/compras/nueva" icon={PackagePlus}>
                Nueva compra
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        tabs={[
          { value: 'compras', label: 'Compras' },
          { value: 'proveedores', label: 'Proveedores' },
        ]}
      />
      {tab === 'proveedores' ? (
        <Card padded={false}>
          <div className="border-b border-line p-4">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por nombre, NIT o lo que vende" className="max-w-xl" />
          </div>
          {sup.error ? (
            <ErrorState error={sup.error} onRetry={sup.refetch} />
          ) : sup.isLoading ? (
            <LoadingBlock />
          ) : (
            <DataTable
              rows={sup.data ?? []}
              rowKey={(s) => s.id}
              onRowClick={(s) => nav(`/proveedores/${s.id}`)}
              empty={<EmptyState title="Todavía no hay proveedores" action={can('proveedor.editar') ? <Button icon={Plus} onClick={() => setForm(true)}>Agregar proveedor</Button> : undefined} />}
              columns={[
                { key: 'n', header: 'Proveedor', render: (s) => <div><p className="font-semibold">{s.name}</p><p className="text-[12.5px] text-muted">{s.supplies}</p></div>, sortValue: (s) => s.name },
                { key: 'c', header: 'Contacto', render: (s) => <span className="text-[14px]">{s.contactName}<span className="block text-muted">{s.phone}</span></span>, hideOnMobile: true },
                { key: 'l', header: 'Última compra', render: (s) => formatDate(s.lastPurchase), sortValue: (s) => s.lastPurchase },
                { key: 't', header: 'Total comprado', align: 'right', render: (s) => <span className="num">{formatCOP(s.totalBought)}</span>, sortValue: (s) => s.totalBought },
                { key: 'b', header: 'Le debes', align: 'right', render: (s) => (s.balance ? <span className="num font-semibold text-warn-700">{formatCOP(s.balance)}</span> : <span className="text-muted">—</span>), sortValue: (s) => s.balance },
              ]}
            />
          )}
        </Card>
      ) : (
        <Card padded={false}>
          <div className="flex flex-wrap gap-2 border-b border-line p-4">
            {[
              ['abiertas', 'Por recibir'],
              ['recibida', 'Recibidas'],
              ['cancelada', 'Canceladas'],
              ['', 'Todas'],
            ].map(([k, l]) => (
              <button key={k} onClick={() => setPStatus(k)} aria-pressed={pStatus === k} className={`rounded-full border px-3 py-1.5 text-[14px] font-semibold ${pStatus === k ? 'border-petrol-600 bg-petrol-600 text-white' : 'border-line-strong text-ink-soft hover:bg-petrol-50'}`}>
                {l}
              </button>
            ))}
          </div>
          {pur.error ? (
            <ErrorState error={pur.error} onRetry={pur.refetch} />
          ) : pur.isLoading ? (
            <LoadingBlock />
          ) : (
            <DataTable
              rows={pur.data ?? []}
              rowKey={(p) => p.id}
              onRowClick={(p) => nav(`/compras/${p.id}`)}
              empty={<EmptyState title={pStatus === 'abiertas' ? 'No hay compras pendientes por recibir' : 'No hay compras en este grupo'} action={can('compra.gestionar') ? <ButtonLink to="/compras/nueva" icon={PackagePlus}>Nueva compra</ButtonLink> : undefined} />}
              columns={[
                { key: 'n', header: 'Compra', render: (p) => <span className="font-bold text-petrol-700">{p.number}</span>, sortValue: (p) => p.id },
                { key: 's', header: 'Proveedor', render: (p) => p.supplierName, sortValue: (p) => p.supplierName },
                { key: 'st', header: 'Estado', render: (p) => <PurchaseBadge status={p.status} /> },
                { key: 'd', header: 'Fecha', render: (p) => formatDate(p.date), sortValue: (p) => p.date },
                { key: 't', header: 'Total', align: 'right', render: (p) => <span className="num">{formatCOP(p.total)}</span>, sortValue: (p) => p.total },
                { key: 'b', header: 'Por pagar', align: 'right', render: (p) => (p.balance > 0 && p.status !== 'cancelada' ? <span className="num font-semibold text-warn-700">{formatCOP(p.balance)}</span> : <span className="text-ok-700">Pagada</span>) },
              ]}
            />
          )}
        </Card>
      )}
      <SupplierFormModal open={form} onClose={() => setForm(false)} onSaved={(s) => nav(`/proveedores/${s.id}`)} />
    </div>
  );
}

export function SupplierFormModal({ open, onClose, supplier, onSaved }: { open: boolean; onClose: () => void; supplier?: Supplier | null; onSaved?: (s: Supplier) => void }) {
  const blank = { name: '', document: '', contactName: '', phone: '', email: '', address: '', supplies: '', notes: '', paymentTermDays: 0 };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(supplier ? { name: supplier.name, document: supplier.document ?? '', contactName: supplier.contactName ?? '', phone: supplier.phone ?? '', email: supplier.email ?? '', address: supplier.address ?? '', supplies: supplier.supplies ?? '', notes: supplier.notes ?? '', paymentTermDays: supplier.paymentTermDays } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier]);
  const set = (k: keyof typeof f, v: string | number) => setF((x) => ({ ...x, [k]: v }));
  const save = useAction(() => (supplier ? api.put<Supplier>(`/suppliers/${supplier.id}`, f) : api.post<Supplier>('/suppliers', f)), {
    success: supplier ? 'Proveedor actualizado' : 'Proveedor creado',
    silentError: true,
    onSuccess: (s) => {
      onSaved?.(s);
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={supplier ? `Editar ${supplier.name}` : 'Agregar proveedor'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={Save} loading={save.isPending} onClick={() => save.mutate(undefined, { onError: (e: ApiError) => setErrors({ ...(e.fields ?? {}), _: e.message }) })}>
            Guardar proveedor
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {errors._ ? <p className="rounded-lg bg-risk-50 px-3 py-2 font-semibold text-risk-700 sm:col-span-2">{errors._}</p> : null}
        <Field label="Nombre o razón social" required error={errors.name} htmlFor="s-name" className="sm:col-span-2">
          <Input id="s-name" value={f.name} onChange={(e) => set('name', e.target.value)} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="NIT o documento" htmlFor="s-doc">
          <Input id="s-doc" value={f.document} onChange={(e) => set('document', e.target.value)} />
        </Field>
        <Field label="Plazo de pago" htmlFor="s-term" hint="Días que da el proveedor para pagar.">
          <Select id="s-term" value={f.paymentTermDays} onChange={(e) => set('paymentTermDays', Number(e.target.value))}>
            {[0, 8, 15, 30, 45, 60].map((d) => (
              <option key={d} value={d}>
                {d ? `${d} días` : 'De contado'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Persona de contacto" htmlFor="s-contact">
          <Input id="s-contact" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} />
        </Field>
        <Field label="Teléfono" error={errors.phone} htmlFor="s-phone">
          <Input id="s-phone" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} invalid={!!errors.phone} />
        </Field>
        <Field label="Correo" htmlFor="s-email">
          <Input id="s-email" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Dirección" htmlFor="s-addr">
          <Input id="s-addr" value={f.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="¿Qué te vende?" htmlFor="s-sup" className="sm:col-span-2">
          <Input id="s-sup" value={f.supplies} onChange={(e) => set('supplies', e.target.value)} placeholder="Ej: telas antifluido y dril" />
        </Field>
        <Field label="Notas" htmlFor="s-notes" className="sm:col-span-2">
          <Textarea id="s-notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
